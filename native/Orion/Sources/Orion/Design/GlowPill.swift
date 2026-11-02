import SwiftUI

/// The one action: an outline capsule in the card's hue with a soft glow rim and a small sparkle (Home's pill,
/// shared). `symbol` swaps the sparkle for a verb's own glyph where that says more (a play triangle, a stop square).
struct GlowPill: View {
    let title: String
    var hue: Color = OrionTheme.accent
    var symbol: String = "sparkle"
    /// Shows a spinner in place of the glyph while the action is in flight.
    var working = false
    let action: () -> Void

    @State private var hovering = false
    @Environment(\.isEnabled) private var enabled

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                if working {
                    ProgressView().controlSize(.mini).tint(OrionTheme.text)
                } else {
                    Image(systemName: symbol).font(.system(size: 10, weight: .semibold))
                }
                Text(title).font(.system(size: 12.5, weight: .semibold))
            }
            .foregroundStyle(enabled ? OrionTheme.text : OrionTheme.textDim)
            .padding(.horizontal, 15)
            .padding(.vertical, 9)
            .background(Capsule().fill(tint.opacity(hovering ? 0.16 : 0.09)))
            .overlay(Capsule().strokeBorder(tint.opacity(hovering ? 0.95 : 0.7), lineWidth: 1))
            .shadow(color: tint.opacity(enabled ? (hovering ? 0.55 : 0.32) : 0), radius: hovering ? 10 : 7)
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .animation(OrionMotion.hover, value: hovering)
    }

    private var tint: Color { enabled ? hue : Color.white.opacity(0.3) }
}

/// The quiet second action beside a pill: "details ›".
struct CardDetailsLink: View {
    let title: String
    var symbol: String = "chevron.right"
    let action: () -> Void

    @State private var hovering = false

    init(_ title: String = "details", symbol: String = "chevron.right", action: @escaping () -> Void) {
        self.title = title
        self.symbol = symbol
        self.action = action
    }

    var body: some View {
        Button(action: action) {
            HStack(spacing: 4) {
                Text(title)
                Image(systemName: symbol).font(.system(size: 9, weight: .semibold))
            }
            .font(.system(size: 12.5, weight: .medium))
            .foregroundStyle(Color.white.opacity(hovering ? 0.9 : 0.62))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .animation(OrionMotion.hover, value: hovering)
    }
}
