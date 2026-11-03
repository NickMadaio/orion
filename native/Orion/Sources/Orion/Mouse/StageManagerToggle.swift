import AppKit
@preconcurrency import ApplicationServices
import Foundation
import MouseKit

/*
 Toggles Stage Manager by pressing its tile in Control Center through Accessibility (Orion already holds that grant).

 Why not `defaults write com.apple.WindowManager GloballyEnabled`: on macOS 26 the key changes but WindowManager does
 not act on it (verified live on Nick's Mac, with and without `killall WindowManager`). The Control Center tile is the
 real switch. The accessibility tree was dumped live: the menu extra is id `com.apple.menuextra.controlcenter`; once
 open, the tile is an AXCheckBox with id `...windowmanager.stagemanager:<uuid>` and description "Stage Manager" (value
 0/1). The first time ever, macOS shows a "StageManagerOnboarding" sheet; its "Turn On Stage Manager" button is pressed
 too. Verified by toggling on and off and watching the WindowManager strip windows appear and disappear.
 Falls back to the defaults write only if Control Center cannot be driven.
 Blocking (short sleeps): always call off the main thread.
 */
enum StageManagerToggle {
    static func run() {
        if !viaControlCenter() { viaDefaults() }
    }

    // MARK: Control Center

    private static func attr(_ e: AXUIElement, _ key: String) -> CFTypeRef? {
        var value: CFTypeRef?
        return AXUIElementCopyAttributeValue(e, key as CFString, &value) == .success ? value : nil
    }
    private static func text(_ e: AXUIElement, _ key: String) -> String { (attr(e, key) as? String) ?? "" }

    private static func find(_ root: AXUIElement, maxDepth: Int = 8, _ match: (AXUIElement) -> Bool) -> AXUIElement? {
        if match(root) { return root }
        guard maxDepth > 0, let kids = attr(root, "AXChildren") as? [AXUIElement] else { return nil }
        for kid in kids { if let hit = find(kid, maxDepth: maxDepth - 1, match) { return hit } }
        return nil
    }

    private static func wait(_ tries: Int, _ probe: () -> AXUIElement?) -> AXUIElement? {
        for _ in 0..<tries {
            if let hit = probe() { return hit }
            Thread.sleep(forTimeInterval: 0.1)
        }
        return nil
    }

    private static func isTile(_ e: AXUIElement) -> Bool {
        ControlCenterMatch.isStageManagerTile(role: text(e, "AXRole"), id: text(e, "AXIdentifier"), description: text(e, "AXDescription"))
    }

    @discardableResult
    private static func viaControlCenter() -> Bool {
        guard AXIsProcessTrusted(),
              let cc = NSRunningApplication.runningApplications(withBundleIdentifier: "com.apple.controlcenter").first else { return false }
        let app = AXUIElementCreateApplication(cc.processIdentifier)
        guard let extra = find(app, { ControlCenterMatch.isMenuExtra(id: text($0, "AXIdentifier")) }) else { return false }
        var openedByUs = false
        var tile = find(app, isTile)
        if tile == nil {
            AXUIElementPerformAction(extra, kAXPressAction as CFString)
            openedByUs = true
            tile = wait(25) { find(app, isTile) }
        }
        guard let tile else {
            if openedByUs { AXUIElementPerformAction(extra, kAXPressAction as CFString) }
            return false
        }
        let pressed = AXUIElementPerformAction(tile, kAXPressAction as CFString) == .success
        confirmFirstRunSheet()
        Thread.sleep(forTimeInterval: 0.3)
        // Close the panel: its menu extra toggles it. Pressing it when it is already closed would reopen it, so only when a tile is still visible.
        if find(app, isTile) != nil { AXUIElementPerformAction(extra, kAXPressAction as CFString) }
        return pressed
    }

    /// The one-time onboarding sheet: wait briefly for it and press "Turn On Stage Manager".
    private static func confirmFirstRunSheet() {
        for _ in 0..<8 {
            Thread.sleep(forTimeInterval: 0.2)
            guard let sheet = NSWorkspace.shared.runningApplications.first(where: { $0.localizedName == ControlCenterMatch.onboardingProcess }) else { continue }
            let root = AXUIElementCreateApplication(sheet.processIdentifier)
            if let button = find(root, maxDepth: 10, { ControlCenterMatch.isTurnOnButton(role: text($0, "AXRole"), title: text($0, "AXTitle"), description: text($0, "AXDescription")) }) {
                AXUIElementPerformAction(button, kAXPressAction as CFString)
                return
            }
        }
    }

    // MARK: Fallback

    private static func viaDefaults() {
        let read = defaults(["read", "com.apple.WindowManager", "GloballyEnabled"]).trimmingCharacters(in: .whitespacesAndNewlines)
        _ = defaults(["write", "com.apple.WindowManager", "GloballyEnabled", "-bool", read == "1" ? "false" : "true"])
    }

    private static func defaults(_ args: [String]) -> String {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/defaults")
        process.arguments = args
        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = Pipe()
        do { try process.run() } catch { return "" }
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        return String(data: data, encoding: .utf8) ?? ""
    }
}
