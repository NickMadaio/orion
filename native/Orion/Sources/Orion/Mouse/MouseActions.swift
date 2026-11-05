import AppKit
import CoreGraphics
import Foundation
import MouseKit

/*
 Runs a MouseAction. Main-thread entry; nothing here blocks it for long.

 System actions, and why each is done the way it is:
  · missionControl / appExpose / launchpad open their own system app through NSWorkspace. That works whether or not
    the user remapped the keyboard shortcut for them, which a synthetic Control-Up would not.
  · desktopLeft / desktopRight / showDesktop / notificationCenter post the default system shortcuts (Ctrl-Left,
    Ctrl-Right, F11, Fn-N). If he has disabled or changed those in Keyboard Shortcuts, the shortcut action is the escape hatch.
  · stageManager presses the Stage Manager tile in Control Center through Accessibility (see StageManagerToggle).
    The old `defaults write com.apple.WindowManager GloballyEnabled` does nothing on macOS 26.
 */
enum MouseActions {
    static func run(_ action: MouseAction, orion: (String) -> Void) {
        switch action {
        case .passthrough: break
        case .orion(let command): orion(command)
        case .openApp(let bundleId): openApp(bundleId)
        case .shortcut(let keys):
            guard let parsed = ShortcutParser.parse(keys) else { OrionLog.write("[mouse] bad shortcut '\(keys)'"); return }
            post(parsed)
        case .system(let name): system(name)
        }
    }

    private static func system(_ name: String) {
        switch name {
        case "missionControl": launch(path: "/System/Applications/Mission Control.app")
        case "launchpad": launchLaunchpad()
        case "appExpose": post(ParsedShortcut(keyCode: 125, flags: ShortcutParser.ctrl))
        case "desktopLeft": post(ParsedShortcut(keyCode: 123, flags: ShortcutParser.ctrl))
        case "desktopRight": post(ParsedShortcut(keyCode: 124, flags: ShortcutParser.ctrl))
        case "showDesktop": post(ParsedShortcut(keyCode: 103, flags: 0))
        case "notificationCenter": post(ParsedShortcut(keyCode: 45, flags: ShortcutParser.fn))
        case "stageManager": toggleStageManager()
        default: OrionLog.write("[mouse] unknown system action '\(name)'")
        }
    }

    private static func launch(path: String) {
        let url = URL(fileURLWithPath: path)
        guard FileManager.default.fileExists(atPath: path) else { OrionLog.write("[mouse] missing \(path)"); return }
        NSWorkspace.shared.openApplication(at: url, configuration: NSWorkspace.OpenConfiguration())
    }

    /// Launchpad became "Apps" on macOS 26; try whichever is installed.
    private static func launchLaunchpad() {
        for path in ["/System/Applications/Apps.app", "/System/Applications/Launchpad.app"]
        where FileManager.default.fileExists(atPath: path) { launch(path: path); return }
    }

    private static func openApp(_ bundleId: String) {
        guard let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundleId) else {
            OrionLog.write("[mouse] no app for \(bundleId)"); return
        }
        NSWorkspace.shared.openApplication(at: url, configuration: NSWorkspace.OpenConfiguration())
    }

    static func post(_ shortcut: ParsedShortcut) {
        guard let source = CGEventSource(stateID: .hidSystemState),
              let down = CGEvent(keyboardEventSource: source, virtualKey: shortcut.keyCode, keyDown: true),
              let up = CGEvent(keyboardEventSource: source, virtualKey: shortcut.keyCode, keyDown: false) else { return }
        // A real arrow key carries the numeric-pad and secondary-fn bits; without them the Dock ignores a synthetic
        // Ctrl-Left/Right (Spaces) or Ctrl-Down (App Exposé) and nothing happens (2026-11-05: Desktop ←/→ did nothing).
        let arrowBits: UInt64 = (123...126).contains(Int(shortcut.keyCode)) ? (CGEventFlags.maskNumericPad.rawValue | CGEventFlags.maskSecondaryFn.rawValue) : 0
        let flags = CGEventFlags(rawValue: shortcut.flags | arrowBits)
        down.flags = flags; up.flags = flags
        down.post(tap: .cghidEventTap)
        up.post(tap: .cghidEventTap)
    }

    private static func toggleStageManager() {
        DispatchQueue.global(qos: .userInitiated).async { StageManagerToggle.run() }
    }
}
