//
//  ⌥Tab — ORION's quick menu (revamped 7 Oct 2026). One gesture: what is on
//  now, what is next, and the handful of things worth doing about it, typed or
//  arrowed to. Anything that is not a command is asked of ORION.
//
//  Two rules shape this, both from the plan and both about not lying.
//
//  PROVENANCE IS TYPED, NOT INFERRED. A sentence produced by a keystroke is not
//  automatically trusted user speech. Session commands carry `origin: .console`
//  and their own request id, and that origin travels through authorization and
//  into the ledger unchanged. Text sent to ORION goes the typed route, never
//  as voice.
//
//  NEVER A ONE-KEYSTROKE BUTTON FOR SOMETHING THAT NEEDS APPROVAL. The capability
//  tiers are AUTO, NOTIFY, APPROVAL and NEVER (see `scripts/orion-authority`).
//  Only the first two may appear here. A Console that offers a one-key shortcut
//  for an APPROVAL action has quietly converted "ask first" into "press this",
//  which is the entire safety property of the gate, deleted by a convenience
//  feature.
//

import AppKit
import SwiftUI
import SessionDomain
import SessionService

/// What the Console is allowed to offer.
enum ConsoleTier: String {
    case auto = "AUTO"
    case notify = "NOTIFY"
    case approval = "APPROVAL"
    case never = "NEVER"

    /// The filter. Deliberately a whitelist rather than "not never" — a new tier
    /// added later must be excluded until somebody decides it belongs, not
    /// included because nobody remembered to exclude it.
    var mayAppearInConsole: Bool { self == .auto || self == .notify }
}

struct ConsoleCommand: Identifiable, Equatable {
    let id: String
    let title: String
    let hint: String
    let symbol: String
    let section: Section
    let tier: ConsoleTier
    let kind: Kind
    /// Extra words a search should match ("pomodoro" finds focus).
    var keywords: String = ""

    enum Section: String { case typed = "", session = "SESSION", orion = "ORION", goTo = "GO TO" }

    enum Kind: Equatable {
        case session(CommandKind)
        case releaseEnforcement
        case ask(String)
        case listen
        case openChat
        case openTab(DashboardTab)
        case finishEarly
        case addTodo(String)
        case toggleMute
        case openApp(URL)
    }
}

/// What the menu shows above the field, from `scripts/orion-quick`.
struct QuickGlance: Decodable, Equatable {
    struct Now: Decodable, Equatable { let title: String; let until: String }
    struct Next: Decodable, Equatable { let title: String; let at: String; let inMinutes: Int }
    let now: Now?
    let next: Next?
    let focusToday: String?
    let phone: String?
}

/// The live session, as one line of facts.
struct QuickSession: Equatable {
    let running: Bool
    let paused: Bool
    let onBreak: Bool
    let remaining: TimeInterval
    /// When the phase ends, for a clock that counts down; nil while paused.
    let endsAt: Date?
    let label: String

    func remaining(at date: Date) -> TimeInterval { endsAt.map { $0.timeIntervalSince(date) } ?? remaining }
}

/// What the menu may ask the rest of the app to do. Set by `AppState`.
struct ConsoleActions {
    var ask: (String) -> Void = { _ in }
    var listen: () -> Void = {}
    var openChat: () -> Void = {}
    var openTab: (DashboardTab) -> Void = { _ in }
    var finishEarly: () -> Void = {}
    var toggleMute: () -> Void = {}
    var isMuted: () -> Bool = { false }
    var say: (String) -> Void = { _ in }
}

final class ConsoleController: ObservableObject {

    @Published private(set) var isVisible = false
    @Published var query = "" { didSet { selection = 0 } }
    @Published var selection = 0
    @Published private(set) var glance: QuickGlance?
    @Published private(set) var session: QuickSession?

    /// What the hotkey registration had to say. Shown in the Console itself,
    /// because a shortcut that silently does nothing reads as Orion being broken.
    @Published private(set) var hotKeyProblem: String?

