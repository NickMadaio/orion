import AppKit
import Combine
import Foundation

/*
 The one place that knows what Orion is doing.

 Owns the hologram model, the microphone, the voice, and the conversation. Every
 property here is read and written on the main thread only; the audio taps, the
 socket reader and the agent subprocess all hop back before touching it.
 */

enum OrionPhase: Equatable {
    case idle
    case listening
    case thinking
    case speaking
    case error

    var hologramState: HologramState {
        switch self {
        case .idle: return .idle
        case .listening: return .listening
        case .thinking: return .thinking
        case .speaking: return .speaking
        case .error: return .error
        }
    }
}

struct Turn: Identifiable {
    enum Role {
        case you
        case orion
        case system
    }

    let id = UUID()
    let role: Role
    var text: String
    let at = Date()
}

final class AppState: ObservableObject {

    // MARK: Published surface

    @Published private(set) var phase: OrionPhase = .idle
    @Published private(set) var statusLine = "Hold Right Option to talk"
    @Published private(set) var turns: [Turn] = []
    @Published private(set) var heard = ""
    @Published var composer = ""

    /// Bumped every time a window wants the caret back in the composer.
    /// A counter rather than a Bool: clicking the menu bar twice should focus
    /// twice, and a Bool that is already `true` publishes no change.
    @Published var focusComposerToken: UInt = 0

    @Published private(set) var gatewayUp = false
    @Published private(set) var voiceUp = false
    @Published private(set) var accessibilityTrusted = false
    @Published private(set) var micDenied = false
    @Published private(set) var speechDenied = false

    @Published var quality: HologramQuality = .automatic {
        didSet {
            hologram.quality = quality
            UserDefaults.standard.set(quality.rawValue, forKey: AppState.qualityKey)
        }
    }

    // MARK: Summoning
    //
    // Seeded from `UserDefaults` in the property initialisers rather than in
    // `init`, so `didSet` never fires while loading and never writes a stored
    // value back over itself.

    @Published var wakeWordEnabled: Bool = SummonSettings.wakeEnabled {
        didSet {
            guard wakeWordEnabled != oldValue else { return }
            SummonSettings.wakeEnabled = wakeWordEnabled
            applyWakeWord()
        }
    }
    @Published var wakeSensitivity: WakeSensitivity = SummonSettings.wakeSensitivity {
        didSet {
            SummonSettings.wakeSensitivity = wakeSensitivity
            wakeWord.tolerance = wakeSensitivity.tolerance
        }
    }
    @Published var summonCorner: SummonCorner = SummonSettings.corner {
        didSet { SummonSettings.corner = summonCorner }
    }
    @Published var autoDismissSeconds: Double = SummonSettings.autoDismissSeconds {
        didSet { SummonSettings.autoDismissSeconds = autoDismissSeconds }
    }

    // MARK: Voice providers
    //
    // Two different things, deliberately kept apart:
    //   * `ttsProvider` / `sttProvider` are what the user CHOSE.
    //   * `activeTTSEngine` / `activeSTTProvider` are what is REALLY serving,
    //     after any fallback. The panel and Preferences show the second one,
    //     for the same reason `orion-doctor` probes instead of reading config:
    //     configuration lies, a live answer does not.

    @Published var ttsProvider: TTSProvider = .local {
        didSet { VoiceSettings.tts = ttsProvider }
    }
    @Published var sttProvider: STTProvider = .apple {
        didSet { VoiceSettings.stt = sttProvider }
    }

    @Published private(set) var activeTTSEngine = "—"
    @Published private(set) var activeSTTProvider: STTProvider = .apple

    var elevenLabsKeyPresent: Bool { Secrets.isPresent(Secrets.elevenLabsVariable) }
    var deepgramKeyPresent: Bool { Secrets.isPresent(Secrets.deepgramVariable) }

    // MARK: Collaborators

    let hologram = HologramModel()
    private let speechInput = SpeechInput()
    private let speechOutput = SpeechOutput()
    private let wakeWord = WakeWordListener()
    private let statusQueue = DispatchQueue(label: "com.nickmadaio.orion.status")
    private let agentQueue = DispatchQueue(label: "com.nickmadaio.orion.agent")

    private var statusTimer: Timer?
    private var permissionTimer: Timer?
    private var askGeneration = 0

    /// A turn started by the wake word rather than by a held key: nothing will
    /// tell us when the user stopped talking, so silence has to.
    private var handsFree = false
    private var handsFreeTimer: Timer?
    private var handsFreeStartedAt = Date.distantPast
    private var lastVoiceAt = Date.distantPast

