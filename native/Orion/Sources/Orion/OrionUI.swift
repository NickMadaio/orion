import SwiftUI

/*
 Orion's visual language.

 The brief this replaces: every element sat in its own rounded, filled capsule,
 every tab was a vertical stack of those capsules at identical widths, and the
 result read as a form rather than as a dashboard. Boxes were doing the work
 that spacing, type and alignment should be doing.

 Four rules, and everything below follows from them:

   1. NOTHING IS IN A BOX. No fills, no card borders, no drop shadows behind
      content. Grouping comes from proximity and from a hairline that separates
      without enclosing. This is also what makes the window genuinely
      see-through — a translucent surface covered in opaque cards is an opaque
      surface, so the transparency work and the visual work are the same work.

   2. TYPE CARRIES THE HIERARCHY. One large number per idea, its unit small
      beside it, its caption smaller still and tracked. If a section needs a box
      to look important, it is not important.

   3. LINE ART, NOT FILLED CHROME. Meters are thin strokes. Actions are hairline
      outlines that fill only on hover. Filled shapes are reserved for the one
      genuinely primary action on a screen.

   4. OFFSET, NOT GRID. Columns have deliberately different widths and start at
      deliberately different heights. A row of three equal cards is the thing
      being replaced, so equal-width anything needs a reason.

 Numbers are monospaced throughout. Proportional digits shift column widths as
 values change, and a dashboard whose numbers jitter while you watch reads as
 unstable even when it is correct.
*/

enum OrionTheme {

    /// A flat fill, for the rare surface that genuinely needs one — a sheet, or
    /// text sitting on a light shape. The dashboard itself paints nothing; see
    /// `SurfaceSettings` for why a colour cannot do that job.
    static let ink = Color(red: 0.016, green: 0.024, blue: 0.043)

    // Kept because sheets and older call sites still reference them. Both are
    // now barely-there and neither is used by the dashboard tabs.
    static let card = Color.white.opacity(0.03)
    static let cardRaised = Color.white.opacity(0.055)
    static let line = Color.white.opacity(0.09)

    static let text = Color.white.opacity(0.95)
    static let textSoft = Color.white.opacity(0.60)
    static let textDim = Color.white.opacity(0.34)

    static let accent = Color(red: 0.18, green: 0.83, blue: 1.00)
    static let green = Color(red: 0.36, green: 0.92, blue: 0.60)
    static let orange = Color(red: 1.00, green: 0.58, blue: 0.20)
    static let red = Color(red: 1.00, green: 0.38, blue: 0.38)
    static let blue = Color(red: 0.36, green: 0.72, blue: 1.00)
    static let violet = Color(red: 0.70, green: 0.52, blue: 1.00)

    /// A calendar's own colour, from `RRGGBB`.
    ///
    /// Falls back to the accent rather than to grey: an event with an
    /// unreadable colour should still look like an event.
    static func color(hex: String?) -> Color {
        guard let hex, hex.count == 6, let value = Int(hex, radix: 16) else { return accent }
        return Color(
            .sRGB,
            red: Double((value >> 16) & 0xFF) / 255,
            green: Double((value >> 8) & 0xFF) / 255,
            blue: Double(value & 0xFF) / 255,
            opacity: 1
        )
    }

    /// Section labels, chip values, every number.
    static func mono(_ size: CGFloat, _ weight: Font.Weight = .medium) -> Font {
        .system(size: size, weight: weight, design: .monospaced)
    }

    /// Headlines and figures. Rounded, because the numbers are the personality.
    static func display(_ size: CGFloat, _ weight: Font.Weight = .semibold) -> Font {
        .system(size: size, weight: weight, design: .rounded)
    }
}

// MARK: - Structure

/// A hairline that fades out rather than terminating.
///
/// A rule with two hard ends draws a boundary, which is a quiet way of drawing
/// the box this design is trying not to draw. One that dissolves separates
/// without enclosing.
struct FadingRule: View {
    var tint: Color = .white
    var height: CGFloat = 1

    var body: some View {
        LinearGradient(
            colors: [tint.opacity(0.16), tint.opacity(0.05), tint.opacity(0)],
            startPoint: .leading,
            endPoint: .trailing
        )
        .frame(height: height)
    }
}

