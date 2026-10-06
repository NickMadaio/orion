import ThinkingOrbsKit
import MobileCore
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
    private let scheduleFocusWatcher = ScheduleFocusWatcher()
    private static let hologramBrightnessBoostKey = "OrionHologramBrightnessBoost20260801"

    // MARK: Published surface

    @Published private(set) var phase: OrionPhase = .idle
    @Published private(set) var statusLine = "Hold Right Option to talk"
    @Published private(set) var turns: [Turn] = []
    @Published private(set) var heard = ""
    @Published var composer = ""
    @Published var earlyFinish: EarlyFinishContext?
    @Published var earlyBusy = false
    @Published var earlyFeedback: String?
    @Published var chatMode = false
    @Published var selectedChatModel: String?
    @Published private(set) var chatSummaries: [ChatSummary] = []
    @Published private(set) var chatConversation: ChatConversation?
    @Published private(set) var chatThinking: String?
    @Published var summonMicMuted = false
    /// The focus session moved out of the main window into its own floating
    /// panel (SessionFloatController), which stays when the window closes.
    @Published var sessionMinimized = false
    var hideSummon: (() -> Void)?
    private let chatStore = try? ChatStore(directory: FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".openclaw/orion-controlled/chats"))
    var chatModels: [ModelChoice] { FileManager.default.contents(atPath: ModelContract.path).map(ChatModels.choices(fromModelRoles:)) ?? [] }
    func refreshEarlyContext() {
        DispatchQueue.global(qos: .utility).async { [weak self] in
            let output = Self.runSchedule(["early", "--check", "--dry-run"])
            let context = try? JSONDecoder().decode(EarlyFinishContext.self, from: Data(output.1.utf8))
            DispatchQueue.main.async { self?.earlyFinish = context }
        }
    }
    func finishEarly(_ mode: String) {
        guard !earlyBusy, ["auto", "block", "out-of-class"].contains(mode) else { return }; earlyBusy = true
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            let result = Self.runSchedule(mode == "auto" ? ["early"] : ["early", mode])
            DispatchQueue.main.async { guard let self else { return }; self.earlyBusy = false; self.earlyFeedback = result.1; self.append(.system, result.1); self.refreshEarlyContext() }
        }
    }
    private static func runSchedule(_ args: [String]) -> (Bool, String) {
        let home = FileManager.default.homeDirectoryForCurrentUser, process = Process()
        process.executableURL = home.appendingPathComponent(".openclaw/tools/node-v24.15.0/bin/node")
        process.arguments = [home.appendingPathComponent(".openclaw/orion-remote/scripts/orion-reschedule").path] + args
        let pipe = Pipe(); process.standardOutput = pipe; process.standardError = pipe
        guard (try? process.run()) != nil else { return (false, "Could not reach the planner.") }
        let data = pipe.fileHandleForReading.readDataToEndOfFile(); process.waitUntilExit()
        return (process.terminationStatus == 0, String(decoding: data, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines))
    }
    func refreshChats() { chatSummaries = (try? chatStore?.list()) ?? []; if let id = chatConversation?.id { chatConversation = try? chatStore?.load(id) } }
    func selectChat(_ id: String) { guard phase != .thinking else { return }; chatConversation = try? chatStore?.load(id); selectedChatModel = chatConversation?.model; chatMode = true }
    func newChat() { guard phase != .thinking else { return }; chatConversation = try? chatStore?.create(model: selectedChatModel, now: Date()); chatMode = true; refreshChats() }
    func renameChat(_ id: String, title: String) { try? chatStore?.rename(id, to: title); refreshChats() }
    func deleteChat(_ id: String) { guard phase != .thinking else { return }; try? chatStore?.delete(id); if chatConversation?.id == id { chatConversation = nil }; refreshChats() }
    private func saveChat(_ role: ChatRole, text: String, thinking: String? = nil) {
        if chatConversation == nil { chatConversation = try? chatStore?.create(model: selectedChatModel, now: Date()) }
        guard let id = chatConversation?.id else { return }
        try? chatStore?.setModel(id, to: selectedChatModel)
        chatConversation = try? chatStore?.append(ChatMessage(id: UUID().uuidString, role: role, text: text, thinking: thinking, at: Date(), device: "mac", model: selectedChatModel), to: id)
        refreshChats()
    }

    /// What Nick sees while `.thinking` runs — see `RunProgressModel`. Starts
    /// with the synthetic first line the moment a turn begins and is replaced
    /// wholesale by the next turn; it is a live status feed, not transcript
    /// history, so it is never appended to `turns`.
    @Published private(set) var thinkingFeed: [String] = []
    /// Seconds since the current `.thinking` phase began. The visible timer
    /// Nick asked for — so a slow answer reads as "36s and counting", not a
    /// silence indistinguishable from a stall.
    @Published private(set) var thinkingElapsedSeconds: Int = 0

    /// Bumped every time a window wants the caret back in the composer.
    /// A counter rather than a Bool: clicking the menu bar twice should focus
    /// twice, and a Bool that is already `true` publishes no change.
    @Published var focusComposerToken: UInt = 0
    /// A tab someone asked the dashboard to show (orion://show/<tab>); the
    /// dashboard selects it and clears this.
    @Published var requestedTab: DashboardTab?

    @Published private(set) var gatewayHealth = GatewayHealthSnapshot.initial
    var gatewayAvailability: GatewayAvailability { gatewayHealth.current() }
    var gatewayUp: Bool { gatewayAvailability == .ready }
    private var statusRefreshInFlight = false
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
    private let clipLibrary = ClipLibrary()
    private lazy var clipPlayer = ClipPlayer(library: clipLibrary)
    private let musicControl = AppleMusicControl()

    /// Ducks the clip while Orion talks. Only the clip — never system volume.
    private lazy var audioCoordinator = AudioCoordinator(
        clips: clipPlayer,
        setClipVolume: { [weak self] value in self?.clipPlayer.volume = value },
        currentClipVolume: { [weak self] in self?.clipPlayer.volume ?? 0 },
        music: musicControl
    )

    private lazy var sessionEffects = SessionEffects(
        clips: clipPlayer,
        speak: { [weak self] line in self?.speakSession(line) ?? false },
        log: { OrionLog.write($0) }
    )
    private(set) lazy var session = SessionService(effects: sessionEffects)

    /// The updater, handed over by AppDelegate which owns it.
    ///
    /// Here so the Settings panel can reach it without the view hierarchy
    /// having to know about the app delegate. Optional because the delegate
    /// sets it during launch, and nothing may assume it exists before then.
    var updates: UpdateController?

    /// Drift enforcement. Off until Nick confirms an allowlist — the model
    /// proposes, he authorizes. Reachable from the socket so the escape works
    /// without the gateway, the local model, or the UI being up.
    private(set) lazy var enforcer = Enforcer(
        speak: { [weak self] line in self?.speakEnforcement(line) },
        intervene: { [weak self] action in self?.applyEnforcementIntervention(action) },
        log: { OrionLog.write($0) }
    )
    /// Messages, for the socket.
    ///
    /// AppState owns its own reader rather than borrowing the dashboard's,
    /// because the socket has to answer whether or not a window is open — and
    /// the whole point is that Orion can be ASKED about a text, which happens
    /// far more often with the dashboard closed than with it open.
    private let messagesReader = MessagesReader()
    private lazy var messageBridge = MessageBridge(reader: messagesReader)
    private lazy var sessionIPC = SessionIPC(service: session, enforcer: enforcer,
                                             messages: messageBridge)

    /// The keyboard-first Console. ⌥Tab by default.
    private(set) lazy var console = ConsoleController(service: session, enforcer: enforcer)

    /// Gate 10's opt-ins. Every one off by default.
    private(set) lazy var focusExtras = FocusExtras()
    private(set) lazy var quittableApps = QuittableApps()
    private lazy var extrasCoordinator = FocusExtrasCoordinator(
        extras: focusExtras, quittable: quittableApps, music: musicControl,
        reasoner: LocalModelReasoner()
    )

    /// Cached because checking Shortcuts launches a process. SwiftUI may ask
    /// for this value while it is rendering Settings, and process work there
    /// can re-enter the view graph and abort the app.
    @Published private(set) var focusShortcutConfigured = false
    var focusSetup: String { extrasCoordinator.focusSetup }
    var focusControl: FocusModeControl { extrasCoordinator.focus }

    /// Re-check after the shortcut name is edited, so the warning clears
    /// without a relaunch.
    func recheckFocusShortcut() { refreshFocusConfiguration() }

    /// The small window that appears during a break.
    private let breakSurface = BreakSurface()
    private let focusShield = FocusShieldSurface()

    /// What the Session tab reads. Held here because AppState owns and wires.
    private(set) lazy var sessionTabModel = SessionTabModel(
        service: session, library: clipLibrary, clipPlayer: clipPlayer,
        music: musicControl, enforcer: enforcer, effects: sessionEffects
    )
    private let speakerVerifier = SpeakerVerifier()

    /// Rolling mono window of what the microphone has heard, for verification.
    /// Two seconds is plenty for a wake word and small enough to be free.
    private var verificationWindow: [Float] = []
    private var verificationRate: Double = 16000
    private static let verificationSeconds: Double = 2.0
    private let speechInput = SpeechInput()
    private let speechOutput = SpeechOutput()
    private let wakeWord = WakeWordListener()
    /// Spoken barge-in — see `BargeInMonitor.swift` and
    /// `docs/planning/v2/PHASE_VOICE_TURN_TAKING.md`. Active only during
    /// `.thinking` and `.speaking`; gated by `setPhase`.
    private let bargeInMonitor = BargeInMonitor()
    private let statusQueue = DispatchQueue(label: "com.nickmadaio.orion.status")
    private let agentQueue = DispatchQueue(label: "com.nickmadaio.orion.agent")
    /// Separate from `agentQueue` on purpose: that queue is where the blocking
    /// `GatewayClient.ask` call sits for the whole turn, so anything that must
    /// run WHILE it is blocked — polling `openclaw audit` for the progress
    /// feed — needs its own queue or it would simply never run until the turn
    /// it is supposed to be describing has already ended.
    private let auditQueue = DispatchQueue(label: "com.nickmadaio.orion.audit-poll", qos: .utility)

    private var statusTimer: Timer?
    private var permissionTimer: Timer?
    private var askGeneration = 0

    /// The feed for the turn currently in flight, or nil when nothing is
    /// running. See `RunProgressModel`.
    private var runProgress: RunProgressModel?
    /// Drives `thinkingFeed` / `thinkingElapsedSeconds` at 1Hz and checks
    /// `isWedged`. Independent of the audit poll's own cadence, so the visible
    /// elapsed timer never stalls waiting on a slow `openclaw audit` call.
    private var progressTickTimer: Timer?
    /// Bumped on every stop/restart of polling so a poll callback that is
    /// still in flight when the turn ends (or a new one starts) finds itself
    /// orphaned and does nothing, rather than writing into the wrong turn's
    /// feed.
    private var auditPollGeneration = 0

    /// A turn started by the wake word rather than by a held key: nothing will
    /// tell us when the user stopped talking, so silence has to.
    private var handsFree = false
    private var handsFreeTimer: Timer?
    private var handsFreeStartedAt = Date.distantPast
    private var lastVoiceAt = Date.distantPast
    private var handsFreeGeneration = 0
    /// The last interim text seen. Streaming recognisers may re-emit the same
    /// interim result while the room is quiet; that exact repeat is not new
    /// speech and must not keep a hands-free turn alive. Any ACTUAL change —
    /// including the text getting SHORTER, which a self-correction produces —
    /// does count; see `AdaptiveEndpointModel`'s file header for the bug this
    /// fixes (the old check only looked at `count >`, so a shrinking
    /// self-correction read as silence).
    private var lastSpeechEvidence = ""
    /// The adaptive endpointing decision for the CURRENT hands-free turn. Nil
    /// outside one, and while `awaitingFollowUp` is waiting for the user to
    /// say anything at all. Seeded from `VoiceTuning.endpointingSeconds` —
    /// see `AdaptiveEndpointModel.swift`'s header for why this, and not a
    /// second hardcoded number, is what fixes "he raised the setting and
    /// Orion still cut him off".
    private var handsFreeEndpoint: AdaptiveEndpointModel?
    /// The most recent utterance-level confidence Deepgram supplied, if any.
    /// Read (not written) by `handsFreeEndpoint.noteTranscript`.
    private var lastTranscriptConfidence: Double?

    /// Text preserved when an utterance was cut off mid-thought — a trailing
    /// continuation cue ("...and"), the hard `handsFreeLimit` ceiling, or a
    /// spoken barge-in that itself carried real words — so it is APPENDED to
    /// what follows instead of being sent as a disconnected fragment or lost
    /// outright. This is the highest-value repair in the pass: see
    /// `AdaptiveEndpointModel.appendContinuation`.
    private var preservedTranscript = ""
    /// How many times in a row a continuation is allowed before giving up and
    /// sending whatever was actually preserved — someone who keeps trailing
    /// off is still owed an answer eventually, not an Orion that listens
    /// forever.
    private var continuationChainRemaining = AppState.maxContinuationChain
    private static let maxContinuationChain = 2

    /// The last Orion reply that a spoken barge-in cut off, kept so "continue
    /// what you were saying" can re-speak it. Cleared the moment a genuinely
    /// new reply is delivered.
    private var interruptedReplyText: String?
    /// Set by `pauseThinking`: the turn generation that was paused rather
    /// than cancelled. If that generation's `GatewayClient.ask` still
    /// returns, its answer is kept — see `send(_:)`'s completion handler —
    /// instead of thrown away the way `cancelThinking` throws its answer away.
    private var pausedGeneration: Int?
    /// The paused turn's answer, once it has arrived, waiting for "continue".
    private var pausedReplacementText: String?

    /// Don't end a hands-free turn during its first moment; the user has barely
    /// drawn breath.
    private static let handsFreeLeadIn: TimeInterval = 1.0
    /// A noisy room must not hold the microphone open forever.
    private static let handsFreeLimit: TimeInterval = 12
    // There used to be a `handsFreeHangover: TimeInterval = 1.3` here — a
    // fixed silence timer, hardcoded, with NO connection to
    // `VoiceTuning.endpointingMs`. It is why raising that tunable from 900ms
    // to 1400ms (`defaults write com.nickmadaio.orion.app
    // OrionVoiceEndpointingMs 1400`) never fixed "he cuts me off": this
    // number, not that one, was ending hands-free turns. Removed rather than
    // left dead — `checkHandsFree` now reads `handsFreeEndpoint.verdict(at:)`
    // instead, seeded from `VoiceTuning.endpointingSeconds`. See
    // `AdaptiveEndpointModel.swift`'s file header and
    // `docs/planning/v2/PHASE_VOICE_TURN_TAKING.md`.

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
    /// Whether the phase we are leaving counted as being mid-exchange —
    /// listening, thinking, or speaking — so the media duck spans all three
    /// and releases exactly once, back at idle.
    private var phaseWasActive = false

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
        // The wake word heard in ORION's own reply, or in its tail.
        if speechOutput.recentlySpoke(),
           SelfEcho.isEcho(heard: trailing ?? "", spoken: speechOutput.lastSpokenText) || (trailing ?? "").isEmpty {
            OrionLog.write("[wake] ignored — ORION was just speaking; that was his own voice")
            return
        }

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
        refreshChats()
        refreshEarlyContext()
        restoreDailyLog()
        wireSpeech()
        wireSession()
        refreshFocusConfiguration()
        scheduleFocusWatcher.start { [weak self] in self?.focusExtras.quitDistractions ?? false }
    }

    /// Refresh away from SwiftUI's render pass, then publish the answer back
    /// on the main thread. The setting remains safely unavailable until this
    /// finishes; a session still reports a missing Shortcut rather than
    /// silently pretending the Focus mode was changed.
    private func refreshFocusConfiguration() {
        let coordinator = extrasCoordinator
        DispatchQueue.global(qos: .utility).async { [weak self] in
            let configured = coordinator.isFocusShortcutConfigured
            DispatchQueue.main.async {
                self?.focusShortcutConfigured = configured
            }
        }
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

    /// Reminders stay visible; only an answer to physical voice input may speak.
    private func announceReminder(_ reminder: StoredReminder) {
        let line = reminder.kind == "alarm" ? "\(reminder.label)." : "\(reminder.label) is up."
        append(.orion, line)
    }

    private var activeReplyOrigin: ReplyOrigin = .typed

    private func speak(_ text: String, origin: ReplyOrigin) {
        guard origin.allowsSpeech else {
            conversationOpen = false
            setPhase(.idle)
            statusLine = wakeWordEnabled ? "Listening for “Orion”" : "Hold Right Option to talk"
            return
        }
        setPhase(.speaking)
        statusLine = "Speaking…"
        speechOutput.speak(text)
    }

    func shutDown() {
        // Non-negotiable: quitting while ducked would leave his music quiet with
        // no obvious cause and nothing left running to explain it. Unconditional
        // restore, paired with `audioCoordinator.reset()` below for the Music/
        // clip half — together, per that file's own doc comment, "restore audio
        // now".
        AudioDucking.restoreSystemVolumeNow()
        reminders.stop()
        statusTimer?.invalidate()
        permissionTimer?.invalidate()
        statusTimer = nil
        permissionTimer = nil
        disarmWatchdog()
        speechInput.abort()
        speechOutput.stop(reason: "app shutting down")
        // Removes the socket file, so a client started after this correctly
        // reports that Orion is not running rather than hanging on a dead path.
        console.teardown()
        sessionIPC.stop()
        session.stop()
        audioCoordinator.reset()
        clipPlayer.stop()
    }

    /// Show the break window during a break, and take it away otherwise.
    ///
    /// Driven from the same snapshot as everything else rather than from a timer
    /// of its own, so it cannot disagree with what the session actually thinks
    /// is happening.
    private func updateBreakSurface(_ snapshot: SessionSnapshot) {
        guard let now = snapshot.reconciliation else {
            DispatchQueue.main.async { [weak self] in
                if self?.breakSurface.isVisible == true { self?.breakSurface.dismiss() }
            }
            return
        }

        let onBreak: Bool
        if case .running(let kind) = now.status, !kind.isFocus { onBreak = true } else { onBreak = false }
        let minutes = max(1, Int((now.remainingInPhase / 60).rounded()))

        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            if onBreak {
                self.breakSurface.onLog = { OrionLog.write($0) }
                self.breakSurface.guided = self.focusExtras.guidedBreathing
                self.breakSurface.ambience = self.focusExtras.breakAmbience
                self.breakSurface.presence = self.focusExtras.cameraPresence
                    ? "Camera is checking you are resting, not scrolling."
                    : nil
                // Holding the exit ends the rest phase itself, not just the
                // window. Dismissing the surface alone would leave the session
                // believing he is still on a break he walked out of.
                self.breakSurface.onHoldExit = { [weak self] in
                    self?.sessionTabModel.endActiveBreak()
                }
                self.breakSurface.show(remaining: now.remainingInPhase,
                                       total: self.focusExtras.breakLength.seconds,
                                       prompt: self.breakPrompt())
            } else if self.breakSurface.isVisible {
                self.breakSurface.dismiss()
            }
        }
    }

    /// What the break window suggests.
    ///
    /// Orion generates these rather than reading from a hand-maintained list —
    /// that was a decision, and a list of twelve would start repeating by the
    /// second day. Until the generator is wired, these are the fallbacks, and
    /// they are deliberately physical: the point of the break is to stop looking
    /// at the screen.
    private func breakPrompt() -> String {
        let fallbacks = [
            "Stand up. Look at something further away than this screen.",
            "Water, and a walk to the window.",
            "Shoulders down, jaw unclenched. Breathe out longer than you breathe in.",
            "Leave the desk. The block will still be here.",
            "Stretch whatever has been still for the last fifty minutes."
        ]
        // Keyed by the day so it is stable within a session rather than
        // flickering on every snapshot.
        let index = abs(OrionDay.current.key.hashValue &+ hydrationBottles) % fallbacks.count
        return fallbacks[index]
    }

    /// Focus interventions are visible, never unsolicited audio.
    private func speakEnforcement(_ line: String) {
        _ = speakSession(line)
    }

    /// Acknowledge the focus effect on screen without unsolicited speech.
    @discardableResult
    private func speakSession(_ line: String) -> Bool {
        if !line.trimmingCharacters(in: .whitespaces).isEmpty { append(.orion, line) }
        return true
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
        musicControl.onLog = { OrionLog.write($0) }
        focusShield.onLog = { OrionLog.write($0) }
        focusShield.onReleaseGuard = { [weak self] in self?.sessionTabModel.release() }

        switch clipLibrary.ensureBuiltInFocusTrack() {
        case .success(let clip):
            OrionLog.write("[clip] built-in focus track ready (\(Int(clip.duration))s loop)")
        case .failure(let failure):
            OrionLog.write("[clip] \(failure.reason)")
        }
        let inventory = clipLibrary.inventory()
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
            if !focusing { self.focusShield.dismiss(restoreWork: false) }
            self.enforcer.evaluate(sessionIsFocusing: focusing)
            self.sessionTabModel.adopt(snapshot)
            self.updateBreakSurface(snapshot)
            self.extrasCoordinator.apply(snapshot)
        }

        extrasCoordinator.onLog = { OrionLog.write($0) }
        quittableApps.onLog = { OrionLog.write($0) }
        // Say what a session would do while nobody is waiting on it, rather
        // than only finding out at the moment it fails to do it.
        extrasCoordinator.logReadiness()

        messagesReader.start()

        console.onLog = { OrionLog.write($0) }
        console.install()

        sessionIPC.onLog = { OrionLog.write($0) }
        if !sessionIPC.start() {
            OrionLog.write("[session] command socket unavailable — scripts cannot reach the session")
        }
    }

    /// Reversible focus corrections only. Guided activates a confirmed work
    /// app; Firm hides the current disallowed app without terminating it;
    /// Shield presents a surface with an unconditional local release.
    private func applyEnforcementIntervention(_ action: EnforcementIntervention) {
        DispatchQueue.main.async { [weak self] in
            switch action {
            case .restore(let bundleID):
                NSRunningApplication.runningApplications(withBundleIdentifier: bundleID)
                    .first?.activate(options: [.activateAllWindows])

            case .hide(let bundleID, let restoreBundleID):
                NSRunningApplication.runningApplications(withBundleIdentifier: bundleID)
                    .forEach { _ = $0.hide() }
                if let restoreBundleID {
                    NSRunningApplication.runningApplications(withBundleIdentifier: restoreBundleID)
                        .first?.activate(options: [.activateAllWindows])
                }

            case .shield(let reason, let restoreBundleID):
                self?.focusShield.show(reason: reason, restoreBundleID: restoreBundleID)
            }
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
            guard self.handsFree, !evidence.isEmpty else { return }
            let now = Date()
            // ANY change counts — including the text getting shorter, which a
            // self-correction produces. See the doc comment on
            // `lastSpeechEvidence` for the bug this fixes.
            if evidence != self.lastSpeechEvidence {
                self.lastVoiceAt = now
                self.lastSpeechEvidence = evidence
            }
            if var endpoint = self.handsFreeEndpoint {
                endpoint.noteTranscript(evidence, confidence: self.lastTranscriptConfidence, at: now)
                self.handsFreeEndpoint = endpoint
            }
        }
        speechInput.onTranscriptConfidence = { [weak self] value in
            self?.lastTranscriptConfidence = value
        }
        speechInput.onFinal = { [weak self] text in
            guard let self else { return }
            self.heard = ""
            let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
            self.handleFinalTranscript(trimmed)
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
            self.bargeInMonitor.observe(buffer, level: level)
        }
        wakeWord.tolerance = wakeSensitivity.tolerance
        bargeInMonitor.currentlySpoken = { [weak self] in self?.speechOutput.currentText ?? "" }
        bargeInMonitor.currentRoute = { AppState.currentOutputRouteKind() }
        bargeInMonitor.currentPhase = { [weak self] in self?.turnPhaseForBargeIn() ?? .idle }
        bargeInMonitor.onBargeIn = { [weak self] text in self?.handleSpokenBargeIn(text) }
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

    // MARK: Barge-in

    /// The route `BargeInPolicy` needs — measured, never guessed. Static
    /// because it depends on nothing but the live CoreAudio state
    /// `AudioRoute.swift` already exposes (owned by the audio-coexistence
    /// pass, not edited here).
    private static func currentOutputRouteKind() -> AudioRouteKind {
        guard let output = AudioRoute.defaultOutputID(), AudioRoute.isBluetooth(output) else {
            return .speakers
        }
        return .headset
    }

    /// `OrionPhase` collapsed to what `BargeInPolicy` needs to know. `.error`
    /// and `.idle` both read as idle to the policy — neither has anything
    /// playing to interrupt.
    private func turnPhaseForBargeIn() -> TurnPhase {
        switch phase {
        case .speaking: return .speaking(.playing)
        case .thinking: return .thinking
        case .listening: return .listening(.capturing)
        case .idle, .error: return .idle
        }
    }

    /// Confident speech heard while Orion is thinking or speaking.
    /// `BargeInMonitor` has already applied `BargeInPolicy` before calling
    /// this — nothing here re-checks the route or the energy.
    private func handleSpokenBargeIn(_ heardText: String) {
        guard activeReplyOrigin.allowsSpeech else { return }
        // His own voice through the speakers is not Nick interrupting (2026-09-29:
        // he cut himself off mid-sentence and started listening to himself).
        let echo = phase == .speaking
            ? SelfEcho.isEchoWhileSpeaking(heard: heardText, spoken: speechOutput.lastSpokenText)
            : SelfEcho.isEcho(heard: heardText, spoken: speechOutput.lastSpokenText)
        if echo {
            OrionLog.write("[bargein] ignored — that was ORION's own voice")
            return
        }
        switch phase {
        case .speaking:
            OrionLog.write("[bargein] confident speech during .speaking — stopping to listen")
            markLastReplyInterrupted()
            speechOutput.stop(reason: "spoken barge-in")
            hologram.setLevel(0)
            conversationOpen = true
            setPhase(.idle)
            beginListening(handsFree: true)
            // Set AFTER beginListening returns: a fresh, non-follow-up press
            // clears `preservedTranscript` at its own top, and this is the one
            // path that has to survive that clear — see `beginListening`.
            preservedTranscript = heardText
        case .thinking:
            OrionLog.write("[bargein] confident speech during .thinking — pausing, not cancelling")
            pauseThinking(reason: "user spoke during thinking", heardSeed: heardText)
        default:
            break
        }
    }

    /// Records the most recent Orion reply as cut off, for "continue what you
    /// were saying". A visible marker rather than a silent flag, so the
    /// transcript itself shows what happened.
    private func markLastReplyInterrupted() {
        guard let index = turns.lastIndex(where: { $0.role == .orion }) else { return }
        interruptedReplyText = turns[index].text
        if !turns[index].text.hasSuffix(" [interrupted]") {
            turns[index].text += " [interrupted]"
        }
    }

    /// Distinct from `cancelThinking`: the agent subprocess is left running
    /// rather than SIGTERM/SIGKILLed. Used when confident speech interrupts
    /// `.thinking` — nothing is being spoken yet, so there is a real answer
    /// worth keeping if it lands, not one worth throwing away. This is the
    /// "pause the task" primitive the brief asked to separate out from
    /// "cancel the task" (`cancelThinking`) and "stop speaking"
    /// (`speechOutput.stop`).
    private func pauseThinking(reason: String, heardSeed: String) {
        guard phase == .thinking else { return }
        disarmWatchdog()
        runProgress?.recordUserCancelled(at: Date())
        stopProgressPolling()
        pausedGeneration = askGeneration
        askGeneration += 1
        OrionLog.write("[think] paused by user (subprocess left running) — \(reason)")
        append(.system, "Paused — still working on that. Say \"continue\" once you're done to hear it.")
        conversationOpen = true
        setPhase(.idle)
        beginListening(handsFree: true)
        preservedTranscript = heardSeed
    }

    // MARK: Phase

    private func setPhase(_ next: OrionPhase) {
        phase = next
        hologram.setState(next.hologramState)
        onSpeakingChanged?(next == .speaking)
        // Every phase that can strand the whole app gets a guaranteed exit.
        // Armed and disarmed here because this is the only function that changes
        // `phase`, which means no future code path can enter or leave one of
        // them without the watchdog agreeing.
        //
        // This used to read `if next == .speaking`, on the belief that speaking
        // was "the one phase that can strand the whole app". It was not.
        // `.thinking` stranded it on 2026-08-12 and cost twelve minutes of
        // deafness — see `armWatchdog`.
        armWatchdog(for: next)
        // Any exit from listening ends a hands-free turn — the user pressed the
        // key, an error fired, or silence already closed it. Doing this here
        // rather than in each caller means no future path can forget and leave
        // a timer polling forever.
        if next != .listening { stopHandsFree() }
        // Duck the room while the ear is open. Placed here rather than in
        // `beginListening` so that every exit path -- silence, escape, error,
        // the key coming up -- restores the volume without having to remember to.
        if next == .listening {
            AudioDucking.beginListeningFallback()
        } else if phaseWasListening {
            AudioDucking.endListeningFallback()
        }
        phaseWasListening = next == .listening
        // The media duck spans the WHOLE exchange — listening, thinking AND
        // speaking — releasing only when the conversation returns to idle or
        // errors out. This is the fix for the music coming back up while Orion
        // is still mid-reply, which is the worst possible moment for it.
        let phaseIsActive = next == .listening || next == .thinking || next == .speaking
        if phaseIsActive, !phaseWasActive {
            audioCoordinator.beginConversation()
        } else if !phaseIsActive, phaseWasActive {
            audioCoordinator.endConversation()
        }
        phaseWasActive = phaseIsActive
        // Deaf unless idle. This is what stops Orion waking itself: while it is
        // speaking, its own voice is in the room and on the tap, and "Orion" is
        // a word it says. Suspension tears the recognition window down rather
        // than filtering results, so its own reply is never transcribed at all.
        wakeWord.setSuspended(next != .idle)
        // Spoken barge-in: active only while there is something to interrupt.
        // `BargeInPolicy` (not this) decides whether a given phrase counts —
        // see `handleSpokenBargeIn` and `TurnTakingState.swift`.
        bargeInMonitor.setActive(activeReplyOrigin.allowsSpeech && (next == .speaking || next == .thinking))
    }

    // MARK: The phase watchdogs

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

    /*
     The same reasoning applies to `.thinking`, which is why there is now one
     watchdog and not two.

     `.thinking` has exactly one exit: the completion block in `send(_:)`. That
     block runs on `agentQueue`, which is SERIAL, behind `GatewayClient.ask`,
     which blocks on `readDataToEndOfFile()`. That read returns only when every
     write end of the pipe is closed — including any handle a grandchild of the
     agent inherited and still holds. When that happens the read never returns,
     the serial queue never drains, the completion never runs, and every later
     turn queues behind the wedged one.

     `wakeWord.setSuspended(next != .idle)` then does the rest: Orion is deaf,
     the meter keeps drawing a live level at a room he cannot hear, and only
     relaunching helps. That is the 2026-08-12 incident, twelve minutes long.
    */

    /// One timer for whichever phase is currently being watched. A single timer
    /// rather than one per phase because `setPhase` is the only writer of
    /// `phase`, so exactly one phase is ever under watch.
    private var phaseWatchdogTimer: Timer?
    private var phaseWatchdog: StallWatchdog?
    /// Which phase the armed watchdog belongs to. A tick that finds the app
    /// somewhere else disarms rather than recovering the wrong phase.
    private var watchedPhase: OrionPhase?

    /// Any evidence that speech is genuinely still happening.
    private func noteSpeechProgress() {
        guard watchedPhase == .speaking else { return }
        phaseWatchdog?.noteProgress()
    }

    /// Limits for the phases that need a floor, or nil for the phases that
    /// cannot strand the app: `.idle` is where we want to be, `.error` already
    /// settles itself after four seconds, and `.listening` is watched inside
    /// `SpeechInput` — the only object that can see whether audio is actually
    /// reaching an ear.
    private func watchdogLimits(
        for phase: OrionPhase
    ) -> (stallAfter: TimeInterval, ceiling: TimeInterval)? {
        switch phase {
        case .speaking:
            return (VoiceTuning.stallTimeout, VoiceTuning.absoluteSpeakingCeiling)
        case .thinking:
            // Ceiling only. There is no progress signal to measure: the agent
            // is a subprocess that says nothing at all until it is finished.
            return (.infinity, VoiceTuning.absoluteThinkingCeiling)
        case .idle, .listening, .error:
            return nil
        }
    }

    private func armWatchdog(for phase: OrionPhase) {
        phaseWatchdogTimer?.invalidate()
        phaseWatchdogTimer = nil
        guard let limits = watchdogLimits(for: phase) else {
            phaseWatchdog = nil
            watchedPhase = nil
            return
        }
        phaseWatchdog = StallWatchdog(stallAfter: limits.stallAfter,
                                      ceiling: limits.ceiling)
        watchedPhase = phase
        // Polls rather than scheduling one long timer, so progress can push the
        // deadline out without tearing the timer down and rebuilding it.
        phaseWatchdogTimer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] _ in
            self?.checkPhaseWatchdog()
        }
    }

    private func disarmWatchdog() {
        phaseWatchdogTimer?.invalidate()
        phaseWatchdogTimer = nil
        phaseWatchdog = nil
        watchedPhase = nil
    }

    private func checkPhaseWatchdog() {
        guard let watched = watchedPhase, let watchdog = phaseWatchdog else { return }
        guard phase == watched else {
            disarmWatchdog()
            return
        }
        // The wording is built here rather than in `StallWatchdog` because
        // `orion-doctor` greps for these exact lines, and sharing a type is no
        // reason to change what it matches.
        switch (watchdog.verdict(), watched) {
        case (.healthy, _):
            return
        case (.stalled(let seconds), .speaking):
            recoverFromStuckSpeaking(reason: "no audio for \(seconds)s")
        case (.overCeiling(let seconds), .speaking):
            recoverFromStuckSpeaking(reason: "reply exceeded \(seconds)s")
        case (.stalled(let seconds), .thinking),
             (.overCeiling(let seconds), .thinking):
            recoverFromStuckThinking(reason: "no answer in \(seconds)s")
        default:
            disarmWatchdog()
        }
    }

    /// Force the end of a thinking phase that will not end on its own.
    ///
    /// The in-flight `GatewayClient.ask` is not cancelled, because from here it
    /// cannot be: it is blocked inside a read on a serial queue, which is the
    /// whole problem. Bumping `askGeneration` is what makes that harmless — if
    /// the call ever does return, its completion finds a stale generation and is
    /// dropped, so a twenty-minute-late answer can never be spoken at someone
    /// who has long since walked away.
    ///
    /// Unlike the speaking recovery this DOES say something in the transcript.
    /// A cut-off reply is Orion's problem and announcing it would be noise, but
    /// a question that never came back is the user's problem: they are owed the
    /// difference between "still working" and "that one is gone, ask again".
    private func recoverFromStuckThinking(reason: String) {
        disarmWatchdog()
        stopProgressPolling()
        OrionLog.write("[think] watchdog recovered a stuck thinking phase — \(reason)")
        askGeneration += 1
        setPhase(.idle)
        statusLine = wakeWordEnabled ? "Listening for “Orion”" : "Hold Right Option to talk"
        append(.system, "That question never came back — the agent stopped answering. Ask again.")
    }

    /// Force the end of a speaking phase that will not end on its own.
    ///
    /// Deliberately loud in the log and silent in the transcript: this is a bug
    /// report, not something Orion should announce. `orion-doctor` greps for it.
    private func recoverFromStuckSpeaking(reason: String) {
        disarmWatchdog()
        OrionLog.write("[speech] watchdog recovered a stuck speaking phase — \(reason)")
        // Tear down the audio path before changing phase: `stop` is idempotent
        // and clears `isSpeaking`, so a late `onFinished` from the wedged
        // engine finds the phase already idle and is ignored by its own guard.
        speechOutput.stop(reason: "watchdog: \(reason)")
        hologram.setLevel(0)
        setPhase(.idle)
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
        if role == .you { saveChat(.user, text: text) }
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
        guard !summonMicMuted else { return }
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
        // A genuinely fresh listen (not a follow-up continuing a preserved
        // fragment) starts clean. Callers that need to seed a preserved
        // fragment across THIS call — `handleSpokenBargeIn`, `pauseThinking`
        // — set `preservedTranscript` AFTER this function returns, which runs
        // after this clear since `beginListening` is synchronous.
        if !followUp {
            preservedTranscript = ""
            continuationChainRemaining = AppState.maxContinuationChain
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
        lastSpeechEvidence = ""
        // A follow-up starts with no endpoint model at all: nothing has been
        // said in it yet, and `checkHandsFree`'s `awaitingFollowUp` branch
        // seeds one itself the moment real speech actually arrives. An
        // ordinary hands-free turn seeds it immediately, from the tunable the
        // user actually controls — see `AdaptiveEndpointModel.swift`'s header
        // for why this, and not a second hardcoded number, is the fix.
        handsFreeEndpoint = followUp ? nil : AdaptiveEndpointModel(
            now: handsFreeStartedAt,
            baseSilence: VoiceTuning.endpointingSeconds,
            extendedSilence: VoiceTuning.extendedEndpointingSeconds
        )

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
        handsFreeEndpoint = nil
    }

    /// Was: a fixed 1.3s hangover unrelated to `VoiceTuning.endpointingMs` —
    /// see `AdaptiveEndpointModel.swift`'s header for why raising that
    /// setting never touched what actually ended a hands-free turn. Now:
    /// `handsFreeEndpoint`'s verdict, seeded from that same tunable, combined
    /// with terminal punctuation, continuation vocabulary and (when Deepgram
    /// supplies it) last-word confidence. `handsFreeLimit` and
    /// `handsFreeLeadIn` stay as hard safety backstops underneath it.
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
        // the adaptive model would see nothing but silence and finalize
        // instantly. Wait out the grace instead; if the user does start
        // talking, `lastVoiceAt` moves and this seeds a real endpoint model
        // from that moment, so the normal detection takes over from there.
        if awaitingFollowUp {
            // `lastVoiceAt` is seeded to the window's start, so any movement in
            // it means the user has begun speaking.
            if lastVoiceAt > handsFreeStartedAt {
                awaitingFollowUp = false
                // Measure the lead-in from when they actually started, not from
                // when the window opened, or the first words get clipped.
                handsFreeStartedAt = lastVoiceAt
                handsFreeEndpoint = AdaptiveEndpointModel(
                    now: lastVoiceAt,
                    baseSilence: VoiceTuning.endpointingSeconds,
                    extendedSilence: VoiceTuning.extendedEndpointingSeconds
                )
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
        if activeSTTProvider == .deepgram { return }

        guard let endpoint = handsFreeEndpoint else { return }
        switch endpoint.verdict(at: now) {
        case .keepListening, .extending:
            return
        case .finalize:
            stopHandsFree()
            endListening()
        }
    }

    /// The user did not follow up. Close the ear and go back to the wake word
    /// — but never silently: a preserved fragment from an earlier cut-off is
    /// sent rather than dropped, which is the same "never lose the words"
    /// rule `handleFinalTranscript` follows.
    private func endConversation() {
        conversationOpen = false
        awaitingFollowUp = false
        stopHandsFree()
        speechInput.discardUtterance()
        heard = ""
        if !preservedTranscript.isEmpty {
            flushPreservedTranscript()
            return
        }
        setPhase(.idle)
        statusLine = wakeWordEnabled ? "Listening for “Orion”" : "Hold Right Option to talk"
    }

    // MARK: Endpointing — preserving a cut-off transcript

    /// One finished utterance, from whichever ear delivered it — push-to-talk
    /// release or a hands-free finalize. Decides whether this is really the
    /// end of what the user meant to say, or a cut-off that should be
    /// preserved and appended to rather than sent as a fragment or lost. See
    /// `AdaptiveEndpointModel.appendContinuation` and the file header on
    /// `AdaptiveEndpointModel.swift`.
    private func handleFinalTranscript(_ text: String) {
        // 2026-09-29: the listening that follows a reply picked up its tail
        // through the speakers — "Eight", "It's eight" — and sent it to the brain
        // as if Nick had said it. Just his own words, just after he said them,
        // is echo: drop it.
        if speechOutput.recentlySpoke(within: 4),
           SelfEcho.isEchoWhileSpeaking(heard: text, spoken: speechOutput.lastSpokenText) {
            OrionLog.write("[echo] dropped a transcript that was ORION's own reply")
            endConversation()
            return
        }
        guard !text.isEmpty else {
            if preservedTranscript.isEmpty {
                setPhase(.idle)
                statusLine = "Nothing heard"
            } else {
                // Silence after a preserved fragment: the chain is over: send
                // what was actually said rather than losing it.
                flushPreservedTranscript()
            }
            return
        }

        let combined = AdaptiveEndpointModel.appendContinuation(text, to: preservedTranscript)
        stopHandsFree()
        let looksCutOff = activeSTTProvider != .deepgram && AdaptiveEndpointModel.hasContinuationCue(text)
            && !AdaptiveEndpointModel.hasTerminalPunctuation(text)

        if looksCutOff, continuationChainRemaining > 0 {
            continuationChainRemaining -= 1
            preservedTranscript = combined
            OrionLog.write("[endpoint] preserved a trailing continuation — reopening the ear "
                + "instead of sending a fragment")
            statusLine = "Go ahead…"
            setPhase(.idle)
            DispatchQueue.main.asyncAfter(deadline: .now() + AppState.followUpSettle) { [weak self] in
                guard let self, self.phase == .idle else { return }
                self.beginListening(handsFree: true, followUp: true)
            }
            return
        }

        preservedTranscript = ""
        continuationChainRemaining = AppState.maxContinuationChain
        send(combined)
    }

    /// Whatever was preserved is sent now rather than lost — used when the
    /// follow-up window that would have continued it timed out instead.
    private func flushPreservedTranscript() {
        let text = preservedTranscript
        preservedTranscript = ""
        continuationChainRemaining = AppState.maxContinuationChain
        guard !text.isEmpty else {
            setPhase(.idle)
            statusLine = "Nothing heard"
            return
        }
        send(text)
    }

    /// "Continue" / "keep going" / "what were you saying" — resume an
    /// interrupted or paused reply instead of treating the phrase as a new
    /// question. Checked in THIS order: a still-running paused turn first (it
    /// is the freshest), then its answer if it already arrived, then a
    /// speaking-interruption's saved text.
    private func handleResumeRequest(origin: ReplyOrigin) {
        if let paused = pausedReplacementText {
            pausedReplacementText = nil
            pausedGeneration = nil
            append(.orion, paused)
            speak(paused, origin: origin)
            return
        }
        if pausedGeneration != nil {
            append(.system, "Still working on that — one more moment.")
            setPhase(.idle)
            statusLine = wakeWordEnabled ? "Listening for “Orion”" : "Hold Right Option to talk"
            return
        }
        if let interrupted = interruptedReplyText {
            interruptedReplyText = nil
            append(.orion, interrupted)
            speak(interrupted, origin: origin)
            return
        }
        setPhase(.idle)
        statusLine = wakeWordEnabled ? "Listening for “Orion”" : "Hold Right Option to talk"
        append(.system, "There's nothing to continue.")
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
        } else if phase == .thinking {
            cancelThinking(reason: "user cancelled")
        }
    }

    /// Stop waiting on the current turn, deliberately, right now.
    ///
    /// Before this existed there was no way to do this at all: the ONLY thing
    /// that could end `.thinking` early was `recoverFromStuckThinking`, which
    /// only fires after `RunTimeouts.watchdogCeiling` because a watchdog
    /// cannot tell "wedged" from "slow but working" — it has to wait long
    /// enough to stop caring about the difference. A user pressing cancel is
    /// not guessing; they mean it now.
    ///
    /// Two things happen on two different clocks, deliberately:
    ///   - the UI: generation bumped, watchdog and progress polling torn down,
    ///     phase back to idle. Synchronous, so this is the part that lands
    ///     within about a second — what "cancelled" has to mean to Nick.
    ///   - the subprocess: `GatewayClient.cancelInFlight` SIGTERMs then
    ///     SIGKILLs it on a background queue. That can take longer if a
    ///     grandchild is holding its pipe open (the 2026-08-12 shape), which is
    ///     fine — nothing in the app is waiting on it any more, because the
    ///     generation bump already orphaned `send(_:)`'s completion handler.
    private func cancelThinking(reason: String) {
        guard phase == .thinking else { return }
        disarmWatchdog()
        runProgress?.recordUserCancelled(at: Date())
        stopProgressPolling()
        askGeneration += 1
        OrionLog.write("[think] cancelled by user — \(reason)")
        setPhase(.idle)
        statusLine = wakeWordEnabled ? "Listening for “Orion”" : "Hold Right Option to talk"
        append(.system, "Cancelled — stopped waiting for that one. (Anything it already started may still finish in the background.)")
        agentQueue.async {
            _ = GatewayClient.cancelInFlight(reason: reason)
        }
    }

    func toggleSummonMute() {
        summonMicMuted.toggle()
        if summonMicMuted { stopHandsFree(); speechInput.discardUtterance(); if phase == .listening { setPhase(.idle) } }
    }

    func submitTyped() {
        let text = composer.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, phase != .thinking else { return }
        composer = ""
        chatMode = true
        if phase == .speaking { bargeIn() }
        send(text, typed: true)
    }

    private func send(_ text: String, typed: Bool = false) {
        let origin: ReplyOrigin = typed ? .typed : .voice
        activeReplyOrigin = origin
        // "Continue" / "keep going" / "what were you saying" resumes an
        // interrupted or paused reply instead of asking the gateway a new
        // question. Checked here so every entry point — hands-free, a typed
        // message, and a push-to-talk release — gets the same behaviour from
        // one place.
        if AdaptiveEndpointModel.isResumeRequest(text) {
            append(.you, text)
            handleResumeRequest(origin: origin)
            return
        }
        // The clock answers the clock questions, instantly (no brain round trip).
        if let quick = QuickAnswer.reply(to: text) {
            append(.you, text)
            askGeneration += 1
            deliver(GatewayReply(text: quick, elapsedMs: 0), origin: origin)
            return
        }
        append(.you, text)
        setPhase(.thinking)
        statusLine = "Thinking…"

        askGeneration += 1
        let generation = askGeneration
        let request = agentRequest(userText: text, spoken: !typed)

        chatThinking = nil
        let chatSession = chatConversation.map { "orion-chat-" + $0.id } ?? GatewayClient.sessionKey
        let chatModel = selectedChatModel
        let turnStartedAt = Date()
        runProgress = RunProgressModel(now: turnStartedAt)
        thinkingFeed = [RunProgressModel.syntheticFirstLine]
        thinkingElapsedSeconds = 0
        startProgressPolling(
            generation: generation,
            session: chatSession,
            sinceMillis: Int(turnStartedAt.timeIntervalSince1970 * 1000)
        )

        agentQueue.async { [weak self] in
            let result: Result<GatewayReply, Error>
            do {
                result = .success(try GatewayClient.ask(request, session: chatSession, model: chatModel))
            } catch {
                result = .failure(error)
            }
            DispatchQueue.main.async {
                guard let self else { return }
                guard self.askGeneration == generation else {
                    // Not the live turn any more. If it was PAUSED rather than
                    // cancelled, the answer is still worth keeping instead of
                    // silently discarding it -- that is the entire difference
                    // between `pauseThinking` and `cancelThinking`.
                    if self.pausedGeneration == generation, case .success(let reply) = result {
                        self.pausedGeneration = nil
                        self.pausedReplacementText = reply.text
                        self.append(.system, "(The paused answer is ready — say \"continue\" to hear it.)")
                    }
                    return
                }
                self.runProgress?.markCallReturned(at: Date())
                self.stopProgressPolling()
                switch result {
                case .success(let reply):
                    self.deliver(reply, origin: origin)
                case .failure(let error):
                    let message = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
                    self.failThinking(message)
                }
            }
        }
    }

    // MARK: The progress feed

    /// Starts the 1Hz UI tick and the first audit poll for this turn. Every
    /// closure below is generation-gated: a callback that lands after the turn
    /// ended (success, failure, cancel, or the outer watchdog) finds its
    /// generation stale and does nothing, so it can never write into a later
    /// turn's feed.
    private func startProgressPolling(generation: Int, session: String, sinceMillis: Int) {
        progressTickTimer?.invalidate()
        auditPollGeneration += 1
        let pollId = auditPollGeneration

        progressTickTimer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] _ in
            guard let self, self.askGeneration == generation else { return }
            self.chatThinking = ChatThinking.read(home: FileManager.default.homeDirectoryForCurrentUser, session: session, since: Date(timeIntervalSince1970: Double(sinceMillis) / 1000))
            self.tickProgress(generation: generation)
        }
        pollAuditOnce(generation: generation, pollId: pollId, session: session, sinceMillis: sinceMillis)
    }

    /// The 1Hz half of the feed: the elapsed timer, the honest silence line,
    /// and the wedge check — none of which need to wait on a slow audit call,
    /// which is exactly why they are driven separately from it.
    private func tickProgress(generation: Int) {
        guard askGeneration == generation, let progress = runProgress else { return }
        let now = Date()
        thinkingFeed = progress.visibleLines(at: now)
        thinkingElapsedSeconds = Int(progress.elapsed(at: now))
        if let latest = thinkingFeed.last { statusLine = latest }
        if progress.isWedged(at: now) {
            // The 2026-08-12 signature, via the honest channel: audit already
            // says the run is over, and `GatewayClient.ask` still has not
            // returned. No reason to wait out `RunTimeouts.watchdogCeiling`,
            // which exists for the case where audit cannot say anything at
            // all — this case, audit already said something.
            recoverFromStuckThinking(
                reason: "audit reported the run finished \(Int(RunTimeouts.wedgeGraceAfterRunEnd))s ago; the subprocess is wedged on its pipe"
            )
        }
    }

    /// One `openclaw audit` round trip, off the main thread, feeding whatever
    /// it finds back into `runProgress` and scheduling the next one
    /// `RunTimeouts.auditPollInterval` after THIS one returns — never on a
    /// fixed cadence regardless of how long the call itself took, which is
    /// what would let slow polls queue up behind each other.
    private func pollAuditOnce(generation: Int, pollId: Int, session: String, sinceMillis: Int) {
        auditQueue.async { [weak self] in
            let page = GatewayClient.auditSince(sinceMillis, session: session)
            let records = page.map { RunProgressModel.parseAuditPage($0) } ?? []
            DispatchQueue.main.async {
                guard let self, self.askGeneration == generation, self.auditPollGeneration == pollId else { return }
                self.runProgress?.ingest(records, at: Date())
                DispatchQueue.main.asyncAfter(deadline: .now() + RunTimeouts.auditPollInterval) { [weak self] in
                    guard let self, self.askGeneration == generation, self.auditPollGeneration == pollId else { return }
                    self.pollAuditOnce(generation: generation, pollId: pollId, session: session, sinceMillis: sinceMillis)
                }
            }
        }
    }

    private func stopProgressPolling() {
        progressTickTimer?.invalidate()
        progressTickTimer = nil
        auditPollGeneration += 1 // orphans any poll callback already in flight
    }

    /// A failed turn names the stage and how long it ran, with whatever the
    /// feed had already seen — not just "the agent did not answer". Nick's own
    /// words: "i cant tell if hes actually working... or if hes timing out".
    /// The raw gateway message alone answers that no better than silence did;
    /// the elapsed time and the last thing actually observed are the part he
    /// is owed.
    private func failThinking(_ rawMessage: String) {
        let now = Date()
        let elapsed = runProgress.map { Int($0.elapsed(at: now)) }
        let lastSeen = runProgress?.visibleLines(at: now).last
        var parts: [String] = []
        if let elapsed { parts.append("Thinking stalled after \(elapsed)s.") }
        parts.append(rawMessage)
        if let lastSeen, lastSeen != RunProgressModel.syntheticFirstLine {
            parts.append("Last seen: \(lastSeen)")
        }
        fail(parts.joined(separator: " "))
    }

    /// Every desktop turn carries a compact, app-supplied snapshot of the
    /// current focus session. The agent must not infer a session from the
    /// conversation, and it does not decide this boundary: SessionService and
    /// Enforcer remain the sources of truth.
    private func agentRequest(userText: String, spoken: Bool = false) -> String {
        let snapshot = session.snapshot()
        let response = SessionWire.describe(snapshot)
        let sessionDescription: String

        if response.status == "running" || response.status == "paused" || response.status == "waiting-for-return" {
            let phase = response.phase ?? "focus"
            let task = response.task?.replacingOccurrences(of: "\n", with: " ") ?? "unnamed task"
            let block: String
            if let number = response.blockNumber, let total = response.totalBlocks {
                block = "block \(number) of \(total)"
            } else {
                block = "current block"
            }
            sessionDescription = "active; \(phase), \(block), user-set task: \(task)"
        } else {
            sessionDescription = "inactive"
        }

        let allowed = enforcer.allowlist.bundleIDs
            .sorted()
            .map { bundleID in
                NSWorkspace.shared.runningApplications.first(where: { $0.bundleIdentifier == bundleID })?.localizedName ?? bundleID
            }
        let allowedDescription = allowed.isEmpty ? "none established" : allowed.joined(separator: ", ")
        let enforcement = enforcer.isArmed ? "active" : "not active"

        return """
        [Orion app context — factual state supplied by the native app]
        Focus session: \(sessionDescription).
        Firm enforcement: \(enforcement).
        Temporary allowed work apps: \(allowedDescription).
        Treat the session status and allowed apps as current operating context. Do not claim an app is blocked, hidden, or quit unless a tool confirms it.
        \(spoken ? "Nick SAID this out loud and your answer will be SPOKEN: one to three short sentences, no lists, no markdown, times as \"8:15 PM\". Offer detail only if he asks." : "")

        User message:
        \(userText)
        """
    }

    private func deliver(_ reply: GatewayReply, origin: ReplyOrigin) {
        // A genuinely new reply retires whatever an earlier interruption was
        // keeping around -- "continue what you were saying" should never
        // resurrect a stale answer once a new one has actually arrived.
        interruptedReplyText = nil
        chatThinking = reply.thinking
        saveChat(.orion, text: reply.text, thinking: reply.thinking)
        append(.orion, reply.text)
        speak(reply.text, origin: origin)
    }

    // MARK: Status and permissions

    func refreshStatus() {
        // Timer, menu and retry share one probe, so repeated clicks cannot queue
        // old observations behind a slow service. All callers are on main.
        guard !statusRefreshInFlight else { return }
        statusRefreshInFlight = true
        statusQueue.async { [weak self] in
            let gateway = GatewayHealthProbe.check(port: GatewayClient.port())
            let voice = TTSClient.isReachable()
            DispatchQueue.main.async {
                guard let self else { return }
                self.statusRefreshInFlight = false
                self.gatewayHealth = gateway
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
        let gateway = gatewayAvailability.title
        let voice = voiceUp ? "voice daemon reachable" : "voice fallback"
        return "\(gateway) · \(voice)"
    }

    /// What is actually speaking and listening right now. Short enough for a
    /// menu item, honest enough to debug from.
    var voiceSummary: String {
        let speaking = activeTTSEngine == "—" ? ttsProvider.rawValue : activeTTSEngine
        return "voice \(speaking) · ears \(activeSTTProvider.rawValue)"
    }
}
