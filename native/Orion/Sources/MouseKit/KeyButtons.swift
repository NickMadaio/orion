import Foundation

/// Mouse buttons that the mouse itself turns into a keyboard key (Razer Synapse's onboard memory can set the sensitivity
/// button to F13). The Mac sees a key press, not a mouse button, so each key becomes a virtual button id: 100 + the F number
/// (F13 is 113 ... F20 is 120). The ids sit beside the real CGEvent button numbers (3...31) in bindings.json.
public enum KeyButtons {
    public static let defaultId = 113
    public static let ids = Array(113...120)

    /// Virtual key codes of F13...F20, in F-number order.
    private static let keyCodes: [Int64] = [105, 107, 113, 106, 64, 79, 80, 90]

    public static func isKeyButton(_ id: Int) -> Bool { ids.contains(id) }

    public static func id(forKeyCode code: Int64) -> Int? {
        keyCodes.firstIndex(of: code).map { 113 + $0 }
    }

    public static func fNumber(_ id: Int) -> Int { id - 100 }

    /// The tap's decision for a key event: the virtual button, or nil to leave it alone. A key is a mouse button only when a
    /// connected mouse advertises it (no mouse, no hijack of a real keyboard's F13) and no modifier is held (a chord is the keyboard's).
    public static func press(keyCode: Int64, hasModifiers: Bool, active: Set<Int>) -> Int? {
        guard !hasModifiers, let id = id(forKeyCode: keyCode), active.contains(id) else { return nil }
        return id
    }
}
