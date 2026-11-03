//
//  ⌥Tab — ORION's command palette (revamped 3 Nov 2026, w18). One fuzzy-ranked list of what ORION can do, where he can
//  go and which apps he can open or switch to, with inline modes by prefix. The ranking, frecency, modes, calculator and
//  keyboard state live in PaletteKit; this file owns the panel, the hotkey and what a chosen row actually does.
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
//  feature. Closing apps is the one bulk action here, and it shows its plan and waits for a second Enter.
//

import AppKit
import SwiftUI
import PaletteKit
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

extension PaletteAction {
    /// Every row the palette lists is AUTO or NOTIFY. Actions that tell you what they did are NOTIFY.
    var tier: ConsoleTier {
        switch self {
        case .sessionOp(.finish), .gameReady, .closeUnused, .quitApp, .todoDone, .finishEarly: return .notify
        default: return .auto
        }
    }
}

/// What the palette may ask the rest of the app to do. Set by `AppState`.
struct ConsoleActions {
    /// The same path the typed summon uses: the composer, then `submitTyped`.
    var ask: (String) -> Void = { _ in }
    var isThinking: () -> Bool = { false }
    var lastTurnID: () -> UUID? = { nil }
    var listen: () -> Void = {}
    var openChat: () -> Void = {}
    var openTab: (DashboardTab) -> Void = { _ in }
    var finishEarly: () -> Void = {}
    var toggleMute: () -> Void = {}
    var isMuted: () -> Bool = { false }
    var say: (String) -> Void = { _ in }
}

final class ConsoleController: ObservableObject {

    let model = PaletteModel()
    @Published private(set) var isVisible = false

    var actions = ConsoleActions()
    var onLog: ((String) -> Void)?

    var panel: NSPanel?
    private let hotKey = GlobalHotKey()
    private var previousApp: NSRunningApplication?
    private var keyMonitor: Any?

    let service: SessionService
    let enforcer: Enforcer

    // Caches the context is built from; each refresh happens off the main thread.
    var installed: [PaletteInstalledApp] = []
    var todos: [PaletteTodo] = []
    var askedAfter: UUID?
    let persistQueue = DispatchQueue(label: "orion.palette.persist", qos: .utility)

    init(service: SessionService, enforcer: Enforcer) {
        self.service = service
        self.enforcer = enforcer
    }

    // MARK: Wiring

    func install(_ combination: HotKeyCombination = .optionTab) {
        hotKey.onLog = { [weak self] line in self?.onLog?(line) }
        hotKey.onFire = { [weak self] in self?.toggle() }
        model.hotKeyProblem = hotKey.register(combination).disclosure

        // Everything slow happens here, once, off the main thread; the panel itself is built on the next turn so
        // the first ⌥Tab only has to order it front.
        persistQueue.async { [weak self] in
            let history = FrecencyFile.standard.load()
            let cache = PaletteAppIndex.cached()
            DispatchQueue.main.async {
                self?.model.frecency = history
                self?.installed = cache.apps
                self?.rebuildContext()
            }
            if cache.stale { self?.rescanApps() }
        }
        DispatchQueue.main.async { [weak self] in _ = self?.makePanelIfNeeded() }
    }

    func teardown() {
        hotKey.unregister()
        hide()
    }

    // MARK: Showing

    func toggle() { isVisible ? hide() : show() }

    func show() {
        guard !isVisible else { return }
        previousApp = NSWorkspace.shared.frontmostApplication
        model.reset()
        refreshSession()
        rebuildContext()
        refreshLive()

        let panel = makePanelIfNeeded()
        position(panel)
        isVisible = true
        installKeyMonitor()
        panel.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        DispatchQueue.main.async { panel.invalidateShadow() }
    }

    func hide() {
        guard isVisible else { return }
        removeKeyMonitor()
        panel?.orderOut(nil)
        isVisible = false
        model.output = nil
        askedAfter = nil

        // Hand focus back to whatever he was in. Without this, dismissing the
        // Console leaves Orion frontmost and he has to click his editor again —
        // every time, which is enough to stop using it.
        if let previousApp, previousApp.bundleIdentifier != Bundle.main.bundleIdentifier {
            previousApp.activate()
        }
        previousApp = nil
    }

    private func makePanelIfNeeded() -> NSPanel {
        if let panel { return panel }
        let size = NSSize(width: PaletteView.width, height: PaletteView.height)
        let panel = PalettePanel(contentRect: NSRect(origin: .zero, size: size),
                                 styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = true
        panel.level = .floating
        panel.isMovableByWindowBackground = true
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
        let host = NSHostingView(rootView: PaletteView(model: model, onRun: { [weak self] index in self?.runRow(at: index) }))
        host.frame = NSRect(origin: .zero, size: size)
        host.wantsLayer = true
        host.layer?.backgroundColor = .clear
        panel.contentView = host
        self.panel = panel
        return panel
    }

    /// Centred, a little above the middle of the screen the pointer is on.
    private func position(_ panel: NSPanel) {
        let mouse = NSEvent.mouseLocation
        let screen = NSScreen.screens.first { $0.frame.contains(mouse) } ?? NSScreen.main
        guard let frame = screen?.visibleFrame else { return }
        let size = panel.frame.size
        panel.setFrameOrigin(NSPoint(x: frame.midX - size.width / 2,
                                     y: frame.midY - size.height / 2 + frame.height * 0.09))
    }

    // MARK: Keys

    private func installKeyMonitor() {
        guard keyMonitor == nil else { return }
        keyMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            guard let self, event.window === self.panel else { return event }
            let flags = event.modifierFlags
            guard let key = PaletteKey.from(keyCode: event.keyCode, characters: event.charactersIgnoringModifiers ?? "",
                                            command: flags.contains(.command), shift: flags.contains(.shift),
                                            option: flags.contains(.option), control: flags.contains(.control)) else { return event }
            self.handle(key)
            return nil
        }
    }

