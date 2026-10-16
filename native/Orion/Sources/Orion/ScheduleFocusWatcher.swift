import AppKit
import ApplicationServices
import Foundation
final class ScheduleFocusWatcher {
    private var timer: Timer?
    private var running = false
    private var lastWorkApp: String?
    func start(enforcement: @escaping () -> Bool) {
        guard timer == nil else { return }
        timer = Timer.scheduledTimer(withTimeInterval: 30, repeats: true) { [weak self] _ in self?.tick(enforcement: enforcement()) }
    }
    private func tick(enforcement: Bool) {
        guard !running, let app = NSWorkspace.shared.frontmostApplication else { return }
        let name = app.localizedName ?? "Unknown"
        var value: CFTypeRef?
        let element = AXUIElementCreateApplication(app.processIdentifier)
        var title = ""
        if AXUIElementCopyAttributeValue(element, kAXFocusedWindowAttribute as CFString, &value) == .success, let value {
            let window = unsafeBitCast(value, to: AXUIElement.self)
            var text: CFTypeRef?
            if AXUIElementCopyAttributeValue(window, kAXTitleAttribute as CFString, &text) == .success { title = text as? String ?? "" }
        }
        let bundleID = app.bundleIdentifier
        let neverTarget = EnforcementGuard.isNeverATarget(name: name, bundleID: bundleID)
        // 2026-10-16: loginwindow and the lock screen are not work apps and not targets.
        if !neverTarget, !["Instagram", "TikTok", "Reddit", "X", "Twitter", "Facebook", "YouTube"].contains(name), name != "Orion" { lastWorkApp = name }
        let home = FileManager.default.homeDirectoryForCurrentUser
        let file = home.appendingPathComponent(".openclaw/orion-controlled/focus-activity.json")
        // 2026-10-16: nil means the system gave nonsense (it said 11.8 days for 40 s); report 0 and switch enforcement off for this tick.
        let idle = IdleReading.current()
        let object: [String: Any] = ["at": ISO8601DateFormatter().string(from: Date()), "app": name, "title": title, "idleSeconds": idle ?? 0, "idleValid": idle != nil, "enforcementAllowed": EnforcementGuard.allowed(consent: enforcement, idleValid: idle != nil, name: name, bundleID: bundleID), "workApp": lastWorkApp ?? ""]
        guard let data = try? JSONSerialization.data(withJSONObject: object), (try? data.write(to: file, options: .atomic)) != nil else { return }
        running = true
        DispatchQueue.global(qos: .utility).async { [weak self] in
            let process = Process(); process.executableURL = home.appendingPathComponent(".openclaw/tools/node-v24.15.0/bin/node")
            process.arguments = [home.appendingPathComponent(".openclaw/orion-remote/scripts/orion-ontask-watch").path]
            process.standardOutput = FileHandle.nullDevice; process.standardError = FileHandle.nullDevice
            if (try? process.run()) != nil { process.waitUntilExit() }
            DispatchQueue.main.async { self?.running = false }
        }
    }
}
