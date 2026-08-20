//
//  The break, as somewhere to be rather than something to dismiss.
//
//  The small floating panel this replaces was honest work — it proved focus is
//  handed back correctly — but it was still a notification, and a notification
//  is a thing you learn to click. Ten minutes of rest that can be reflexively
//  cancelled is not rest; it is a suggestion, and the suggestion loses to
//  whatever is on the other monitor.
//
//  So this takes the screen. Every screen. And it deliberately looks like
//  nothing else in Orion: the rest of the app is instrument panels, cyan on
//  near-black, information-dense on purpose. That look is right for working and
//  wrong for stopping. Here it is slow gradients, one number, and something to
//  breathe with — because the job of this screen is to be uninteresting in a
//  pleasant way. Nothing to read, nothing to decide, nothing to click.
//
//  There is no dismiss control anywhere on it. That is not an oversight and it
//  is not hidden cleverness — the way out before the timer is to tell Orion why
//  leaving is vital, and the screen says so plainly. See BreakLock for why that
//  door has to exist at all.
//

import SwiftUI
import SessionDomain

// MARK: - The breath

/// One breath, as four phases with their own lengths.
///
/// 4-4-6-2 rather than box breathing's even 4-4-4-4: a longer exhale than inhale
/// is the part that actually settles the nervous system, and the short pause at
/// the end keeps the cycle from feeling like a metronome. Sixteen seconds, so a
/// three-minute break is about eleven breaths — enough to drop into it.
enum BreathPhase: Equatable {
    case inhale, hold, exhale, settle

    var seconds: Double {
        switch self {
        case .inhale: return 4
        case .hold: return 4
        case .exhale: return 6
        case .settle: return 2
        }
    }

    var label: String {
        switch self {
        case .inhale: return "breathe in"
        case .hold: return "hold"
        case .exhale: return "breathe out"
        case .settle: return "settle"
        }
    }

    /// How big the circle is at the START of this phase, and where it travels.
    /// Hold and settle do not move — stillness has to actually be still, or the
    /// animation is telling the lungs something different from the words.
    var scale: (from: Double, to: Double) {
        switch self {
        case .inhale: return (0.62, 1.0)
        case .hold: return (1.0, 1.0)
        case .exhale: return (1.0, 0.62)
        case .settle: return (0.62, 0.62)
        }
    }

    static let all: [BreathPhase] = [.inhale, .hold, .exhale, .settle]
    static let cycle: Double = all.reduce(0) { $0 + $1.seconds }
}

/// Where in the breath we are at a given moment. Pure, so the animation is a
/// function of the clock rather than a pile of state that can drift out of sync
/// with itself after ten minutes of running.
struct Breath: Equatable {
    let phase: BreathPhase
    /// 0...1 through the current phase.
    let progress: Double

    init(elapsed: Double) {
        let t = elapsed.truncatingRemainder(dividingBy: BreathPhase.cycle)
        var remaining = t
        var found = BreathPhase.inhale
        for phase in BreathPhase.all {
            if remaining < phase.seconds { found = phase; break }
            remaining -= phase.seconds
            found = phase
        }
        self.phase = found
        self.progress = min(1, max(0, remaining / found.seconds))
    }

    /// Eased, because lungs do not move linearly and a linear circle looks like
    /// a machine part.
    var scale: Double {
        let (from, to) = phase.scale
        let eased = progress < 0.5
            ? 2 * progress * progress
            : 1 - pow(-2 * progress + 2, 2) / 2
        return from + (to - from) * eased
    }
}

// MARK: - The screen

struct BreakSanctuaryView: View {

    let remaining: TimeInterval
    let progress: Double
    /// The physical suggestion — look out a window, stand up. Shown once, small.
    let prompt: String
    /// Whether the breathing guide is on. Off means the same calm screen with
    /// nothing moving in the middle, which some days is the right answer.
    let guided: Bool
    /// What the camera has to say, when it is switched on. Nil when it is not.
    let presence: String?
    /// The back door. Held, not clicked — see `escapeHatch`.
    var onHoldExit: (() -> Void)?

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var holdStarted: Date?
    @State private var holdWork: DispatchWorkItem?

