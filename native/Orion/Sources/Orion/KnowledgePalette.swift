import SwiftUI

/// Colour for the Knowledge tab. The app's tokens (`OrionTheme`) are white-on-transparent because the window is
/// dark glass over the desktop; this palette keeps those exact values in dark mode and inverts the ink for light,
/// so the same view reads on either. Type colours are the app's own (accent, green, blue, violet, orange, red)
/// plus four that sit between them, each pulled darker in light mode to keep its contrast.
struct KnowledgePalette {
    let scheme: ColorScheme

    var isDark: Bool { scheme == .dark }
    private var ink: Color { isDark ? .white : Color(red: 0.05, green: 0.07, blue: 0.11) }

    var text: Color { isDark ? OrionTheme.text : ink.opacity(0.9) }
    var textSoft: Color { isDark ? OrionTheme.textSoft : ink.opacity(0.62) }
    var textDim: Color { isDark ? OrionTheme.textDim : ink.opacity(0.42) }
    var hairline: Color { ink }
    /// Edges at rest: present, not loud.
    var edge: Color { ink.opacity(isDark ? 0.13 : 0.16) }

    func color(_ type: KnowledgeNodeType) -> Color {
        let (r, g, b) = Self.rgb(type)
        let k = isDark ? 1.0 : 0.68
        return Color(.sRGB, red: r * k, green: g * k, blue: b * k, opacity: 1)
    }

    private static func rgb(_ type: KnowledgeNodeType) -> (Double, Double, Double) {
        switch type {
        case .person: (0.18, 0.83, 1.00)      // OrionTheme.accent
        case .place: (0.36, 0.92, 0.60)       // green
        case .course: (0.36, 0.72, 1.00)      // blue
        case .project: (0.70, 0.52, 1.00)     // violet
        case .routine: (1.00, 0.80, 0.38)     // amber, between orange and goal
        case .habit: (1.00, 0.58, 0.20)       // orange
        case .app: (1.00, 0.52, 0.80)         // rose
        case .health: (1.00, 0.38, 0.38)      // red
        case .preference: (0.82, 0.84, 0.94)  // pale steel: rules, not things
        case .goal: (0.84, 0.95, 0.42)        // lime
        }
    }
}

private struct KnowledgePaletteKey: EnvironmentKey {
    static let defaultValue = KnowledgePalette(scheme: .dark)
}

extension EnvironmentValues {
    var knowledgePalette: KnowledgePalette {
        get { self[KnowledgePaletteKey.self] }
        set { self[KnowledgePaletteKey.self] = newValue }
    }
}

/// A hairline that fades at both ends, in the palette's ink (the app's `FadingHairline` is white-only).
struct KnowledgeHairline: View {
    var vertical = false
    var peak = 0.14
    @Environment(\.knowledgePalette) private var palette

    var body: some View {
        Rectangle()
            .fill(LinearGradient(colors: [.clear, palette.hairline.opacity(peak), .clear],
                                 startPoint: vertical ? .top : .leading, endPoint: vertical ? .bottom : .trailing))
            .frame(width: vertical ? 0.5 : nil, height: vertical ? nil : 0.5)
    }
}

/// The section marker, palette-aware: a tracked label with a rule running off to the right.
struct KnowledgeSectionLabel: View {
    let title: String
    var trailing: String?
    @Environment(\.knowledgePalette) private var palette

    var body: some View {
        HStack(spacing: 10) {
            Text(title.uppercased()).font(OrionTheme.mono(9, .semibold)).tracking(2.2).foregroundStyle(palette.textDim).fixedSize()
            LinearGradient(colors: [palette.hairline.opacity(0.16), palette.hairline.opacity(0)], startPoint: .leading, endPoint: .trailing)
                .frame(height: 0.5)
            if let trailing {
                Text(trailing.uppercased()).font(OrionTheme.mono(9)).tracking(1.4).foregroundStyle(palette.textDim).fixedSize()
            }
        }
    }
}
