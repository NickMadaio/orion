import SwiftUI

/// 2026-10-16 UI audit #5/#7: grouping comes from spacing, type scale and
/// fading hairlines, never from filled cards. One rule that fades out at both
/// ends, and an outline button (stroke, no fill).
struct FadingHairline: View {
    var color: Color = .white
    var peak: Double = 0.14

    var body: some View {
        Rectangle()
            .fill(LinearGradient(colors: [.clear, color.opacity(peak), .clear],
                                 startPoint: .leading, endPoint: .trailing))
            .frame(height: 0.5)
    }
}

/// A vertical hairline that fades at both ends, between unequal columns.
struct FadingVerticalHairline: View {
    var peak: Double = 0.14

    var body: some View {
        Rectangle()
            .fill(LinearGradient(colors: [.clear, Color.white.opacity(peak), .clear],
                                 startPoint: .top, endPoint: .bottom))
            .frame(width: 0.5)
    }
}

/// Stroke, no fill. Dims to a grey outline when disabled.
struct OutlineButtonStyle: ButtonStyle {
    var tint: Color = OrionTheme.accent
    @Environment(\.isEnabled) private var enabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(OrionTheme.mono(10, .semibold)).tracking(1.6)
            .foregroundStyle(enabled ? tint : Color.white.opacity(0.38))
            .padding(.horizontal, 16).padding(.vertical, 7)
            .overlay(Capsule().strokeBorder(enabled ? tint.opacity(configuration.isPressed ? 0.9 : 0.6)
                                                    : Color.white.opacity(0.22), lineWidth: 0.7))
            .contentShape(Capsule())
    }
}

/// A section with no card behind it: a fading hairline above, then spacing.
/// The replacement for OrionPanel on the Plan tab (2026-10-16 UI audit #7).
struct PlainSection<Content: View>: View {
    var padding: CGFloat = 18
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            FadingHairline()
            content
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.top, padding)
        }
    }
}
