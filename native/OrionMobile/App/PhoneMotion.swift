import SwiftUI

/*
 The phone's motion vocabulary (wave 12): one set of springs, one press feel,
 one soft entrance, and one ambient clock. Values are timings and constants
 only (high damping, scale 0.96, ease-out 0.18); nothing here bounces.
*/
enum PhoneMotion {
    /// Entrances and scroll-to-bottom.
    static let enter = Animation.spring(response: 0.45, dampingFraction: 0.92)
    /// The drawer settling after a release.
    static let drawer = Animation.spring(response: 0.38, dampingFraction: 0.9)
    /// The reduced-motion stand-in for any spring.
    static let reduced = Animation.easeOut(duration: 0.14)
    static let press = Animation.easeOut(duration: 0.18)

    static func spring(_ animation: Animation, reduce: Bool) -> Animation { reduce ? reduced : animation }
}

/// Press feedback for plain buttons: sinks a little and dims, no bounce.
struct PhonePressStyle: ButtonStyle {
    var scale: CGFloat = 0.96
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? scale : 1)
            .opacity(configuration.isPressed ? 0.7 : 1)
            .animation(PhoneMotion.press, value: configuration.isPressed)
    }
}

/// A new line arriving: fades up from slightly below, un-blurring as it settles.
/// `rise` is how far it travels (a sent message travels further, from the composer).
struct SoftReveal: ViewModifier {
    let enabled: Bool
    var rise: CGFloat = 14
    @State private var shown = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        let settled = shown || !enabled
        content
            .opacity(settled ? 1 : 0)
            .scaleEffect(settled || reduceMotion ? 1 : 0.97, anchor: .bottomLeading)
            .offset(y: settled || reduceMotion ? 0 : rise)
            .blur(radius: settled || reduceMotion ? 0 : 7)
            .onAppear {
                guard enabled, !shown else { return }
                withAnimation(PhoneMotion.spring(PhoneMotion.enter, reduce: reduceMotion)) { shown = true }
            }
    }
}

extension View {
    func softReveal(_ enabled: Bool, rise: CGFloat = 14) -> some View { modifier(SoftReveal(enabled: enabled, rise: rise)) }
}

/// Elapsed ambient time that stops while paused and resumes from the same
/// phase, so a returning app does not jump. A reference type on purpose: it is
/// read inside a `TimelineView` closure and must not publish per frame.
final class AmbientPhase {
    private var offset: TimeInterval = 0
    private var pausedAt: Date?

    func time(at date: Date) -> TimeInterval { (pausedAt ?? date).timeIntervalSinceReferenceDate - offset }

    func setPaused(_ paused: Bool, at date: Date = Date()) {
        if paused, pausedAt == nil { pausedAt = date }
        else if !paused, let start = pausedAt { offset += date.timeIntervalSince(start); pausedAt = nil }
    }
}

/// The phone's one ambient clock. Everything idle (the thinking dots, the
/// shimmer) runs off this so it stops together: app not active, Reduce Motion
/// on, or Low Power Mode. It resumes from the phase it stopped at.
struct AmbientTimeline<Content: View>: View {
    var interval: TimeInterval = 1.0 / 30
    /// Extra reason to stop (for example, nothing is working).
    var paused = false
    @ViewBuilder let content: (TimeInterval) -> Content

    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var phase = AmbientPhase()
    @State private var lowPower = ProcessInfo.processInfo.isLowPowerModeEnabled

    private var stopped: Bool { paused || scenePhase != .active || reduceMotion || lowPower }

    var body: some View {
        TimelineView(.animation(minimumInterval: interval, paused: stopped)) { context in
            content(phase.time(at: context.date))
        }
        .onChange(of: stopped) { _, now in phase.setPaused(now) }
        .onReceive(NotificationCenter.default.publisher(for: .NSProcessInfoPowerStateDidChange)) { _ in
            lowPower = ProcessInfo.processInfo.isLowPowerModeEnabled
        }
    }
}

/// Text with a soft light sweeping across it: "working", not "stuck".
struct PhoneShimmerText: View {
    let text: String
    var size: CGFloat = 14

    var body: some View {
        AmbientTimeline { t in
            let sweep = (t.truncatingRemainder(dividingBy: 2.4)) / 2.4   // 0...1 across the line
            Text(text).font(.system(size: size)).foregroundStyle(Phone.dim)
                .overlay {
                    LinearGradient(colors: [.clear, Phone.text, .clear], startPoint: .leading, endPoint: .trailing)
                        .frame(width: 70).offset(x: (sweep * 2 - 1) * 110)
                        .mask { Text(text).font(.system(size: size)) }
                }
        }
    }
}
