import AppKit
import Foundation
import MouseKit

/*
 Main-thread only (callbacks arrive on the main queue or run loop). Owns the mouse feature: the device watcher, the remapper, the cached bindings and the settings state.
 Devices and bindings live in ~/.openclaw/orion-controlled/mouse/ (see MouseKit). The chat side (orion-mouse) also
 writes bindings.json, so the file's modification time is polled and the in-memory copy reloaded on change.
 Game detection is cached on app activation, never computed per click.
 */
final class MouseController: ObservableObject {
    static let shared = MouseController()
    @Published private(set) var devices = DevicesFile()
    @Published private(set) var bindings = BindingsFile()
    @Published private(set) var accessibilityGranted = Permissions.accessibilityTrusted
    @Published private(set) var tapRunning = false
    /// The extra button last pressed, for "press it to identify".
    @Published private(set) var lastPressed: Int?
    @Published private(set) var frontmost: (bundleId: String, name: String)?

    /// The runtime gate for the buttons: off while a game is in front, on otherwise; the hotkey flips it. Not persisted.
    @Published private(set) var gate = MouseGate()
    /// A game is running (w18 gamemode). Drives game-prep, the reopen offer and the wheel's "In games" mode, not the buttons.
    @Published private(set) var gameSession = GameSession.idle
    /// Closing unneeded apps when a game opens. On unless switched off; the keep list lives in game-prep.json.
    @Published private(set) var autoPrep = true
    /// "Game mode: closed Chrome ... Mouse shortcuts paused." for the bubble.
    var onGameStarted: ((String) -> Void)?
    /// "Game over — want me to reopen Chrome and Slack?" (only when apps were closed).
    var onGameOver: ((String) -> Void)?
    /// "Mouse shortcuts off" / "on": a quiet bubble, never spoken.
    var onToggled: ((String) -> Void)?
    /// Why the toggle hotkey is not working (taken by another app), for the shortcut row.
    @Published private(set) var toggleKeyProblem: String?
    private let toggleKey = GlobalHotKey()
    private var registeredToggleShortcut: String?
    private var reopenApps: [ClosedApp] = []

    /// Delivers ORION's question as the proactive bubble; the id is the outreach record's id.
    var onAsk: ((String, String) -> Void)?
    var onOrionCommand: ((String) -> Void)?
    /// `orion-mouse setup` (chat) or orion://mouse-setup: open the setup popup.
    var onSetupRequested: (() -> Void)?
    /// While the setup popup is open, presses are swallowed and identify rows but do not run their actions.
    private(set) var setupOpen = false
    private var outreachOffset = 0

    private let store: MouseStore
    private let sessionStore = GameSessionStore(controlledDir: MouseStore.defaultControlledDir())
    private let prepConfig = GamePrepConfigStore(controlledDir: MouseStore.defaultControlledDir())
    private let watcher = MouseDeviceWatcher()
    private let remapper = MouseRemapper()
    private var activationToken: NSObjectProtocol?
    private var poll: Timer?
    private var bindingsStamp: Date?
    private var lastBundle: String?
    private var lastGame = false
    private var ticks = 0
    private var naturalScrolling = true

    init(store: MouseStore = MouseStore(controlledDir: MouseStore.defaultControlledDir())) {
        self.store = store
    }

