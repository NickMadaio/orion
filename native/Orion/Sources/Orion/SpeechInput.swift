import AppKit
import AVFoundation
import Foundation
import Speech

/*
 Microphone in, text out.

 Two ears, one microphone.

 `SFSpeechRecognizer` with an audio-buffer request, forced on-device where the
 installed locale supports it: lower latency, and nothing about what is said in
 this room leaves the machine. Orion is local-first and that is not a detail.

 Deepgram is the optional alternative, chosen in Preferences. What it buys is
 server-side endpointing: Apple's recogniser has no fast end-of-utterance signal,
 so a released push-to-talk key waits up to `appleFinalGrace` for the last
 partial to be promoted. Deepgram answers a `Finalize` within a couple of
 hundred milliseconds. That gap is most of the delay between "I stopped talking"
 and "Orion started thinking".

 Whichever is active, there is exactly ONE `AVAudioEngine` and exactly ONE input
 tap. It feeds four consumers — the recogniser in use, the hologram's level
 meter, a short replay buffer that makes the Deepgram→Apple fallback seamless,
 and `onMonitor`, the passive hook the wake word reads. Orion never opens a
 second microphone session, and `WakeWordListener` has no engine of its own to
 open one with.

 The tap has two modes. Push-to-talk starts it and stops it around an utterance,
 as it always has. `startMonitoring()` holds the same tap open indefinitely with
 no recogniser attached, which is what the wake word needs; `stopEngine` then
 declines to close a session something else is still using. The level only
 reaches the hologram while Orion is genuinely listening, so an idle Orion does
 not sit there shimmering at an empty room.

 If Deepgram has no key, cannot connect, or dies mid-utterance, the captured
 audio is replayed into `SFSpeechRecognizer` and the user is told which ear is
 actually listening. Dictation never just stops working.

 Callbacks are always delivered on the main thread.
 */
final class SpeechInput {

    var onPartial: ((String) -> Void)?
    var onFinal: ((String) -> Void)?
    var onLevel: ((Double) -> Void)?
    var onError: ((String) -> Void)?
    /// Fires when the ear actually serving is settled or changes, with an
    /// optional note for the transcript. Reports what IS listening, never what
    /// was merely configured.
    var onActiveProvider: ((STTProvider, String?) -> Void)?
    /// Passive observer of the one input tap: every buffer, with its level, on
    /// the main thread, in every mode. The wake word is the only consumer, and
    /// this is the only way audio reaches it — it cannot open a microphone.
    var onMonitor: ((AVAudioPCMBuffer, Double) -> Void)?

    private(set) var isRunning = false
    /// What is REALLY listening, after any fallback.
    private(set) var activeProvider: STTProvider = .apple

    private let engine = AVAudioEngine()
    private let recognizer: SFSpeechRecognizer?
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?

    private var deepgram: DeepgramStream?
    private let converter = LinearPCMConverter()
    /// Audio captured before a route is settled. Replayed into whichever
    /// recogniser wins, so the fallback costs no words.
    private var replay: [AVAudioPCMBuffer] = []
    private var replaying = true

    private var latestText = ""
    private var awaitingFinal = false
    private var finalTimer: Timer?
    private var startGeneration = 0

    /// Someone (the wake word) needs the microphone session held open between
    /// utterances. While true, stopping an utterance leaves the tap in place.
    private var monitoring = false
    /// There is no API to ask a node whether it has a tap, so track it.
    private var tapInstalled = false
    private var configurationObserver: NSObjectProtocol?

    /// How long to let Apple promote its last partial to a final result.
    /// Tunable for the same reason as Deepgram's endpointing: too short and a
    /// trailing word is dropped. See `VoiceTuning.appleFinalGrace`.
    private static var appleFinalGrace: TimeInterval { VoiceTuning.appleFinalGrace }
    /// Deepgram answers a `Finalize` fast; this is only the safety net.
    private static let deepgramFinalGrace: TimeInterval = 0.8
    /// ~3 seconds at 48 kHz in 1024-frame buffers. Enough to cover a failed
    /// connect without letting a long hold grow the buffer without bound.
    private static let replayLimit = 140

