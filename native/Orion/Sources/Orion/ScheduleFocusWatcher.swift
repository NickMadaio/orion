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
        // 2026-10-16: nil means the system gave nonsense (it said 11.8 days for 40 s): write null (unknown is
        // unknown, not 0) and switch enforcement off for this tick.
        let idle = IdleReading.current()
        let screen = ScreenState.current()
        let route = AudioRoute.outputRoute()
        let object = FocusActivityRecord.object(
            at: Date(), app: name, title: title, bundleID: bundleID, idle: idle, locked: screen.locked,
            displayAsleep: screen.displayAsleep,
            enforcementAllowed: EnforcementGuard.allowed(consent: enforcement, idleValid: idle != nil, name: name, bundleID: bundleID),
            workApp: lastWorkApp ?? "", route: route)
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

/// Screen lock and display sleep, for the awareness `mac` facet.
enum ScreenState {
    static func current() -> (locked: Bool, displayAsleep: Bool) {
        var locked = false
        if let info = CGSessionCopyCurrentDictionary() as? [String: Any] {
            locked = (info["CGSSessionScreenIsLocked"] as? Int) == 1 || (info["kCGSSessionOnConsoleKey"] as? Bool) == false
        }
        return (locked, CGDisplayIsAsleep(CGMainDisplayID()) != 0)
    }
}

/// The shape of `focus-activity.json` (read by orion-ontask-watch and orion-awareness).
enum FocusActivityRecord {
    static func object(at: Date, app: String, title: String, bundleID: String?, idle: TimeInterval?, locked: Bool,
                       displayAsleep: Bool, enforcementAllowed: Bool, workApp: String,
                       route: AudioRoute.OutputRoute?) -> [String: Any] {
        var object: [String: Any] = [
            "at": ISO8601DateFormatter().string(from: at), "app": app, "title": title,
            "bundleID": bundleID ?? "",
            "idleSeconds": idle.map { $0 as Any } ?? NSNull(), "idleValid": idle != nil,
            "locked": locked, "displayAsleep": displayAsleep,
            "enforcementAllowed": enforcementAllowed, "workApp": workApp,
        ]
        if let route {
            object["audio"] = ["route": route.kind.rawValue, "device": route.device, "headphones": route.headphones] as [String: Any]
        } else {
            object["audio"] = ["route": "unknown", "device": "", "headphones": NSNull()] as [String: Any]
        }
        return object
    }
}
