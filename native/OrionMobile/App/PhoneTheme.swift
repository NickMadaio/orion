import SwiftUI
import MobileCore

/*
 The phone's visual language — the Mac app's, carried to a small screen.

 Nick (2026-09-25): the phone UI was "mainly functional without the user in
 mind" and looked terrible next to the Mac app. The Mac's rules apply here too:
 dark, no bubble behind every element, grouping by space, type scale and
 hairlines that fade rather than enclose; one large figure per idea; line-art
 rings instead of filled chrome; mono for labels and every number.
*/
enum Phone {
    /// A colour that is one value in dark mode and another in light.
    static func adaptive(dark: UIColor, light: UIColor) -> Color {
        Color(UIColor { $0.userInterfaceStyle == .dark ? dark : light })
    }
    /// Foreground ink at an opacity: white on dark, black on light. For hairlines and washes.
    static func wash(_ opacity: Double) -> Color {
        adaptive(dark: UIColor.white.withAlphaComponent(opacity), light: UIColor.black.withAlphaComponent(opacity))
    }

    // Calm, near-black in dark mode (first), warm off-white in light.
    static let ink = adaptive(dark: UIColor(red: 0.035, green: 0.04, blue: 0.05, alpha: 1),
                              light: UIColor(red: 0.975, green: 0.975, blue: 0.97, alpha: 1))
    static let text = adaptive(dark: UIColor.white.withAlphaComponent(0.92), light: UIColor.black.withAlphaComponent(0.88))
    static let soft = wash(0.62)
    static let dim = wash(0.40)
    static let hairline = wash(0.09)

    // One accent: ORION's cyan, a touch calmer. The rest only mark status.
    // The same hues as Home's cards (PhoneHomeHue), so every screen reads as one app.
    static let accent = adaptive(dark: UIColor(red: 79 / 255, green: 184 / 255, blue: 1, alpha: 1),
                                 light: UIColor(red: 0.04, green: 0.50, blue: 0.70, alpha: 1))
    static let green = Color(red: 0.36, green: 0.92, blue: 0.60)
    static let orange = Color(red: 1.00, green: 0.58, blue: 0.20)
    static let violet = accent
    static let purple = Color(red: 0.70, green: 0.52, blue: 1.00)
    static let red = Color(red: 0.95, green: 0.36, blue: 0.36)
    static let sleep = Color(red: 0.58, green: 0.62, blue: 1.00)
    static let yellow = Color(red: 1.00, green: 0.84, blue: 0.30)

    static func mono(_ size: CGFloat, _ weight: Font.Weight = .semibold) -> Font {
        .system(size: size, weight: weight, design: .monospaced)
    }
    static func display(_ size: CGFloat, _ weight: Font.Weight = .semibold) -> Font {
        .system(size: size, weight: weight, design: .serif)
    }

    static func greeting(at date: Date = Date()) -> String {
        switch Calendar.current.component(.hour, from: date) {
        case 5..<12: return "Good morning"
        case 12..<18: return "Good afternoon"
        case 18..<23: return "Good evening"
        default: return "Up late"
        }
    }
}

/// The screen behind everything: Home's near-black ink with one faint pool of light. Static.
struct PhoneBackdrop: View {
    var tint: Color = Phone.accent
    @Environment(\.colorScheme) private var scheme
    var body: some View {
        let dark = scheme == .dark
        ZStack {
            Phone.ink
            RadialGradient(colors: [tint.opacity(dark ? 0.07 : 0.04), .clear], center: UnitPoint(x: 0.3, y: 0.2),
                           startRadius: 10, endRadius: 360)
            RadialGradient(colors: [Phone.purple.opacity(dark ? 0.05 : 0.03), .clear], center: UnitPoint(x: 0.85, y: 0.7),
                           startRadius: 10, endRadius: 280)
        }
        .ignoresSafeArea()
    }
}