    init() {
        recognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US")) ?? SFSpeechRecognizer()
    }

    // MARK: Permissions

    static var speechAuthorized: Bool {
        SFSpeechRecognizer.authorizationStatus() == .authorized
    }

    static var speechDenied: Bool {
        let status = SFSpeechRecognizer.authorizationStatus()
        return status == .denied || status == .restricted
    }

    static var microphoneAuthorized: Bool {
        AVCaptureDevice.authorizationStatus(for: .audio) == .authorized
    }

    static var microphoneDenied: Bool {
        let status = AVCaptureDevice.authorizationStatus(for: .audio)
        return status == .denied || status == .restricted
    }

    /// Asks for both permissions in the order the user will understand them.
    /// Denial produces a real message, never a silent no-op.
    ///
    /// Speech Recognition is requested even when Deepgram is the configured ear,
    /// because Apple is the fallback and a permission dialog in the middle of a
    /// network failure is the worst possible moment for one.
    func requestPermissions(_ completion: @escaping (Bool, String?) -> Void) {
        // Come to the front before asking.
        //
        // Orion is LSUIElement and its panel is deliberately non-activating, so
        // when push-to-talk fires while another app is frontmost, Orion has no
        // UI context in which macOS can present a permission prompt. It does
        // not queue the request — it denies it outright, instantly, and records
        // the denial. The log showed the whole thing inside one second:
        //
        //   [press]         microphone=not-yet-asked
        //   [permissions]   REFUSED
        //   [after-refusal] microphone=DENIED
        //
        // Activating first is what gives the prompt somewhere to appear. This
        // only runs on the path where a permission is still undecided, so it
        // costs one focus change once, not on every press.
        NSApp.activate(ignoringOtherApps: true)

        SFSpeechRecognizer.requestAuthorization { status in
            DispatchQueue.main.async {
                guard status == .authorized else {
                    completion(false, "Orion needs Speech Recognition access to hear you. Turn it on in System Settings ▸ Privacy & Security ▸ Speech Recognition.")
                    return
                }
                AVCaptureDevice.requestAccess(for: .audio) { granted in
                    DispatchQueue.main.async {
                        if granted {
                            completion(true, nil)
                        } else {
                            completion(false, "Orion needs Microphone access to hear you. Turn it on in System Settings ▸ Privacy & Security ▸ Microphone.")
                        }
                    }
                }
            }
        }
    }

    private var lastAudioLog = Date.distantPast
    private var peakLevel: Double = 0
    private var conversionFailures = 0
    private var bytesSentToDeepgram = 0

    /// Buffers that actually reached a recogniser, either one. The Deepgram byte
    /// count cannot answer "is anything being heard at all" because it stays at
    /// zero for the whole of an Apple utterance, which looks identical to being
    /// deaf.
    private var buffersRouted = 0
    /// Buffers `route` had nowhere to put, and when we last said so. Dropping
    /// audio in silence is how the 2026-08-12 stall stayed invisible for twelve
    /// minutes; dropping it 40 times a second into the log would be no better.
    private var buffersDropped = 0
    private var lastDropLog = Date.distantPast
    private var lastRouteProgressAt = Date.distantPast
    /// The last time the room was loud enough that something SHOULD have been
    /// routed. Starvation is only meaningful against real input — a quiet room
    /// that routes nothing is not starving, it is quiet.
    private var lastLoudAt = Date.distantPast
    private var starvationTimer: Timer?

    /// Live microphone with nothing reaching an ear for this long means the
    /// utterance is starved. Comfortably longer than a natural pause, and far
    /// shorter than the user's patience.
    private static let starvationTimeout: TimeInterval = 5
    /// Level that counts as "someone is actually talking in this room".
    private static let starvationFloor: Double = 0.08
    /// How often to repeat the dropped-audio line while it keeps happening.
    private static let dropLogInterval: TimeInterval = 2.0

