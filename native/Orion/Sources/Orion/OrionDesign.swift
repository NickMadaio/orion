import SwiftUI

/*
 Orion's design tokens: one type scale, one spacing scale, and a handful of motion curves.

 Before 2026-10-30 the app used more than thirty distinct font sizes and about thirty different
 animation curves — a spring of 0.34/0.82 here, 0.35/0.85 there, 0.38/0.72 somewhere else. Each was
 reasonable alone; together they are why moving between tabs felt like moving between apps. These
 tokens are the short list everything new should pick from, and the shared components use them.

 Motion rules, which are Nick's bar (Sentient OS: "super smooth"):
   · fast and quiet — 0.16 s for hover, 0.3–0.45 s for anything that moves;
   · springs are critically-ish damped (≥ 0.84): things settle, they do not bounce;
   · everything respects Reduce Motion — movement becomes a plain cross-fade, never nothing.
*/

/// The type scale. Mono for labels and numbers, rounded for figures, the system face for reading.
enum OrionType {
    /// Tracked uppercase section labels and captions.
    static let caption = OrionTheme.mono(9, .semibold)
    /// Small mono metadata: times, counts, units.
    static let meta = OrionTheme.mono(10)
    /// Secondary reading text.
    static let small = Font.system(size: 12)
    /// The reading size for rows and messages.
    static let body = Font.system(size: 13)
    /// Chat and narrative prose.
    static let prose = Font.system(size: 14)
    /// A row or section title.
    static let title = Font.system(size: 15, weight: .semibold)
    /// Figures beside text.
    static let figure = OrionTheme.display(26)
    /// The one big number per idea.
    static let hero = OrionTheme.display(46)

    /// Tracking that goes with `caption`.
    static let captionTracking: CGFloat = 2.0
}

/// The spacing scale. Grouping is done with these, not with boxes.
enum OrionSpace {
    static let xs: CGFloat = 4
    static let s: CGFloat = 8
    static let m: CGFloat = 14
    static let l: CGFloat = 22
    static let xl: CGFloat = 34
    static let xxl: CGFloat = 56
}

/// The motion curves. Pick by intent, not by number.
enum OrionMotion {
    /// Hover and focus feedback.
    static let hover = Animation.easeOut(duration: 0.16)
    /// Selection: a marker sliding, a row lighting up.
    static let select = Animation.spring(response: 0.34, dampingFraction: 0.86)
    /// A page or section changing.
    static let page = Animation.spring(response: 0.42, dampingFraction: 0.9)
    /// Content arriving.
    static let enter = Animation.spring(response: 0.45, dampingFraction: 0.92)
    /// Plain cross-fades: state lines, dimming.
    static let fade = Animation.easeInOut(duration: 0.28)

    /// The animation to use, given Reduce Motion: movement collapses to a short fade.
    static func resolved(_ animation: Animation, reduceMotion: Bool) -> Animation {
        reduceMotion ? .easeInOut(duration: 0.2) : animation
    }

    /// `withAnimation`, with Reduce Motion honoured.
    static func perform(_ animation: Animation, reduceMotion: Bool, _ body: () -> Void) {
        withAnimation(resolved(animation, reduceMotion: reduceMotion), body)
    }

    /// Content rising slightly as it arrives. Under Reduce Motion, a fade only.
    static func rise(reduceMotion: Bool, distance: CGFloat = 10) -> AnyTransition {
        reduceMotion ? .opacity : .opacity.combined(with: .offset(y: distance))
    }
}

// MARK: - Entrance

private struct FrozenMotionKey: EnvironmentKey {
    static let defaultValue: Double? = nil
}

extension EnvironmentValues {
    /// Renders only: holds every `orionEntrance` at this progress (0…1) instead of animating, so ImageRenderer —
    /// which draws one frame and never runs `onAppear` — can show a settled screen or a frame mid-animation.
    var orionFrozenMotion: Double? {
        get { self[FrozenMotionKey.self] }
        set { self[FrozenMotionKey.self] = newValue }
    }
}

/// Fade and rise into place on first appearance, optionally staggered, instead of popping in.
private struct OrionEntrance: ViewModifier {
    let delay: Double
    let distance: CGFloat

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.orionFrozenMotion) private var frozen
    @State private var shown = false

    func body(content: Content) -> some View {
        let progress = frozen ?? (shown ? 1 : 0)
        content
            .opacity(progress)
            .offset(y: reduceMotion ? 0 : (1 - progress) * distance)
            .onAppear {
                guard frozen == nil, !shown else { return }
                withAnimation(OrionMotion.resolved(OrionMotion.enter, reduceMotion: reduceMotion).delay(reduceMotion ? 0 : delay)) {
                    shown = true
                }
            }
    }
}

extension View {
    /// Fade and rise in on first appearance. `order` staggers siblings by 40 ms each, capped so a long list does
    /// not keep arriving for a second.
    func orionEntrance(order: Int = 0, distance: CGFloat = 10) -> some View {
        modifier(OrionEntrance(delay: Double(min(order, 8)) * 0.04, distance: distance))
    }
}
