import MobileCore
import SwiftUI

/*
 The pieces of the phone Home, in the Mac Home's language at phone size: a thin tinted outline card on the backdrop
 with a faint inner gradient, a coloured mono kicker, a serif sentence and a glowing outline pill. No heavy fills.
 Colours follow the colour scheme, because the phone has a light appearance too.
*/

/// Home's inks for the current scheme.
struct PhoneHomeInk {
    let dark: Bool
    init(_ scheme: ColorScheme) { dark = scheme == .dark }
    private func wash(_ opacity: Double) -> Color { dark ? Color.white.opacity(opacity) : Color.black.opacity(opacity * 0.95) }
    var text: Color { wash(0.93) }
    var soft: Color { wash(0.62) }
    var dim: Color { wash(0.40) }
    var faint: Color { wash(0.09) }
    var ground: Color { dark ? Color(red: 0.035, green: 0.04, blue: 0.05) : Color(red: 0.975, green: 0.975, blue: 0.97) }
}

/// One hue per card, as on the Mac (HomeCardStyle).
enum PhoneHomeHue {
    static let event = Color(red: 0.36, green: 0.72, blue: 1.00)
    static let question = Color(red: 0.70, green: 0.52, blue: 1.00)
    static let approval = Color(red: 1.00, green: 0.58, blue: 0.20)
    static let done = Color(red: 0.36, green: 0.92, blue: 0.60)
    static let water = Color(red: 79 / 255, green: 184 / 255, blue: 255 / 255)
    static let sleep = Color(red: 0.58, green: 0.62, blue: 1.00)
    /// Blue Orion's #4FB8FF, the hologram's main stroke.
    static let accent = Color(red: 79 / 255, green: 184 / 255, blue: 255 / 255)
}

/// The tilted outline card: kicker, serif title, a line or two, then whatever actions the card carries.
struct PhoneHomeCard<Actions: View>: View {
    let hue: Color
    let kicker: [String]
    let title: String
    var lines: [String] = []
    var tilt: Double = 0
    @ViewBuilder var actions: () -> Actions
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let ink = PhoneHomeInk(scheme)
        VStack(alignment: .leading, spacing: 0) {
            Text(PhoneHome.kickerText(kicker))
                .font(.system(size: 9.5, weight: .semibold, design: .monospaced)).tracking(2.2)
                .foregroundStyle(hue).lineLimit(1).minimumScaleFactor(0.7).padding(.bottom, 10)
            Text(title)
                .font(.system(size: 21, design: .serif)).foregroundStyle(ink.text)
                .lineLimit(4).fixedSize(horizontal: false, vertical: true)
                .padding(.bottom, lines.isEmpty ? 16 : 8)
            if !lines.isEmpty {
                VStack(alignment: .leading, spacing: 3) {
                    ForEach(lines, id: \.self) { line in
                        Text(line).font(.system(size: 13.5)).foregroundStyle(ink.soft).lineSpacing(2)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .padding(.bottom, 16)
            }
            actions()
        }
        .padding(.horizontal, 20).padding(.vertical, 18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(surface(ink))
        .rotationEffect(.degrees(tilt))
        .accessibilityElement(children: .contain)
    }

    private func surface(_ ink: PhoneHomeInk) -> some View {
        let shape = RoundedRectangle(cornerRadius: 20, style: .continuous)
        return shape.fill(ink.ground.opacity(0.4))
            .overlay(shape.fill(LinearGradient(colors: [ink.faint.opacity(0.5), ink.faint.opacity(0.08)], startPoint: .top, endPoint: .bottom)))
            .overlay(shape.strokeBorder(LinearGradient(colors: [hue.opacity(0.45), ink.faint, hue.opacity(0.18)],
                                                       startPoint: .topLeading, endPoint: .bottomTrailing), lineWidth: 0.9))
            .shadow(color: hue.opacity(ink.dark ? 0.08 : 0.04), radius: 14, y: 6)
    }
}

/// The glow-rim pill (the Mac's GlowPill at phone size). Sinks a touch when pressed.
struct PhoneHomePill: View {
    let title: String
    var hue: Color = PhoneHomeHue.accent
    var symbol: String = "sparkle"
    var working = false
    var large = false
    let action: () -> Void
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                if working { ProgressView().controlSize(.small).tint(hue) }
                else { Image(systemName: symbol).font(.system(size: large ? 13 : 10.5, weight: .semibold)) }
                Text(title).font(.system(size: large ? 15.5 : 13, weight: .semibold))
            }
            .foregroundStyle(PhoneHomeInk(scheme).text)
            .padding(.horizontal, large ? 22 : 15).padding(.vertical, large ? 13 : 9)
            .background(Capsule().fill(hue.opacity(large ? 0.14 : 0.09)))
            .overlay(Capsule().strokeBorder(hue.opacity(0.75), lineWidth: 1))
            .shadow(color: hue.opacity(large ? 0.45 : 0.3), radius: large ? 12 : 7)
            .contentShape(Capsule())
        }
        .buttonStyle(HomePressStyle())
    }
}

