import AppKit
import AVFoundation
import Combine
import SessionDomain
import SessionService
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

struct FocusTask: Identifiable, Codable, Equatable {
    var id = UUID()
    var title: String
    var isComplete = false
}

final class AppState: ObservableObject {

    /// Applies this requested visual lift once, rather than compounding it on
    /// every launch.
    private static let hologramBrightnessBoostKey = "OrionHologramBrightnessBoost20260801"

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

    // MARK: Daily command-center logging
    //
    // These are intentionally lightweight and local. They give the dashboard
    // useful, honest interaction before a wearable or banking connection is
    // chosen. Each resets only when the calendar day changes.
    @Published private(set) var hydrationBottles = 0
    @Published private(set) var supplementsLogged = 0
    @Published private(set) var workoutLogged = false
    @Published private(set) var focusTasks: [FocusTask] = []
    private static let dailyLogDateKey = "orion.dailyLog.date"
    private static let hydrationKey = "orion.dailyLog.hydration"
    private static let supplementsKey = "orion.dailyLog.supplements"
    private static let workoutKey = "orion.dailyLog.workout"
    private static let focusTasksKey = "orion.dailyLog.focusTasks"

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
    /// Writes straight through to the global the draw path reads, so the change
    /// is visible on the very next frame rather than at the next launch.
    @Published var hologramBrightness: Double = SummonSettings.brightness {
        didSet {
            SummonSettings.brightness = hologramBrightness
            holoGain = hologramBrightness
        }
    }
    /// Edge length of the orb. `onSizeChanged` is set by the app delegate,
    /// which owns the panel — `AppState` deliberately knows nothing about
    /// windows.
    @Published var orbSize: Double = SummonSettings.orbSize {
        didSet {
            SummonSettings.orbSize = orbSize
            onSizeChanged?()
        }
    }
    var onSizeChanged: (() -> Void)?

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
    private let reminders = ReminderService()

    /// The single writer of session state and history, and the socket scripts
    /// talk to. Owned here because AppState owns and wires; the engine logic
    /// lives in SessionDomain and the I/O in SessionService, and neither is
    /// reachable except through this one object.
    /// The clip library and player, and the object that carries out whatever
    /// `reconcile` asks for. Announcements go to the log until Gate 6 routes
    /// them through Orion's real voice — recorded honestly, just not spoken.
    private let clipPlayer = ClipPlayer()
    private lazy var sessionEffects = SessionEffects(
        clips: clipPlayer,
        speak: { _ in true },
        log: { OrionLog.write($0) }
    )
    private(set) lazy var session = SessionService(effects: sessionEffects)

    /// Drift enforcement. Off until Nick confirms an allowlist — the model
    /// proposes, he authorizes. Reachable from the socket so the escape works
    /// without the gateway, the local model, or the UI being up.
    private(set) lazy var enforcer = Enforcer(
        speak: { [weak self] line in self?.speakEnforcement(line) },
        log: { OrionLog.write($0) }
    )
    private lazy var sessionIPC = SessionIPC(service: session, enforcer: enforcer)
    private let speakerVerifier = SpeakerVerifier()

    /// Rolling mono window of what the microphone has heard, for verification.
    /// Two seconds is plenty for a wake word and small enough to be free.
    private var verificationWindow: [Float] = []
    private var verificationRate: Double = 16000
    private static let verificationSeconds: Double = 2.0
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
    private var handsFreeGeneration = 0
    /// The last interim text that actually advanced. Streaming recognisers may
    /// re-emit the same interim result while the room is quiet; those repeats
    /// are not new speech and must not keep a hands-free turn alive.
    private var lastSpeechEvidence = ""

    /// Don't end a hands-free turn during its first moment; the user has barely
    /// drawn breath.
    private static let handsFreeLeadIn: TimeInterval = 1.0
    /// Silence that ends a hands-free turn.
    private static let handsFreeHangover: TimeInterval = 1.3
    /// A noisy room must not hold the microphone open forever.
    private static let handsFreeLimit: TimeInterval = 12

