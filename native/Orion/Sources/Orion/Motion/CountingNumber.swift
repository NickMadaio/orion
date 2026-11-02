import OrionViews
import SwiftUI

/*
 A number that counts up to its value (wave 12, review #7). The count is the animation: SwiftUI interpolates
 `animatableData` and the text re-renders each frame, so it rides whatever curve the surrounding `withAnimation`
 uses, and needs no timer. Held at its final value under Reduce Motion and in renders.
*/

struct CountingNumber: View, Animatable {
    var value: Double
    var prefix = ""
    var suffix = ""

    var animatableData: Double {
        get { value }
        set { value = newValue }
    }

    var body: some View {
        Text("\(prefix)\(Int(value.rounded()))\(suffix)").monospacedDigit()
    }
}

/// Drives a `CountingNumber` from zero (or from `start`) to `value` once, on appearance, after `delay`.
struct CountUp: View {
    let value: Int
    var delay: Double = 0
    var prefix = ""
    var suffix = ""

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.orionFrozenMotion) private var frozen
    @State private var reached = false

    var body: some View {
        let shown = frozen.map { Double(value) * $0 } ?? (reduceMotion || reached ? Double(value) : 0)
        CountingNumber(value: shown, prefix: prefix, suffix: suffix)
            .onAppear {
                guard frozen == nil, !reduceMotion, !reached else { return }
                withAnimation(.easeOut(duration: 0.9).delay(delay)) { reached = true }
            }
    }
}
