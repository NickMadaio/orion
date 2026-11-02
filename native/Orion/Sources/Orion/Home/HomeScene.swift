import OrionViews
import SwiftUI

/*
 The Home page's composition, from plain values (renders use it directly; HomeTab feeds it live data):
 greeting top left, the card spread below it, the composer pinned to the bottom. Behind the cards, one soft radial
 glow is the only atmosphere: no orrery, no orbiting app shortcuts (Nick, 2026-11-02: "all gone").
*/

struct HomeScene<Composer: View>: View {
    let greeting: String
    let subline: String
    let cards: [HomeCard]
    let availableHeight: CGFloat
    let onAction: (HomeCardAction) -> Void
    @ViewBuilder let composer: () -> Composer

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 11) {
                Text(greeting)
                    .font(OrionTheme.display(31))
                    .foregroundStyle(OrionTheme.text)
                Text(subline)
                    .font(OrionTheme.mono(10, .medium))
                    .tracking(3.2)
                    .foregroundStyle(Color.white.opacity(0.38))
            }
            .padding(.leading, 24)
            .padding(.top, 10)
            .softReveal(delay: 0.05)

            // The spread hangs a fixed step below the greeting, as Sentient's does; spare height goes under it.
            // Centring it (the first version) left a void between greeting and cards on a two-card day (live, 11-02).
            HomeCardSpread(cards: cards, onAction: onAction)
                .frame(maxWidth: 1_260)
                .padding(.horizontal, 44)
                .frame(maxWidth: .infinity)
                .padding(.top, 72)

            Spacer(minLength: 34)

            composer()
                .frame(maxWidth: 1_200)
                .padding(.horizontal, 24)
                .frame(maxWidth: .infinity)
        }
        .frame(maxWidth: .infinity, minHeight: availableHeight, alignment: .top)
        .background(atmosphere)
    }

    /// A faint pool of light behind the spread. Static.
    private var atmosphere: some View {
        GeometryReader { proxy in
            ZStack {
                RadialGradient(colors: [OrionTheme.accent.opacity(0.07), OrionTheme.accent.opacity(0.02), .clear],
                               center: UnitPoint(x: 0.42, y: 0.42), startRadius: 20, endRadius: proxy.size.width * 0.5)
                RadialGradient(colors: [OrionTheme.violet.opacity(0.05), .clear],
                               center: UnitPoint(x: 0.72, y: 0.58), startRadius: 10, endRadius: proxy.size.width * 0.32)
            }
        }
        .allowsHitTesting(false)
    }
}
