import SwiftUI
import WidgetKit
import MobileCore

/*
 ORION's widgets, on the Mac and the iPhone (2026-09-29).

 The apps' visual language, carried to the home screen: ink, one glowing tint,
 mono labels in caps, rounded display figures, hairlines that fade instead of
 boxes. The hologram is the real one — stills rendered from the Mac app's
 HologramModel and black-hole study, one per mood — because a widget cannot
 animate and a drawn imitation would look like one.
*/
enum W {
    static let ink = Color(red: 0.035, green: 0.04, blue: 0.056)
    static let text = Color.white.opacity(0.94)
    static let soft = Color.white.opacity(0.62)
    static let dim = Color.white.opacity(0.38)
    static let hairline = Color.white.opacity(0.09)

    static let accent = Color(red: 0.18, green: 0.83, blue: 1.00)
    static let green = Color(red: 0.36, green: 0.92, blue: 0.60)
    static let orange = Color(red: 1.00, green: 0.58, blue: 0.20)
    static let violet = Color(red: 0.70, green: 0.52, blue: 1.00)
    static let red = Color(red: 1.00, green: 0.38, blue: 0.38)
    static let gold = Color(red: 1.00, green: 0.74, blue: 0.36)

    static func mono(_ size: CGFloat, _ weight: Font.Weight = .semibold) -> Font {
        .system(size: size, weight: weight, design: .monospaced)
    }
    static func display(_ size: CGFloat, _ weight: Font.Weight = .semibold) -> Font {
        .system(size: size, weight: weight, design: .rounded)
    }

    /// Classes are ORION's cyan, plans with people violet, study green, ORION's own blocks orange.
    static func tint(_ kind: String) -> Color {
        switch kind {
        case "class": return accent
        case "social": return violet
        case "study": return green
        case "orion": return orange
        case "sleep": return accent.opacity(0.6)
        default: return soft
        }
    }

    static func tint(_ mood: OrionGlance.Mood) -> Color {
        switch mood {
        case .calm: return gold
        case .focus: return violet
        case .asking: return accent
        case .alert: return red
        case .night: return accent.opacity(0.7)
        }
    }

    static func moodLabel(_ mood: OrionGlance.Mood) -> String {
        switch mood {
        case .calm: return "At rest"
        case .focus: return "On it"
        case .asking: return "Waiting on you"
        case .alert: return "Chasing you"
        case .night: return "Night watch"
        }
    }

    static func clock(_ date: Date) -> String { OrionGlance.clock(date) }
    static func duration(_ seconds: TimeInterval) -> String { OrionGlance.duration(seconds) }

    /// Where a tap goes. The Mac's ORION app and the iPhone app both handle orion://show/<tab>.
    static func link(_ tab: String) -> URL { URL(string: "orion://show/\(tab)")! }
}

/// The ink, with the mood's tint glowing from one corner.
struct WidgetBackdrop: View {
    var tint: Color = W.accent
    var body: some View {
        ZStack {
            W.ink
            RadialGradient(colors: [tint.opacity(0.20), .clear], center: .topLeading, startRadius: 0, endRadius: 260)
            RadialGradient(colors: [W.violet.opacity(0.07), .clear], center: .bottomTrailing, startRadius: 0, endRadius: 240)
        }
    }
}

extension View {
    /// Every widget's background; the lock screen draws its own.
    func orionBackground(_ tint: Color = W.accent) -> some View {
        containerBackground(for: .widget) { WidgetBackdrop(tint: tint) }
    }
}

/// A mono label in caps with a rule that fades out.
struct Eyebrow: View {
    let text: String
    var tint: Color = W.dim
    var rule = true
    init(_ text: String, tint: Color = W.dim, rule: Bool = true) { self.text = text; self.tint = tint; self.rule = rule }
    var body: some View {
        HStack(spacing: 6) {
            Text(text).textCase(.uppercase).font(W.mono(9)).tracking(1.4).foregroundStyle(tint).lineLimit(1)
            if rule {
                LinearGradient(colors: [W.hairline, .clear], startPoint: .leading, endPoint: .trailing).frame(height: 1)
            }
        }
    }
}

