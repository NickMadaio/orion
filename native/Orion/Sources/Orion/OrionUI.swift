import SwiftUI

/*
 The dashboard's visual language.

 Pulled out of `DashboardView` because the tabs had drifted into looking
 identical: every one was a heading, a rounded card, and a sentence of
 placeholder prose explaining what would eventually go there. Six tabs, one
 layout, almost no data. That reads as an app that has not been built yet, even
 where the data exists and is simply not being shown.

 The reference Nick supplied works because it is dense and every element is a
 live number. Four things carry that, and they are what this file provides:

   1. Rule-prefixed section labels — small, tracked, monospaced, all caps,
      preceded by an em dash. They separate without drawing a box around
      everything, which is what lets a screen hold eight sections without
      turning into a stack of competing panels.
   2. One number per idea, set large, with its unit small beside it.
   3. Ring and zone meters, so progress is legible at a glance rather than read.
   4. Full-width action rows, so the common action per section is unmissable.

 Everything is monospaced-by-default on numbers. Proportional digits shift
 column widths as values change, and a dashboard whose numbers jitter while you
 watch reads as unstable even when it is correct.
*/

enum OrionTheme {
    /// The window wash, TRANSLUCENT.
    ///
    /// The revamp made this fully opaque, which flattened the panel into an
    /// ordinary window and lost the floating-glass read the app had. Alpha is
    /// back — the material behind it does the rest — and the cards above are
    /// translucent too so the depth carries all the way through rather than
    /// stopping at the first surface.
    /// Kept for anything that still wants a flat fill. The dashboard itself no
    /// longer uses it — see VisualEffectBackground for why a colour cannot do
    /// this job.
    static let ink = Color(red: 0.031, green: 0.035, blue: 0.047, opacity: 0.62)
    static let card = Color.white.opacity(0.045)
    static let cardRaised = Color.white.opacity(0.075)
    static let line = Color.white.opacity(0.07)

    static let text = Color.white.opacity(0.94)
    static let textSoft = Color.white.opacity(0.62)
    static let textDim = Color.white.opacity(0.38)

    static let green = Color(red: 0.36, green: 0.92, blue: 0.60)
    static let orange = Color(red: 1.00, green: 0.58, blue: 0.20)
    static let red = Color(red: 1.00, green: 0.38, blue: 0.38)
    static let blue = Color(red: 0.36, green: 0.72, blue: 1.00)
    static let violet = Color(red: 0.70, green: 0.52, blue: 1.00)

    /// Section labels, chip values, every number.
    static func mono(_ size: CGFloat, _ weight: Font.Weight = .medium) -> Font {
        .system(size: size, weight: weight, design: .monospaced)
    }
}

/// `— SECTION LABEL`, the backbone of the whole layout.
struct SectionRule: View {
    let title: String
    var trailing: String? = nil

    var body: some View {
        HStack(spacing: 10) {
            Rectangle()
                .fill(OrionTheme.textDim)
                .frame(width: 14, height: 1)
            Text(title.uppercased())
                .font(OrionTheme.mono(9, .semibold))
                .tracking(1.8)
                .foregroundStyle(OrionTheme.textDim)
            Spacer(minLength: 8)
            if let trailing {
                Text(trailing.uppercased())
                    .font(OrionTheme.mono(10, .medium))
                    .tracking(1.2)
                    .foregroundStyle(OrionTheme.textDim)
            }
        }
        .padding(.top, 4)
    }
}

/// A FLOATING tile, not a filled bubble.
///
/// The previous version was an opaque-ish rounded rectangle with a visible
/// fill, and every section on every tab got one — so a screen was a vertical
/// stack of identical grey capsules and nothing had any hierarchy. Uniform
/// containers are the enemy of a dense dashboard: they cost the same vertical
/// space whether they hold one number or twenty rows.
///
/// So: almost no fill, a hairline edge, and a soft drop shadow. The shadow is
/// what does the work — it lifts the content off the glass so a tile reads as
/// hovering rather than as a box drawn on top. Content stays legible because
/// the blur behind is already dark, not because a panel is painted under it.
struct OrionTile<Content: View>: View {
    var padding: CGFloat = 15
    var tint: Color = .clear
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 10) { content }
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background {
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .fill(.white.opacity(0.055))
                    .overlay {
                        RoundedRectangle(cornerRadius: 16, style: .continuous)
                            .fill(tint.opacity(tint == .clear ? 0 : 0.10))
                    }
                    .overlay {
                        RoundedRectangle(cornerRadius: 16, style: .continuous)
                            .strokeBorder(.white.opacity(0.10), lineWidth: 0.5)
                    }
                    // Lift. Without this a translucent tile on a translucent
                    // background has no edge at all and everything melts.
                    .shadow(color: .black.opacity(0.35), radius: 14, y: 6)
            }
    }
}

/// Kept so older call sites still compile; forwards to the floating tile.
struct OrionPanel<Content: View>: View {
    var padding: CGFloat = 15
    @ViewBuilder var content: Content

    var body: some View {
        OrionTile(padding: padding) { content }
    }
}

/// One number, set large, with its unit kept small so the value dominates.
struct BigStat: View {
    let value: String
    var unit: String? = nil
    var caption: String? = nil
    var tint: Color = OrionTheme.text

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            if let caption {
                Text(caption.uppercased())
                    .font(OrionTheme.mono(9, .semibold))
                    .tracking(1.4)
                    .foregroundStyle(OrionTheme.textDim)
            }
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                Text(value)
                    .font(.system(size: 34, weight: .semibold, design: .rounded))
                    .foregroundStyle(tint)
                if let unit {
                    Text(unit)
                        .font(OrionTheme.mono(13))
                        .foregroundStyle(OrionTheme.textDim)
                }
            }
        }
    }
}