    var actions = ConsoleActions()
    var onLog: ((String) -> Void)?

    private var panel: NSPanel?
    private let hotKey = GlobalHotKey()
    private var previousApp: NSRunningApplication?
    private var apps: [(name: String, url: URL)] = []

    private let service: SessionService
    private let enforcer: Enforcer

    init(service: SessionService, enforcer: Enforcer) {
        self.service = service
        self.enforcer = enforcer
    }

    // MARK: Wiring

    func install(_ combination: HotKeyCombination = .optionTab) {
        hotKey.onLog = { [weak self] line in self?.onLog?(line) }
        hotKey.onFire = { [weak self] in self?.toggle() }

        let registration = hotKey.register(combination)
        hotKeyProblem = registration.disclosure
    }

    func teardown() {
        hotKey.unregister()
        hide()
    }

    // MARK: Showing

    func toggle() { isVisible ? hide() : show() }

    func show() {
        guard panel == nil else { return }
        previousApp = NSWorkspace.shared.frontmostApplication
        refreshSession()
        loadGlance()
        if apps.isEmpty { apps = Self.installedApps() }

        let panel = NSPanel(
            contentRect: NSRect(x: 0, y: 0, width: QuickMenuView.width, height: 420),
            styleMask: [.titled, .fullSizeContentView, .nonactivatingPanel],
            backing: .buffered, defer: false
        )
        panel.titleVisibility = .hidden
        panel.titlebarAppearsTransparent = true
        panel.isMovableByWindowBackground = true
        panel.level = .floating
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = true
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
        let host = NSHostingController(rootView: QuickMenuView(controller: self))
        host.sizingOptions = [.preferredContentSize]
        host.view.wantsLayer = true
        host.view.layer?.backgroundColor = .clear
        panel.contentViewController = host

        if let screen = NSScreen.main {
            let frame = screen.visibleFrame
            panel.setFrameTopLeftPoint(NSPoint(x: frame.midX - QuickMenuView.width / 2,
                                               y: frame.maxY - frame.height * 0.22))
        }

        // The Console DOES take key focus, unlike the break surface: it has a
        // text field, and a text field nobody can type into is not a console.
        panel.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)