/// The quiet text action beside a pill ("Not now", "Deny").
struct PhoneHomeLink: View {
    let title: String
    let action: () -> Void
    @Environment(\.colorScheme) private var scheme
    var body: some View {
        Button(action: action) {
            Text(title).font(.system(size: 13, weight: .medium)).foregroundStyle(PhoneHomeInk(scheme).soft)
                .padding(.vertical, 8).contentShape(Rectangle())
        }
        .buttonStyle(HomePressStyle())
    }
}

struct HomePressStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.96 : 1)
            .opacity(configuration.isPressed ? 0.75 : 1)
            .animation(.easeOut(duration: 0.18), value: configuration.isPressed)
    }
}

/// The glance row: mono caps label, a brighter value, fading hairlines between. Water carries a +1.
struct PhoneHomeGlanceRow: View {
    let items: [PhoneHome.GlanceItem]
    let onAddWater: () -> Void
    var onSetWaterGoal: (Int) -> Void = { _ in }
    let onOpen: (PhoneHome.GlanceItem.Kind) -> Void
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let ink = PhoneHomeInk(scheme)
        HStack(spacing: 0) {
            ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
                if index > 0 {
                    Rectangle().fill(LinearGradient(colors: [.clear, ink.dim.opacity(0.6), .clear], startPoint: .top, endPoint: .bottom))
                        .frame(width: 1, height: 22).padding(.horizontal, 12)
                }
                cell(item, ink: ink)
            }
            Spacer(minLength: 0)
        }
    }

    @ViewBuilder
    private func cell(_ item: PhoneHome.GlanceItem, ink: PhoneHomeInk) -> some View {
        if item.kind == .water, let goal = item.goal {
            cellBody(item, ink: ink).waterGoalMenu(goal: goal, onChange: onSetWaterGoal)
        } else {
            cellBody(item, ink: ink)
        }
    }

    private func cellBody(_ item: PhoneHome.GlanceItem, ink: PhoneHomeInk) -> some View {
        HStack(spacing: 8) {
            Button { onOpen(item.kind) } label: {
                VStack(alignment: .leading, spacing: 3) {
                    Text(item.label).font(.system(size: 8.5, weight: .semibold, design: .monospaced)).tracking(2.2).foregroundStyle(ink.dim)
                    Text(item.value).font(.system(size: 12, design: .monospaced)).foregroundStyle(ink.text.opacity(0.8))
                        .lineLimit(1).minimumScaleFactor(0.8)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(HomePressStyle())
            .accessibilityLabel("\(item.label.capitalized): \(item.value)")
            if item.kind == .water {
                Button(action: onAddWater) {
                    Text("+1").font(.system(size: 11, weight: .semibold, design: .monospaced)).foregroundStyle(ink.text)
                        .frame(width: 30, height: 30)
                        .overlay(Circle().strokeBorder(PhoneHomeHue.water.opacity(0.7), lineWidth: 1))
                        .shadow(color: PhoneHomeHue.water.opacity(0.35), radius: 6)
                        .contentShape(Circle())
                }
                .buttonStyle(HomePressStyle())
                .accessibilityLabel("Add a bottle of water")
                .accessibilityIdentifier("homeAddWater")
            }
        }
    }
}

/// The Done early pill, in the glance row's language: a quiet outline pill that asks first (the caller confirms).
struct PhoneHomeDoneEarlyPill: View {
    var working = false
    let hint: String
    let action: () -> Void
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let ink = PhoneHomeInk(scheme)
        Button(action: action) {
            HStack(spacing: 8) {
                if working { ProgressView().controlSize(.small).tint(PhoneHomeHue.done) }
                else { Image(systemName: DoneEarly.symbol).font(.system(size: 13, weight: .regular)) }
                Text(DoneEarly.label.uppercased()).font(.system(size: 9.5, weight: .semibold, design: .monospaced)).tracking(2.2)
            }
            .foregroundStyle(ink.text.opacity(0.85))
            .padding(.horizontal, 14).frame(height: 44)
            .overlay(Capsule().strokeBorder(PhoneHomeHue.done.opacity(0.7), lineWidth: 1))
            .shadow(color: PhoneHomeHue.done.opacity(0.28), radius: 6)
            .contentShape(Capsule())
        }
        .buttonStyle(HomePressStyle())
        .disabled(working)
        .accessibilityLabel(DoneEarly.label)
        .accessibilityHint(hint)
        .accessibilityIdentifier("homeDoneEarly")
    }
}