    /// Deepgram is connected but is being fed nothing. Say so and hand the
    /// utterance to Apple rather than listening to silence.
    private func deepgramStarved(_ reason: String) {
        guard deepgram != nil else { return }
        OrionLog.write("[deepgram] STARVED: \(reason) — switching to Apple")
        fallBackToApple(reason: "Deepgram could not be fed audio")
    }

    /// Throttled evidence that the tap is alive. Silence here means the
    /// microphone never opened; sound here means the problem is downstream.
    ///
    /// `ear=` reports where buffers are ACTUALLY going this second, which is not
    /// the same as `activeProvider`. It used to print the configured provider
    /// unconditionally, so a tap held open for the wake word between utterances
    /// logged `ear=deepgram sent=<frozen>` at a room nobody was transcribing —
    /// twelve minutes of that is what the 2026-08-12 stall looked like from the
    /// log, and it read like a broken Deepgram rather than a phase that never
    /// ended. `ear=monitor` is the honest answer: the tap is alive, the wake
    /// word can hear, and no utterance is open.
    private func logAudio(_ level: Double) {
        peakLevel = max(peakLevel, level)
        let now = Date()
        guard now.timeIntervalSince(lastAudioLog) >= 1.0 else { return }
        lastAudioLog = now
        let ear: String
        if !isRunning {
            ear = "monitor"
        } else if request != nil {
            ear = STTProvider.apple.rawValue
        } else if let deepgram, deepgram.isOpen {
            ear = STTProvider.deepgram.rawValue
        } else {
            // An utterance IS open and yet there is nowhere to put a buffer:
            // Deepgram is still shaking hands, or its socket died without
            // saying so. This is the state the starvation watchdog exists for.
            ear = "none"
        }
        OrionLog.write(String(format: "[audio] level=%.3f peak=%.3f ear=%@ sent=%dB",
                              level, peakLevel, ear, bytesSentToDeepgram))
        peakLevel = 0
    }

    // MARK: The listening watchdog

    /*
     `.speaking` and `.thinking` have floors in `AppState`; this is the same
     floor for the phase `AppState` cannot see into. Only this object knows
     whether buffers are reaching an ear, so only this object can tell the
     difference between "the room is quiet" and "the room is loud and Orion is
     hearing none of it".

     The recovery is deliberately the one that already exists. `deepgramStarved`
     announces the switch and replays the captured audio into Apple, so a
     starved utterance costs a provider change rather than the words.
    */

