import SwiftUI

/*
 The run console: one place that says what the loop is doing, one button that
 does the obvious next thing, and proof that a press landed.

 Nick (2026-09-25): the start and stop controls were "clunky", looked old, and
 "i cant tell if me pressing a button actually worked". The last one is the
 real defect. A press used to show a small spinner for as long as the CLI took
 (well under a second) and then nothing, while the loop itself took up to a
 whole model exchange to act. So every press now leaves a visible trail:
 SENT (the CLI accepted it) → RECORDED (it is in the run's state) → DONE (the
 loop visibly did it), read from the same state and heartbeat as everything
 else, never assumed.
*/

/// What the operator asked for, and how far it has got.
struct ProjectIntent: Equatable {
    enum Kind: String, Equatable { case start, pause, stop, exterminate, resume }
    enum Phase: Equatable { case sending, recorded, done, failed(String) }

    let kind: Kind
    var phase: Phase
    let at: Date

    /// Has the LOOP done it — not merely recorded the request? Pure, so the
    /// rules are tested rather than eyeballed.
    static func isDone(_ kind: Kind, run: ProjectAgentStatus?, live: Bool) -> Bool {
        switch kind {
        case .start: return live
        case .pause: return run?.status == .paused
        case .stop, .exterminate: return !live
        case .resume:
            guard let run else { return false }
            return !run.isPausing && !run.isStopping && !run.isExterminating && run.status != .paused
        }
    }

    var verb: String {
        switch kind {
        case .start: return "Start"
        case .pause: return "Pause"
        case .stop: return "Stop"
        case .exterminate: return "Exterminate"
        case .resume: return "Resume"
        }
    }

    /// What is happening between "recorded" and "done", in words.
    var waiting: String {
        switch kind {
        case .start: return "Launching the supervisor — usually a few seconds"
        case .pause: return "Holds at the next task boundary"
        case .stop: return "Finishing the step in flight, then stopping cleanly"
        case .exterminate: return "Abandoning the model call in flight"
        case .resume: return "Clearing the hold"
        }
    }

    var finished: String {
        switch kind {
        case .start: return "Running"
        case .pause: return "Paused"
        case .stop: return "Stopped"
        case .exterminate: return "Exterminated"
        case .resume: return "Resumed"
        }
    }
}

/// The console's mood, which drives colour and motion everywhere in it.
enum ProjectMood: Equatable {
    case idle, working, reviewing, transitioning, attention, complete

    var tint: Color {
        switch self {
        case .idle: return OrionTheme.textDim
        case .working: return OrionTheme.accent
        case .reviewing: return OrionTheme.violet
        case .transitioning: return OrionTheme.blue
        case .attention: return OrionTheme.orange
        case .complete: return OrionTheme.green
        }
    }

    static func of(run: ProjectAgentStatus?, beat: ProjectAgentHeartbeat?, live: Bool, launching: Bool,
                   pending: Bool) -> ProjectMood {
        if run?.status == .completed { return .complete }
        if pending || launching || (live && (run?.isStopping == true || run?.isPausing == true || run?.isExterminating == true)) {
            return .transitioning
        }
        if live { return beat?.role == "reviewer" ? .reviewing : .working }
        if run?.isBlocked == true || run?.hasOpenEscalations == true { return .attention }
        return .idle
    }
}

// MARK: - The orb

/// A line-art ring that breathes while work is happening, spins while the run
/// is changing state, pulses outward when it needs Nick, and closes when done.
struct ProjectPulseOrb: View {
    let mood: ProjectMood
    var size: CGFloat = 58
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        TimelineView(.animation(paused: reduceMotion || mood == .idle)) { context in
            let t = context.date.timeIntervalSinceReferenceDate
            let breath = (sin(t * 1.6) + 1) / 2
            ZStack {
                Circle().fill(mood.tint.opacity(mood == .idle ? 0 : 0.10 + 0.14 * breath))
                    .blur(radius: size * 0.28)
                Circle().stroke(mood.tint.opacity(mood == .idle ? 0.35 : 0.28), lineWidth: 1.2)
                if mood == .attention {
                    let wave = t.truncatingRemainder(dividingBy: 1.8) / 1.8
                    Circle().stroke(mood.tint.opacity(0.5 * (1 - wave)), lineWidth: 1.2)
                        .scaleEffect(1 + 0.45 * wave)
                }
                if mood == .complete {
                    Circle().stroke(mood.tint, lineWidth: 2.2)
                    Image(systemName: "checkmark").font(.system(size: size * 0.3, weight: .semibold)).foregroundStyle(mood.tint)
                } else if mood != .idle && mood != .attention {
                    let speed = mood == .transitioning ? 300.0 : 90.0
                    let sweep = mood == .transitioning ? 0.22 : 0.36
                    // The gradient spans the arc, not the circle, so the head is
                    // full colour and the tail fades: a comet, not a smudge.
                    Circle().trim(from: 0, to: sweep)
                        .stroke(AngularGradient(colors: [mood.tint.opacity(0), mood.tint], center: .center,
                                                startAngle: .degrees(0), endAngle: .degrees(360 * sweep)),
                                style: StrokeStyle(lineWidth: 2.6, lineCap: .round))
                        .rotationEffect(.degrees(reduceMotion ? 0 : (t * speed).truncatingRemainder(dividingBy: 360)))
                }
                Circle().fill(mood.tint.opacity(mood == .idle ? 0.35 : 0.75 + 0.25 * breath))
                    .frame(width: size * 0.14, height: size * 0.14)
                    .opacity(mood == .complete ? 0 : 1)
            }
            .frame(width: size, height: size)
        }
        .animation(.easeInOut(duration: 0.5), value: mood)
        .accessibilityHidden(true)
    }
}

