import OrionViews
import SwiftUI
import ThinkingOrbsKit

/*
 The Home page's composition, from plain values (renders use it directly; HomeTab feeds it live data):
 greeting top left, the card spread below it, the glance row and the composer pinned to the bottom. Behind it all,
 the hologram (U5, 2026-11-02: "combine the old stuff with the new"): large, slow and dimmed, filling the empty
 field on a quiet day and sinking behind the cards on a busy one (HomeHologramPlacement). The app-shortcut orbs
 that used to circle it stay gone.
*/

struct HomeScene<Composer: View>: View {
    let greeting: String
    let subline: String
    let cards: [HomeCard]
    var glance: [HomeGlanceItem] = []
    /// Nil draws no hologram (renders of the bare layout).
    var hologram: HologramModel?
    /// Renders only: a fixed moment of the hologram.
    var hologramFrozenTime: Double?
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

            if !glance.isEmpty {
                HomeGlanceRow(items: glance, onAction: onAction)
                    .frame(maxWidth: .infinity)
                    .padding(.bottom, 22)
                    .softReveal(delay: 0.3)
            }

            composer()
                .frame(maxWidth: 1_200)
                .padding(.horizontal, 24)
                .frame(maxWidth: .infinity)
        }
        .frame(maxWidth: .infinity, minHeight: availableHeight, alignment: .top)
        .background(hologramLayer)
        .background(atmosphere)
    }

    /// The hologram and a faint ring around it, placed by card count. Behind the cards and never hit-testable.
    private var hologramLayer: some View {
        GeometryReader { proxy in
            if let hologram {
                let placement = HomeHologramPlacement.forCards(cards.count)
                let frame = placement.frame(in: proxy.size)
                ZStack {
                    // The ring, after Sentient's hero: one hairline with a soft halo, static.
                    Circle()
                        .strokeBorder(Color.white.opacity(0.16), lineWidth: 0.8)
                        .shadow(color: OrionTheme.accent.opacity(0.35), radius: 10)
                        .padding(frame.width * 0.02)
                    HomeHologram(model: hologram, frozenTime: hologramFrozenTime)
                        .padding(frame.width * 0.08)
                }
                .frame(width: frame.width, height: frame.height)
                .opacity(placement.opacity)
                .position(x: frame.midX, y: frame.midY)
                .animation(ViewMotion.softReveal, value: cards.count)
            }
        }
        .allowsHitTesting(false)
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
