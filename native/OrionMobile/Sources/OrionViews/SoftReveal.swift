import SwiftUI

/*
 The standard entrance for arriving content, and the shared pause rules for ambient motion.

 Lives in OrionViews (not the Mac target) because the shared chat screen needs it and cannot see the Mac app.
 The Mac motion files (the Motion folder) build on these.

 Wave 12 (2026-11-02). The numbers are timings and constants observed in Sentient OS's UI (an idea, not code):
 a new element starts at opacity 0, scale 0.97 anchored at its bottom, a 7 pt blur and 14 pt low, and a
 response-0.54 / damping-0.86 spring brings it home. The blur is transient motion blur on content that is
 arriving, never a frosted material, so it does not conflict with the real-alpha window.
*/

public extension ViewMotion {
    /// Content arriving: a long, damped spring. It settles, it does not bounce.
    static let softReveal = Animation.spring(response: 0.54, dampingFraction: 0.86)
    /// The hero "deal" on Home: beats 0.11 s apart after a 0.25 s start (see `dealDelay`).
    static let deal = Animation.spring(response: 0.62, dampingFraction: 0.86)

    /// Seconds before beat `order` of a staggered deal. Capped so a long list does not keep arriving.
    static func dealDelay(order: Int) -> Double { 0.25 + Double(min(max(order, 0), 12)) * 0.11 }
}

// MARK: - Frozen motion (renders)

private struct FrozenMotionKey: EnvironmentKey {
    static let defaultValue: Double? = nil
}

public extension EnvironmentValues {
    /// Renders only: holds every entrance at this progress (0…1) instead of animating, so ImageRenderer, which
    /// draws one frame and never runs `onAppear`, can show a settled screen or a frame mid-animation.
    var orionFrozenMotion: Double? {
        get { self[FrozenMotionKey.self] }
        set { self[FrozenMotionKey.self] = newValue }
    }
}

// MARK: - SoftReveal

/// The look of an element at `progress` (0 = just arrived, 1 = settled). Under Reduce Motion: opacity only.
public struct SoftRevealEffect: ViewModifier {
    public var progress: Double
    public var reduceMotion = false
    public var anchor: UnitPoint = .bottom
    public var rise: CGFloat = 14
    public var blur: CGFloat = 7

    public init(progress: Double, reduceMotion: Bool = false, anchor: UnitPoint = .bottom, rise: CGFloat = 14, blur: CGFloat = 7) {
        self.progress = progress; self.reduceMotion = reduceMotion; self.anchor = anchor; self.rise = rise; self.blur = blur
    }

    public func body(content: Content) -> some View {
        let remaining = 1 - min(1, max(0, progress))
        content
            .opacity(min(1, max(0, progress) * 1.25))
            .scaleEffect(reduceMotion ? 1 : 1 - 0.03 * remaining, anchor: anchor)
            .blur(radius: reduceMotion ? 0 : blur * remaining)
            .offset(y: reduceMotion ? 0 : rise * remaining)
    }
}

public extension AnyTransition {
    /// SoftReveal as a transition, for rows that are inserted live. Removal is a quick fade.
    static func softReveal(reduceMotion: Bool = false) -> AnyTransition {
        .asymmetric(
            insertion: .modifier(active: SoftRevealEffect(progress: 0, reduceMotion: reduceMotion),
                                 identity: SoftRevealEffect(progress: 1, reduceMotion: reduceMotion)),
            removal: .opacity)
    }
}

/// Reveals its content once, on first appearance (or at a frozen progress for renders).
private struct SoftRevealOnAppear: ViewModifier {
    let delay: Double
    let animation: Animation
    let rise: CGFloat

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.orionFrozenMotion) private var frozen
    @State private var shown = false

    func body(content: Content) -> some View {
        content
            .modifier(SoftRevealEffect(progress: frozen ?? (shown ? 1 : 0), reduceMotion: reduceMotion, rise: rise))
            .onAppear {
                guard frozen == nil, !shown else { return }
                withAnimation(ViewMotion.resolved(animation, reduceMotion: reduceMotion).delay(reduceMotion ? 0 : delay)) { shown = true }
            }
    }
}