/// The hologram still for a mood: the gold shell, or the event horizon.
struct HologramArt: View {
    enum Style { case shell, horizon }
    let mood: OrionGlance.Mood
    var style: Style = .shell
    /// Small, zoomed-in stills for the lock screen and Dynamic Island: at 60 pt
    /// the full frame shrinks to a faint disc, and Live Activities limit image size.
    var mini = false

    var name: String {
        switch style {
        case .shell:
            switch mood {
            case .calm: return "holo-idle"
            case .focus: return "holo-thinking"
            case .asking: return "holo-listening"
            case .alert: return "holo-alert"
            case .night: return "hole-idle"
            }
        case .horizon:
            switch mood {
            case .calm, .night: return "hole-idle"
            case .focus: return "hole-thinking"
            case .asking, .alert: return "hole-speaking"
            }
        }
    }

    var body: some View {
        Image(mini ? name + "-mini" : name)
            .resizable()
            .interpolation(.high)
            .scaledToFill()
            // The stills are square on ink; fading the edge lets the glow sit on the widget's own backdrop.
            .mask(EllipticalGradient(stops: [.init(color: .black, location: 0.62), .init(color: .clear, location: 1)],
                                     center: .center, startRadiusFraction: 0, endRadiusFraction: 0.5))
            .accessibilityHidden(true)
    }
}

/// A thin ring: the lock screen's and the rings widget's one shape.
struct Ring: View {
    let value: Double
    var tint: Color = W.accent
    var width: CGFloat = 4
    var body: some View {
        ZStack {
            Circle().stroke(tint.opacity(0.16), lineWidth: width)
            Circle().trim(from: 0, to: max(0.001, min(1, value)))
                .stroke(tint, style: StrokeStyle(lineWidth: width, lineCap: .round))
                .rotationEffect(.degrees(-90))
        }
    }
}

/// How far through the block on now: drawn from the timeline entry's moment,
/// so it is exact at every redraw (every quarter hour and at each edge).
struct TimeBar: View {
    let value: Double
    var tint: Color = W.accent
    var body: some View {
        GeometryReader { proxy in
            ZStack(alignment: .leading) {
                Capsule().fill(tint.opacity(0.16))
                Capsule().fill(tint).frame(width: max(4, proxy.size.width * CGFloat(min(1, max(0, value)))))
            }
        }
        .frame(height: 4)
    }
}

/// One row of a schedule: time, a tint bar, the title.
struct BlockRow: View {
    let block: OrionGlance.Block
    let now: Date
    var compact = false
    var body: some View {
        let on = block.start <= now && now < block.end
        HStack(alignment: .center, spacing: 8) {
            Text(W.clock(block.start)).font(W.mono(compact ? 10 : 11, .medium))
                .foregroundStyle(on ? W.text : W.soft).frame(width: compact ? 36 : 40, alignment: .leading)
            RoundedRectangle(cornerRadius: 1.5).fill(W.tint(block.kind)).frame(width: 3, height: compact ? 14 : 18)
                .opacity(block.end < now ? 0.35 : 1)
            Text(block.title).font(.system(size: compact ? 12 : 13, weight: on ? .semibold : .regular))
                .foregroundStyle(on ? W.text : W.soft).lineLimit(1)
            Spacer(minLength: 0)
            if on {
                Text(W.duration(block.end.timeIntervalSince(now))).font(W.mono(9)).foregroundStyle(W.tint(block.kind))
            } else if !compact {
                Text("\(block.minutes)m").font(W.mono(9, .regular)).foregroundStyle(W.dim)
            }
        }
    }
}

/// When there is no glance yet: say so, and where to fix it.
struct NotConnected: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Eyebrow("ORION", tint: W.accent)
            Spacer(minLength: 0)
            Text("Open ORION once").font(W.display(15, .bold)).foregroundStyle(W.text)
            Text("Widgets fill in after the app has run.").font(.system(size: 11)).foregroundStyle(W.soft)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }
}
