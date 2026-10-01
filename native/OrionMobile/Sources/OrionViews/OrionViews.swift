import SwiftUI

/// Shared colours for the screens in this module (they cannot see the Mac app's
/// `OrionTheme` or the phone's `Phone`): text on a dark backdrop, cyan accent.
public enum ViewTokens {
    public static let text = Color.white.opacity(0.94)
    public static let soft = Color.white.opacity(0.62)
    public static let dim = Color.white.opacity(0.38)
    public static let hairline = Color.white.opacity(0.08)
    public static let accent = Color(red: 0.18, green: 0.83, blue: 1.00)
    public static let violet = Color(red: 0.70, green: 0.52, blue: 1.00)
    public static let warning = Color(red: 1.00, green: 0.55, blue: 0.35)
}