/// The arc meter from the reference: a value you read in a glance, not a number
/// you parse. Used for day progress and for recovery.
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
                .stroke(Color.white.opacity(0.08), lineWidth: 9)
            Circle()
                .trim(from: 0, to: clamped)
                .stroke(tint, style: StrokeStyle(lineWidth: 9, lineCap: .round))
                .rotationEffect(.degrees(-90))
                .shadow(color: tint.opacity(0.45), radius: 8)
            VStack(spacing: 1) {
                Text(value)
                    .font(.system(size: diameter * 0.26, weight: .semibold, design: .rounded))
                    .foregroundStyle(OrionTheme.text)
                if let caption {
                    Text(caption.uppercased())
                        .font(OrionTheme.mono(9, .semibold))
                        .tracking(1.3)
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

/// A count against a target, with the "good enough" band marked on the track.
///
/// The marker is the point: a bar alone says how far along you are, but not
/// whether that is fine. The reference labels the band directly on the track,
/// which answers both at once.
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
        VStack(alignment: .leading, spacing: 5) {
            GeometryReader { geometry in
                ZStack(alignment: .leading) {
                    Capsule()
                        .fill(Color.white.opacity(0.08))
                    Capsule()
                        .fill(tint)
                        .frame(width: max(6, geometry.size.width * fraction))
                    // The band sits at 75% of target, which is where "enough
                    // for today" actually begins for every counter here.
                    Rectangle()
                        .fill(OrionTheme.green.opacity(0.5))
                        .frame(width: 1)
                        .offset(x: geometry.size.width * 0.75)
                }
            }
            .frame(height: 10)
            HStack {
                Text("0").font(OrionTheme.mono(9)).foregroundStyle(OrionTheme.textDim)
                Spacer()
                Text(zoneLabel)
                    .font(OrionTheme.mono(9))
                    .foregroundStyle(OrionTheme.green.opacity(0.85))
                Spacer()
                Text("\(target)").font(OrionTheme.mono(9)).foregroundStyle(OrionTheme.textDim)
            }
        }
        .animation(.easeOut(duration: 0.35), value: fraction)
    }
}

/// The compact status chips that run under the header in the reference.
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
                .font(OrionTheme.mono(11, .semibold))
                .foregroundStyle(OrionTheme.text)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 7)
        .background(
            Capsule().fill(OrionTheme.cardRaised)
                .overlay(Capsule().stroke(OrionTheme.line, lineWidth: 1))
        )
    }
}

/// The full-width quick-log row. One per section, and it is the obvious thing
/// to click — the reference's "Drank a bottle ↑".
struct LogButton: View {
    let title: String
    var systemImage: String = "arrow.up"
    var tint: Color = .white
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 7) {
                Spacer()
                Text(title)
                    .font(.system(size: 13, weight: .semibold))
                Image(systemName: systemImage)
                    .font(.system(size: 11, weight: .bold))
                Spacer()
            }
            .padding(.vertical, 11)
            .foregroundStyle(OrionTheme.ink)
            .background(Capsule().fill(tint))
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
    }
}

/// A small square button, for the `−` beside a quick-log row.
struct StepButton: View {
    let systemImage: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .font(.system(size: 12, weight: .bold))
                .foregroundStyle(OrionTheme.textSoft)
                .frame(width: 36, height: 38)
                .background(
                    RoundedRectangle(cornerRadius: 10).fill(OrionTheme.cardRaised)
                        .overlay(RoundedRectangle(cornerRadius: 10).stroke(OrionTheme.line, lineWidth: 1))
                )
                .contentShape(RoundedRectangle(cornerRadius: 10))
        }
        .buttonStyle(.plain)
    }
}

/// A label/value line — the workhorse for subscriptions, stack items, metrics.
struct DataRow: View {
    let label: String
    var sublabel: String? = nil
    let value: String
    var valueTint: Color = OrionTheme.text
    var tickable: Bool = false
    var ticked: Bool = false
    var onTick: (() -> Void)? = nil

    var body: some View {
        HStack(spacing: 11) {
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
            Spacer(minLength: 8)
            Text(value)
                .font(OrionTheme.mono(12, .semibold))
                .foregroundStyle(valueTint)
        }
        .padding(.vertical, 7)
    }
}

/// The one-line "not connected yet" state.
///
/// Worth a named component because six tabs were each explaining their own
/// emptiness in a different paragraph of prose. An empty section should be one
/// quiet line and a way to act, not an essay about the future.
struct NotConnected: View {
    let what: String
    var detail: String? = nil
    var actionTitle: String? = nil
    var action: (() -> Void)? = nil

    var body: some View {
        HStack(spacing: 11) {
            Image(systemName: "link")
                .font(.system(size: 11, weight: .semibold))
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
            Spacer(minLength: 8)
            if let actionTitle, let action {
                Button(action: action) {
                    Text(actionTitle)
                        .font(OrionTheme.mono(10, .semibold))
                        .foregroundStyle(OrionTheme.blue)
                        .padding(.horizontal, 11)
                        .padding(.vertical, 6)
                        .background(Capsule().stroke(OrionTheme.blue.opacity(0.4), lineWidth: 1))
                        .contentShape(Capsule())
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.vertical, 4)
    }
}
