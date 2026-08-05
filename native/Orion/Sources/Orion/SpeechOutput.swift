import AVFoundation
import Foundation

/*
 Text in, voice out.

 Chunks are played the moment their frame arrives, queued in order, instead of
 waiting for the daemon's `done`. That is the entire reason stream mode exists
 and it is the single biggest perceived-latency win available: the first
 sentence starts speaking while the last one is still being synthesised.

 `AVAudioEngine` + `AVAudioPlayerNode` rather than `AVAudioPlayer` so the output
 can be tapped for a playback level, which is what makes the hologram's core
 pulse in time with Orion's own voice.

 If the daemon is missing or errors before a single chunk plays, we fall back to
 `AVSpeechSynthesizer`. Orion is never mute.

 Which voice the daemon uses — local MLX or ElevenLabs — is chosen in
 Preferences and sent with each request. The daemon reports back the engine that
 ACTUALLY served, and that is what `onActiveEngine` publishes: a configured
 provider that quietly fell back is exactly the failure worth surfacing.

 Everything on this class is main-thread only; the audio taps hop back.
 */
final class SpeechOutput: NSObject, AVSpeechSynthesizerDelegate {

    var onLevel: ((Double) -> Void)?
    var onFinished: (() -> Void)?
    var onNotice: ((String) -> Void)?
    /// The engine that really spoke, as reported by the daemon.
    var onActiveEngine: ((String) -> Void)?

    private(set) var isSpeaking = false

    private let engine = AVAudioEngine()
    private let player = AVAudioPlayerNode()
    private let tts = TTSClient()

    /// The daemon renders 24 kHz mono. Connecting the player at that rate lets
    /// the main mixer do the one sample-rate conversion to the hardware rate,
    /// so the common case needs no conversion of our own.
    private let playbackFormat = AVAudioFormat(commonFormat: .pcmFormatFloat32,
                                               sampleRate: 24000,
                                               channels: 1,
                                               interleaved: false)

    private var engineConfigured = false

    /// Releases the audio device a moment after Orion stops talking.
    ///
    /// This matters more than it looks. A *running* `AVAudioEngine` holds the
    /// shared output device open at the engine's format — 24 kHz mono here —
    /// and everything else on the Mac gets dragged down to it. The symptom is
    /// that music sounds muffled the whole time Orion is open, which is a
    /// miserable thing for an always-resident menu-bar app to do.
    ///
    /// `pause()` is not enough: it stops rendering but keeps the device. Only
    /// `stop()` gives it back.
    ///
    /// The delay exists so that back-to-back replies do not tear the device
    /// down and rebuild it between every sentence.
    private var deviceReleaseTimer: Timer?
    private static let deviceReleaseDelay: TimeInterval = 1.5
    private var currentText = ""
    private var pendingBuffers = 0
    private var streamComplete = false
    private var playedAnything = false

    private var synthesizer: AVSpeechSynthesizer?
    private var fallbackTimer: Timer?
    private var fallbackPhase: Double = 0

    // MARK: Public API

    func speak(_ text: String) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        stop(reason: "new reply starting")
        OrionLog.write("[speech] speaking \(trimmed.count) chars")
        guard !trimmed.isEmpty else {
            onFinished?()
            return
        }

        isSpeaking = true
        streamComplete = false
        playedAnything = false
        pendingBuffers = 0
        currentText = trimmed