    private func armStarvationWatchdog() {
        starvationTimer?.invalidate()
        let now = Date()
        lastRouteProgressAt = now
        lastLoudAt = now
        starvationTimer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] _ in
            self?.checkStarvation()
        }
    }

    private func disarmStarvationWatchdog() {
        starvationTimer?.invalidate()
        starvationTimer = nil
    }

    private func checkStarvation() {
        guard isRunning else {
            disarmStarvationWatchdog()
            return
        }
        let now = Date()
        // Nothing to hear means nothing to route. Not a fault.
        guard now.timeIntervalSince(lastLoudAt) < SpeechInput.starvationTimeout else { return }
        guard now.timeIntervalSince(lastRouteProgressAt) >= SpeechInput.starvationTimeout else { return }

        let silent = Int(now.timeIntervalSince(lastRouteProgressAt))
        if deepgram != nil {
            deepgramStarved("microphone is live but nothing has reached the socket in \(silent)s")
            return
        }
        // Apple's turn to be starving. There is no second recogniser to fall
        // back to, so this is a log line rather than a recovery — but a stall
        // that names itself is one somebody can fix. The routed/dropped pair is
        // the diagnosis: routed climbing means the recogniser is deaf, dropped
        // climbing means the audio never got that far.
        OrionLog.write(
            "[audio] STARVED: utterance open, room is loud, nothing routed in \(silent)s "
                + "(routed=\(buffersRouted) dropped=\(buffersDropped))"
        )
        lastRouteProgressAt = now
    }

    // MARK: Lifecycle

    func start() {
        guard !isRunning else { return }
        cancelPendingFinal()
        // A new press supersedes any utterance still waiting to be finalised.
        awaitingFinal = false

        guard let recognizer = recognizer else {
            onError?("Speech recognition is not available on this Mac.")
            return
        }
        guard recognizer.isAvailable else {
            onError?("Speech recognition is temporarily unavailable. Try again in a moment.")
            return
        }

        // Fast path: on every press after the first, both permissions are
        // already decided, so we skip the async round trip entirely.
        if SpeechInput.speechAuthorized && SpeechInput.microphoneAuthorized {
            begin(recognizer)
            return
        }

        startGeneration += 1
        let generation = startGeneration
        requestPermissions { [weak self] granted, message in
            guard let self, self.startGeneration == generation else { return }
            if granted {
                OrionLog.write("[permissions] granted — starting")
                self.begin(recognizer)
            } else {
                OrionLog.write("[permissions] REFUSED: \(message ?? "no reason given")")
                OrionLog.permissionSnapshot("after-refusal")
                self.onError?(message ?? "Orion could not get permission to listen.")
            }
        }
    }

    private func begin(_ recognizer: SFSpeechRecognizer) {
        guard !isRunning else { return }

        latestText = ""
        awaitingFinal = false
        replay.removeAll(keepingCapacity: true)
        replaying = true

        // Decide the ear before opening the microphone, so the tap knows where
        // buffers are going the moment they start arriving.
        let wanted = VoiceSettings.stt
        if wanted == .deepgram, let key = Secrets.deepgramKey {
            OrionLog.write("[ear] Deepgram selected, key present — connecting")
            startDeepgram(key: key)
        } else {
            if wanted == .deepgram {
                OrionLog.write("[ear] Deepgram selected but NO KEY — falling back to Apple")
                announce(.apple, "Deepgram is selected but no \(Secrets.deepgramVariable) was found — listening on-device instead.")
            } else {
                announce(.apple, nil)
            }
            startApple(recognizer)
        }

        guard startMicrophone() else {
            teardownRecognisers()
            return
        }
        isRunning = true
        // Armed only for the life of an utterance: outside one, routing nothing
        // is the correct behaviour rather than a stall.
        armStarvationWatchdog()
    }

    // MARK: Monitoring
    //
    // The wake word needs the microphone open when nothing is being dictated.
    // Rather than let it have an engine of its own, it borrows this one: the tap
    // stays installed, no recogniser is attached, and buffers reach `onMonitor`
    // and nowhere else.

    /// Holds the single microphone session open with no recogniser attached.
    /// Returns false if the microphone is unavailable or unpermitted, so the
    /// caller can say so rather than listening to nothing.
    @discardableResult
    func startMonitoring() -> Bool {
        OrionLog.write("[monitor] starting passive tap")
        guard SpeechInput.microphoneAuthorized else { return false }
        monitoring = true
        guard startMicrophone() else {
            monitoring = false
            return false
        }
        observeConfigurationChanges()
        return true
    }

    func stopMonitoring() {
        guard monitoring else { return }
        monitoring = false
        if let configurationObserver {
            NotificationCenter.default.removeObserver(configurationObserver)
        }
        configurationObserver = nil
        // An utterance in flight keeps the session; it will close it itself.
        if !isRunning && !awaitingFinal {
            stopEngine()
        }
    }

    /// A long-lived session outlives device changes. Plugging in AirPods tears
    /// the engine's graph down, and without this the wake word would go quietly
    /// deaf until the next push-to-talk re-opened the microphone.
    private func observeConfigurationChanges() {
        guard configurationObserver == nil else { return }
        configurationObserver = NotificationCenter.default.addObserver(
            forName: .AVAudioEngineConfigurationChange,
            object: engine,
            queue: .main
        ) { [weak self] _ in
            guard let self, self.monitoring, !self.isRunning, !self.awaitingFinal else { return }
            self.stopEngine(force: true)
            _ = self.startMicrophone()
        }
    }

    /// The one microphone session. Everything else is a consumer of this tap.
    /// Idempotent: a push-to-talk press during monitoring reuses the tap that is
    /// already running rather than tearing it down and building another.
    private func startMicrophone() -> Bool {
        if engine.isRunning && tapInstalled { return true }

        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        guard format.sampleRate > 0, format.channelCount > 0 else {
            onError?("No microphone input is available right now.")
            return false
        }

        input.removeTap(onBus: 0)
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
            // The level is computed on the audio thread; everything downstream
            // of it happens on the main thread.
            let level = orionNormalisedLevel(buffer)
            DispatchQueue.main.async {
                guard let self else { return }
                // The wake word sees every buffer in every mode. The hologram
                // sees the level only while Orion is genuinely listening — an
                // idle Orion should not shimmer at the room.
                self.onMonitor?(buffer, level)
                if self.isRunning { self.onLevel?(level) }
                // Remembered before routing, so the starvation watchdog is
                // comparing "the room was loud" against "and nothing moved".
                if level >= SpeechInput.starvationFloor { self.lastLoudAt = Date() }
                // One line per second while listening: proves whether the
                // microphone is producing audio at all, before blaming an ear.
                self.logAudio(level)
                self.route(buffer)
            }
        }
        tapInstalled = true

        engine.prepare()
        do {
            try engine.start()
        } catch {
            input.removeTap(onBus: 0)
            tapInstalled = false
            onError?("Could not start the microphone: \(error.localizedDescription)")
            return false
        }
        return true
    }

    /// Main thread. Sends one buffer wherever it needs to go.
    ///
    /// Only while an utterance is open: in monitoring-only mode there is no
    /// recogniser to feed and nothing to replay, so buffers stop here.
    private func route(_ buffer: AVAudioPCMBuffer) {
        // Not a drop worth counting: with no utterance open there is nothing to
        // route to, which is the ordinary state of a tap held open for the wake
        // word. `logAudio` says `ear=monitor` so the log still shows which of
        // the two situations this is.
        guard isRunning else { return }
        if let request {
            request.append(buffer)
            noteRouted()
            return
        }
        if let deepgram, deepgram.isOpen {
            // `LinearPCMConverter` has a FAILABLE init, so `converter` is an
            // Optional. Written as `converter?.data(...)` this silently dropped
            // every buffer when the converter was nil or a conversion failed —
            // Deepgram held an open socket and received no audio at all, which
            // looks exactly like "the API is broken".
            guard let converter else {
                deepgramStarved("audio converter unavailable")
                return
            }
            guard let data = converter.data(from: buffer) else {
                conversionFailures += 1
                if conversionFailures == 5 {
                    deepgramStarved("audio conversion failed repeatedly")
                }
                return
            }
            // Empty is fine — the resampler is accumulating, not failing.
            guard !data.isEmpty else { return }
            conversionFailures = 0
            bytesSentToDeepgram += data.count
            deepgram.send(audio: data)
            noteRouted()
            return
        }
        // Nothing is ready to receive audio yet — Deepgram is still shaking
        // hands. Hold it so the fallback, if it happens, loses no words.
        if replaying, replay.count < SpeechInput.replayLimit {
            replay.append(buffer)
            return
        }
        // Past here the buffer is genuinely gone: an utterance is open, the
        // replay buffer is full or closed, and no recogniser will ever see this
        // audio. Say so — throttled, because this arrives 40+ times a second.
        noteDropped()
    }

    /// A buffer reached a recogniser. Resets the starvation deadline.
    private func noteRouted() {
        buffersRouted += 1
        lastRouteProgressAt = Date()
    }

    private func noteDropped() {
        buffersDropped += 1
        let now = Date()
        guard now.timeIntervalSince(lastDropLog) >= SpeechInput.dropLogInterval else { return }
        lastDropLog = now
        OrionLog.write("[audio] DROPPED \(buffersDropped) buffer(s) — utterance open with nowhere to route")
    }

    // MARK: Apple

    private func startApple(_ recognizer: SFSpeechRecognizer) {
        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        // On-device keeps the audio local and removes the network round trip,
        // which is most of the interim-result latency.
        if recognizer.supportsOnDeviceRecognition {
            request.requiresOnDeviceRecognition = true
        }
        self.request = request

        task = recognizer.recognitionTask(with: request) { [weak self] result, error in
            DispatchQueue.main.async {
                guard let self else { return }
                if let result {
                    let text = result.bestTranscription.formattedString
                    if !text.isEmpty {
                        OrionLog.write("[apple] heard: \(text)")
                        self.latestText = text
                        self.onPartial?(text)
                    }
                    if result.isFinal {
                        self.deliverFinal()
                    }
                    return
                }
                if error != nil {
                    // The task ends with an error on a clean `endAudio` too, so
                    // this is the normal path as often as it is the sad one.
                    if self.awaitingFinal {
                        self.deliverFinal()
                    } else if self.isRunning {
                        self.stopEngine()
                        self.isRunning = false
                        self.disarmStarvationWatchdog()
                        self.onError?("Dictation stopped unexpectedly. Hold Right Option and try again.")
                    }
                }
            }
        }

        // Replay anything captured while a previous route was being decided.
        flushReplay { request.append($0) }
        replaying = false
    }

    // MARK: Deepgram

    private func startDeepgram(key: String) {
        let stream = DeepgramStream(apiKey: key)
        deepgram = stream

        stream.onOpen = { [weak self] in
            guard let self, self.deepgram === stream else { return }
            OrionLog.write("[deepgram] socket OPEN — listening via Deepgram")
            self.announce(.deepgram, nil)
            self.flushReplay { buffer in
                if let data = self.converter?.data(from: buffer) {
                    stream.send(audio: data)
                }
            }
            self.replaying = false
        }
        stream.onPartial = { [weak self] text in
            OrionLog.write("[deepgram] heard something")
            guard let self, self.deepgram === stream else { return }
            self.latestText = text
            self.onPartial?(text)
        }
        stream.onSegment = { [weak self] text in
            guard let self, self.deepgram === stream else { return }
            self.latestText = text
        }
        stream.onEndOfSpeech = { [weak self] in
            guard let self, self.deepgram === stream else { return }
            // Only acted on once the key is up: while it is held, the user is
            // still in charge of where the utterance ends.
            if self.awaitingFinal { self.deliverFinal() }
        }
        stream.onFailure = { [weak self] message in
            OrionLog.write("[deepgram] FAILED — falling back to Apple")
            guard let self, self.deepgram === stream else { return }
            self.fallBackToApple(reason: message)
        }
        stream.connect()
    }

    /// Deepgram could not serve. Move this utterance to Apple without losing the
    /// audio already captured, and say so in the transcript.
    private func fallBackToApple(reason: String) {
        deepgram?.abort()
        deepgram = nil

        guard let recognizer, recognizer.isAvailable else {
            if isRunning || awaitingFinal {
                onError?("Deepgram is unavailable (\(reason)) and on-device dictation is not ready.")
            }
            return
        }
        announce(.apple, "Deepgram unavailable (\(reason)) — listening on-device instead.")
        startApple(recognizer)

        // The key may already be up: finish the utterance rather than stranding
        // it on a recogniser that will never be told the audio ended.
        if awaitingFinal {
            request?.endAudio()
            scheduleFinal(after: SpeechInput.appleFinalGrace)
        }
    }

    private func flushReplay(_ sink: (AVAudioPCMBuffer) -> Void) {
        for buffer in replay { sink(buffer) }
        replay.removeAll(keepingCapacity: false)
    }

    private func announce(_ provider: STTProvider, _ note: String?) {
        let changed = provider != activeProvider
        activeProvider = provider
        if changed || note != nil {
            onActiveProvider?(provider, note)
        }
    }

    // MARK: Stopping

    /// Release of push-to-talk: close the audio stream and give the recogniser a
    /// brief moment to promote the last partial to a final result.
    func stop() {
        guard isRunning else { return }
        isRunning = false
        awaitingFinal = true
        disarmStarvationWatchdog()

        stopEngine()
        onLevel?(0)

        if let deepgram {
            // `Finalize` flushes what the server is still holding; the grace
            // period is only a safety net, not the expected path.
            deepgram.finish()
            scheduleFinal(after: SpeechInput.deepgramFinalGrace)
            return
        }
        request?.endAudio()
        scheduleFinal(after: SpeechInput.appleFinalGrace)
    }

    /// Drop the current utterance without delivering a result, but leave the
    /// microphone session alone.
    ///
    /// The difference from `abort()` is who keeps the microphone: `abort()`
    /// forces it shut, which is right when the app is quitting and wrong when a
    /// conversation simply lapsed — there, the wake word is still supposed to
    /// be listening, and forcing the engine down would leave `monitoring` true
    /// with nothing running behind it, which is deafness that reports itself as
    /// health.
    ///
    /// The difference from `stop()` is that nothing is delivered: a follow-up
    /// window that timed out has heard silence, and announcing "nothing heard"
    /// for a question the user never asked is noise.
    func discardUtterance() {
        cancelPendingFinal()
        awaitingFinal = false
        isRunning = false
        disarmStarvationWatchdog()
        request?.endAudio()
        teardownRecognisers()
        latestText = ""
        replay.removeAll(keepingCapacity: false)
        // Not forced: if the wake word is monitoring, the tap stays installed.
        stopEngine()
        onLevel?(0)
    }

    /// Hard stop with no result — used when the app quits. Unlike `stop()`, this
    /// closes the microphone even if the wake word was holding it open, so the
    /// caller should stop monitoring first if it wants it back.
    func abort() {
        cancelPendingFinal()
        awaitingFinal = false
        isRunning = false
        disarmStarvationWatchdog()
        stopEngine(force: true)
        request?.endAudio()
        teardownRecognisers()
        latestText = ""
        replay.removeAll(keepingCapacity: false)
        onLevel?(0)
    }

    private func teardownRecognisers() {
        task?.cancel()
        task = nil
        request = nil
        deepgram?.abort()
        deepgram = nil
    }

    /// Ends the utterance's claim on the microphone. If the wake word still has
    /// one, the session stays up and the tap stays installed — `route` simply
    /// has nowhere to send audio now. Only `force` actually closes it.
    private func stopEngine(force: Bool = false) {
        if monitoring && !force { return }
        if engine.isRunning {
            engine.stop()
        }
        engine.inputNode.removeTap(onBus: 0)
        tapInstalled = false
    }

    private func scheduleFinal(after seconds: TimeInterval) {
        finalTimer?.invalidate()
        finalTimer = Timer.scheduledTimer(withTimeInterval: seconds, repeats: false) { [weak self] _ in
            DispatchQueue.main.async { self?.deliverFinal() }
        }
    }

    private func cancelPendingFinal() {
        finalTimer?.invalidate()
        finalTimer = nil
    }

    private func deliverFinal() {
        guard awaitingFinal else { return }
        awaitingFinal = false
        cancelPendingFinal()

        let text = latestText.trimmingCharacters(in: .whitespacesAndNewlines)
        latestText = ""
        task?.finish()
        task = nil
        request = nil
        deepgram?.abort()
        deepgram = nil
        replay.removeAll(keepingCapacity: false)

        onFinal?(text)
    }
}