/// The section marker: a tracked label with the rule running off to the right.
///
/// Replaces the old `— SECTION` prefix, which pinned every heading to the same
/// left edge and produced the ladder of identical rows this design is undoing.
struct SectionRule: View {
    let title: String
    var trailing: String? = nil
    var tint: Color = OrionTheme.textDim

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            Text(title.uppercased())
                .font(OrionTheme.mono(9, .semibold))
                .tracking(2.2)
                .foregroundStyle(tint)
                .fixedSize()
            FadingRule()
            if let trailing {
                Text(trailing.uppercased())
                    .font(OrionTheme.mono(9, .medium))
                    .tracking(1.4)
                    .foregroundStyle(OrionTheme.textDim)
                    .fixedSize()
            }
        }
        .padding(.bottom, 2)
    }
}

/// Pure layout. No fill, no border, no shadow — deliberately.
///
/// This used to be the rounded card that every section was wrapped in, and the
/// name is kept only so that call sites do not all have to change at once.
/// What it does now is hold a column of content at a consistent rhythm, which
/// is all a container on this surface is allowed to do.
struct OrionTile<Content: View>: View {
    var padding: CGFloat = 0
    var spacing: CGFloat = 12
    /// Left accent hairline. Off unless a section genuinely leads the page —
    /// a rule the eye can follow is flow; a border around content is a box.
    var accent: Color? = nil
    @ViewBuilder var content: Content

    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            if let accent {
                Capsule()
                    .fill(
                        LinearGradient(
                            colors: [accent.opacity(0.85), accent.opacity(0.05)],
                            startPoint: .top,
                            endPoint: .bottom
                        )
                    )
                    .frame(width: 2)
            }
            VStack(alignment: .leading, spacing: spacing) { content }
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(padding)
    }
}

/// Kept so older call sites still compile; forwards to the plain container.
struct OrionPanel<Content: View>: View {
    var padding: CGFloat = 0
    @ViewBuilder var content: Content

    var body: some View {
        OrionTile(padding: padding) { content }
    }
}

// MARK: - Figures

/// One number, set large, with its unit kept small so the value dominates.
struct BigStat: View {
    let value: String
    var unit: String? = nil
    var caption: String? = nil
    var tint: Color = OrionTheme.text
    var size: CGFloat = 38

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            if let caption {
                Text(caption.uppercased())
                    .font(OrionTheme.mono(9, .semibold))
                    .tracking(1.6)
                    .foregroundStyle(OrionTheme.textDim)
            }
            HStack(alignment: .firstTextBaseline, spacing: 5) {
                Text(value)
                    .font(OrionTheme.display(size))
                    .foregroundStyle(tint)
                if let unit {
                    Text(unit)
                        .font(OrionTheme.mono(12))
                        .foregroundStyle(OrionTheme.textDim)
                }
            }
        }
    }
}

/// A value you read in a glance rather than a number you parse.
///
/// Thinner than it was. A 9pt stroke reads as a filled donut — another shape
/// competing for attention; a 5pt stroke reads as an instrument.
struct RingMeter: View {
    /// 0...1. Clamped rather than trusted — a ring that wraps past its own
    /// start looks like a rendering fault, not like an out-of-range value.
    let progress: Double
    let value: String
    var caption: String? = nil
    var subcaption: String? = nil
    var tint: Color = OrionTheme.orange
    var diameter: CGFloat = 128

    private var clamped: Double { min(1, max(0, progress)) }

    var body: some View {
        ZStack {
            Circle()
                .stroke(Color.white.opacity(0.07), lineWidth: 5)
            Circle()
                .trim(from: 0, to: clamped)
                .stroke(
                    AngularGradient(
                        colors: [tint.opacity(0.55), tint],
                        center: .center,
                        startAngle: .degrees(0),
                        endAngle: .degrees(360 * clamped)
                    ),
                    style: StrokeStyle(lineWidth: 5, lineCap: .round)
                )
                .rotationEffect(.degrees(-90))
                .shadow(color: tint.opacity(0.5), radius: 9)
            VStack(spacing: 2) {
                Text(value)
                    .font(OrionTheme.display(diameter * 0.28))
                    .foregroundStyle(OrionTheme.text)
                if let caption {
                    Text(caption.uppercased())
                        .font(OrionTheme.mono(8, .semibold))
                        .tracking(1.6)
                        .foregroundStyle(OrionTheme.textDim)
                }
                if let subcaption {
                    Text(subcaption)
                        .font(OrionTheme.mono(9))
                        .foregroundStyle(OrionTheme.textDim)
                }
            }
        }
        .frame(width: diameter, height: diameter)
        .animation(.easeOut(duration: 0.5), value: clamped)
    }
}