        tts.stream(
            text: trimmed,
            onChunk: { [weak self] url, _ in
                self?.enqueue(url)
            },
            onDone: { [weak self] outcome in
                self?.handle(outcome, originalText: trimmed)
            }
        )
    }

    /// Barge-in. Tells the daemon to drop everything and silences the queue in
    /// the same breath — a cancel that only reached the daemon would still let
    /// already-scheduled buffers finish playing.
    func stop(reason: String = "unspecified") {
        // "Sometimes he just doesn't say it" is a CANCELLED utterance, not a
        // failed one — every synthesis in the log succeeded. Naming the caller
        // is the difference between diagnosing that in one line and guessing.
        if isSpeaking {
            OrionLog.write("[speech] CUT OFF mid-sentence by: \(reason)")
        }
        tts.cancelAll()
        stopFallback()

        if engineConfigured {
            player.stop()
            player.reset()
        }

        isSpeaking = false
        pendingBuffers = 0
        streamComplete = false
        playedAnything = false
        onLevel?(0)
        scheduleDeviceRelease()
    }

    // MARK: Audio device lifetime

    private func scheduleDeviceRelease() {
        deviceReleaseTimer?.invalidate()
        deviceReleaseTimer = Timer.scheduledTimer(
            withTimeInterval: SpeechOutput.deviceReleaseDelay, repeats: false
        ) { [weak self] _ in
            self?.releaseDevice()
        }
    }

    private func releaseDevice() {
        deviceReleaseTimer?.invalidate()
        deviceReleaseTimer = nil
        guard !isSpeaking, engine.isRunning else { return }
        // Drop the mixer tap too — it exists only to drive the hologram while
        // Orion is speaking, and a tap is a reason for the graph to stay live.
        if engineConfigured {
            engine.mainMixerNode.removeTap(onBus: 0)
        }
        engine.stop()
        // The tap has to be reinstalled next time, so make the configure step
        // run again rather than silently losing the level meter.
        engineConfigured = false
    }

    static func isDaemonReachable() -> Bool {
        TTSClient.isReachable()
    }

    // MARK: Streaming playback

    private func enqueue(_ url: URL) {
        guard isSpeaking else { return }
        guard let buffer = loadBuffer(url) else { return }

        do {
            try startEngineIfNeeded()
        } catch {
            // Nothing has played yet, so the whole reply can still go to the
            // fallback voice.
            failToFallback(reason: "audio output is unavailable — \(error.localizedDescription)",
                           text: currentText)
            return
        }

        pendingBuffers += 1
        playedAnything = true
        player.scheduleBuffer(buffer, at: nil, options: [], completionCallbackType: .dataPlayedBack) { [weak self] _ in
            DispatchQueue.main.async {
                self?.bufferFinished()
            }
        }
        if !player.isPlaying {
            player.play()
        }
    }

    private func bufferFinished() {
        guard isSpeaking else { return }
        pendingBuffers = max(0, pendingBuffers - 1)
        finishIfDrained()
    }

    private func handle(_ outcome: TTSOutcome, originalText: String) {
        guard isSpeaking else { return }
        switch outcome {
        case .cancelled:
            return
        case .finished(let chunks, let engine):
            streamComplete = true
            onActiveEngine?(engine)
            if chunks == 0 && !playedAnything {
                failToFallback(reason: nil, text: originalText)
                return
            }
            finishIfDrained()
        case .failed(let message):
            if playedAnything {
                // Partial speech already went out; do not double-speak it.
                streamComplete = true
                onNotice?("Voice stream ended early: \(message)")
                finishIfDrained()
            } else {
                failToFallback(reason: message, text: originalText)
            }
        }
    }

    private func finishIfDrained() {
        guard isSpeaking, streamComplete, pendingBuffers == 0 else { return }
        OrionLog.write("[speech] finished cleanly")
        isSpeaking = false
        if engineConfigured {
            player.stop()
        }
        onLevel?(0)
        // Hand the audio device back shortly, so the rest of the Mac stops
        // being held at Orion's 24 kHz mono playback format.
        scheduleDeviceRelease()
        onFinished?()
    }

    private func startEngineIfNeeded() throws {
        if !engineConfigured {
            guard let playbackFormat = playbackFormat else {
                throw NSError(domain: "Orion", code: 20, userInfo: [
                    NSLocalizedDescriptionKey: "Could not build the playback audio format."
                ])
            }
            // Idempotent: the device is released between replies, which clears
            // `engineConfigured`, but the node stays attached to the engine.
            // Attaching twice is a hard error, so ask first.
            if player.engine !== engine {
                engine.attach(player)
            }
            engine.connect(player, to: engine.mainMixerNode, format: playbackFormat)
            // nil format = "whatever this bus is already running at", which
            // survives the user changing output device mid-session.
            engine.mainMixerNode.installTap(onBus: 0, bufferSize: 1024, format: nil) { [weak self] buffer, _ in
                let level = orionNormalisedLevel(buffer)
                DispatchQueue.main.async {
                    guard let self, self.isSpeaking else { return }
                    self.onLevel?(level)
                }
            }
            engineConfigured = true
        }
        if !engine.isRunning {
            engine.prepare()
            try engine.start()
        }
    }

    private func loadBuffer(_ url: URL) -> AVAudioPCMBuffer? {
        guard let file = try? AVAudioFile(forReading: url) else { return nil }
        let frames = AVAudioFrameCount(file.length)
        guard frames > 0 else { return nil }
        guard let source = AVAudioPCMBuffer(pcmFormat: file.processingFormat, frameCapacity: frames) else {
            return nil
        }
        do {
            try file.read(into: source)
        } catch {
            return nil
        }
        guard let target = self.playbackFormat else { return source }
        if source.format.sampleRate == target.sampleRate,
           source.format.channelCount == target.channelCount,
           source.format.commonFormat == target.commonFormat {
            return source
        }
        return convert(source, to: target)
    }

    /// Only runs if the daemon ever renders at something other than 24 kHz mono
    /// (its `say` fallback engine is configurable), but a format mismatch on
    /// `scheduleBuffer` is a hard crash, so it is worth the twenty lines.
    private func convert(_ source: AVAudioPCMBuffer, to format: AVAudioFormat) -> AVAudioPCMBuffer? {
        guard let converter = AVAudioConverter(from: source.format, to: format) else { return nil }
        let ratio = format.sampleRate / source.format.sampleRate
        let capacity = AVAudioFrameCount(Double(source.frameLength) * ratio) + 4096
        guard let output = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: capacity) else { return nil }

        var supplied = false
        var conversionError: NSError?
        let status = converter.convert(to: output, error: &conversionError) { _, inputStatus in
            if supplied {
                inputStatus.pointee = .endOfStream
                return nil
            }
            supplied = true
            inputStatus.pointee = .haveData
            return source
        }
        if status == .error || conversionError != nil { return nil }
        guard output.frameLength > 0 else { return nil }
        return output
    }

    // MARK: Fallback voice

    private func failToFallback(reason: String?, text: String? = nil) {
        onActiveEngine?("system")
        if let reason {
            onNotice?("Warm voice unavailable (\(reason)) — using the built-in voice.")
        }
        guard let text, !text.isEmpty else {
            isSpeaking = false
            onLevel?(0)
            onFinished?()
            return
        }
        speakWithSystemVoice(text)
    }

    private func speakWithSystemVoice(_ text: String) {
        let synthesizer = self.synthesizer ?? AVSpeechSynthesizer()
        synthesizer.delegate = self
        self.synthesizer = synthesizer

        let utterance = AVSpeechUtterance(string: text)
        utterance.voice = AVSpeechSynthesisVoice(language: "en-US")
        isSpeaking = true

        // The system synthesiser plays straight to the output device, so there
        // is no buffer for us to tap. Rather than freeze the hologram mid-reply,
        // drive it with a gentle synthetic envelope. It is honestly fake, and
        // only ever used on the fallback path.
        fallbackPhase = 0
        fallbackTimer?.invalidate()
        fallbackTimer = Timer.scheduledTimer(withTimeInterval: 1.0 / 20.0, repeats: true) { [weak self] _ in
            guard let self else { return }
            self.fallbackPhase += 0.05
            let value = 0.34 + 0.18 * sin(self.fallbackPhase * 7.3) + 0.08 * sin(self.fallbackPhase * 2.1)
            self.onLevel?(max(0, min(1, value)))
        }

        synthesizer.speak(utterance)
    }

    private func stopFallback() {
        fallbackTimer?.invalidate()
        fallbackTimer = nil
        synthesizer?.stopSpeaking(at: .immediate)
    }

    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.fallbackTimer?.invalidate()
            self.fallbackTimer = nil
            self.isSpeaking = false
            self.onLevel?(0)
            self.onFinished?()
        }
    }

    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.fallbackTimer?.invalidate()
            self.fallbackTimer = nil
            self.onLevel?(0)
        }
    }
}
