import OrionViews
import SwiftUI

/*
 Wave 14 (Health): the round meter for the Health tab. A hairline track, an arc that draws itself in with a soft
 spring and a glow, and whatever the caller puts in the middle. It is deliberately not `RingMeter` (OrionUI.swift),
 which carries its own captions: here the centre is a slot, so the same ring serves a 124pt recovery score and a 44pt
 water count. Held complete under Reduce Motion and in renders (`orionFrozenMotion`).
*/

struct HealthRing<Centre: View>: View {
    /// 0...1; clamped, so an out-of-range reading never wraps past its own start.
    let progress: Double
    var tint: Color = OrionTheme.accent
    var diameter: CGFloat = 120
    var lineWidth: CGFloat = 4
    /// Seconds before the arc starts drawing: the stagger.
    var delay: Double = 0
    @ViewBuilder var centre: () -> Centre

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.orionFrozenMotion) private var frozen
    @State private var drawn = false

    private var clamped: Double { min(1, max(0, progress.isFinite ? progress : 0)) }
    private var reveal: Double { frozen ?? (reduceMotion || drawn ? 1 : 0) }

    var body: some View {
        ZStack {
            Circle().strokeBorder(Color.white.opacity(0.09), lineWidth: 1)
                .padding(lineWidth / 2)
            Circle()
                .trim(from: 0, to: clamped * reveal)
                .stroke(tint.opacity(0.92), style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))
                .padding(lineWidth / 2)
                .rotationEffect(.degrees(-90))
                .shadow(color: tint.opacity(0.55), radius: diameter > 80 ? 8 : 4)
            // The end dot: the line-art meters' bright tip, carried round.
            if clamped * reveal > 0.01 {
                Circle().fill(tint).frame(width: lineWidth + 1.5, height: lineWidth + 1.5)
                    .shadow(color: tint, radius: 4)
                    .offset(y: -(diameter - lineWidth) / 2)
                    .rotationEffect(.degrees(360 * clamped * reveal))
            }
            centre()
        }
        .frame(width: diameter, height: diameter)
        .animation(reduceMotion ? nil : .spring(response: 0.9, dampingFraction: 0.88), value: clamped)
        .onAppear {
            guard frozen == nil, !reduceMotion, !drawn else { return }
            withAnimation(.spring(response: 1.1, dampingFraction: 0.9).delay(delay)) { drawn = true }
        }
        .accessibilityElement(children: .combine)
        .accessibilityValue("\(Int((clamped * 100).rounded())) percent")
    }
}

/// A figure that counts up to a decimal value once (`CountUp` is integer-only; strain is 6.3).
struct HealthCount: View {
    let value: Double
    var decimals = 0
    var delay: Double = 0

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.orionFrozenMotion) private var frozen
    @State private var reached = false

    var body: some View {
        let shown = frozen.map { value * $0 } ?? (reduceMotion || reached ? value : 0)
        HealthCountText(value: shown, decimals: decimals)
            .onAppear {
                guard frozen == nil, !reduceMotion, !reached else { return }
                withAnimation(.easeOut(duration: 1.0).delay(delay)) { reached = true }
            }
    }
}

private struct HealthCountText: View, Animatable {
    var value: Double
    var decimals: Int
    var animatableData: Double {
        get { value }
        set { value = newValue }
    }
    var body: some View { Text(String(format: "%.\(decimals)f", value)).monospacedDigit() }
}
