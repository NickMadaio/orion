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
        if !["Instagram", "TikTok", "Reddit", "X", "Twitter", "Facebook", "YouTube"].contains(name), name != "Orion" { lastWorkApp = name }
        let home = FileManager.default.homeDirectoryForCurrentUser
        let file = home.appendingPathComponent(".openclaw/orion-controlled/focus-activity.json")
        let object: [String: Any] = ["at": ISO8601DateFormatter().string(from: Date()), "app": name, "title": title, "idleSeconds": CGEventSource.secondsSinceLastEventType(.combinedSessionState, eventType: .null), "enforcementAllowed": enforcement, "workApp": lastWorkApp ?? ""]
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