    func start() {
        devices = store.loadDevices()
        outreachOffset = (try? Data(contentsOf: outreachURL))?.count ?? 0   // old lines are history
        refreshNaturalScrolling()
        loadBindingsFromDisk()
        autoPrep = prepConfig.autoPrep()
        restoreGameSession()
        toggleKey.onLog = { OrionLog.write($0) }
        toggleKey.onFire = { [weak self] in self?.toggleMouseShortcuts() }
        registerToggleKey()
        remapper.onAction = { [weak self] action, _ in
            guard self?.setupOpen == false else { return }
            MouseActions.run(action) { self?.onOrionCommand?($0) }
        }
        remapper.onObserved = { [weak self] button in self?.observed(button) }
        watcher.onAttach = { [weak self] mouse in self?.attached(mouse) }
        watcher.onDetach = { [weak self] id in self?.detached(id) }
        watcher.start()
        activationToken = NSWorkspace.shared.notificationCenter.addObserver(
            forName: NSWorkspace.didActivateApplicationNotification, object: nil, queue: .main) { [weak self] note in
            let app = note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication
            self?.activated(app)
        }
        activated(NSWorkspace.shared.frontmostApplication)
        refreshTap()
        poll = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            self?.tick()
        }
    }

    func stop() {
        poll?.invalidate(); poll = nil
        toggleKey.unregister(); registeredToggleShortcut = nil
        if let activationToken { NSWorkspace.shared.notificationCenter.removeObserver(activationToken) }
        watcher.stop(); remapper.stop()
    }

    // MARK: Settings actions (each re-reads the file first, so the chat side's edit is kept)

    func setDefault(_ button: Int, _ action: MouseAction?) { change { $0.settingDefault(button, action) }; markConfigured() }
    func setApp(_ bundleId: String, button: Int, _ action: MouseAction?) { change { $0.settingApp(bundleId, button: button, action) }; markConfigured() }
    func togglePassthrough(_ bundleId: String) { change { $0.togglingPassthrough(bundleId) } }
    func setAutoGames(_ on: Bool) { change { var b = $0; b.autoPassthroughGames = on; return b } }
    func setReverseWheel(_ mode: ReverseWheelMode) { change { var b = $0; b.reverseWheel = mode; return b } }
    func setAutoPrep(_ on: Bool) {
        do { try prepConfig.setAutoPrep(on) } catch { OrionLog.write("[game] could not save the auto-prep setting: \(error.localizedDescription)") }
        autoPrep = prepConfig.autoPrep()
    }
    /// Reopen / No on the game-over bubble.
    func answerReopen(_ yes: Bool) {
        if yes { GamePrepRunner.reopen(reopenApps) }
        reopenApps = []
    }
    func setEnabled(_ on: Bool) { change { var b = $0; b.enabled = on; return b } }
    func setAutoPause(_ on: Bool) { change { var b = $0; b.autoPauseInGames = on; return b } }

    /// The global hotkey: flips the runtime gate (not the file) and says so quietly.
    func toggleMouseShortcuts() {
        setGate(gate.toggled())
        onToggled?(MouseToggleWords.line(enabled: gate.passes(masterEnabled: bindings.enabled)))
    }

    private func setGate(_ next: MouseGate) {
        guard next != gate else { return }
        gate = next
        remapper.update { var s = $0; s.gateOn = next.isOn; return s }
    }

    /// A recorded shortcut ("ctrl+opt+m"). Ignored when it does not parse.
    func setToggleShortcut(_ text: String) {
        guard ShortcutParser.parse(text) != nil else { return }
        change { var b = $0; b.toggleShortcut = text; return b }
    }
    func resetToggleShortcut() { setToggleShortcut(BindingsFile.defaultToggleShortcut) }

    private func registerToggleKey() {
        let text = bindings.toggleShortcut
        guard text != registeredToggleShortcut, let parsed = ShortcutParser.parse(text) else { return }
        registeredToggleShortcut = text
        let result = toggleKey.register(HotKeyCombination(keyCode: UInt32(parsed.keyCode), modifiers: ShortcutParser.carbonModifiers(parsed.flags)))
        toggleKeyProblem = result.isRegistered ? nil : "\(ShortcutParser.symbols(text)) is taken by another app. Record a different shortcut."
    }
    func clearLastPressed() { lastPressed = nil }

    /// Re-reads both files without starting the watcher or the tap (previews and tests).
    func reload() { devices = store.loadDevices(); loadBindingsFromDisk() }
    func highlight(_ button: Int?) { lastPressed = button }

    private var outreachURL: URL { MouseStore.defaultControlledDir().appendingPathComponent("outreach.jsonl") }

    private var setupBaseline: BindingsFile?
    func setSetupOpen(_ open: Bool) {
        setupOpen = open
        if open { setupBaseline = bindings } else { lastPressed = nil }
    }

    /// Done: saves the suggested defaults only on a mouse with no bindings yet, marks the device configured, returns the confirmation line.
    func finishSetup() -> String {
        let buttons = Array(Set(devices.devices.filter(\.connected).flatMap(\.extraButtons)).union(bindings.default.keys.compactMap(Int.init))).sorted()
        let before = setupBaseline ?? bindings
        change { MouseSetupPlan.finalized($0, buttons: buttons) }
        markConfigured()
        return MouseSetupPlan.doneLine(before: before, after: bindings, buttons: buttons)
    }

    /// New `setup-open` lines appended to outreach.jsonl since launch (the chat side's trigger).
    private func checkSetupRequests() {
        guard let data = try? Data(contentsOf: outreachURL) else { return }
        let (lines, next) = OutreachTail.newLines(in: data, after: outreachOffset)
        outreachOffset = next
        if lines.contains(where: OutreachTail.isSetupOpen) { onSetupRequested?() }
    }

    func requestAccessibility() {
        Permissions.promptForAccessibility()
        Permissions.openAccessibilitySettings()
    }

    func recheckAccessibility() { refreshTap() }

    /// Answer to the proactive ask. Set up leaves the device "asked" until a binding is saved.
    func answerAsk(setUp: Bool) {
        guard !setUp else { return }
        update(devices: { devs in
            devs.devices.reduce(devs) { acc, d in d.setupState == .asked ? DeviceRegistry.setting(.declined, id: d.id, into: acc) : acc }
        })
    }

    // MARK: Private

    private func change(_ edit: (BindingsFile) -> BindingsFile) {
        do { bindings = try store.updateBindings(edit) } catch { OrionLog.write("[mouse] could not save bindings: \(error.localizedDescription)") }
        pushBindings()
    }

    private func update(devices edit: (DevicesFile) -> DevicesFile) {
        do { devices = try store.updateDevices(edit) } catch { OrionLog.write("[mouse] could not save devices: \(error.localizedDescription)") }
    }

    private func markConfigured() {
        update(devices: { file in
            file.devices.reduce(file) { acc, d in d.connected && d.setupState != .configured ? DeviceRegistry.setting(.configured, id: d.id, into: acc) : acc }
        })
    }

    private func loadBindingsFromDisk() {
        bindingsStamp = modified(store.bindingsURL)
        bindings = store.loadBindings()
        pushBindings()
    }

    private func modified(_ url: URL) -> Date? {
        (try? FileManager.default.attributesOfItem(atPath: url.path))?[.modificationDate] as? Date
    }

    private func pushBindings() {
        registerToggleKey()
        let copy = bindings
        remapper.update { var s = $0; s.bindings = copy; return s }
        remapper.updateWheel { var w = $0; w.mode = copy.reverseWheel; return w }
    }

    private func tick() {
        checkSetupRequests()
        ticks += 1
        if ticks % Self.naturalRefreshTicks == 1 { refreshNaturalScrolling() }
        let stamp = modified(store.bindingsURL)
        if stamp != bindingsStamp { loadBindingsFromDisk() }
        let trusted = Permissions.accessibilityTrusted
        if !trusted, remapper.isRunning { remapper.stop() }
        if trusted != accessibilityGranted || (trusted && !remapper.isRunning) { refreshTap() }
        // Games go fullscreen, and Java windows get their title, after activation: re-check about once a second.
        activated(NSWorkspace.shared.frontmostApplication)
        if ticks % 3 == 0 { scanForGameProcesses() }
        checkGameAlive()
        let new = prepConfig.autoPrep(); if new != autoPrep { autoPrep = new }
        let disk = store.loadDevices()
        if disk != devices { devices = disk }
    }

    /// The system's natural-scrolling switch, read from the global default (never written) every ~15 s, not per event.
    private static let naturalRefreshTicks = 15

    private func refreshNaturalScrolling() {
        let key = "com.apple.swipescrolldirection" as CFString
        CFPreferencesAppSynchronize(kCFPreferencesAnyApplication)
        let value = CFPreferencesCopyAppValue(key, kCFPreferencesAnyApplication)
        let natural = ScrollWheelPolicy.naturalScrolling(fromDefault: value)
        guard natural != naturalScrolling || ticks == 0 else { return }
        naturalScrolling = natural
        remapper.updateWheel { var w = $0; w.natural = natural; return w }
    }

    private func refreshTap() {
        accessibilityGranted = Permissions.accessibilityTrusted
        tapRunning = accessibilityGranted && remapper.start()
    }

    private func activated(_ app: NSRunningApplication?) {
        guard let app else { return }
        let facts = Self.facts(for: app)
        let game = GameClassifier.isGame(facts)
        let id = app.bundleIdentifier
        if game { feedGame(.frontmost(Self.gameRef(for: app, facts: facts), isGame: true, now: Self.now())) }
        if let id, frontmost?.bundleId != id { frontmost = (id, app.localizedName ?? id) }
        guard id != lastBundle || game != lastGame else { return }
        lastBundle = id; lastGame = game
        setGate(gate.focusChanged(frontIsGame: game, autoPause: bindings.autoPauseInGames))
        remapper.update { var s = $0; s.bundleId = id; s.isGame = game; return s }
    }

    // MARK: Game session

    private static func now() -> String { ISO8601DateFormatter().string(from: Date()) }

    private static func gameRef(for app: NSRunningApplication, facts: GameClassifier.Facts) -> GameRef {
        let raw = app.localizedName ?? app.bundleIdentifier ?? "game"
        let name = facts.isJavaProcess ? "Minecraft" : raw
        let bundle = app.bundleIdentifier.flatMap { $0.isEmpty ? nil : $0 }
        return GameRef(name: name, bundleId: bundle, key: bundle ?? raw, pid: app.processIdentifier)
    }

    /// The session ends when its processes are gone, not when the game loses focus.
    private func checkGameAlive() {
        guard gameSession.active else { return }
        let alive = Set(gameSession.pids.filter { kill($0, 0) == 0 || errno == EPERM })
        feedGame(.alive(alive, now: Self.now()))
    }

    private func feedGame(_ event: GameSessionEvent) {
        let (next, effect) = GameSessionMachine.reduce(gameSession, event)
        guard next != gameSession else { return }
        gameSession = next
        do { try sessionStore.save(next) } catch { OrionLog.write("[game] could not save the session: \(error.localizedDescription)") }
        remapper.updateWheel { var w = $0; w.gameSession = next.active; return w }
        switch effect {
        case .started(let game): gameStarted(game)
        case .ended: gameEnded()
        case nil: break
        }
    }

    /// A relaunched app picks the session up from the file instead of starting idle, so a game that is still running stays paused.
    private func restoreGameSession() {
        guard let saved = sessionStore.load(), saved.active else { return }
        gameSession = saved
        remapper.updateWheel { var w = $0; w.gameSession = true; return w }
        OrionLog.write("[game] session restored: \(saved.game?.name ?? "game")")
    }

    /// The real game is a separate process (Java under CurseForge, Prism, Modrinth) that may never become "frontmost" in a way
    /// the classifier can read, so every few seconds the running Java games are added to the session by their pids.
    private func scanForGameProcesses() {
        for pid in GameProcessScan.javaGamePids() where !gameSession.pids.contains(pid) || !gameSession.active {
            let ref = GameRef(name: "Minecraft", bundleId: nil, key: "java", pid: pid)
            feedGame(.frontmost(ref, isGame: true, now: Self.now()))
        }
    }

    private func gameStarted(_ game: GameRef) {
        OrionLog.write("[game] session started: \(game.name)")
        guard autoPrep else { onGameStarted?(GameWords.started(headline: nil)); return }
        GamePrepRunner.run(game: game) { [weak self] headline in self?.onGameStarted?(GameWords.started(headline: headline)) }
    }

    private func gameEnded() {
        OrionLog.write("[game] session ended")
        reopenApps = sessionStore.prep()?.closed ?? []
        if let question = GameWords.gameOver(reopenApps) { onGameOver?(question) }
    }

    private static func facts(for app: NSRunningApplication) -> GameClassifier.Facts {
        var category: String?
        if let url = app.bundleURL, let info = Bundle(url: url)?.infoDictionary {
            category = info["LSApplicationCategoryType"] as? String
        }
        let name = app.localizedName
        let java = app.executableURL?.lastPathComponent == "java" || name == "java"
        return GameClassifier.Facts(bundleId: app.bundleIdentifier, name: name, category: category, isJavaProcess: java,
                                    windowTitle: java ? windowTitle(pid: app.processIdentifier) : nil,
                                    isFullscreen: isFullscreen(pid: app.processIdentifier),
                                    executablePath: app.executableURL?.path)
    }

    private static func windowInfo(pid: pid_t) -> [[String: Any]] {
        let all = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
        return all.filter { ($0[kCGWindowOwnerPID as String] as? Int32) == pid && ($0[kCGWindowLayer as String] as? Int) == 0 }
    }

    private static func windowTitle(pid: pid_t) -> String? {
        windowInfo(pid: pid).compactMap { $0[kCGWindowName as String] as? String }.first { !$0.isEmpty }
    }

    private static func isFullscreen(pid: pid_t) -> Bool {
        let screens = NSScreen.screens.map(\.frame)
        return windowInfo(pid: pid).contains { w in
            guard let b = w[kCGWindowBounds as String] as? [String: CGFloat], let width = b["Width"], let height = b["Height"] else { return false }
            return screens.contains { abs($0.width - width) < 2 && abs($0.height - height) < 2 }
        }
    }

    private func observed(_ button: Int) {
        lastPressed = button
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.6) { [weak self] in
            if self?.lastPressed == button { self?.lastPressed = nil }
        }
        update(devices: { DeviceRegistry.observed(button: button, into: $0) })
    }

    private func attached(_ mouse: AttachedMouse) {
        let now = ISO8601DateFormatter().string(from: Date())
        update(devices: { DeviceRegistry.attached(mouse, into: $0, now: now) })
        guard let device = devices.devices.first(where: { $0.id == mouse.id }), device.setupState == .new else { return }
        // "asked" is written before anything is shown, so a crash or relaunch can never ask twice.
        update(devices: { DeviceRegistry.setting(.asked, id: device.id, into: $0) })
        let text = DeviceRegistry.askText(for: device)
        let id = Self.recordOutreach(text: text)
        onAsk?(text, id)
    }

    private func detached(_ id: String) {
        let now = ISO8601DateFormatter().string(from: Date())
        update(devices: { DeviceRegistry.detached(id: id, into: $0, now: now) })
    }

    /// An outreach.jsonl row, so if he answers in chat ORION knows what the question was.
    private static func recordOutreach(text: String) -> String {
        let ms = Int(Date().timeIntervalSince1970 * 1000)
        let id = "reach-\(ms)-mouse"
        let row: [String: Any] = ["id": id, "at": ISO8601DateFormatter().string(from: Date()), "text": text, "kind": "mouse",
                                  "why": "mouse: new device with extra buttons", "channel": "mac-bubble",
                                  "reason": "a new mouse was plugged in", "urgent": false, "headphones": false]
        guard let data = try? JSONSerialization.data(withJSONObject: row, options: [.sortedKeys]),
              let line = String(data: data, encoding: .utf8) else { return id }
        let url = MouseStore.defaultControlledDir().appendingPathComponent("outreach.jsonl")
        do {
            if !FileManager.default.fileExists(atPath: url.path) { try Data().write(to: url) }
            let handle = try FileHandle(forWritingTo: url)
            defer { try? handle.close() }
            try handle.seekToEnd()
            try handle.write(contentsOf: Data((line + "\n").utf8))
        } catch { OrionLog.write("[mouse] could not record the outreach: \(error.localizedDescription)") }
        return id
    }
}