/// A screen's own header: a mono date line and one large title. The navigation
/// bar's large title is replaced, not doubled.
struct PhoneHeader: View {
    let eyebrow: String
    let title: String
    var tint: Color = Phone.dim
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            // Displayed in caps; read (and matched by UI tests) as written.
            Text(eyebrow).textCase(.uppercase).font(Phone.mono(10.5)).tracking(2.2).foregroundStyle(tint)
                .lineLimit(2).fixedSize(horizontal: false, vertical: true)
            Text(title).font(.system(size: 34, weight: .regular, design: .serif)).foregroundStyle(Phone.text)
                .lineLimit(2).minimumScaleFactor(0.8).accessibilityAddTraits(.isHeader)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .softReveal(true, rise: 10)
    }
}

/// A section label with a rule that fades out — separates without enclosing.
struct SectionLabel: View {
    let text: String
    var tint: Color = Phone.dim
    init(_ text: String, tint: Color = Phone.dim) { self.text = text; self.tint = tint }
    var body: some View {
        HStack(spacing: 10) {
            Text(text).textCase(.uppercase).font(Phone.mono(10)).tracking(2.2).foregroundStyle(tint).lineLimit(1).minimumScaleFactor(0.7)
            LinearGradient(colors: [Phone.hairline, .clear], startPoint: .leading, endPoint: .trailing).frame(height: 1)
        }
        .accessibilityAddTraits(.isHeader)
    }
}

/// A line-art ring around a symbol. Breathes when `live`.
struct PhoneRing: View {
    let symbol: String
    var tint: Color = Phone.accent
    var size: CGFloat = 64
    var live = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        TimelineView(.animation(paused: !live || reduceMotion)) { context in
            let breath = live ? (sin(context.date.timeIntervalSinceReferenceDate * 1.6) + 1) / 2 : 0.4
            ZStack {
                Circle().fill(tint.opacity(0.10 + 0.12 * breath)).blur(radius: size * 0.3)
                Circle().stroke(tint.opacity(0.45), lineWidth: 1.2)
                Image(systemName: symbol).font(.system(size: size * 0.36, weight: .light)).foregroundStyle(tint)
            }
            .frame(width: size, height: size)
        }
        .accessibilityHidden(true)
    }
}

/// Glow-rim outline capsule (Home's pill); the prominent one glows more. Sinks when pressed, 44pt tall at least.
struct PhoneButtonStyle: ButtonStyle {
    var tint: Color = Phone.accent
    var prominent = false
    @Environment(\.isEnabled) private var enabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 15, weight: .semibold))
            .padding(.horizontal, 20).frame(minHeight: 44)
            .foregroundStyle(enabled ? Phone.text : Phone.dim)
            .background(Capsule().fill(tint.opacity(enabled ? (prominent ? 0.14 : 0.07) : 0)))
            .overlay { Capsule().strokeBorder(tint.opacity(enabled ? 0.75 : 0.18), lineWidth: 1) }
            .shadow(color: tint.opacity(enabled ? (prominent ? 0.4 : 0.22) : 0), radius: prominent ? 12 : 7)
            .contentShape(Capsule())
            .scaleEffect(configuration.isPressed ? 0.96 : 1)
            .opacity(configuration.isPressed ? 0.8 : 1)
            .animation(PhoneMotion.press, value: configuration.isPressed)
    }
}

