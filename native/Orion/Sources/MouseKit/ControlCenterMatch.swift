import Foundation

/// How the Control Center accessibility tree names things on macOS 26 (dumped live; ids carry a per-install UUID suffix).
public enum ControlCenterMatch {
    public static func isMenuExtra(id: String) -> Bool { id == "com.apple.menuextra.controlcenter" }

    /// The Stage Manager tile: a checkbox whose id contains "windowmanager.stagemanager" or whose description starts with it.
    public static func isStageManagerTile(role: String, id: String, description: String) -> Bool {
        if id.contains("windowmanager.stagemanager") { return true }
        return role == "AXCheckBox" && description.hasPrefix("Stage Manager")
    }

    /// The first-run sheet's confirm button ("Turn On Stage Manager"), shown once by the StageManagerOnboarding process.
    public static func isTurnOnButton(role: String, title: String, description: String) -> Bool {
        role == "AXButton" && (title + description).contains("Turn On")
    }

    public static let onboardingProcess = "StageManagerOnboarding"
}
