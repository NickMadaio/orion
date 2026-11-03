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

    /// Delivers ORION's question as the proactive bubble; the id is the outreach record's id.
    var onAsk: ((String, String) -> Void)?
    var onOrionCommand: ((String) -> Void)?

    private let store: MouseStore
    private let watcher = MouseDeviceWatcher()
    private let remapper = MouseRemapper()
    private var activationToken: NSObjectProtocol?
    private var poll: Timer?
    private var bindingsStamp: Date?
    private var lastBundle: String?
    private var lastGame = false

    init(store: MouseStore = MouseStore(controlledDir: MouseStore.defaultControlledDir())) {
        self.store = store
    }

    func start() {
        devices = store.loadDevices()
        loadBindingsFromDisk()
        remapper.onAction = { [weak self] action, _ in
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
        if let activationToken { NSWorkspace.shared.notificationCenter.removeObserver(activationToken) }
        watcher.stop(); remapper.stop()
    }

    // MARK: Settings actions (each re-reads the file first, so the chat side's edit is kept)

    func setDefault(_ button: Int, _ action: MouseAction?) { change { $0.settingDefault(button, action) }; markConfigured() }
    func setApp(_ bundleId: String, button: Int, _ action: MouseAction?) { change { $0.settingApp(bundleId, button: button, action) }; markConfigured() }
    func togglePassthrough(_ bundleId: String) { change { $0.togglingPassthrough(bundleId) } }
    func setAutoGames(_ on: Bool) { change { var b = $0; b.autoPassthroughGames = on; return b } }
    func setEnabled(_ on: Bool) { change { var b = $0; b.enabled = on; return b } }
    func clearLastPressed() { lastPressed = nil }

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
        let copy = bindings
        remapper.update { var s = $0; s.bindings = copy; return s }
    }

    private func tick() {
        let stamp = modified(store.bindingsURL)
        if stamp != bindingsStamp { loadBindingsFromDisk() }
        let trusted = Permissions.accessibilityTrusted
        if !trusted, remapper.isRunning { remapper.stop() }
        if trusted != accessibilityGranted || (trusted && !remapper.isRunning) { refreshTap() }
        // Games go fullscreen, and Java windows get their title, after activation: re-check about once a second.
        activated(NSWorkspace.shared.frontmostApplication)
        let disk = store.loadDevices()
        if disk != devices { devices = disk }
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
        if let id, frontmost?.bundleId != id { frontmost = (id, app.localizedName ?? id) }
        guard id != lastBundle || game != lastGame else { return }
        lastBundle = id; lastGame = game
        remapper.update { var s = $0; s.bundleId = id; s.isGame = game; return s }
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
                                    isFullscreen: isFullscreen(pid: app.processIdentifier))
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