// MARK: - Buttons

/// An outline capsule that lifts on hover, sinks on press, and glows when it is
/// the thing to press. No filled chrome: the tint lives in the stroke and the light.
struct ConsoleButton: View {
    let title: String
    let symbol: String
    var tint: Color = OrionTheme.accent
    var prominent = false
    var working = false
    let action: () -> Void
    @State private var hovering = false
    @Environment(\.isEnabled) private var enabled
    /// A white tint at full strength is a grey slab; colours can carry more.
    private var fill: Double { tint == OrionTheme.text ? 0.13 : 0.34 }

    var body: some View {
        Button(action: action) {
            HStack(spacing: 9) {
                ZStack {
                    Image(systemName: symbol).opacity(working ? 0 : 1)
                    if working { ArcSpinner(tint: prominent ? .white : tint, size: 13) }
                }
                .frame(width: 16)
                Text(title)
            }
            .font(.system(size: prominent ? 14 : 12, weight: .semibold, design: .rounded))
            .padding(.horizontal, prominent ? 22 : 14).padding(.vertical, prominent ? 12 : 8)
            .foregroundStyle(enabled ? (prominent ? Color.white : tint) : OrionTheme.textDim)
            .background {
                Capsule().fill(LinearGradient(colors: [tint.opacity(prominent ? fill : 0.06), tint.opacity(prominent ? fill / 3 : 0.0)],
                                              startPoint: .topLeading, endPoint: .bottomTrailing))
                    .opacity(enabled ? (hovering ? 1 : 0.8) : 0.25)
            }
            .overlay { Capsule().stroke(tint.opacity(enabled ? (hovering ? 0.9 : 0.55) : 0.15), lineWidth: 1.1) }
            .shadow(color: tint.opacity(enabled && prominent ? (hovering ? 0.55 : 0.32) : 0), radius: hovering ? 16 : 10)
            .contentShape(Capsule())
        }
        .buttonStyle(ConsolePressStyle())
        .onHover { hovering = $0 }
        .animation(.easeOut(duration: 0.18), value: hovering)
    }
}

private struct ConsolePressStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.95 : 1)
            .brightness(configuration.isPressed ? 0.12 : 0)
            .animation(.spring(response: 0.22, dampingFraction: 0.6), value: configuration.isPressed)
    }
}

// MARK: - Proof that a press landed

/// Sent → Recorded → Done, drawn as three beads on a line that fills as each
/// step is observed. A failure says what failed, in place.
struct ProjectIntentTrail: View {
    let intent: ProjectIntent

    private var reached: Int {
        switch intent.phase {
        case .sending: return 0
        case .recorded: return 2
        case .done: return 3
        case .failed: return 0
        }
    }

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            if case .failed(let reason) = intent.phase {
                Label("\(intent.verb) did not go through — \(reason)", systemImage: "exclamationmark.triangle")
                    .font(.system(size: 12)).foregroundStyle(OrionTheme.orange).lineLimit(2)
            } else {
                HStack(spacing: 0) {
                    bead("Sent", index: 1)
                    link(filled: reached >= 2)
                    bead("Recorded", index: 2)
                    link(filled: reached >= 3)
                    bead(intent.phase == .done ? intent.finished : "Done", index: 3)
                }
                Text(intent.phase == .done ? "\(intent.verb) took effect" : intent.waiting)
                    .font(.system(size: 11)).foregroundStyle(OrionTheme.textSoft).lineLimit(1)
                    .contentTransition(.opacity)
            }
        }
        .animation(.spring(response: 0.4, dampingFraction: 0.8), value: intent.phase)
    }

    private func bead(_ label: String, index: Int) -> some View {
        let on = reached >= index || (index == 1 && intent.phase != .sending)
        let current = !on && (index == reached + 1 || (index == 1 && intent.phase == .sending))
        return HStack(spacing: 5) {
            ZStack {
                Circle().stroke(OrionTheme.green.opacity(on ? 1 : 0.3), lineWidth: 1.2).frame(width: 14, height: 14)
                if on { Image(systemName: "checkmark").font(.system(size: 7, weight: .heavy)).foregroundStyle(OrionTheme.green) }
                else if current { ArcSpinner(tint: OrionTheme.green, size: 9) }
            }
            Text(label).font(OrionTheme.mono(9, .semibold)).tracking(0.6)
                .foregroundStyle(on ? OrionTheme.text : OrionTheme.textDim)
        }
    }

    private func link(filled: Bool) -> some View {
        ZStack(alignment: .leading) {
            Capsule().fill(.white.opacity(0.1))
            Capsule().fill(OrionTheme.green).frame(width: filled ? 22 : 0)
        }
        .frame(width: 22, height: 1.5).padding(.horizontal, 6)
    }
}

