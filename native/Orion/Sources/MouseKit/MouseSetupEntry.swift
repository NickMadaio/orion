import Foundation

/// The ways into the mouse setup popup that need no chat: the menu-bar item and the Settings pill. Both run the same
/// path as orion://mouse-setup, which is also what `orion-mouse setup` opens.
public enum MouseSetupEntry {
    public static let menuTitle = "Open mouse setup"
    public static let pillTitle = "Set up buttons"
    public static let typeMenuTitle = "Type to ORION  ⌃⌥Space"
    public static let typeURL = URL(string: "orion://type")!
    public static let url = URL(string: "orion://mouse-setup")!
}