/// A thin tinted outline card, like Home's, with an optional small tilt. Use only where Home would.
struct PhoneCard<Content: View>: View {
    var tint: Color = Phone.accent
    var tilt: Double = 0
    @ViewBuilder let content: () -> Content
    var body: some View {
        let shape = RoundedRectangle(cornerRadius: 20, style: .continuous)
        content()
            .padding(.horizontal, 18).padding(.vertical, 16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(shape.fill(LinearGradient(colors: [Phone.wash(0.045), Phone.wash(0.01)], startPoint: .top, endPoint: .bottom)))
            .overlay(shape.strokeBorder(LinearGradient(colors: [tint.opacity(0.45), Phone.wash(0.09), tint.opacity(0.18)],
                                                       startPoint: .topLeading, endPoint: .bottomTrailing), lineWidth: 0.9))
            .rotationEffect(.degrees(tilt))
    }
}

/// A ring with one figure inside and a mono caps label under it: the phone's stand-in for a progress bar.
struct PhoneGauge: View {
    let label: String
    let figure: String
    let fraction: Double?
    var unit: String? = nil
    var tint: Color = Phone.accent
    var size: CGFloat = 92
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        VStack(spacing: 10) {
            ZStack {
                Circle().stroke(Phone.wash(0.08), lineWidth: 5)
                Circle().trim(from: 0, to: CGFloat(RingMath.clamp(fraction ?? 0)))
                    .stroke(tint, style: StrokeStyle(lineWidth: 5, lineCap: .round))
                    .rotationEffect(.degrees(-90)).shadow(color: tint.opacity(0.4), radius: 5)
                VStack(spacing: 0) {
                    Text(figure).font(.system(size: size * 0.30, weight: .regular, design: .serif)).foregroundStyle(Phone.text)
                        .minimumScaleFactor(0.6).lineLimit(1)
                    if let unit { Text(unit).font(Phone.mono(9, .medium)).tracking(1).foregroundStyle(Phone.dim) }
                }
                .padding(.horizontal, 8)
            }
            .frame(width: size, height: size)
            Text(label).textCase(.uppercase).font(Phone.mono(9.5)).tracking(2).foregroundStyle(tint).lineLimit(1).minimumScaleFactor(0.7)
        }
        .animation(PhoneMotion.spring(PhoneMotion.enter, reduce: reduceMotion), value: fraction)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(label), \(figure)\(unit.map { " " + $0 } ?? "")")
    }
}

/// A small status line with a dot: connection, freshness, sample.
struct StatusDot: View {
    let text: String
    var tint: Color = Phone.dim
    /// Goes on the TEXT, so UI tests still find it as static text.
    var identifier: String? = nil
    var body: some View {
        HStack(spacing: 8) {
            Circle().fill(tint).frame(width: 6, height: 6).accessibilityHidden(true)
            Text(text).font(.system(size: 13, weight: .medium)).foregroundStyle(Phone.soft)
                .accessibilityIdentifier(identifier ?? "")
        }
    }
}

/// One idea, one large figure.
struct PhoneStat: View {
    let label: String
    let value: String
    var detail: String? = nil
    var tint: Color = Phone.text
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label).textCase(.uppercase).font(Phone.mono(10)).tracking(2).foregroundStyle(Phone.dim)
            Text(value).font(Phone.display(26, .regular)).foregroundStyle(tint).fixedSize(horizontal: false, vertical: true)
            if let detail { Text(detail).font(.system(size: 13)).foregroundStyle(Phone.soft) }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

/// An empty screen that says what will be here and why it is not yet.
struct PhoneEmptyState: View {
    let symbol: String
    let title: String
    let detail: String
    var tint: Color = Phone.accent
    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            PhoneRing(symbol: symbol, tint: tint, size: 72, live: false)
            Text(title).font(Phone.display(22, .regular)).foregroundStyle(Phone.text)
            Text(detail).font(.system(size: 15)).foregroundStyle(Phone.soft).lineSpacing(3)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

/// One entry on the day's timeline: time, a dot on a line, the block.
struct TimelineRow: View {
    let time: String
    let title: String
    let detail: String
    let tint: Color
    var isLast = false
    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            Text(time).font(Phone.mono(12, .medium)).foregroundStyle(Phone.dim).frame(width: 46, alignment: .leading)
                .padding(.top, 2)
            VStack(spacing: 0) {
                Circle().stroke(tint, lineWidth: 1.6).background(Circle().fill(tint.opacity(0.25))).frame(width: 11, height: 11)
                    .padding(.top, 4)
                if !isLast { Rectangle().fill(Phone.hairline).frame(width: 1).frame(maxHeight: .infinity) }
            }
            VStack(alignment: .leading, spacing: 4) {
                Text(title).font(.system(size: 16, weight: .semibold)).foregroundStyle(Phone.text)
                Text(detail).font(.system(size: 13)).foregroundStyle(Phone.soft)
            }
            .padding(.bottom, isLast ? 0 : 22)
            Spacer(minLength: 0)
        }
        .fixedSize(horizontal: false, vertical: true)
        .accessibilityElement(children: .combine)
    }
}

