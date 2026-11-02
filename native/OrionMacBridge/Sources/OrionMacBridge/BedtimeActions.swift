import AppKit
import Foundation

/// The Mac half of the bedtime nudge (2026-11-02): quit a distraction, dim the screen, lock it.
/// Self-imposed and gentle: apps are asked to quit (never forced, so an app with unsaved work shows its
/// own save sheet and stays open), and nothing here needs Accessibility or an extra entitlement.
enum BedtimeActions {
    /// Never quit by this route: the shell, the terminal he works in, ORION itself, and the system's own surfaces.
    static let neverQuit: Set<String> = [
        "com.apple.finder", "com.apple.dock", "com.apple.loginwindow", "com.apple.systemuiserver",
        "com.apple.controlcenter", "com.apple.notificationcenterui", "com.apple.spotlight",
        "com.apple.windowserver", "com.apple.systempreferences", "com.apple.activitymonitor",
        "com.apple.terminal", "com.googlecode.iterm2", "com.mitchellh.ghostty", "dev.warp.warp-stable",
    ]

    /// nil when quitting `bundleId` is allowed, otherwise the plain reason it is not.
    static func refusal(bundleId: String) -> String? {
        let id = bundleId.lowercased()
        guard id.range(of: #"^[a-z0-9][a-z0-9.\-_]{1,200}$"#, options: .regularExpression) != nil else {
            return "That is not a bundle id."
        }
        if neverQuit.contains(id) || id.contains("orion") || id.contains("openclaw") {
            return "I will not quit that one."
        }
        return nil
    }

    static func quitApp(bundleId: String, waitSeconds: TimeInterval = 3) throws -> [String: String] {
        if let reason = refusal(bundleId: bundleId) { throw BridgeError.invalidRequest(reason) }
        let running = NSRunningApplication.runningApplications(withBundleIdentifier: bundleId)
            .filter { $0.processIdentifier != ProcessInfo.processInfo.processIdentifier }
        guard !running.isEmpty else { return ["status": "not_running", "bundle_id": bundleId] }
        for app in running { _ = app.terminate() }   // graceful; never forceTerminate
        let deadline = Date().addingTimeInterval(waitSeconds)
        while Date() < deadline, running.contains(where: { !$0.isTerminated }) {
            Thread.sleep(forTimeInterval: 0.1)
        }
        let stillOpen = running.contains { !$0.isTerminated }
        return ["status": stillOpen ? "still_running" : "quit", "bundle_id": bundleId,
                "note": stillOpen ? "It asked to be quit but is still open, probably an unsaved document." : "Quit."]
    }

    static func lockScreen() throws -> [String: String] {
        typealias Lock = @convention(c) () -> Int32
        guard let handle = dlopen("/System/Library/PrivateFrameworks/login.framework/login", RTLD_NOW),
              let symbol = dlsym(handle, "SACLockScreenImmediate") else {
            throw BridgeError.unavailable("This Mac would not lock the screen from here.")
        }
        _ = unsafeBitCast(symbol, to: Lock.self)()
        return ["status": "locked"]
    }

    // MARK: dim

    static let dimLevel: Float = 0.12

    /// The new brightness for a dim: never brighter than it already is.
    static func dimTarget(current: Float) -> Float { min(current, dimLevel) }

    private typealias GetBrightness = @convention(c) (UInt32, UnsafeMutablePointer<Float>) -> Int32
    private typealias SetBrightness = @convention(c) (UInt32, Float) -> Int32

    private static func displayServices() throws -> (GetBrightness, SetBrightness) {
        guard let handle = dlopen("/System/Library/PrivateFrameworks/DisplayServices.framework/DisplayServices", RTLD_NOW),
              let get = dlsym(handle, "DisplayServicesGetBrightness"),
              let set = dlsym(handle, "DisplayServicesSetBrightness") else {
            throw BridgeError.unavailable("This display's brightness cannot be changed from here.")
        }
        return (unsafeBitCast(get, to: GetBrightness.self), unsafeBitCast(set, to: SetBrightness.self))
    }

    static func dim(stateFile: URL) throws -> [String: String] {
        let (get, set) = try displayServices()
        var current: Float = 0
        guard get(CGMainDisplayID(), &current) == 0 else { throw BridgeError.unavailable("Could not read the brightness.") }
        // A second dim keeps the ORIGINAL level to restore.
        let saved = savedLevel(stateFile) ?? current
        let target = dimTarget(current: current)
        try FileManager.default.createDirectory(at: stateFile.deletingLastPathComponent(), withIntermediateDirectories: true)
        try JSONSerialization.data(withJSONObject: ["brightness": Double(saved)]).write(to: stateFile, options: .atomic)
        guard set(CGMainDisplayID(), target) == 0 else { throw BridgeError.unavailable("Could not dim the display.") }
        return ["status": "dimmed", "brightness": String(format: "%.2f", target), "restores_to": String(format: "%.2f", saved)]
    }

    static func undim(stateFile: URL) throws -> [String: String] {
        let (_, set) = try displayServices()
        guard let saved = savedLevel(stateFile) else { return ["status": "not_dimmed"] }
        guard set(CGMainDisplayID(), saved) == 0 else { throw BridgeError.unavailable("Could not restore the brightness.") }
        try? FileManager.default.removeItem(at: stateFile)
        return ["status": "restored", "brightness": String(format: "%.2f", saved)]
    }

    static func savedLevel(_ stateFile: URL) -> Float? {
        guard let data = try? Data(contentsOf: stateFile),
              let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              let value = object["brightness"] as? Double, (0.0...1.0).contains(value) else { return nil }
        return Float(value)
    }

    static var stateFile: URL {
        let base = ProcessInfo.processInfo.environment["ORION_CONTROLLED_DIR"]
            ?? FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".openclaw/orion-controlled").path
        return URL(fileURLWithPath: base).appendingPathComponent("dim-state.json")
    }
}