    // MARK: Conversation mode
    //
    // Saying a name is how you START talking to someone, not how you continue.
    // Orion used to return to `.idle` the instant it stopped speaking, so a
    // follow-up needed the wake word again — which meant it was never a
    // conversation, just a series of unrelated commands that happened to be
    // adjacent. This holds the exchange open after Orion answers.

    /// True from the wake word until the exchange lapses. Only ever set for
    /// voice-initiated turns: push-to-talk already has a key that says when the
    /// user is finished, and should not start listening on its own.
    private var conversationOpen = false
    /// The listening window currently open is a follow-up, so nothing has been
    /// said in it yet and the ordinary hangover must not close it immediately.
    private var awaitingFollowUp = false

    /// How long to wait for a follow-up before deciding the exchange is over.
    /// Long enough to think about the answer, short enough that Orion is not
    /// still holding the microphone open when you have walked away.
    private static let followUpGrace: TimeInterval = 6
    /// A beat after Orion's own audio ends, before the ear opens. The speaker's
    /// tail and the room's reverb are still arriving; without this the follow-up
    /// window hears Orion and answers itself.
    private static let followUpSettle: TimeInterval = 0.45

    /// Whether the phase we are leaving was `.listening`, so ducking is
    /// restored exactly once.
    private var phaseWasListening = false