    /// How long the exit has to be held.
    private static let holdSeconds: Double = 3

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 30)) { timeline in
            let elapsed = timeline.date.timeIntervalSinceReferenceDate
            let breath = Breath(elapsed: elapsed)

            ZStack {
                background(elapsed: elapsed)

                VStack(spacing: 0) {
                    Spacer(minLength: 0)

                    if guided {
                        breathingGuide(breath)
                    } else {
                        stillMark
                    }

                    Spacer(minLength: 0)

                    clock
                        .padding(.bottom, 10)

                    Text(prompt)
                        .font(.system(size: 15, weight: .regular, design: .rounded))
                        .foregroundStyle(.white.opacity(0.42))
                        .multilineTextAlignment(.center)
                        .frame(maxWidth: 460)

                    Spacer(minLength: 0)

                    footer(now: timeline.date)
                        .padding(.bottom, 44)
                }
                .padding(40)
            }
        }
    }

    // MARK: Background

    /// Slow light, and nothing that reads as an interface.
    ///
    /// Three soft fields drifting at different rates on long periods — 47, 61
    /// and 83 seconds, deliberately coprime so the composition never visibly
    /// repeats inside a ten-minute break. Blurred far past the point of being
    /// shapes, because anything with an edge becomes something to look at.
    private func background(elapsed: Double) -> some View {
        ZStack {
            LinearGradient(
                colors: [
                    Color(red: 0.02, green: 0.07, blue: 0.09),
                    Color(red: 0.03, green: 0.11, blue: 0.13),
                    Color(red: 0.02, green: 0.06, blue: 0.10)
                ],
                startPoint: .topLeading, endPoint: .bottomTrailing
            )

            if !reduceMotion {
                field(hue: Color(red: 0.20, green: 0.72, blue: 0.62),
                      period: 47, phase: 0, elapsed: elapsed, size: 760)
                field(hue: Color(red: 0.16, green: 0.44, blue: 0.66),
                      period: 61, phase: 2.1, elapsed: elapsed, size: 900)
                field(hue: Color(red: 0.34, green: 0.66, blue: 0.44),
                      period: 83, phase: 4.3, elapsed: elapsed, size: 640)
            }
        }
        .ignoresSafeArea()
    }

    private func field(hue: Color, period: Double, phase: Double,
                       elapsed: Double, size: CGFloat) -> some View {
        let t = elapsed / period + phase
        return Circle()
            .fill(
                RadialGradient(colors: [hue.opacity(0.30), hue.opacity(0)],
                               center: .center, startRadius: 0, endRadius: size / 2)
            )
            .frame(width: size, height: size)
            .offset(x: CGFloat(cos(t * 2 * .pi)) * 260,
                    y: CGFloat(sin(t * 2 * .pi * 0.7)) * 180)
            .blur(radius: 60)
    }

    // MARK: The middle

    private func breathingGuide(_ breath: Breath) -> some View {
        VStack(spacing: 34) {
            ZStack {
                // Two trailing rings, scaled slightly behind the core, so the
                // movement reads as breath rather than as a pulsing dot.
                ring(scale: breath.scale * 1.22, opacity: 0.07, width: 1)
                ring(scale: breath.scale * 1.10, opacity: 0.12, width: 1)

                Circle()
                    .fill(
                        RadialGradient(
                            colors: [Color.white.opacity(0.20), Color(red: 0.24, green: 0.78, blue: 0.70).opacity(0.10)],
                            center: .center, startRadius: 2, endRadius: 150
                        )
                    )
                    .frame(width: 260, height: 260)
                    .scaleEffect(reduceMotion ? 0.85 : breath.scale)
                    .overlay(
                        Circle()
                            .strokeBorder(Color.white.opacity(0.22), lineWidth: 1)
                            .frame(width: 260, height: 260)
                            .scaleEffect(reduceMotion ? 0.85 : breath.scale)
                    )
            }
            .frame(width: 340, height: 340)

            Text(reduceMotion ? "breathe slowly" : breath.phase.label)
                .font(.system(size: 17, weight: .light, design: .rounded))
                .tracking(3.4)
                .foregroundStyle(.white.opacity(0.62))
                .animation(.easeInOut(duration: 0.5), value: breath.phase)
        }
    }

    private func ring(scale: Double, opacity: Double, width: CGFloat) -> some View {
        Circle()
            .strokeBorder(Color.white.opacity(opacity), lineWidth: width)
            .frame(width: 260, height: 260)
            .scaleEffect(reduceMotion ? 0.9 : scale)
    }

    /// The unguided version: something to rest the eyes on that does not ask
    /// anything of them.
    private var stillMark: some View {
        Circle()
            .fill(
                RadialGradient(colors: [Color.white.opacity(0.10), Color.white.opacity(0)],
                               center: .center, startRadius: 0, endRadius: 170)
            )
            .frame(width: 340, height: 340)
    }

    // MARK: Time

    private var clock: some View {
        VStack(spacing: 16) {
            Text(Self.clockText(remaining))
                .font(.system(size: 74, weight: .thin, design: .rounded))
                .monospacedDigit()
                .foregroundStyle(.white.opacity(0.88))

            // A hairline rather than a progress bar. A bar invites watching the
            // bar, which is the opposite of resting.
            ZStack(alignment: .leading) {
                Capsule().fill(Color.white.opacity(0.10)).frame(width: 260, height: 2)
                Capsule().fill(Color.white.opacity(0.45))
                    .frame(width: 260 * CGFloat(min(1, max(0, progress))), height: 2)
            }
        }
    }

    static func clockText(_ remaining: TimeInterval) -> String {
        let total = max(0, Int(remaining.rounded(.up)))
        return String(format: "%d:%02d", total / 60, total % 60)
    }

    // MARK: Footer

    /// The only things this screen says about itself: that the camera is on when
    /// it is, where the door is, and that there is a door at all.
    private func footer(now: Date) -> some View {
        VStack(spacing: 14) {
            if let presence {
                Label(presence, systemImage: "video")
                    .font(.system(size: 12, weight: .regular, design: .rounded))
                    .foregroundStyle(.white.opacity(0.34))
            }

            Text("If something is genuinely urgent, tell Orion out loud and say why.")
                .font(.system(size: 12.5, weight: .regular, design: .rounded))
                .foregroundStyle(.white.opacity(0.30))

            if onHoldExit != nil { escapeHatch(now: now) }
        }
    }

    /// The back door.
    ///
    /// A break you genuinely cannot leave is not a discipline tool, it is a
    /// thing that owns your machine — and the first time it holds you while
    /// something real is happening, you will turn the whole feature off and
    /// never turn it back on. So there is always a way out.
    ///
    /// It is a HOLD, not a click, and that is the entire design. Three seconds
    /// of deliberate pressure beats reflex, which is all the lock was ever
    /// fighting: nobody holds a button for three seconds absent-mindedly on the
    /// way to Slack. It is drawn quietly, at the bottom, below the line telling
    /// you the better option is to say why out loud — present, unhidden, and
    /// visibly not the intended path.
    private func escapeHatch(now: Date) -> some View {
        let progress: Double = {
            guard let holdStarted else { return 0 }
            return min(1, now.timeIntervalSince(holdStarted) / Self.holdSeconds)
        }()

        return ZStack {
            Capsule()
                .strokeBorder(Color.white.opacity(holdStarted == nil ? 0.14 : 0.30), lineWidth: 1)

            GeometryReader { proxy in
                Capsule()
                    .fill(Color.white.opacity(0.16))
                    .frame(width: proxy.size.width * CGFloat(progress))
            }
            .clipShape(Capsule())

            Text(progress > 0 ? "keep holding…" : "hold to leave")
                .font(.system(size: 11.5, weight: .regular, design: .rounded))
                .tracking(1.6)
                .foregroundStyle(.white.opacity(holdStarted == nil ? 0.28 : 0.6))
        }
        .frame(width: 168, height: 30)
        .contentShape(Capsule())
        .gesture(
            DragGesture(minimumDistance: 0)
                .onChanged { _ in beginHold() }
                .onEnded { _ in cancelHold() }
        )
        .padding(.top, 6)
    }

    private func beginHold() {
        guard holdStarted == nil else { return }
        holdStarted = Date()

        // A scheduled item rather than watching the clock in `body`: firing a
        // callback out of a view update is how you get an exit that runs twice.
        let work = DispatchWorkItem { [self] in
            guard holdStarted != nil else { return }
            holdStarted = nil
            onHoldExit?()
        }
        holdWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + Self.holdSeconds, execute: work)
    }

    private func cancelHold() {
        holdWork?.cancel()
        holdWork = nil
        holdStarted = nil
    }
}
