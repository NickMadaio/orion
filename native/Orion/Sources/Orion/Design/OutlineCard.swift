import SwiftUI

/// The coloured mono caps whisper above a card or a figure ("OVERDUE · 3 TASKS"). One hue per kind of thing.
struct Kicker: View {
    let text: String
    var hue: Color = OrionTheme.accent

    var body: some View {
        Text(text.uppercased())
            .font(OrionTheme.mono(9.5, .semibold))
            .tracking(2.3)
            .foregroundStyle(hue)
            .lineLimit(1)
    }
}

/// One discrete, actionable thing (a run, a bill, an experiment) on a thin tinted outline: near-black with a faint
/// inner gradient, so the window's real alpha still shows through. An optional small tilt, as on Home, and a hover
/// that lifts it a touch and brightens the rim. The look is Home's card (HomeCardView), shared.
struct OutlineCard<Content: View>: View {
    var hue: Color = OrionTheme.accent
    /// Degrees; keep within ±1.5 so it reads as laid down by hand, not as broken.
    var tilt: Double = 0
    var padding: CGFloat = 22
    var hoverLift = true
    @ViewBuilder var content: Content

    @State private var hovering = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    static var corner: CGFloat { 20 }

    var body: some View {
        content
            .padding(.horizontal, padding + 2)
            .padding(.vertical, padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(OutlineSurface(hue: hue, lit: hovering))
            .scaleEffect(hovering && hoverLift && !reduceMotion ? 1.01 : 1)
            .rotationEffect(.degrees(tilt))
            .onHover { hovering = $0 }
            .animation(OrionMotion.hover, value: hovering)
            .accessibilityElement(children: .contain)
    }
}

/// The card's surface on its own, for a view that already owns its hover state.
struct OutlineSurface: View {
    var hue: Color
    var lit = false

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: 20, style: .continuous)
        shape
            // Near-black, not opaque: the desktop still reads through, just quieter under the text.
            .fill(OrionTheme.ink.opacity(0.42))
            .overlay(shape.fill(LinearGradient(colors: [Color.white.opacity(0.045), Color.white.opacity(0.008)],
                                               startPoint: .top, endPoint: .bottom)))
            .overlay(shape.strokeBorder(LinearGradient(colors: [hue.opacity(lit ? 0.62 : 0.40), Color.white.opacity(lit ? 0.16 : 0.09),
                                                                hue.opacity(lit ? 0.30 : 0.16)],
                                                       startPoint: .topLeading, endPoint: .bottomTrailing),
                                        lineWidth: 0.9))
            .shadow(color: hue.opacity(lit ? 0.16 : 0.06), radius: lit ? 22 : 14, y: 6)
    }
}

/// The serif sentence a card leads with: the user's life speaks serif.
struct CardTitle: View {
    let text: String
    var size: CGFloat = 22

    init(_ text: String, size: CGFloat = 22) {
        self.text = text
        self.size = size
    }

    var body: some View {
        Text(text)
            .font(OrionTheme.serif(size))
            .foregroundStyle(OrionTheme.text)
            .lineSpacing(1)
            .lineLimit(3)
            .fixedSize(horizontal: false, vertical: true)
    }
}

/// A line of card body text.
struct CardBody: View {
    let text: String

    init(_ text: String) { self.text = text }

    var body: some View {
        Text(text)
            .font(.system(size: 13))
            .foregroundStyle(Color.white.opacity(0.58))
            .lineSpacing(3)
            .lineLimit(3)
            .fixedSize(horizontal: false, vertical: true)
    }
}
