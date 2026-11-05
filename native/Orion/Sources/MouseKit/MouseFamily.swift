import Foundation

/// One physical mouse can attach under several ids (a USB dongle and Bluetooth report different vendor and product ids and names).
/// A family groups those entries so they share buttons, bindings and the setup popup.
public enum MouseFamily {
    /// Families whose top button is set to F13 in onboard memory: always offered, whichever way the mouse is connected.
    private static let topButton: Set<String> = ["razer-basilisk-v3-x"]

    public static func key(name: String) -> String {
        let n = name.lowercased()
        if n.contains("basilisk v3 x") || n.contains("bsk v3 x") { return "razer-basilisk-v3-x" }
        return n.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    public static func hasTopButton(_ family: String) -> Bool { topButton.contains(family) }

    /// The fullest name among the entries ("Razer Basilisk V3 X HyperSpeed" over "BSK V3 X HS").
    public static func displayName(_ names: [String]) -> String? { names.max { $0.count < $1.count } }
}
