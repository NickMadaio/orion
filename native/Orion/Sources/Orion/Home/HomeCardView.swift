import SwiftUI

/*
 One Home card: a thin tinted outline on near-black with a faint inner gradient, a coloured mono kicker, a serif
 sentence, a line or two of body, and one glowing pill. No heavy fill: the window's real alpha still shows through.
 Hover lifts it a touch (1.01) and brightens the rim.
*/

enum HomeCardStyle {
    static func hue(_ kind: HomeCardKind) -> Color {
        switch kind {
        case .question: OrionTheme.violet
        case .event: OrionTheme.blue
        case .tasks: OrionTheme.orange
        case .focus: OrionTheme.green
        case .health: OrionTheme.rose
        case .sleep: OrionTheme.lavender
        }
    }

    static let corner: CGFloat = 20
}

struct HomeCardView: View {
    let card: HomeCard
    let onAction: (HomeCardAction) -> Void

    @State private var hovering = false

    private var hue: Color { HomeCardStyle.hue(card.kind) }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(card.kickerText)
                .font(OrionTheme.mono(9.5, .semibold))
                .tracking(2.3)
                .foregroundStyle(hue)
                .lineLimit(1)
                .padding(.bottom, 12)

            Text(card.title)
                .font(OrionTheme.serif(22))
                .foregroundStyle(OrionTheme.text)
                .lineSpacing(1)
                .lineLimit(3)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.bottom, card.body.isEmpty ? 18 : 10)

            if !card.body.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    ForEach(card.body, id: \.self) { line in
                        Text(line)
                            .font(.system(size: 13))
                            .foregroundStyle(Color.white.opacity(0.58))
                            .lineSpacing(3)
                            .lineLimit(3)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .padding(.bottom, 18)
            }

            HStack(spacing: 16) {
                HomeGlowPill(title: card.primary.title, hue: hue) { onAction(card.primary.action) }
                if let details = card.details {
                    Button { onAction(details.action) } label: {
                        HStack(spacing: 4) {
                            Text(details.title)
                            Image(systemName: "chevron.right").font(.system(size: 9, weight: .semibold))
                        }
                        .font(.system(size: 12.5, weight: .medium))
                        .foregroundStyle(Color.white.opacity(0.62))
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .padding(.horizontal, 24)
        .padding(.top, 22)
        .padding(.bottom, 22)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(surface)
        .scaleEffect(hovering ? 1.01 : 1)
        .onHover { hovering = $0 }
        .animation(OrionMotion.hover, value: hovering)
        .accessibilityElement(children: .contain)
    }

    private var surface: some View {
        let shape = RoundedRectangle(cornerRadius: HomeCardStyle.corner, style: .continuous)
        return shape
            // Near-black, not opaque: the desktop still reads through, just quieter under the text.
            .fill(OrionTheme.ink.opacity(0.42))
            .overlay(shape.fill(LinearGradient(colors: [Color.white.opacity(0.045), Color.white.opacity(0.008)],
                                               startPoint: .top, endPoint: .bottom)))
            .overlay(shape.strokeBorder(LinearGradient(colors: [hue.opacity(hovering ? 0.62 : 0.40), Color.white.opacity(hovering ? 0.16 : 0.09),
                                                                hue.opacity(hovering ? 0.30 : 0.16)],
                                                       startPoint: .topLeading, endPoint: .bottomTrailing),
                                        lineWidth: 0.9))
            .shadow(color: hue.opacity(hovering ? 0.16 : 0.06), radius: hovering ? 22 : 14, y: 6)
    }
}

/// The card's one action: an outline capsule in the card's hue with a soft glow rim and a small sparkle.
struct HomeGlowPill: View {
    let title: String
    let hue: Color
    let action: () -> Void

    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Image(systemName: "sparkle").font(.system(size: 10, weight: .semibold))
                Text(title).font(.system(size: 12.5, weight: .semibold))
            }
            .foregroundStyle(OrionTheme.text)
            .padding(.horizontal, 15)
            .padding(.vertical, 9)
            .background(Capsule().fill(hue.opacity(hovering ? 0.16 : 0.09)))
            .overlay(Capsule().strokeBorder(hue.opacity(hovering ? 0.95 : 0.7), lineWidth: 1))
            .shadow(color: hue.opacity(hovering ? 0.55 : 0.32), radius: hovering ? 10 : 7)
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .animation(OrionMotion.hover, value: hovering)
    }
}
