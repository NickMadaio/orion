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
        case .project: OrionTheme.accent
        case .health: OrionTheme.rose
        case .sleep: OrionTheme.lavender
        }
    }

    static let corner: CGFloat = 20

    /// Serif title size by priority rank: the centre card's is the largest.
    static func titleSize(rank: Int) -> CGFloat { [26, 21, 20, 19, 18][min(max(rank, 0), 4)] }
}

struct HomeCardView: View {
    let card: HomeCard
    /// Priority rank in the spread: 0 is the centre card. Bigger rank means smaller type, a dimmer rim, less glow.
    var rank: Int = 0
    let onAction: (HomeCardAction) -> Void

    @State private var hovering = false

    private var hue: Color { HomeCardStyle.hue(card.kind) }
    private var top: Bool { rank == 0 }
    private var dim: Double { HomePriorityPlan.dim(rank) }
    private var inset: CGFloat { rank >= 3 ? 18 : (top ? 26 : 22) }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(card.kickerText)
                .font(OrionTheme.mono(top ? 10.5 : 9.5, .semibold))
                .tracking(2.3)
                .foregroundStyle(hue)
                .lineLimit(2)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.bottom, 12)

            Text(card.title)
                .font(OrionTheme.serif(HomeCardStyle.titleSize(rank: rank)))
                .foregroundStyle(OrionTheme.text.opacity(dim))
                .lineSpacing(1)
                .lineLimit(top ? 4 : 5)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.bottom, card.body.isEmpty ? 18 : 10)

            if !card.body.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    ForEach(card.body, id: \.self) { line in
                        Text(line)
                            .font(.system(size: top ? 14 : 13))
                            .foregroundStyle(Color.white.opacity(top ? 0.80 : 0.72))
                            .lineSpacing(3)
                            .lineLimit(top ? 4 : 5)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .padding(.bottom, 18)
            }

            // Side by side when the card is wide enough, else the quiet link drops under the pill.
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 16) { actions }
                VStack(alignment: .leading, spacing: 12) { actions }
            }
        }
        .padding(.horizontal, inset)
        .padding(.top, inset)
        .padding(.bottom, inset)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(surface)
        .scaleEffect(hovering ? 1.01 : 1)
        .onHover { hovering = $0 }
        .animation(OrionMotion.hover, value: hovering)
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder private var actions: some View {
        HomeGlowPill(title: card.primary.title, hue: hue) { onAction(card.primary.action) }
            .fixedSize()
        if let details = card.details {
            Button { onAction(details.action) } label: {
                HStack(spacing: 4) {
                    Text(details.title)
                    Image(systemName: "chevron.right").font(.system(size: 9, weight: .semibold))
                }
                .font(.system(size: 12.5, weight: .medium))
                .foregroundStyle(Color.white.opacity(0.72))
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        }
    }

    private var surface: some View {
        let shape = RoundedRectangle(cornerRadius: HomeCardStyle.corner, style: .continuous)
        return shape
            // Near-black, not opaque: the desktop still reads through, just quieter under the text.
            .fill(OrionTheme.ink.opacity(0.42))
            .overlay(shape.fill(LinearGradient(colors: [Color.white.opacity(0.045), Color.white.opacity(0.008)],
                                               startPoint: .top, endPoint: .bottom)))
            .overlay(shape.strokeBorder(LinearGradient(colors: [hue.opacity((hovering ? 0.62 : 0.40) * dim * (top ? 1.45 : 1)),
                                                                Color.white.opacity(hovering ? 0.16 : (top ? 0.14 : 0.09)),
                                                                hue.opacity((hovering ? 0.30 : 0.16) * dim * (top ? 1.6 : 1))],
                                                       startPoint: .topLeading, endPoint: .bottomTrailing),
                                        lineWidth: top ? 1.3 : 0.9))
            .shadow(color: hue.opacity((hovering ? 0.16 : 0.06) * dim + (top ? 0.12 : 0)), radius: top ? 30 : (hovering ? 22 : 14), y: 6)
    }
}

/// The card's one action. Now the shared page-kit pill (Design/GlowPill.swift), unchanged in look; the old name
/// stays so Home reads as it did.
typealias HomeGlowPill = GlowPill
