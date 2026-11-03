import Foundation

/// Human wording for actions, shared by the settings picker and the tests.
public enum MouseActionLabel {
    static let systemTitles: [String: String] = [
        "missionControl": "Mission Control", "appExpose": "App Exposé", "stageManager": "Stage Manager",
        "showDesktop": "Show Desktop", "launchpad": "Launchpad", "desktopLeft": "Desktop to the left",
        "desktopRight": "Desktop to the right", "notificationCenter": "Notification Center"
    ]
    static let orionTitles: [String: String] = ["summon": "Summon ORION", "talk": "Talk to ORION", "dashboard": "Open ORION dashboard"]

    public static func label(_ action: MouseAction?) -> String {
        switch action {
        case nil, .some(.passthrough): return "Does nothing special"
        case .some(.system(let n)): return systemTitles[n] ?? n
        case .some(.shortcut(let k)): return "Shortcut \(k)"
        case .some(.openApp(let b)): return "Open \(b.split(separator: ".").last.map(String.init) ?? b)"
        case .some(.orion(let c)): return orionTitles[c] ?? c
        }
    }

    /// The fixed choices, in picker order (shortcut and open-app are filled in by the user).
    public static var presets: [MouseAction] {
        MouseAction.systemNames.map { .system($0) } + MouseAction.orionCommands.map { .orion($0) }
    }
}