public extension View {
    /// The standard entrance for content that arrives: fade, a touch of scale, a brief blur, a short rise.
    func softReveal(delay: Double = 0, animation: Animation = ViewMotion.softReveal, rise: CGFloat = 14) -> some View {
        modifier(SoftRevealOnAppear(delay: delay, animation: animation, rise: rise))
    }

    /// One beat of the Home "deal": SoftReveal on the shared 0.25 s + 0.11 s-per-beat schedule.
    func deal(order: Int, rise: CGFloat = 14) -> some View {
        softReveal(delay: ViewMotion.dealDelay(order: order), animation: ViewMotion.deal, rise: rise)
    }
}

// MARK: - Ambient pause rules

private struct AmbientPausedKey: EnvironmentKey {
    static let defaultValue = false
}

public extension EnvironmentValues {
    /// True while idle animation should stand still: the window is hidden, occluded or inactive. The Mac app sets
    /// it at the dashboard root; Reduce Motion is read separately by `AmbientTimeline`.
    var ambientPaused: Bool {
        get { self[AmbientPausedKey.self] }
        set { self[AmbientPausedKey.self] = newValue }
    }
}

/// Accumulated active time, so a paused animation resumes from the same phase instead of jumping.
final class AmbientPhase {
    private(set) var elapsed: Double = 0
    private var last: Date?

    /// Advance to `date`. A gap longer than `maxStep` (the view was off screen) counts as that long, not more.
    @discardableResult
    func advance(to date: Date, maxStep: Double = 0.25) -> Double {
        if let last { elapsed += min(max(0, date.timeIntervalSince(last)), maxStep) }
        last = date
        return elapsed
    }

    /// Stop counting; the next `advance` starts from here.
    func pause() { last = nil }
}

/// A clock for idle animation. `content` receives seconds of ACTIVE time. It ticks at `fps` while running, and
/// stands still (holding its phase) when the window is paused, Reduce Motion is on, or `running` is false.
public struct AmbientTimeline<Content: View>: View {
    var fps: Double = 30
    var running = true
    /// What to show while still, as seconds of active time; nil keeps the last phase.
    var stillTime: Double?
    let content: (Double) -> Content

    @Environment(\.ambientPaused) private var paused
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var phase = AmbientPhase()

    public init(fps: Double = 30, running: Bool = true, stillTime: Double? = nil, @ViewBuilder content: @escaping (Double) -> Content) {
        self.fps = fps; self.running = running; self.stillTime = stillTime; self.content = content
    }

    private var standing: Bool { paused || reduceMotion || !running }

    public var body: some View {
        if standing {
            content(stillTime ?? phase.elapsed).onAppear { phase.pause() }
        } else {
            TimelineView(.animation(minimumInterval: 1 / fps)) { context in
                content(phase.advance(to: context.date))
            }
        }
    }
}

// MARK: - Working glimmer

/// A word with a slow soft sweep of light across it: ORION is working. Still under Reduce Motion, when the
/// window is paused, and in renders (`animated: false`).
public struct GlimmerText: View {
    let text: String
    var font: Font = .system(size: 13, weight: .medium)
    var animated = true
    var base: Color = ViewTokens.soft.opacity(0.55)
    var shine: Color = .white

    public init(_ text: String, font: Font = .system(size: 13, weight: .medium), animated: Bool = true,
                base: Color = ViewTokens.soft.opacity(0.55), shine: Color = .white) {
        self.text = text; self.font = font; self.animated = animated; self.base = base; self.shine = shine
    }

    public var body: some View {
        AmbientTimeline(fps: 24, running: animated, stillTime: 0.9) { time in
            // One sweep every 2.6 s, travelling from before the word to past it.
            let sweep = (time / 2.6).truncatingRemainder(dividingBy: 1) * 1.6 - 0.3
            Text(text)
                .font(font)
                .foregroundStyle(base)
                .overlay {
                    Text(text).font(font).foregroundStyle(shine.opacity(0.95))
                        .mask {
                            LinearGradient(stops: [.init(color: .clear, location: sweep - 0.22),
                                                   .init(color: .white, location: sweep),
                                                   .init(color: .clear, location: sweep + 0.22)],
                                           startPoint: .leading, endPoint: .trailing)
                        }
                }
        }
    }
}
