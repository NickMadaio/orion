import PaletteKit
import SwiftUI

/// One hue per kind of row, from the Home palette.
extension PaletteSection {
    var hue: Color {
        switch self {
        case .today: return OrionTheme.orange
        case .actions: return OrionTheme.accent
        case .goTo: return OrionTheme.violet
        case .apps: return OrionTheme.blue
        case .running: return OrionTheme.green
        case .ask: return OrionTheme.lavender
        }
    }
}

extension PaletteItem {
    var hue: Color { urgent ? OrionTheme.red : section.hue }

    /// The .app behind an app row, for its icon.
    var appPath: String? {
        switch action {
        case .openApp(let path): return path
        case .switchApp(_, _, let path): return path
        default: return nil
        }
    }
}

/// The tiny blue Orion orb in the strip and beside ORION's answer.
struct PaletteOrb: View {
    var size: CGFloat = 12

    var body: some View {
        Circle()
            .fill(RadialGradient(colors: [Color.white.opacity(0.95), OrionTheme.accent, Color(red: 0.12, green: 0.35, blue: 0.95)],
                                 center: UnitPoint(x: 0.35, y: 0.3), startRadius: 0, endRadius: size * 0.75))
            .frame(width: size, height: size)
            .overlay(Circle().strokeBorder(OrionTheme.accent.opacity(0.55), lineWidth: 0.6))
            .shadow(color: OrionTheme.accent.opacity(0.7), radius: size * 0.4)
    }
}