extension View {
    /// Screen chrome shared by every tab: the backdrop, dark scheme, no system bar title.
    func phoneScreen() -> some View {
        self
            .scrollContentBackground(.hidden)
            .background(PhoneBackdrop())
            .toolbar(.hidden, for: .navigationBar)
    }
}

/// A secondary screen shown over the chat: its own navigation stack and a quiet close button.
struct PhoneSheetFrame<Content: View>: View {
    let close: () -> Void
    @ViewBuilder let content: () -> Content
    var body: some View {
        NavigationStack { content() }
            .overlay(alignment: .topTrailing) {
                Button(action: close) {
                    Image(systemName: "xmark").font(.system(size: 14, weight: .semibold)).foregroundStyle(Phone.soft)
                        .frame(width: 44, height: 44).contentShape(Rectangle())
                }
                .padding(.top, 6).padding(.trailing, 8)
                .accessibilityLabel("Close").accessibilityIdentifier("closeSheet")
            }
            .background(Phone.ink.ignoresSafeArea())
    }
}


/// The bottom tab bar, in Home's language: near-black, one thin hairline on top, mono caps labels, the blue accent on
/// the selected tab, and 56pt targets. Each tab is a full screen; nothing is a pop-up.
struct PhoneTabBar: View {
    @Binding var selection: PhoneTab
    /// Tabs that need a look (approvals waiting on More).
    var badges: [PhoneTab: Int] = [:]
    /// The selected tab's colour: ORION's blue, or the focus hue while a session runs.
    var accent: Color = Phone.accent

    var body: some View {
        HStack(spacing: 0) {
            ForEach(PhoneTab.allCases, id: \.self) { tab in item(tab) }
        }
        .padding(.top, 2)
        .background(Phone.ink.ignoresSafeArea(edges: .bottom))
        .overlay(alignment: .top) { Rectangle().fill(Phone.hairline).frame(height: 1) }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("phoneTabBar")
    }

    private func item(_ tab: PhoneTab) -> some View {
        let selected = selection == tab
        return Button { if !selected { selection = tab } } label: {
            VStack(spacing: 5) {
                ZStack(alignment: .topTrailing) {
                    Image(systemName: Self.symbol(tab, selected: selected)).font(.system(size: 19, weight: .light))
                    if let count = badges[tab], count > 0 {
                        Circle().fill(Phone.orange).frame(width: 7, height: 7).offset(x: 5, y: -1)
                    }
                }
                Text(tab.title.uppercased()).font(Phone.mono(9, .medium)).tracking(1.6)
            }
            .foregroundStyle(selected ? accent : Phone.dim)
            .frame(maxWidth: .infinity, minHeight: 56)
            .contentShape(Rectangle())
        }
        .buttonStyle(PhonePressStyle())
        .accessibilityLabel(tab.title)
        .accessibilityAddTraits(selected ? [.isButton, .isSelected] : .isButton)
        .accessibilityIdentifier("tab-\(tab.rawValue)")
    }

    static func symbol(_ tab: PhoneTab, selected: Bool) -> String {
        switch tab {
        case .home: return selected ? "house.fill" : "house"
        case .plan: return "calendar"
        case .health: return selected ? "heart.fill" : "heart"
        case .lists: return "checklist"
        case .more: return "ellipsis"
        }
    }
}