        self.panel = panel
        isVisible = true
    }

    func hide() {
        panel?.orderOut(nil)
        panel = nil
        isVisible = false
        query = ""

        // Hand focus back to whatever he was in. Without this, dismissing the
        // Console leaves Orion frontmost and he has to click his editor again —
        // every time, which is enough to stop using it.
        if let previousApp, previousApp.bundleIdentifier != Bundle.main.bundleIdentifier {
            previousApp.activate()
        }
        previousApp = nil
    }

    // MARK: Live facts

    private func refreshSession() {
        let wire = SessionWire.describe(service.snapshot())
        switch wire.status {
        case "running", "paused", "waiting-for-return":
            let block = wire.phase == "focus"
                ? "focus \(wire.blockNumber ?? 1) of \(wire.totalBlocks ?? 1)" : "break"
            session = QuickSession(running: true, paused: wire.status == "paused",
                                   onBreak: wire.phase != "focus",
                                   remaining: wire.remainingSeconds ?? 0,
                                   endsAt: wire.status == "running"
                                       ? Date().addingTimeInterval(wire.remainingSeconds ?? 0) : nil,
                                   label: [block, wire.task].compactMap { $0 }.joined(separator: " · "))
        default:
            session = nil
        }
    }

    private func loadGlance() {
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            let output = Self.runScript("orion-quick", [])
            let decoded = output.flatMap { try? JSONDecoder().decode(QuickGlance.self, from: Data($0.utf8)) }
            DispatchQueue.main.async { self?.glance = decoded }
        }
    }

    /// Runs one of ORION's scripts with the bundled node; nil when it fails.
    static func runScript(_ name: String, _ arguments: [String]) -> String? {
        let home = FileManager.default.homeDirectoryForCurrentUser
        let process = Process()
        process.executableURL = home.appendingPathComponent(".openclaw/tools/node-v24.15.0/bin/node")
        process.arguments = [home.appendingPathComponent("Desktop/ORION/scripts/\(name)").path] + arguments
        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = pipe
        do { try process.run() } catch { return nil }
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        let text = String(decoding: data, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
        return process.terminationStatus == 0 ? text : nil
    }

    private static func installedApps() -> [(name: String, url: URL)] {
        let roots = ["/Applications", "/Applications/Utilities", "/System/Applications",
                     "/System/Applications/Utilities", "/System/Library/CoreServices",
                     FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Applications").path]
        return roots.flatMap { root -> [(name: String, url: URL)] in
            let names = (try? FileManager.default.contentsOfDirectory(atPath: root)) ?? []
            return names.filter { $0.hasSuffix(".app") }.map {
                (String($0.dropLast(4)), URL(fileURLWithPath: root).appendingPathComponent($0))
            }
        }
    }

    // MARK: Commands

    /// Only AUTO and NOTIFY, filtered here rather than at the call site so
    /// there is exactly one place the rule lives.
    var matches: [ConsoleCommand] {
        let typed = query.trimmingCharacters(in: .whitespaces)
        let all = typed.isEmpty
            ? QuickCommands.everyday(session: session, glance: glance, muted: actions.isMuted())
            : QuickCommands.forQuery(typed, session: session, glance: glance,
                                     muted: actions.isMuted(), apps: apps)
        return Array(all.filter(\.tier.mayAppearInConsole).prefix(9))
    }

    func moveSelection(_ step: Int) {
        let count = matches.count
        guard count > 0 else { return }
        selection = (selection + step + count) % count
    }

    func runSelected() {
        let list = matches
        guard list.indices.contains(selection) else { return }
        run(list[selection])
    }

    /// ⌘↩: whatever is typed goes to ORION, even when it matches a command.
    func askTyped() {
        let typed = query.trimmingCharacters(in: .whitespaces)
        guard !typed.isEmpty else { return }
        run(ConsoleCommand(id: "ask", title: typed, hint: "", symbol: "sparkle", section: .typed,
                           tier: .auto, kind: .ask(typed)))
    }

    /// Run one, with typed provenance.
    func run(_ command: ConsoleCommand) {
        guard command.tier.mayAppearInConsole else { return }
        hide()
        switch command.kind {
        case .releaseEnforcement:
            enforcer.release()
            onLog?("[console] released enforcement")
        case .session(let kind):
            // `origin: .console` — typed, and carried through unchanged. This is
            // not speech and must never be recorded as speech.
            let outcome = service.send(Command(
                requestID: RequestID(from: UUID()),
                origin: .console,
                issuedAt: Date(),
                kind: kind
            ))
            if let rejection = outcome.rejection, !outcome.wasDuplicate {
                onLog?("[console] \(command.title): \(rejection.message)")
                actions.say(rejection.message)
            } else {
                onLog?("[console] \(command.title)")
            }
        case .ask(let text): actions.ask(text)
        case .listen: actions.listen()
        case .openChat: actions.openChat()
        case .openTab(let tab): actions.openTab(tab)
        case .finishEarly: actions.finishEarly()
        case .toggleMute: actions.toggleMute()
        case .openApp(let url):
            NSWorkspace.shared.openApplication(at: url, configuration: NSWorkspace.OpenConfiguration())
            onLog?("[console] opened \(url.lastPathComponent)")
        case .addTodo(let title):
            onLog?("[console] add to-do")
            DispatchQueue.global(qos: .userInitiated).async { [actions] in
                let result = Self.runScript("orion-tasks", ["add", title])
                DispatchQueue.main.async { actions.say(result ?? "Could not add \"\(title)\" to your to-dos.") }
            }
        }
    }
}
