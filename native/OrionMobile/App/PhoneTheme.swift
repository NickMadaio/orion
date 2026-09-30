import SwiftUI

/*
 The phone's visual language — the Mac app's, carried to a small screen.

 Nick (2026-09-25): the phone UI was "mainly functional without the user in
 mind" and looked terrible next to the Mac app. The Mac's rules apply here too:
 dark, no bubble behind every element, grouping by space, type scale and
 hairlines that fade rather than enclose; one large figure per idea; line-art
 rings instead of filled chrome; mono for labels and every number.
*/
enum Phone {
    static let ink = Color(red: 0.035, green: 0.04, blue: 0.056)
    static let text = Color.white.opacity(0.94)
    static let soft = Color.white.opacity(0.62)
    static let dim = Color.white.opacity(0.38)
    static let hairline = Color.white.opacity(0.08)

    // The Mac's palette, so the two apps read as one product.
    static let accent = Color(red: 0.18, green: 0.83, blue: 1.00)
    static let green = Color(red: 0.36, green: 0.92, blue: 0.60)
    static let orange = Color(red: 1.00, green: 0.58, blue: 0.20)
    static let violet = Color(red: 0.70, green: 0.52, blue: 1.00)
    static let red = Color(red: 1.00, green: 0.38, blue: 0.38)

    static func mono(_ size: CGFloat, _ weight: Font.Weight = .semibold) -> Font {
        .system(size: size, weight: weight, design: .monospaced)
    }
    static func display(_ size: CGFloat, _ weight: Font.Weight = .semibold) -> Font {
        .system(size: size, weight: weight, design: .rounded)
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

/// The screen behind everything: ink, with the accent glowing faintly from the top.
struct PhoneBackdrop: View {
    var tint: Color = Phone.accent
    var body: some View {
        ZStack {
            Phone.ink
            RadialGradient(colors: [tint.opacity(0.16), .clear], center: .topLeading, startRadius: 0, endRadius: 420)
            RadialGradient(colors: [Phone.violet.opacity(0.07), .clear], center: .bottomTrailing, startRadius: 0, endRadius: 380)
        }
        .ignoresSafeArea()
    }
}

/// A screen's own header: a mono date line and one large title. The navigation
/// bar's large title is replaced, not doubled.
struct PhoneHeader: View {
    let eyebrow: String
    let title: String
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            // Displayed in caps; read (and matched by UI tests) as written.
            Text(eyebrow).textCase(.uppercase).font(Phone.mono(11)).tracking(1.6).foregroundStyle(Phone.dim)
            Text(title).font(Phone.display(34, .bold)).foregroundStyle(Phone.text).accessibilityAddTraits(.isHeader)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// A section label with a rule that fades out — separates without enclosing.
struct SectionLabel: View {
    let text: String
    var tint: Color = Phone.dim
    init(_ text: String, tint: Color = Phone.dim) { self.text = text; self.tint = tint }
    var body: some View {
        HStack(spacing: 10) {
            Text(text).textCase(.uppercase).font(Phone.mono(10)).tracking(1.6).foregroundStyle(tint)
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

/// Outline capsule; the prominent one glows. Sinks when pressed.
struct PhoneButtonStyle: ButtonStyle {
    var tint: Color = Phone.accent
    var prominent = false
    @Environment(\.isEnabled) private var enabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 15, weight: .semibold, design: .rounded))
            .padding(.horizontal, 20).padding(.vertical, 12)
            .foregroundStyle(enabled ? (prominent ? Color.white : tint) : Phone.dim)
            .background {
                Capsule().fill(LinearGradient(colors: [tint.opacity(prominent ? 0.32 : 0.05), tint.opacity(prominent ? 0.10 : 0)],
                                              startPoint: .topLeading, endPoint: .bottomTrailing))
            }
            .overlay { Capsule().stroke(tint.opacity(enabled ? 0.6 : 0.15), lineWidth: 1.1) }
            .shadow(color: tint.opacity(enabled && prominent ? 0.35 : 0), radius: 12)
            .scaleEffect(configuration.isPressed ? 0.96 : 1)
            .animation(.spring(response: 0.22, dampingFraction: 0.6), value: configuration.isPressed)
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
            Text(label).textCase(.uppercase).font(Phone.mono(10)).tracking(1.4).foregroundStyle(Phone.dim)
            Text(value).font(Phone.display(26)).foregroundStyle(tint).fixedSize(horizontal: false, vertical: true)
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
            Text(title).font(Phone.display(22)).foregroundStyle(Phone.text)
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