/// A count against a target, as a hairline rather than a bar.
///
/// The marker is the point: a track alone says how far along you are, but not
/// whether that is fine. Marking the band on the track answers both at once.
struct ZoneBar: View {
    let value: Int
    let target: Int
    var zoneLabel: String = "healthy zone"
    var tint: Color = OrionTheme.blue

    private var fraction: Double {
        guard target > 0 else { return 0 }
        return min(1, max(0, Double(value) / Double(target)))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            GeometryReader { geometry in
                ZStack(alignment: .leading) {
                    Capsule()
                        .fill(Color.white.opacity(0.09))
                        .frame(height: 2)
                    Capsule()
                        .fill(tint)
                        .frame(width: max(2, geometry.size.width * fraction), height: 2)
                        .shadow(color: tint.opacity(0.6), radius: 5)
                    // "Enough for today" begins at 75% of target for every
                    // counter here.
                    Rectangle()
                        .fill(OrionTheme.green.opacity(0.45))
                        .frame(width: 1, height: 7)
                        .offset(x: geometry.size.width * 0.75)
                }
                .frame(height: 7)
            }
            .frame(height: 7)
            HStack(spacing: 0) {
                Text(zoneLabel)
                    .font(OrionTheme.mono(9))
                    .foregroundStyle(OrionTheme.textDim)
                Spacer()
                Text("\(value) / \(target)")
                    .font(OrionTheme.mono(9))
                    .foregroundStyle(OrionTheme.textDim)
            }
        }
        .animation(.easeOut(duration: 0.35), value: fraction)
    }
}

/// A week of a metric as a single line, with the latest point marked.
///
/// Line art rather than a chart: no axes, no gridlines, no legend. At this size
/// the only questions are "which way is it going" and "is today unusual", and
/// a stroked path answers both without spending a single label on it.
struct Sparkline: View {
    /// Normalised 0...1, oldest → newest.
    let points: [Double]
    var tint: Color = OrionTheme.accent
    var height: CGFloat = 26

    var body: some View {
        SparkPath(points: points)
            .stroke(tint.opacity(0.75),
                    style: StrokeStyle(lineWidth: 1.5, lineCap: .round, lineJoin: .round))
            .overlay {
                GeometryReader { geometry in
                    let inset: CGFloat = SparkPath.inset
                    let usable = max(1, geometry.size.height - inset * 2)
                    let y = inset + usable * (1 - CGFloat(points.last ?? 0))
                    Circle()
                        .fill(tint)
                        .frame(width: 4, height: 4)
                        .position(x: geometry.size.width, y: y)
                        .shadow(color: tint.opacity(0.9), radius: 4)
                        .opacity(points.isEmpty ? 0 : 1)
                }
            }
            .frame(height: height)
    }
}

/// The line itself. A `Shape` rather than an inline `Path`, because the point
/// maths needs a function and a result builder will not take a declaration.
private struct SparkPath: Shape {
    static let inset: CGFloat = 3
    let points: [Double]

    func path(in rect: CGRect) -> Path {
        var path = Path()
        guard points.count > 1 else { return path }
        let usable = max(1, rect.height - SparkPath.inset * 2)
        let step = rect.width / CGFloat(points.count - 1)
        for (index, value) in points.enumerated() {
            let point = CGPoint(x: CGFloat(index) * step,
                                y: SparkPath.inset + usable * (1 - CGFloat(value)))
            if index == 0 { path.move(to: point) } else { path.addLine(to: point) }
        }
        return path
    }
}

/// A status reading in the header strip. No capsule — the strip separates its
/// own items with hairlines, so each one carrying a pill was six shapes doing
/// one shape's job.
struct StatChip: View {
    let icon: String
    let value: String
    var tint: Color = OrionTheme.textSoft

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: icon)
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(tint)
            Text(value)
                .font(OrionTheme.mono(11, .medium))
                .foregroundStyle(OrionTheme.textSoft)
        }
    }
}

// MARK: - Actions