// MARK: - Progress, one segment per task

/// The plan as a strip: each task a segment sized by its weight and coloured by
/// where it is. The one in flight shimmers, so "working" is visible at a glance.
struct ProjectTaskStrip: View {
    let run: ProjectAgentStatus
    var height: CGFloat = 7
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private func color(_ task: ProjectAgentStatus.WorkItem) -> Color {
        if run.isParked(task) { return OrionTheme.orange }
        switch task.status {
        case .accepted: return OrionTheme.green
        case .running: return OrionTheme.accent
        case .awaiting_review: return OrionTheme.violet
        case .blocked: return OrionTheme.orange
        case .queued, .unknown: return .white.opacity(0.12)
        }
    }

    var body: some View {
        let total = max(run.tasks.reduce(0) { $0 + $1.weight }, 0.0001)
        GeometryReader { geometry in
            let spacing: CGFloat = 3
            let usable = max(0, geometry.size.width - spacing * CGFloat(max(run.tasks.count - 1, 0)))
            HStack(spacing: spacing) {
                ForEach(run.tasks) { task in
                    let live = task.status == .running || task.status == .awaiting_review
                    TimelineView(.animation(paused: reduceMotion || !live)) { context in
                        let phase = context.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: 1.6) / 1.6
                        Capsule().fill(color(task))
                            .overlay {
                                if live {
                                    LinearGradient(colors: [.clear, .white.opacity(0.55), .clear],
                                                   startPoint: .leading, endPoint: .trailing)
                                        .frame(width: 26).offset(x: -60 + 140 * phase)
                                        .clipShape(Capsule())
                                }
                            }
                            .clipShape(Capsule())
                    }
                    .frame(width: max(height, usable * CGFloat(task.weight / total)))
                    .help("\(task.title) — \(task.status.rawValue.replacingOccurrences(of: "_", with: " "))")
                }
            }
        }
        .frame(height: height)
        .animation(.easeInOut(duration: 0.45), value: run.tasks.map(\.status.rawValue))
    }
}

// MARK: - Asleep or away

/// Two words, one choice. Applies to the live run at once.
struct ProjectAlertSwitch: View {
    let away: Bool
    let busy: Bool
    let onChange: (Bool) -> Void

    var body: some View {
        HStack(spacing: 10) {
            Text("ALERTS").font(OrionTheme.mono(8, .semibold)).tracking(1.1).foregroundStyle(OrionTheme.textDim)
            HStack(spacing: 2) {
                option("Asleep", symbol: "moon.zzz", on: !away) { onChange(false) }
                option("Away", symbol: "bell", on: away) { onChange(true) }
            }
            .padding(2)
            .overlay(Capsule().stroke(.white.opacity(0.1), lineWidth: 1))
            Text(away ? "Each deferred task is sent as it happens" : "Nothing until one silent summary when it stops")
                .font(.system(size: 11)).foregroundStyle(OrionTheme.textDim).lineLimit(1)
        }
        .disabled(busy)
        .animation(.spring(response: 0.3, dampingFraction: 0.8), value: away)
    }

    private func option(_ title: String, symbol: String, on: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Label(title, systemImage: symbol).font(.system(size: 11, weight: .medium))
                .padding(.horizontal, 10).padding(.vertical, 5)
                .foregroundStyle(on ? OrionTheme.text : OrionTheme.textDim)
                .background { if on { Capsule().fill(.white.opacity(0.1)) } }
                .contentShape(Capsule())
        }
        .buttonStyle(.plain)
    }
}

/// A small drawn spinner in the orb's language. AppKit's spinner neither
/// matches the line-art nor renders outside a window.
struct ArcSpinner: View {
    var tint: Color = OrionTheme.accent
    var size: CGFloat = 12
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        TimelineView(.animation(paused: reduceMotion)) { context in
            let angle = (context.date.timeIntervalSinceReferenceDate * 400).truncatingRemainder(dividingBy: 360)
            Circle().trim(from: 0, to: 0.7)
                .stroke(AngularGradient(colors: [tint.opacity(0), tint], center: .center,
                                        startAngle: .degrees(0), endAngle: .degrees(252)),
                        style: StrokeStyle(lineWidth: max(1.4, size / 7), lineCap: .round))
                .rotationEffect(.degrees(reduceMotion ? 0 : angle))
        }
        .frame(width: size, height: size)
        .accessibilityLabel("Working")
    }
}