    private func removeKeyMonitor() {
        if let keyMonitor { NSEvent.removeMonitor(keyMonitor) }
        keyMonitor = nil
    }

    func handle(_ key: PaletteKey) {
        switch key {
        case .up: model.move(-1)
        case .down: model.move(1)
        case .tab: model.cycleSection()
        case .backTab: model.cycleSection(backward: true)
        case .actionsMenu: model.openSubMenu()
        case .enter: enter()
        case .escape: escape()
        case .askTyped: askTyped()
        case .quitApp: quitSelectedApp()
        case .quickPick(let number):
            if let item = model.nav.quickPick(number) { run(item) }
        }
    }

    private func escape() {
        if model.nav.subMenu != nil { model.closeSubMenu() }
        else if model.output?.isPlan == true { model.output = nil }
        else { hide() }
    }

    private func enter() {
        if let sub = model.nav.selectedSubAction, model.nav.subMenu != nil {
            model.closeSubMenu()
            perform(sub.action, id: nil)
            return
        }
        switch model.output {
        case .plan?: confirmCloseUnused()
        case .answer?: actions.openChat(); hide()
        case .result?: hide()
        case .working?, .planning?, .thinking?: break
        case nil: if let item = model.nav.selectedItem { run(item) }
        }
    }

    func runRow(at index: Int) {
        model.select(index)
        if let item = model.nav.selectedItem { run(item) }
    }

    // MARK: Live facts

    func refreshSession() {
        let wire = SessionWire.describe(service.snapshot())
        switch wire.status {
        case "running", "paused", "waiting-for-return":
            let block = wire.phase == "focus"
                ? "focus \(wire.blockNumber ?? 1) of \(wire.totalBlocks ?? 1)" : "break"
            model.session = QuickSession(running: true, paused: wire.status == "paused",
                                         onBreak: wire.phase != "focus",
                                         remaining: wire.remainingSeconds ?? 0,
                                         endsAt: wire.status == "running"
                                             ? Date().addingTimeInterval(wire.remainingSeconds ?? 0) : nil,
                                         label: [block, wire.task].compactMap { $0 }.joined(separator: " · "))
        default:
            model.session = nil
        }
    }

    /// Glance, to-dos and (when stale) the app index: all off the main thread, each applied when it lands.
    private func refreshLive() {
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            let output = PaletteScripts.run("orion-quick", [], timeout: 15)
            let decoded = output.ok ? try? JSONDecoder().decode(QuickGlance.self, from: Data(output.text.utf8)) : nil
            DispatchQueue.main.async { self?.model.glance = decoded; self?.rebuildContext() }
        }
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            let list = PaletteScripts.run("orion-tasks", ["list"], timeout: 25)
            let parsed = list.ok ? PaletteTodoParser.parse(list.text, today: Self.todayString()) : nil
            DispatchQueue.main.async {
                if let parsed { self?.todos = parsed }
                self?.rebuildContext()
            }
        }
        persistQueue.async { [weak self] in
            if PaletteAppIndex.cached().stale { self?.rescanApps() }
        }
    }

    private func rescanApps() {
        let apps = PaletteAppIndex.scan()
        PaletteAppIndex.save(apps)
        DispatchQueue.main.async { [weak self] in self?.installed = apps; self?.rebuildContext() }
    }

    func rebuildContext() {
        let session = model.session.map { PaletteSession(paused: $0.paused, onBreak: $0.onBreak) }
        var focusMinutes: Int?
        if session == nil, let next = model.glance?.next, (15...600).contains(next.inMinutes - 5) { focusMinutes = next.inMinutes - 5 }
        model.context = PaletteContext(session: session, muted: actions.isMuted(),
                                       mouseShortcutsOn: MouseController.shared.bindings.enabled,
                                       nextFocusMinutes: focusMinutes, todos: todos, installed: installed,
                                       running: PaletteAppIndex.running())
    }

    /// Runs one of ORION's scripts with the bundled node; nil when it fails (UsageView still calls this).
    static func runScript(_ name: String, _ arguments: [String]) -> String? {
        let result = PaletteScripts.run(name, arguments, timeout: 60)
        return result.ok ? result.text : nil
    }

    static func todayString() -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: Date())
    }
}

/// A borderless panel that can still take key focus: the field needs it.
final class PalettePanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }
}