/// The primary action of a section: a hairline outline that fills on hover.
///
/// Previously a solid white capsule the full width of its card, which made
/// every section shout equally. An outline reads as available rather than as
/// urgent, and the hover fill gives back all the affordance the fill was for.
struct LogButton: View {
    let title: String
    var systemImage: String = "arrow.up"
    var tint: Color = OrionTheme.accent
    var fullWidth: Bool = false
    let action: () -> Void

    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: 7) {
                if fullWidth { Spacer(minLength: 0) }
                Text(title)
                    .font(.system(size: 12, weight: .semibold))
                Image(systemName: systemImage)
                    .font(.system(size: 10, weight: .bold))
                if fullWidth { Spacer(minLength: 0) }
            }
            .foregroundStyle(hovering ? OrionTheme.ink : tint)
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
            .background {
                Capsule()
                    .fill(hovering ? tint : Color.clear)
                    .overlay(Capsule().strokeBorder(tint.opacity(hovering ? 0 : 0.45), lineWidth: 1))
            }
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .animation(.easeOut(duration: 0.14), value: hovering)
    }
}

/// A small round button, for the `−` beside a quick-log action.
struct StepButton: View {
    let systemImage: String
    let action: () -> Void

    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .font(.system(size: 11, weight: .bold))
                .foregroundStyle(hovering ? OrionTheme.text : OrionTheme.textDim)
                .frame(width: 30, height: 30)
                .background(
                    Circle().strokeBorder(Color.white.opacity(hovering ? 0.28 : 0.12), lineWidth: 1)
                )
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .animation(.easeOut(duration: 0.14), value: hovering)
    }
}

/// A quiet text action. The default for anything that is not the one primary
/// action on a screen.
struct InlineAction: View {
    let title: String
    var systemImage: String? = nil
    var tint: Color = OrionTheme.accent
    let action: () -> Void

    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: 5) {
                Text(title)
                    .font(OrionTheme.mono(10, .semibold))
                    .tracking(0.8)
                if let systemImage {
                    Image(systemName: systemImage).font(.system(size: 9, weight: .bold))
                }
            }
            .foregroundStyle(hovering ? tint : tint.opacity(0.75))
            .overlay(alignment: .bottom) {
                Rectangle()
                    .fill(tint.opacity(hovering ? 0.7 : 0.22))
                    .frame(height: 1)
                    .offset(y: 3)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .animation(.easeOut(duration: 0.14), value: hovering)
    }
}

// MARK: - Rows

/// A label/value line. Separated by air and a hairline, never by a fill.
struct DataRow: View {
    let label: String
    var sublabel: String? = nil
    let value: String
    var valueTint: Color = OrionTheme.text
    var tickable: Bool = false
    var ticked: Bool = false
    var onTick: (() -> Void)? = nil

    var body: some View {
        HStack(spacing: 12) {
            if tickable {
                Button { onTick?() } label: {
                    Image(systemName: ticked ? "checkmark.circle.fill" : "circle")
                        .font(.system(size: 15))
                        .foregroundStyle(ticked ? OrionTheme.green : OrionTheme.textDim)
                        .contentShape(Circle())
                }
                .buttonStyle(.plain)
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(label)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(ticked ? OrionTheme.textDim : OrionTheme.text)
                    .strikethrough(ticked, color: OrionTheme.textDim)
                if let sublabel {
                    Text(sublabel)
                        .font(OrionTheme.mono(10))
                        .foregroundStyle(OrionTheme.textDim)
                }
            }
            Spacer(minLength: 12)
            Text(value)
                .font(OrionTheme.mono(12, .semibold))
                .foregroundStyle(valueTint)
        }
        .padding(.vertical, 8)
    }
}

/// The one-line "not connected yet" state.
///
/// An empty section should be one quiet line and a way to act, not an essay
/// about the future.
struct NotConnected: View {
    let what: String
    var detail: String? = nil
    var actionTitle: String? = nil
    var action: (() -> Void)? = nil

    var body: some View {
        HStack(spacing: 11) {
            Image(systemName: "link")
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(OrionTheme.textDim)
            VStack(alignment: .leading, spacing: 2) {
                Text("\(what) not connected")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(OrionTheme.textSoft)
                if let detail {
                    Text(detail)
                        .font(OrionTheme.mono(10))
                        .foregroundStyle(OrionTheme.textDim)
                }
            }
            Spacer(minLength: 12)
            if let actionTitle, let action {
                InlineAction(title: actionTitle, action: action)
            }
        }
        .padding(.vertical, 6)
    }
}