    private static let qualityKey = "OrionHologramQuality"

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
        if !UserDefaults.standard.bool(forKey: AppState.hologramBrightnessBoostKey) {
            hologramBrightness = min(4.0, hologramBrightness * 1.3)
            UserDefaults.standard.set(true, forKey: AppState.hologramBrightnessBoostKey)
        }
        ttsProvider = VoiceSettings.tts
        sttProvider = VoiceSettings.stt
        // Deliberately NOT `sttProvider`: nothing has listened yet, so claiming
        // the configured ear is active would be the exact lie this pair of
        // properties exists to prevent. It becomes true on the first press.
        activeSTTProvider = .apple
        restoreDailyLog()
        wireSpeech()
        wireSession()
    }

    func logHydration() {
        refreshDailyLogIfNeeded()
        hydrationBottles += 1
        persistDailyLog()
    }

    func removeHydration() {
        refreshDailyLogIfNeeded()
        hydrationBottles = max(0, hydrationBottles - 1)
        persistDailyLog()
    }

    func logSupplement() {
        refreshDailyLogIfNeeded()
        supplementsLogged += 1
        persistDailyLog()
    }

    func toggleWorkoutLogged() {
        refreshDailyLogIfNeeded()
        workoutLogged.toggle()
        persistDailyLog()
    }

    func addFocusTask(_ title: String) {
        let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        refreshDailyLogIfNeeded()
        focusTasks.append(FocusTask(title: trimmed))
        persistDailyLog()
    }

    func toggleFocusTask(_ id: UUID) {
        guard let index = focusTasks.firstIndex(where: { $0.id == id }) else { return }
        focusTasks[index].isComplete.toggle()
        persistDailyLog()
    }

    func removeFocusTask(_ id: UUID) {
        focusTasks.removeAll { $0.id == id }
        persistDailyLog()
    }

    private func restoreDailyLog() {
        refreshDailyLogIfNeeded()
        let defaults = UserDefaults.standard
        hydrationBottles = defaults.integer(forKey: AppState.hydrationKey)
        supplementsLogged = defaults.integer(forKey: AppState.supplementsKey)
        workoutLogged = defaults.bool(forKey: AppState.workoutKey)
        if let data = defaults.data(forKey: AppState.focusTasksKey),
           let stored = try? JSONDecoder().decode([FocusTask].self, from: data) {
            focusTasks = stored
        } else {
            focusTasks = [
                FocusTask(title: "Choose your three most important outcomes"),
                FocusTask(title: "Use Orion to capture and organize tasks"),
                FocusTask(title: "Review your day before it closes"),
            ]
        }
    }

    private func refreshDailyLogIfNeeded() {
        // The LOGICAL day, not the civil one. Keyed off midnight, a bottle of
        // water logged at 1am counted for tomorrow, and the whole day's
        // counters reset under you if you were still at the desk. See OrionDay.
        let today = OrionDay.current.key
        let defaults = UserDefaults.standard
        guard defaults.string(forKey: AppState.dailyLogDateKey) != today else { return }
        defaults.set(today, forKey: AppState.dailyLogDateKey)
        defaults.set(0, forKey: AppState.hydrationKey)
        defaults.set(0, forKey: AppState.supplementsKey)
        defaults.set(false, forKey: AppState.workoutKey)
        defaults.removeObject(forKey: AppState.focusTasksKey)
        hydrationBottles = 0
        supplementsLogged = 0
        workoutLogged = false
        focusTasks = []
    }

    private func persistDailyLog() {
        let defaults = UserDefaults.standard
        defaults.set(hydrationBottles, forKey: AppState.hydrationKey)
        defaults.set(supplementsLogged, forKey: AppState.supplementsKey)
        defaults.set(workoutLogged, forKey: AppState.workoutKey)
        if let data = try? JSONEncoder().encode(focusTasks) {
            defaults.set(data, forKey: AppState.focusTasksKey)
        }
    }
    func start() {
        OrionLog.write("---- Orion launched ----")
        OrionLog.permissionSnapshot("launch")
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

        speakerVerifier.refreshStatus()
        reminders.onDue = { [weak self] reminder in
            self?.announceReminder(reminder)
        }
        reminders.start()
    }

    /// A timer or alarm came due.
    ///
    /// Spoken, not just shown. A notification banner is a thing you find later;
    /// the entire point of asking an assistant for a timer instead of setting
    /// one on your phone is that you do not have to be looking at anything.
    private func announceReminder(_ reminder: StoredReminder) {
        let spoken = reminder.kind == "alarm"
            ? "\(reminder.label)."
            : "\(reminder.label) is up."
        append(.orion, spoken)
        onWantsSummon?()

        // Never cut off a reply in progress — queue behind it. Interrupting
        // Orion mid-sentence to announce a timer loses whatever it was saying.
        guard phase != .speaking, phase != .listening else {
            pendingAnnouncement = spoken
            return
        }
        speak(spoken)
    }

    /// Said as soon as Orion is not busy. See `announceReminder`.
    private var pendingAnnouncement: String?

    private func speak(_ text: String) {
        setPhase(.speaking)
        statusLine = "Speaking…"
        speechOutput.speak(text)
    }

    func shutDown() {
        // Non-negotiable: quitting while ducked would leave his music quiet with
        // no obvious cause and nothing left running to explain it.
        AudioDucking.restore()
        reminders.stop()
        statusTimer?.invalidate()
        permissionTimer?.invalidate()
        statusTimer = nil
        permissionTimer = nil
        disarmSpeakingWatchdog()
        speechInput.abort()
        speechOutput.stop(reason: "app shutting down")
        // Removes the socket file, so a client started after this correctly
        // reports that Orion is not running rather than hanging on a dead path.
        sessionIPC.stop()
        session.stop()
        clipPlayer.stop()
    }

    /// What enforcement says out loud.
    ///
    /// Routed through `speak(...)` in Gate 6. Until then it is written to the
    /// log rather than sent to `/usr/bin/say`, because a half-wired voice that
    /// talks over Orion's real one is worse than one that is plainly not
    /// connected yet.
    private func speakEnforcement(_ line: String) {
        OrionLog.write("[focus] would say: \(line)")
    }

    /// Bring the session up and open its command socket.
    ///
    /// `start()` first: it records that the process started, which is what makes
    /// the gap since the last heartbeat read as downtime rather than as focus
    /// Nick never served. Only then is the socket opened, so the first command
    /// through it cannot race the recovery.
    private func wireSession() {
        let snapshot = session.start()
        if let failure = snapshot.failure {
            OrionLog.write("[session] state file unreadable — \(failure.message)")
        } else if let now = snapshot.reconciliation {
            OrionLog.write("[session] restored \(now.status.label) — "
                           + "phase \(now.phaseIndex), \(Int(now.servedInPhase))s served")
        } else {
            OrionLog.write("[session] no session running")
        }

        clipPlayer.onLog = { OrionLog.write($0) }
        clipPlayer.onFailure = { OrionLog.write("[clip] \($0)") }

        let inventory = ClipLibrary().inventory()
        if let explanation = inventory.explanation {
            // Never a silent empty. If there is nothing to play, say why.
            OrionLog.write("[clip] \(explanation)")
        } else {
            OrionLog.write("[clip] \(inventory.clips.count) clip(s): "
                           + inventory.clips.map(\.name).joined(separator: ", "))
        }

        // Enforcement is evaluated on every session change, which includes the
        // heartbeat — so it runs on the same dispatch timer and inherits its
        // independence from the main run loop.
        session.onChange = { [weak self] snapshot in
            guard let self else { return }
            let focusing: Bool
            if case .running(let kind) = snapshot.reconciliation?.status, kind.isFocus {
                focusing = true
            } else {
                focusing = false
            }
            self.enforcer.evaluate(sessionIsFocusing: focusing)
        }

        sessionIPC.onLog = { OrionLog.write($0) }
        if !sessionIPC.start() {
            OrionLog.write("[session] command socket unavailable — scripts cannot reach the session")
        }
    }

    private func wireSpeech() {
        speechInput.onLevel = { [weak self] level in
            guard let self else { return }
            self.hologram.setLevel(level)
        }
        speechInput.onPartial = { [weak self] text in
            guard let self else { return }
            self.heard = text
            // The level meter is deliberately sensitive enough to animate the
            // hologram, so it also sees fans, music and room noise.  It must
            // never be the source of truth for whether a hands-free request is
            // still being spoken.  A real interim transcript is that evidence.
            let evidence = text.trimmingCharacters(in: .whitespacesAndNewlines)
            if self.handsFree,
               !evidence.isEmpty,
               evidence.count > self.lastSpeechEvidence.count {
                self.lastVoiceAt = Date()
                self.lastSpeechEvidence = evidence
            }
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
            guard let self else { return }
            self.hologram.setLevel(level)
            // Audio is moving, so the speaking phase is real. This is what
            // keeps the watchdog from cutting off a long but healthy reply.
            self.noteSpeechProgress()
        }
        speechOutput.onFinished = { [weak self] in
            guard let self else { return }
            guard self.phase == .speaking else { return }
            // Orion has finished answering. If this exchange began by voice,
            // reopen the ear instead of going quiet, so the reply can be
            // answered the way a person would answer it.
            // A timer that came due mid-reply has been waiting; say it now,
            // before deciding whether to reopen the ear.
            if let queued = self.pendingAnnouncement {
                self.pendingAnnouncement = nil
                self.speak(queued)
                return
            }
            if self.conversationOpen, self.wakeWordEnabled {
                self.setPhase(.idle)
                self.statusLine = "Go ahead…"
                DispatchQueue.main.asyncAfter(deadline: .now() + AppState.followUpSettle) { [weak self] in
                    guard let self else { return }
                    // Anything that happened in the meantime — a key press, a
                    // new question, the user switching it off — wins.
                    guard self.conversationOpen, self.wakeWordEnabled, self.phase == .idle else { return }
                    self.beginListening(handsFree: true, followUp: true)
                }
                return
            }
            self.setPhase(.idle)
            self.statusLine = "Hold Right Option to talk"
        }
        speechOutput.onNotice = { [weak self] message in
            self?.append(.system, message)
        }

        // The wake word is a passive reader of the one input tap. It never
        // opens a device, and it is never handed to Deepgram: an always-on
        // microphone that streams to a vendor is a different product than the
        // one this is, so wake detection is on-device or it is off.
        speechInput.onMonitor = { [weak self] buffer, level in
            guard let self else { return }
            // Keep the last couple of seconds. When the wake word fires, the
            // audio that triggered it is already gone unless it was retained —
            // and re-recording after the fact would verify the silence *after*
            // his name, not the name itself.
            self.retainForVerification(buffer)
            self.wakeWord.observe(buffer, level: level)
        }
        wakeWord.tolerance = wakeSensitivity.tolerance
        wakeWord.onUnavailable = { [weak self] message in
            guard let self else { return }
            self.wakeWordEnabled = false
            self.append(.system, message)
        }
        wakeWord.onWake = { [weak self] trailing in
            guard let self else { return }
            // Verify the voice before acting on the word. Fails open: anything
            // other than a confident rejection wakes as normal.
            let window = self.recentAudio()
            self.speakerVerifier.verify(
                samples: window.samples,
                sampleRate: window.rate
            ) { [weak self] result in
                guard let self else { return }
                switch result {
                case .match(let score):
                    OrionLog.write(String(format: "[voiceid] accepted %.3f", score))
                    self.handleWake(trailing: trailing)
                case .cannotVerify(let reason):
                    OrionLog.write("[voiceid] not verified (\(reason)) — waking anyway")
                    self.handleWake(trailing: trailing)
                case .reject(let score, let threshold):
                    // Silent to the user on purpose. The whole point is that a
                    // television saying his name produces nothing at all; an
                    // announcement every time the room talks would be worse than
                    // the problem being solved.
                    OrionLog.write(
                        String(format: "[voiceid] ignored a wake — %.3f below %.3f",
                               score, threshold)
                    )
                }
            }
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

    // MARK: Speaker verification

    private func retainForVerification(_ buffer: AVAudioPCMBuffer) {
        guard let channel = buffer.floatChannelData?[0] else { return }
        let count = Int(buffer.frameLength)
        guard count > 0 else { return }
        verificationRate = buffer.format.sampleRate
        verificationWindow.append(contentsOf: UnsafeBufferPointer(start: channel, count: count))
        let cap = Int(verificationRate * AppState.verificationSeconds)
        if verificationWindow.count > cap {
            verificationWindow.removeFirst(verificationWindow.count - cap)
        }
    }

    private func recentAudio() -> (samples: [Float], rate: Double) {
        (verificationWindow, verificationRate)
    }

    /// Re-read what the voice daemon can actually do. Surfaced in the menu bar
    /// so "is it filtering?" has a visible answer rather than a guess.
    var voiceIdStatus: String { speakerVerifier.status }
    func refreshVoiceId() { speakerVerifier.refreshStatus() }

    // MARK: Phase

    private func setPhase(_ next: OrionPhase) {
        phase = next
        hologram.setState(next.hologramState)
        onSpeakingChanged?(next == .speaking)
        // `.speaking` is the one phase that can strand the whole app, so it is
        // the one phase with a guaranteed exit. Armed and disarmed here because
        // this is the only function that changes `phase`, which means no future
        // code path can enter or leave speaking without the watchdog agreeing.
        if next == .speaking { armSpeakingWatchdog() } else { disarmSpeakingWatchdog() }
        // Any exit from listening ends a hands-free turn — the user pressed the
        // key, an error fired, or silence already closed it. Doing this here
        // rather than in each caller means no future path can forget and leave
        // a timer polling forever.
        if next != .listening { stopHandsFree() }
        // Duck the room while the ear is open. Placed here rather than in
        // `beginListening` so that every exit path -- silence, escape, error,
        // the key coming up -- restores the volume without having to remember to.
        if next == .listening {
            AudioDucking.duck()
        } else if phaseWasListening {
            AudioDucking.restore()
        }
        phaseWasListening = next == .listening
        // Deaf unless idle. This is what stops Orion waking itself: while it is
        // speaking, its own voice is in the room and on the tap, and "Orion" is
        // a word it says. Suspension tears the recognition window down rather
        // than filtering results, so its own reply is never transcribed at all.
        wakeWord.setSuspended(next != .idle)
    }

    // MARK: The speaking watchdog

    /*
     Why this exists.

     `.speaking` had exactly one exit: `speechOutput.onFinished`, which is
     called from `finishIfDrained()`, which returns early unless
     `pendingBuffers == 0`. Every route to that counter reaching zero runs
     through a completion handler on a scheduled audio buffer. When one of those
     never arrives — the same failure family as the `endOfStream` and `SIGHUP`
     bugs already fixed in this tree — the counter stays above zero, `onFinished`
     never fires, and the phase never ends.

     The consequence is worse than a stuck animation. Input is gated on the
     phase in six places, `wakeWord.setSuspended(next != .idle)` keeps the wake
     word off, and `announceReminder` queues instead of speaking. Orion goes
     permanently deaf while looking like he is mid-sentence, and the only cure
     is relaunching the app. That is precisely the bug Nick reported after
     adding a file: "it still thought he was speaking although he wasn't".

     Chasing each TTS failure path individually cannot close this, because the
     next unhandled one reopens it. So the state machine gets a floor: whatever
     happens downstream, `.speaking` ends.

     Measured from the last sign of life, not from the start, so a genuinely
     long reply is never truncated — the timer only fires when nothing at all
     has happened for `stallTimeout` seconds. An absolute ceiling sits behind
     that for the case where an engine keeps emitting level events forever.
    */

    private var speakingWatchdog: Timer?
    private var lastSpeechProgressAt = Date()
    private var speakingStartedAt = Date()

    /// Any evidence that speech is genuinely still happening.
    private func noteSpeechProgress() {
        lastSpeechProgressAt = Date()
    }

    private func armSpeakingWatchdog() {
        speakingWatchdog?.invalidate()
        let now = Date()
        speakingStartedAt = now
        lastSpeechProgressAt = now
        // Polls rather than schedules one long timer, so progress can push the
        // deadline out without tearing the timer down and rebuilding it.
        speakingWatchdog = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] _ in
            guard let self else { return }
            guard self.phase == .speaking else {
                self.disarmSpeakingWatchdog()
                return
            }
            let stalled = Date().timeIntervalSince(self.lastSpeechProgressAt)
            let total = Date().timeIntervalSince(self.speakingStartedAt)
            if stalled >= VoiceTuning.stallTimeout {
                self.recoverFromStuckSpeaking(
                    reason: "no audio for \(Int(stalled))s"
                )
            } else if total >= VoiceTuning.absoluteSpeakingCeiling {
                self.recoverFromStuckSpeaking(
                    reason: "reply exceeded \(Int(total))s"
                )
            }
        }
    }

    private func disarmSpeakingWatchdog() {
        speakingWatchdog?.invalidate()
        speakingWatchdog = nil
    }

    /// Force the end of a speaking phase that will not end on its own.
    ///
    /// Deliberately loud in the log and silent in the transcript: this is a bug
    /// report, not something Orion should announce. `orion-doctor` greps for it.
    private func recoverFromStuckSpeaking(reason: String) {
        disarmSpeakingWatchdog()
        OrionLog.write("[speech] watchdog recovered a stuck speaking phase — \(reason)")
        // Tear down the audio path before changing phase: `stop` is idempotent
        // and clears `isSpeaking`, so a late `onFinished` from the wedged
        // engine finds the phase already idle and is ignored by its own guard.
        speechOutput.stop(reason: "watchdog: \(reason)")
        hologram.setLevel(0)
        // A reminder that queued behind the reply must not be lost with it.
        let queued = pendingAnnouncement
        pendingAnnouncement = nil
        setPhase(.idle)
        if let queued {
            speak(queued)
            return
        }
        // Reopen the ear on the same terms as a clean finish, so a recovered
        // turn is indistinguishable from a normal one from the user's side.
        if conversationOpen, wakeWordEnabled {
            statusLine = "Go ahead…"
            DispatchQueue.main.asyncAfter(deadline: .now() + AppState.followUpSettle) { [weak self] in
                guard let self else { return }
                guard self.conversationOpen, self.wakeWordEnabled, self.phase == .idle else { return }
                self.beginListening(handsFree: true, followUp: true)
            }
        } else {
            statusLine = "Hold Right Option to talk"
        }
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
    func beginListening(handsFree wantsHandsFree: Bool = false,
                        followUp: Bool = false) {
        // No permission guard here on purpose: without Accessibility the global
        // monitor never fires at all, so reaching this point means the press did
        // arrive. The missing-permission case is surfaced in the panel banner.
        if phase == .speaking {
            bargeIn()
        }
        guard !speechInput.isRunning else {
            OrionLog.write("[press] ignored — already listening")
            return
        }
        OrionLog.permissionSnapshot("press")
        onWantsPanel?()
        heard = ""
        lastSpeechEvidence = ""
        // A turn the user started by voice opens the exchange; one started by
        // the key does not, and closes any exchange that was open — pressing
        // the key is an explicit statement about how this turn will end.
        if wantsHandsFree {
            conversationOpen = true
        } else {
            conversationOpen = false
        }
        setPhase(.listening)
        statusLine = followUp
            ? "Go ahead…"
            : (wantsHandsFree ? "Listening… (pause when you're done)" : "Listening…")
        hologram.ping()
        speechInput.start()

        if wantsHandsFree { startHandsFree(followUp: followUp) }
    }

    // MARK: Hands-free turns

    private func startHandsFree(followUp: Bool = false) {
        handsFree = true
        awaitingFollowUp = followUp
        handsFreeStartedAt = Date()
        handsFreeGeneration += 1
        let generation = handsFreeGeneration
        // Seed as "just spoke" so the lead-in is measured from the summon, not
        // from an epoch in 1970.
        lastVoiceAt = handsFreeStartedAt

        handsFreeTimer?.invalidate()
        handsFreeTimer = Timer.scheduledTimer(withTimeInterval: 0.2, repeats: true) { [weak self] _ in
            self?.checkHandsFree()
        }

        // A main-run-loop timer is convenient for the normal, fast route, but
        // it must never be the sole way out of a live microphone stream. This
        // independent deadline guarantees that a malformed or endlessly
        // repeated interim transcript becomes a request, not an infinite
        // listening state.
        DispatchQueue.global(qos: .userInitiated).asyncAfter(deadline: .now() + AppState.handsFreeLimit) { [weak self] in
            DispatchQueue.main.async {
                guard let self,
                      self.handsFree,
                      self.handsFreeGeneration == generation,
                      self.phase == .listening else { return }
                OrionLog.write("[handsfree] hard finish after \(Int(AppState.handsFreeLimit))s")
                self.stopHandsFree()
                self.endListening()
            }
        }
    }

    private func stopHandsFree() {
        handsFree = false
        awaitingFollowUp = false
        handsFreeGeneration += 1
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
        // A follow-up window is open before anything has been said in it, so
        // the ordinary hangover would close it almost at once. Wait out the
        // grace instead; if the user does start talking, `lastVoiceAt` moves
        // and this stops being a follow-up, so the normal end-of-turn silence
        // detection takes over from there.
        if awaitingFollowUp {
            // `lastVoiceAt` is seeded to the window's start, so any movement in
            // it means the user has begun speaking.
            if lastVoiceAt > handsFreeStartedAt {
                awaitingFollowUp = false
                // Measure the lead-in from when they actually started, not from
                // when the window opened, or the first words get clipped.
                handsFreeStartedAt = lastVoiceAt
                return
            }
            if now.timeIntervalSince(handsFreeStartedAt) >= AppState.followUpGrace {
                // Nothing came. The exchange is over; go back to waiting for
                // the wake word rather than sitting here with the ear open.
                endConversation()
            }
            return
        }

        // Don't cut anyone off in the first breath.
        guard now.timeIntervalSince(handsFreeStartedAt) >= AppState.handsFreeLeadIn else { return }

        if now.timeIntervalSince(lastVoiceAt) >= AppState.handsFreeHangover {
            stopHandsFree()
            endListening()
        }
    }

    /// The user did not follow up. Close the ear and go back to the wake word.
    private func endConversation() {
        conversationOpen = false
        awaitingFollowUp = false
        stopHandsFree()
        speechInput.discardUtterance()
        heard = ""
        setPhase(.idle)
        statusLine = wakeWordEnabled ? "Listening for “Orion”" : "Hold Right Option to talk"
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
        speechOutput.stop(reason: "barge-in (escape, or you started talking)")
        hologram.setLevel(0)
        // Escape means "stop", and that includes not reopening the ear for a
        // follow-up. Without this, cutting Orion off would be answered by Orion
        // politely waiting for you to continue — the opposite of what escape is.
        conversationOpen = false
        if phase == .speaking {
            setPhase(.idle)
            statusLine = wakeWordEnabled ? "Listening for “Orion”" : "Stopped"
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