    /// Don't end a hands-free turn during its first moment; the user has barely
    /// drawn breath.
    private static let handsFreeLeadIn: TimeInterval = 1.0
    /// Silence that ends a hands-free turn.
    private static let handsFreeHangover: TimeInterval = 1.3
    /// A noisy room must not hold the microphone open forever.
    private static let handsFreeLimit: TimeInterval = 15
    /// Input level that counts as "still talking".
    private static let handsFreeVoiceLevel: Double = 0.16

    private static let qualityKey = "OrionHologramQuality"

    /// Stable id for the invisible row at the end of the transcript, so the
    /// scroll view can be pinned to the bottom as turns arrive.
    static let transcriptBottomAnchor = "orion.transcript.bottom"

    /// Set by the app delegate so state changes can drive the escape watcher and
    /// bring the panel forward when the user talks to a hidden Orion.
    var onSpeakingChanged: ((Bool) -> Void)?
    var onWantsPanel: (() -> Void)?

    /// Orion arriving on its own — bring the panel to the configured corner
    /// without taking focus. Distinct from `onWantsPanel`, which honours
    /// wherever the panel was last put by hand.
    var onWantsSummon: (() -> Void)?

    // MARK: Wake word

    /// Start or stop always-on listening to match the preference, and keep the
    /// passive tap running only while it is actually needed.
    ///
    /// The tap is reference-counted by intent rather than by phase: push-to-talk
    /// opens and closes the recogniser itself, but the monitor has to survive
    /// between turns or the wake word would go deaf the moment a turn ended.
    private func applyWakeWord() {
        if wakeWordEnabled {
            guard wakeWord.canRunLocally else {
                // `start()` reports the real reason through `onUnavailable`,
                // which also flips the preference back off.
                wakeWord.start()
                return
            }
            guard SpeechInput.microphoneAuthorized, SpeechInput.speechAuthorized else {
                wakeWordEnabled = false
                append(.system, "Wake word needs microphone and speech-recognition access. Grant them in Preferences, then switch it back on.")
                return
            }
            guard speechInput.startMonitoring() else {
                wakeWordEnabled = false
                append(.system, "Could not open the microphone for wake-word listening.")
                return
            }
            wakeWord.start()
            // A turn may already be in flight when this is switched on.
            wakeWord.setSuspended(phase != .idle)
            statusLine = "Listening for “Orion”"
        } else {
            wakeWord.stop()
            speechInput.stopMonitoring()
        }
    }

    /// Heard its name.
    ///
    /// `trailing` is whatever followed the wake word in the same recognition
    /// result. When it is there, the user said "Orion, what's on my calendar"
    /// in one breath and should not be made to repeat the second half.
    private func handleWake(trailing: String?) {
        guard phase == .idle else { return }

        onWantsSummon?()
        hologram.ping()

        if let command = trailing?.trimmingCharacters(in: .whitespacesAndNewlines),
           command.count >= 2 {
            // "Orion, what's on my calendar" — the whole request arrived in one
            // breath. Don't make him say the second half again.
            heard = command
            send(command)
        } else {
            // Just the name. Open a hands-free turn and let silence close it.
            beginListening(handsFree: true)
        }
    }

    // MARK: Lifecycle

    init() {
        if let stored = UserDefaults.standard.string(forKey: AppState.qualityKey),
           let value = HologramQuality(rawValue: stored) {
            quality = value
        }
        hologram.quality = quality
        ttsProvider = VoiceSettings.tts
        sttProvider = VoiceSettings.stt
        // Deliberately NOT `sttProvider`: nothing has listened yet, so claiming
        // the configured ear is active would be the exact lie this pair of
        // properties exists to prevent. It becomes true on the first press.
        activeSTTProvider = .apple
        wireSpeech()
    }

