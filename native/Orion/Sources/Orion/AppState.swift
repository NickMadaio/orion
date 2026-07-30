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

    // MARK: Collaborators

    let hologram = HologramModel()
    private let speechInput = SpeechInput()
    private let speechOutput = SpeechOutput()
    private let statusQueue = DispatchQueue(label: "com.nickmadaio.orion.status")
    private let agentQueue = DispatchQueue(label: "com.nickmadaio.orion.agent")

    private var statusTimer: Timer?
    private var permissionTimer: Timer?
    private var askGeneration = 0

    private static let qualityKey = "OrionHologramQuality"

    /// Stable id for the invisible row at the end of the transcript, so the
    /// scroll view can be pinned to the bottom as turns arrive.
    static let transcriptBottomAnchor = "orion.transcript.bottom"

    /// Set by the app delegate so state changes can drive the escape watcher and
    /// bring the panel forward when the user talks to a hidden Orion.
    var onSpeakingChanged: ((Bool) -> Void)?
    var onWantsPanel: (() -> Void)?

    // MARK: Lifecycle

    init() {
        if let stored = UserDefaults.standard.string(forKey: AppState.qualityKey),
           let value = HologramQuality(rawValue: stored) {
            quality = value
        }
        hologram.quality = quality
        wireSpeech()
    }

    func start() {
        refreshPermissions()
        refreshStatus()

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
            self?.hologram.setLevel(level)
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
    }

    // MARK: Phase

    private func setPhase(_ next: OrionPhase) {
        phase = next
        hologram.setState(next.hologramState)
        onSpeakingChanged?(next == .speaking)
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
    func beginListening() {
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
        statusLine = "Listening…"
        hologram.ping()
        speechInput.start()
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
}
