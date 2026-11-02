import SwiftUI

/// The one big figure per idea: a coloured mono kicker, the number set large and light, its unit small beside it,
/// and an optional note under it. Light, not bold, the way Knowledge's count is: a big number on black reads
/// heavier than it is. An integer value counts up on arrival (CountUp; held still under Reduce Motion and in renders).
struct BigNumber: View {
    let label: String
    let value: String
    var unit: String? = nil
    var note: String? = nil
    var hue: Color = OrionTheme.accent
    var valueTint: Color = OrionTheme.text
    var size: CGFloat = 46
    /// When set, the figure counts up to this instead of showing `value` statically.
    var countTo: Int? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Kicker(text: label, hue: hue.opacity(0.9))
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Group {
                    if let countTo { CountUp(value: countTo, delay: 0.25) } else { Text(value) }
                }
                .font(OrionTheme.display(size, .light))
                .foregroundStyle(valueTint)
                .lineLimit(1)
                .fixedSize()
                if let unit, !unit.isEmpty {
                    Text(unit)
                        .font(OrionTheme.mono(11))
                        .foregroundStyle(Color.white.opacity(0.42))
                }
            }
            if let note, !note.isEmpty {
                Text(note)
                    .font(OrionTheme.mono(10))
                    .foregroundStyle(Color.white.opacity(0.42))
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .accessibilityElement(children: .combine)
    }
}

/// A line-art meter: a hairline track, the filled part in the hue with a soft glow, and a small bright end dot.
/// No bar, no fill behind it.
struct LineMeter: View {
    /// 0…1; clamped.
    let progress: Double
    var hue: Color = OrionTheme.accent
    var width: CGFloat? = nil

    var body: some View {
        GeometryReader { proxy in
            let clamped = min(1, max(0, progress.isFinite ? progress : 0))
            let filled = proxy.size.width * clamped
            ZStack(alignment: .leading) {
                Rectangle().fill(Color.white.opacity(0.10)).frame(height: 1)
                Rectangle().fill(hue.opacity(0.85)).frame(width: filled, height: 1.2)
                    .shadow(color: hue.opacity(0.7), radius: 3)
                if clamped > 0 {
                    Circle().fill(hue).frame(width: 4, height: 4)
                        .shadow(color: hue, radius: 3)
                        .offset(x: max(0, filled - 2))
                }
            }
            .frame(maxHeight: .infinity)
        }
        .frame(width: width, height: 6)
        .accessibilityValue("\(Int((min(1, max(0, progress.isFinite ? progress : 0)) * 100).rounded())) percent")
    }
}