    func start() {
        refreshPermissions()
        refreshStatus()
        // Honour a wake preference carried over from the last run.
        if wakeWordEnabled { applyWakeWord() }

        statusTimer = Timer.scheduledTimer(withTimeInterval: 6, repeats: true) { [weak self] _ in
            self?.refreshStatus()
        }
        // Accessibility can be granted while we are running; notice it rather
        // than making the user relaunch.
        permissionTimer = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] _ in
            self?.refreshPermissions()
        }
    }

    func shutDown() {
        statusTimer?.invalidate()
        permissionTimer?.invalidate()
        statusTimer = nil
        permissionTimer = nil
        speechInput.abort()
        speechOutput.stop()
    }

    private func wireSpeech() {
        speechInput.onLevel = { [weak self] level in
            guard let self else { return }
            self.hologram.setLevel(level)
            // The same tap that draws the hologram decides when a hands-free
            // turn is over. Level rather than transcript text: partials arrive
            // in bursts and lag the voice, so silence detected from them would
            // always end the turn late.
            if self.handsFree, level >= AppState.handsFreeVoiceLevel {
                self.lastVoiceAt = Date()
            }
        }
        speechInput.onPartial = { [weak self] text in
            guard let self else { return }
            self.heard = text
        }
        speechInput.onFinal = { [weak self] text in
            guard let self else { return }
            self.heard = ""
            let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.isEmpty else {
                self.setPhase(.idle)
                self.statusLine = "Nothing heard"
                return
            }
            self.send(trimmed)
        }
        speechInput.onError = { [weak self] message in
            guard let self else { return }
            self.heard = ""
            self.fail(message)
        }
        speechInput.onActiveProvider = { [weak self] provider, note in
            guard let self else { return }
            self.activeSTTProvider = provider
            if let note { self.append(.system, note) }
        }

        speechOutput.onLevel = { [weak self] level in
            self?.hologram.setLevel(level)
        }
        speechOutput.onFinished = { [weak self] in
            guard let self else { return }
            if self.phase == .speaking {
                self.setPhase(.idle)
                self.statusLine = "Hold Right Option to talk"
            }
        }
        speechOutput.onNotice = { [weak self] message in
            self?.append(.system, message)
        }

        // The wake word is a passive reader of the one input tap. It never
        // opens a device, and it is never handed to Deepgram: an always-on
        // microphone that streams to a vendor is a different product than the
        // one this is, so wake detection is on-device or it is off.
        speechInput.onMonitor = { [weak self] buffer, level in
            self?.wakeWord.observe(buffer, level: level)
        }
        wakeWord.tolerance = wakeSensitivity.tolerance
        wakeWord.onUnavailable = { [weak self] message in
            guard let self else { return }
            self.wakeWordEnabled = false
            self.append(.system, message)
        }
        wakeWord.onWake = { [weak self] trailing in
            self?.handleWake(trailing: trailing)
        }
        speechOutput.onActiveEngine = { [weak self] engine in
            guard let self else { return }
            self.activeTTSEngine = engine
            // The daemon is allowed to serve locally when the cloud voice is
            // unreachable. Say so once, rather than letting the user wonder
            // why the voice changed.
            if self.ttsProvider == .elevenlabs && engine != "elevenlabs" && engine != "unknown" {
                self.append(.system, "ElevenLabs was unavailable — that reply used the \(engine) voice.")
            }
        }
    }

    // MARK: Phase

    private func setPhase(_ next: OrionPhase) {
        phase = next
        hologram.setState(next.hologramState)
        onSpeakingChanged?(next == .speaking)
        // Any exit from listening ends a hands-free turn — the user pressed the
        // key, an error fired, or silence already closed it. Doing this here
        // rather than in each caller means no future path can forget and leave
        // a timer polling forever.
        if next != .listening { stopHandsFree() }
        // Deaf unless idle. This is what stops Orion waking itself: while it is
        // speaking, its own voice is in the room and on the tap, and "Orion" is
        // a word it says. Suspension tears the recognition window down rather
        // than filtering results, so its own reply is never transcribed at all.
        wakeWord.setSuspended(next != .idle)
    }

    private func fail(_ message: String) {
        setPhase(.error)
        statusLine = message
        append(.system, message)
        // Settle back to idle so the shell does not stay red forever.
        DispatchQueue.main.asyncAfter(deadline: .now() + 4) { [weak self] in
            guard let self, self.phase == .error else { return }
            self.setPhase(.idle)
            self.statusLine = "Hold Right Option to talk"
        }
    }

    private func append(_ role: Turn.Role, _ text: String) {
        turns.append(Turn(role: role, text: text))
        if turns.count > 60 {
            turns.removeFirst(turns.count - 60)
        }
    }

    // MARK: Talking

    /// Right Option pressed.
    /// Start a turn.
    ///
    /// `handsFree` marks a turn the wake word began. Push-to-talk has a key
    /// release to say "I have finished"; a spoken summon has nothing, so
    /// silence has to end it. That is the only difference between the two.
    func beginListening(handsFree wantsHandsFree: Bool = false) {
        // No permission guard here on purpose: without Accessibility the global
        // monitor never fires at all, so reaching this point means the press did
        // arrive. The missing-permission case is surfaced in the panel banner.
        if phase == .speaking {
            bargeIn()
        }
        guard !speechInput.isRunning else { return }
        onWantsPanel?()
        heard = ""
        setPhase(.listening)
        statusLine = wantsHandsFree ? "Listening… (pause when you're done)" : "Listening…"
        hologram.ping()
        speechInput.start()

        if wantsHandsFree { startHandsFree() }
    }

    // MARK: Hands-free turns

    private func startHandsFree() {
        handsFree = true
        handsFreeStartedAt = Date()
        // Seed as "just spoke" so the lead-in is measured from the summon, not
        // from an epoch in 1970.
        lastVoiceAt = handsFreeStartedAt

        handsFreeTimer?.invalidate()
        handsFreeTimer = Timer.scheduledTimer(withTimeInterval: 0.2, repeats: true) { [weak self] _ in
            self?.checkHandsFree()
        }
    }

    private func stopHandsFree() {
        handsFree = false
        handsFreeTimer?.invalidate()
        handsFreeTimer = nil
    }

    private func checkHandsFree() {
        guard handsFree, phase == .listening else {
            stopHandsFree()
            return
        }
        let now = Date()

        // A noisy room must not hold the microphone open forever.
        if now.timeIntervalSince(handsFreeStartedAt) >= AppState.handsFreeLimit {
            stopHandsFree()
            endListening()
            return
        }
        // Don't cut anyone off in the first breath.
        guard now.timeIntervalSince(handsFreeStartedAt) >= AppState.handsFreeLeadIn else { return }

        if now.timeIntervalSince(lastVoiceAt) >= AppState.handsFreeHangover {
            stopHandsFree()
            endListening()
        }
    }

    /// Right Option released.
    func endListening() {
        guard speechInput.isRunning else { return }
        statusLine = "Thinking…"
        setPhase(.thinking)
        speechInput.stop()
    }

    /// Escape, or the user starting to talk over a reply.
    func bargeIn() {
        speechOutput.stop()
        hologram.setLevel(0)
        if phase == .speaking {
            setPhase(.idle)
            statusLine = "Stopped"
        }
    }

    func submitTyped() {
        let text = composer.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        composer = ""
        if phase == .speaking { bargeIn() }
        send(text)
    }

    private func send(_ text: String) {
        append(.you, text)
        setPhase(.thinking)
        statusLine = "Thinking…"

        askGeneration += 1
        let generation = askGeneration

        agentQueue.async { [weak self] in
            let result: Result<GatewayReply, Error>
            do {
                result = .success(try GatewayClient.ask(text))
            } catch {
                result = .failure(error)
            }
            DispatchQueue.main.async {
                guard let self, self.askGeneration == generation else { return }
                switch result {
                case .success(let reply):
                    self.deliver(reply)
                case .failure(let error):
                    let message = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
                    self.fail(message)
                }
            }
        }
    }

    private func deliver(_ reply: GatewayReply) {
        append(.orion, reply.text)
        setPhase(.speaking)
        statusLine = "Speaking…"
        speechOutput.speak(reply.text)
    }

    // MARK: Status and permissions

    func refreshStatus() {
        statusQueue.async { [weak self] in
            let gateway = GatewayClient.isUp()
            let voice = TTSClient.isReachable()
            DispatchQueue.main.async {
                guard let self else { return }
                self.gatewayUp = gateway
                self.voiceUp = voice
            }
        }
    }

    func refreshPermissions() {
        accessibilityTrusted = Permissions.accessibilityTrusted
        micDenied = SpeechInput.microphoneDenied
        speechDenied = SpeechInput.speechDenied
    }

    func requestAccessibility() {
        Permissions.promptForAccessibility()
        Permissions.openAccessibilitySettings()
    }

    /// Asks for microphone and speech up front, so the first push-to-talk is not
    /// also the first permission dialog.
    func primeMicrophonePermissions() {
        guard !SpeechInput.speechAuthorized || !SpeechInput.microphoneAuthorized else { return }
        NSApp.activate(ignoringOtherApps: true)
        speechInput.requestPermissions { [weak self] granted, message in
            guard let self else { return }
            self.refreshPermissions()
            if !granted, let message {
                self.append(.system, message)
            }
        }
    }

    var statusSummary: String {
        let gateway = gatewayUp ? "gateway up" : "gateway down"
        let voice = voiceUp ? "voice warm" : "voice cold"
        return "\(gateway) · \(voice)"
    }

    /// What is actually speaking and listening right now. Short enough for a
    /// menu item, honest enough to debug from.
    var voiceSummary: String {
        let speaking = activeTTSEngine == "—" ? ttsProvider.rawValue : activeTTSEngine
        return "voice \(speaking) · ears \(activeSTTProvider.rawValue)"
    }
}
