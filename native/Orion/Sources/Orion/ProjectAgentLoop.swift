import SwiftUI

/// The agentic loop, drawn as the loop it is.
///
/// Nick asked for this directly (mission §15). An earlier attempt drew a ring
/// with four dots on it, which was a gauge wearing a loop's name: it showed a
/// position without showing the thing the position is *on*. The ladder is a set
/// of named stages with work flowing between them, and most of what it has to
/// communicate lives in the arrows — that corrections go back to the worker,
/// that escalation is a branch off the side and not part of the cycle.
///
/// Everything here is READ FROM DURABLE STATE: the task's `stage`, the run's
/// status, the heartbeat. Nothing is inferred from a model's narration, and the
/// graph dims when the heartbeat is stale, so a loop that has stopped cannot
/// look like a loop that is turning.
struct ProjectAgentLoopDial: View {
    let run: ProjectAgentStatus
    let beat: ProjectAgentHeartbeat?

    /// The rungs, in the order work travels them.
    enum Stage: Int, CaseIterable, Identifiable {
        case worker, tests, selfCheck, review, correct

        var id: Int { rawValue }

        var lines: [String] {
            switch self {
            case .worker: return ["WORKER"]
            case .tests: return ["TESTS"]
            case .selfCheck: return ["SELF", "CHECK"]
            case .review: return ["REVIEW"]
            case .correct: return ["CORRECT"]
            }
        }

        /// Each rung keeps its own colour, dimly when idle and fully when it is
        /// the one running. A single-hue diagram reads as one undifferentiated
        /// thing; these are five different jobs and the eye should be able to
        /// tell them apart before it reads a word.
        var hue: Color {
            switch self {
            case .worker: return OrionTheme.accent
            case .tests: return OrionTheme.blue
            case .selfCheck: return OrionTheme.green
            case .review: return OrionTheme.violet
            case .correct: return OrionTheme.orange
            }
        }

        /// Laid out as Nick drew it: the cycle across the top, the correction
        /// path returning underneath, and the worker anchoring the left.
        var position: CGPoint {
            switch self {
            case .worker: return CGPoint(x: 145, y: 46)
            case .tests: return CGPoint(x: 244, y: 116)
            case .selfCheck: return CGPoint(x: 225, y: 220)
            case .review: return CGPoint(x: 145, y: 290)
            case .correct: return CGPoint(x: 55, y: 220)
            }
        }

        var radius: CGFloat {
            switch self {
            case .worker, .review: return 34
            case .correct: return 28
            default: return 30
            }
        }
    }

    static let escalatePoint = CGPoint(x: 255, y: 320)
    static let escalateRadius: CGFloat = 24
    static let canvas = CGSize(width: 300, height: 350)

    private var live: Bool { beat?.isLive ?? false }

    /// Which rung the run is on. `nil` means the loop is not turning.
    private var current: Stage? {
        if run.finalReview || run.isBlocked { return nil }
        if run.awaitingFinalReview { return .review }
        if let task = run.active {
            switch task.stage {
            case .inspect, .implement: return .worker
            case .test: return .tests
            case .review: return .review
            case .repair: return .correct
            case .queued, .accepted, .unknown: return nil
            }
        }
        if run.tasks.contains(where: { $0.status == .awaiting_review }) { return .review }
        if run.tasks.contains(where: { $0.stage == .repair }) { return .correct }
        return nil
    }

    private var tint: Color {
        if run.isBlocked { return OrionTheme.orange }
        if run.finalReview { return OrionTheme.green }
        if !live { return OrionTheme.textDim }
        return OrionTheme.accent
    }

    /// The edges, and what each one means. The labels are the point of the
    /// picture: without them this is five circles in a row.
    private var edges: [(from: Stage, to: Stage, label: String?, curve: CGFloat)] {
        [
            (.worker, .tests, "runs", -26),
            (.tests, .selfCheck, "results", -18),
            (.selfCheck, .review, "ready", -26),
            (.review, .correct, "corrections", 34),
            (.correct, .worker, "back to work", 34),
        ]
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            /*
             One clock drives the path bead, node orbit and node breath. Keeping
             them in separate repeating SwiftUI animations caused their phases
             to reset whenever the two-second status refresh rebuilt this view,
             which looked like a stutter. A wall-clock phase survives refreshes.
            */
            TimelineView(.animation(minimumInterval: 1.0 / 30.0, paused: !live)) { timeline in
                ZStack(alignment: .topLeading) {
                    Canvas { context, _ in
                        for edge in edges { draw(edge: edge, in: &context) }
                        drawEscalation(in: &context)
                        if live { drawFlow(at: timeline.date, in: &context) }
                    }
                    .frame(width: Self.canvas.width, height: Self.canvas.height)

                    ForEach(Stage.allCases) { node($0, at: timeline.date) }
                    escalateNode
                }
            }
            .frame(width: Self.canvas.width, height: Self.canvas.height)

            Text(caption)
                .font(.system(size: 12))
                .foregroundStyle(OrionTheme.textDim)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var caption: String {
        if run.finalReview { return "Run complete — \(run.acceptedCount)/\(run.tasks.count) tasks accepted." }
        if run.isBlocked { return "Stopped. The loop could not resolve this on its own." }
        if run.status == .paused { return "Paused. Nothing is claimed while it holds here." }
        if !live { return "No supervisor is driving this. The loop is not turning." }
        if let task = run.active, let subtask = task.subtask { return subtask.caption }
        return "Work returns to the worker until the reviewer accepts it; escalation is the last resort."
    }

    // MARK: Edges

    private func point(_ stage: Stage) -> CGPoint { stage.position }

    /// A quadratic curve between two nodes, trimmed to their rims and finished
    /// with an arrowhead, so the direction of travel is never ambiguous.
    private func draw(edge: (from: Stage, to: Stage, label: String?, curve: CGFloat), in context: inout GraphicsContext) {
        let start = point(edge.from)
        let end = point(edge.to)
        let mid = CGPoint(x: (start.x + end.x) / 2, y: (start.y + end.y) / 2)
        let normal = CGPoint(x: -(end.y - start.y), y: end.x - start.x)
        let length = max(1, sqrt(normal.x * normal.x + normal.y * normal.y))
        let control = CGPoint(x: mid.x + normal.x / length * edge.curve,
                              y: mid.y + normal.y / length * edge.curve)

        let from = advance(from: start, towards: control, by: edge.from.radius + 4)
        let to = advance(from: end, towards: control, by: edge.to.radius + 9)

        var path = Path()
        path.move(to: from)
        path.addQuadCurve(to: to, control: control)

        let travelled = isTravelled(edge)
        let colour = travelled
            ? (run.isBlocked ? OrionTheme.orange : edge.to.hue).opacity(live ? 0.85 : 0.35)
            : Color.white.opacity(0.11)
        context.stroke(path, with: .color(colour), style: StrokeStyle(lineWidth: travelled ? 2 : 1.25, lineCap: .round))
        arrowhead(at: to, from: control, in: &context, colour: colour)

        if let label = edge.label {
            let anchor = CGPoint(x: control.x, y: control.y + (edge.curve > 0 ? 12 : -12))
            context.draw(
                Text(label)
                    .font(OrionTheme.mono(7))
                    .foregroundStyle(travelled ? OrionTheme.textSoft : OrionTheme.textDim.opacity(0.75)),
                at: anchor)
        }
    }

    /// Escalation leaves the cycle, so it is drawn leaving the cycle: dashed,
    /// off to the side, and lit only when it is actually the thing happening.
    private func drawEscalation(in context: inout GraphicsContext) {
        let start = point(.review)
        let end = Self.escalatePoint
        let from = advance(from: start, towards: end, by: Stage.review.radius + 4)
        let to = advance(from: end, towards: start, by: Self.escalateRadius + 9)
        var path = Path()
        path.move(to: from)
        path.addLine(to: to)
        let colour = run.isBlocked ? OrionTheme.orange : Color.white.opacity(0.10)
        context.stroke(path, with: .color(colour),
                       style: StrokeStyle(lineWidth: run.isBlocked ? 2 : 1, lineCap: .round, dash: [4, 4]))
        arrowhead(at: to, from: from, in: &context, colour: colour)
    }

    /// A bead of light running down the edge the work is leaving by.
    ///
    /// It is the difference between a diagram of the loop and a picture of the
    /// loop RUNNING, and it is the cheapest honest liveness signal there is:
    /// it moves only while the heartbeat is live, and only along the edge that
    /// leaves the rung the controller says the run is on.
    private func drawFlow(at date: Date, in context: inout GraphicsContext) {
        guard let current, !run.isBlocked,
              let edge = edges.first(where: { $0.from == current }) else { return }
        let geometry = curve(for: edge)
        // Two seconds end to end, from the wall clock rather than a stored
        // phase, so the bead keeps time across re-renders of the panel.
        let progress = CGFloat(date.timeIntervalSince1970.truncatingRemainder(dividingBy: 2) / 2)
        let hue = edge.to.hue
        // A bright head and a longer tapered trail stay visible against the
        // dark panel, especially on the short WORKER -> TESTS edge.
        for (index, offset) in [0.0, 0.045, 0.09, 0.135, 0.18, 0.225].enumerated() {
            let t = progress - CGFloat(offset)
            guard t >= 0 else { continue }
            let point = pointOn(geometry, t: t)
            let diameter = max(3.5, 11 - CGFloat(index) * 1.35)
            let fade = max(0.18, 1.0 - Double(index) * 0.15)
            context.fill(
                Path(ellipseIn: CGRect(x: point.x - diameter / 2, y: point.y - diameter / 2,
                                       width: diameter, height: diameter)),
                with: .color(hue.opacity(fade)))
        }
    }

    /// The three control points of an edge's curve, trimmed to the node rims.
    private func curve(for edge: (from: Stage, to: Stage, label: String?, curve: CGFloat))
        -> (start: CGPoint, control: CGPoint, end: CGPoint) {
        let start = point(edge.from), end = point(edge.to)
        let mid = CGPoint(x: (start.x + end.x) / 2, y: (start.y + end.y) / 2)
        let normal = CGPoint(x: -(end.y - start.y), y: end.x - start.x)
        let length = max(1, sqrt(normal.x * normal.x + normal.y * normal.y))
        let control = CGPoint(x: mid.x + normal.x / length * edge.curve,
                              y: mid.y + normal.y / length * edge.curve)
        return (advance(from: start, towards: control, by: edge.from.radius + 4),
                control,
                advance(from: end, towards: control, by: edge.to.radius + 9))
    }

    private func pointOn(_ geometry: (start: CGPoint, control: CGPoint, end: CGPoint), t: CGFloat) -> CGPoint {
        let inverse = 1 - t
        return CGPoint(
            x: inverse * inverse * geometry.start.x + 2 * inverse * t * geometry.control.x + t * t * geometry.end.x,
            y: inverse * inverse * geometry.start.y + 2 * inverse * t * geometry.control.y + t * t * geometry.end.y)
    }

    private func advance(from origin: CGPoint, towards target: CGPoint, by distance: CGFloat) -> CGPoint {
        let dx = target.x - origin.x, dy = target.y - origin.y
        let length = max(1, sqrt(dx * dx + dy * dy))
        return CGPoint(x: origin.x + dx / length * distance, y: origin.y + dy / length * distance)
    }

    private func arrowhead(at tip: CGPoint, from origin: CGPoint, in context: inout GraphicsContext, colour: Color) {
        let dx = tip.x - origin.x, dy = tip.y - origin.y
        let angle = atan2(dy, dx)
        let size: CGFloat = 6
        var head = Path()
        head.move(to: tip)
        head.addLine(to: CGPoint(x: tip.x - size * cos(angle - .pi / 7), y: tip.y - size * sin(angle - .pi / 7)))
        head.addLine(to: CGPoint(x: tip.x - size * cos(angle + .pi / 7), y: tip.y - size * sin(angle + .pi / 7)))
        head.closeSubpath()
        context.fill(head, with: .color(colour))
    }

    /// Did the work actually come along this edge on the current pass?
    ///
    /// The forward edges light once the marker is past them. The two correction
    /// edges are different: they light only when the run has REALLY been sent
    /// back — a second attempt, a correction cycle or a reviewer repair on the
    /// task in flight. Lighting "back to work" on a first attempt would draw a
    /// journey the run never made, which is the diagram lying.
    private func isTravelled(_ edge: (from: Stage, to: Stage, label: String?, curve: CGFloat)) -> Bool {
        if run.finalReview { return true }
        guard let current else { return false }
        if edge.from == .review || edge.from == .correct { return wentBack }
        return edge.from.rawValue < current.rawValue
    }

    /// The task in flight has been round the loop before.
    private var wentBack: Bool {
        guard let task = run.active ?? run.tasks.first(where: { $0.status == .awaiting_review }) else { return false }
        return task.attempts > 1 || (task.corrections ?? 0) > 0 || (task.repairsUsed ?? 0) > 0
    }

    // MARK: Nodes

    private func node(_ stage: Stage, at date: Date) -> some View {
        let isCurrent = current == stage
        let reached = current.map { stage.rawValue <= $0.rawValue } ?? false
        // Blocked repaints the whole graph amber: when a run has stopped, which
        // rung it stopped on matters less than the fact that it stopped.
        let hue = run.isBlocked ? OrionTheme.orange : stage.hue
        let fill = isCurrent ? hue.opacity(0.18) : hue.opacity(0.05)
        let stroke = isCurrent ? hue : (reached ? hue.opacity(0.5) : hue.opacity(0.22))
        let seconds = date.timeIntervalSince1970
        let orbitAngle = seconds.truncatingRemainder(dividingBy: 2.8) / 2.8 * 360
        let breath = (sin(seconds * .pi) + 1) / 2
        return ZStack {
            Circle()
                .fill(fill)
                .overlay(Circle().strokeBorder(stroke, lineWidth: isCurrent ? 2 : 1))
                .shadow(color: isCurrent && live ? hue.opacity(0.6) : .clear, radius: 14)

            /*
             The orbit: a short arc circling the rung that is running.

             It is the one piece of pure motion here, and it is deliberately
             attached to the thing that is actually working rather than to the
             panel at large. A spinner that turns regardless of state is
             decoration; this one exists only while the heartbeat is live and
             only on the stage the controller says is in flight, so a still
             graph means a still run.
            */
            if isCurrent && live {
                Circle()
                    .trim(from: 0, to: 0.18)
                    .stroke(
                        AngularGradient(colors: [hue.opacity(0), hue], center: .center),
                        style: StrokeStyle(lineWidth: 3, lineCap: .round))
                    .frame(width: stage.radius * 2 + 16, height: stage.radius * 2 + 16)
                    .rotationEffect(.degrees(orbitAngle))
                    .shadow(color: hue.opacity(0.9), radius: 5)

                // A visible breath beneath the node shows that the worker is
                // active even when the moving arc is on its far side.
                Circle()
                    .stroke(hue.opacity(0.28 + breath * 0.34), lineWidth: 2.5)
                    .frame(width: stage.radius * 2 + 24, height: stage.radius * 2 + 24)
                    .scaleEffect(0.92 + breath * 0.13)
                    .blur(radius: 1.5)
            }
            VStack(spacing: 0) {
                ForEach(stage.lines, id: \.self) { line in
                    Text(line)
                        .font(OrionTheme.mono(stage.radius > 34 ? 9 : 8, isCurrent ? .semibold : .medium))
                        .tracking(0.9)
                        .foregroundStyle(isCurrent ? OrionTheme.text : (reached ? OrionTheme.textSoft : OrionTheme.textDim))
                }
            }
        }
        .frame(width: stage.radius * 2, height: stage.radius * 2)
        .animation(.easeInOut(duration: 0.35), value: isCurrent)
        .position(stage.position)
    }

    private var escalateNode: some View {
        ZStack {
            Circle()
                .fill(run.isBlocked ? OrionTheme.orange.opacity(0.16) : Color.white.opacity(0.03))
                .overlay(Circle().strokeBorder(
                    run.isBlocked ? OrionTheme.orange : Color.white.opacity(0.12),
                    style: StrokeStyle(lineWidth: run.isBlocked ? 2 : 1, dash: run.isBlocked ? [] : [3, 3])))
                .shadow(color: run.isBlocked ? OrionTheme.orange.opacity(0.5) : .clear, radius: 10)
            VStack(spacing: 0) {
                Text("ASTRA")
                    .font(OrionTheme.mono(7, .semibold))
                    .tracking(0.8)
                    .foregroundStyle(run.isBlocked ? OrionTheme.orange : OrionTheme.textDim)
                Text("via you")
                    .font(OrionTheme.mono(6))
                    .foregroundStyle(OrionTheme.textDim.opacity(0.8))
            }
        }
        .frame(width: Self.escalateRadius * 2, height: Self.escalateRadius * 2)
        .position(Self.escalatePoint)
    }
}

/// The same loop before a run exists. It keeps the Projects workspace legible
/// as a workflow, then the live dial above takes over as soon as state.json is
/// created. No stage is highlighted and nothing moves, because no supervisor
/// is running yet.
struct ProjectAgentLoopBlueprint: View {
    private let stages = ProjectAgentLoopDial.Stage.allCases
    private let edges: [(ProjectAgentLoopDial.Stage, ProjectAgentLoopDial.Stage)] = [
        (.worker, .tests), (.tests, .selfCheck), (.selfCheck, .review),
        (.review, .correct), (.correct, .worker),
    ]

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            ZStack(alignment: .topLeading) {
                Canvas { context, _ in
                    for (from, to) in edges {
                        var path = Path()
                        path.move(to: from.position)
                        path.addLine(to: to.position)
                        context.stroke(path, with: .color(Color.white.opacity(0.13)),
                                       style: StrokeStyle(lineWidth: 1.25, lineCap: .round))
                    }
                    var branch = Path()
                    branch.move(to: ProjectAgentLoopDial.Stage.review.position)
                    branch.addLine(to: ProjectAgentLoopDial.escalatePoint)
                    context.stroke(branch, with: .color(Color.white.opacity(0.10)),
                                   style: StrokeStyle(lineWidth: 1, dash: [4, 4]))
                }
                .frame(width: ProjectAgentLoopDial.canvas.width, height: ProjectAgentLoopDial.canvas.height)

                ForEach(stages) { stage in
                    ZStack {
                        Circle().fill(stage.hue.opacity(0.06))
                            .overlay(Circle().strokeBorder(stage.hue.opacity(0.28), lineWidth: 1))
                        VStack(spacing: 0) {
                            ForEach(stage.lines, id: \.self) { line in
                                Text(line).font(OrionTheme.mono(stage.radius > 34 ? 9 : 8, .medium))
                                    .tracking(0.9).foregroundStyle(OrionTheme.textDim)
                            }
                        }
                    }
                    .frame(width: stage.radius * 2, height: stage.radius * 2)
                    .position(stage.position)
                }

                ZStack {
                    Circle().fill(Color.white.opacity(0.03))
                        .overlay(Circle().strokeBorder(Color.white.opacity(0.12),
                                                       style: StrokeStyle(lineWidth: 1, dash: [3, 3])))
                    VStack(spacing: 0) {
                        Text("ASTRA").font(OrionTheme.mono(7, .semibold)).tracking(0.8)
                        Text("via you").font(OrionTheme.mono(6))
                    }.foregroundStyle(OrionTheme.textDim)
                }
                .frame(width: 48, height: 48).position(ProjectAgentLoopDial.escalatePoint)
            }
            .frame(width: ProjectAgentLoopDial.canvas.width, height: ProjectAgentLoopDial.canvas.height)

            Text("Start the project to light the live worker → tests → self-check → review loop.")
                .font(.system(size: 12)).foregroundStyle(OrionTheme.textDim)
        }
    }
}

/// The loop owns the previously empty right third of Projects. It stays in
/// place while Plan, Activity and Reviews change, so progress never disappears
/// just because the operator opens a document or review.
struct ProjectWorkflowSidebar: View {
    let run: ProjectAgentStatus?
    let beat: ProjectAgentHeartbeat?

    private var live: Bool { beat?.isLive == true }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("AGENT LOOP")
                        .font(OrionTheme.mono(10, .semibold)).tracking(1.8)
                    Text("Local build pipeline")
                        .font(.system(size: 11)).foregroundStyle(OrionTheme.textDim)
                }
                Spacer()
                HStack(spacing: 5) {
                    ProjectPulseOrb(mood: live ? .working : .idle, size: 12)
                    Text(live ? "LIVE" : "READY").font(OrionTheme.mono(8, .semibold)).tracking(0.8)
                }
                .padding(.horizontal, 9).padding(.vertical, 6)
                .background(.white.opacity(0.05), in: Capsule())
            }

            VStack(alignment: .leading, spacing: 8) {
                HStack(alignment: .firstTextBaseline) {
                    Text("PROGRESS").font(OrionTheme.mono(8, .semibold)).tracking(1.1)
                        .foregroundStyle(OrionTheme.textDim)
                    Spacer()
                    Text(progressPercent).font(OrionTheme.mono(18, .semibold))
                        .foregroundStyle(run?.finalReview == true ? OrionTheme.green : OrionTheme.text)
                }
                if let run { ProjectTaskStrip(run: run, height: 5) }
                else { Capsule().fill(.white.opacity(0.08)).frame(height: 5) }
                Text(progressDetail).font(.system(size: 11)).foregroundStyle(OrionTheme.textDim)
                    .lineLimit(2).fixedSize(horizontal: false, vertical: true)
                if let active = run?.active {
                    Label(active.subtask?.caption ?? active.title,
                          systemImage: "arrow.right.circle.fill")
                        .font(.system(size: 11, weight: .medium)).foregroundStyle(active.stage == .repair ? OrionTheme.orange : OrionTheme.textSoft)
                        .lineLimit(2)
                }
            }
            .padding(12).background(.black.opacity(0.16), in: RoundedRectangle(cornerRadius: 12))

            Group {
                if let run { ProjectAgentLoopDial(run: run, beat: beat) }
                else { ProjectAgentLoopBlueprint() }
            }

            Rectangle().fill(.white.opacity(0.08)).frame(height: 1)
            HStack {
                Label("Worker", systemImage: "hammer")
                Spacer()
                Label("Reviewer", systemImage: "checkmark.seal")
            }
            .font(.system(size: 10, weight: .medium)).foregroundStyle(OrionTheme.textDim)
        }
        .padding(16)
        .background(
            ZStack {
                RoundedRectangle(cornerRadius: 20).fill(Color.white.opacity(0.028))
                RadialGradient(colors: [OrionTheme.accent.opacity(0.09), .clear],
                               center: .topLeading, startRadius: 0, endRadius: 330)
                    .clipShape(RoundedRectangle(cornerRadius: 20))
            })
        .overlay(RoundedRectangle(cornerRadius: 20).stroke(.white.opacity(0.08), lineWidth: 1))
    }

    private var progressPercent: String {
        guard let run else { return "0%" }
        let value = min(run.finalReview ? 100 : 99, Int((run.acceptedFraction * 100).rounded(.down)))
        return "\(value)%"
    }

    private var progressDetail: String {
        guard let run else { return "Progress begins when the first task is accepted." }
        if run.finalReview { return "Finished · all tasks accepted and final review passed" }
        if run.awaitingFinalReview { return "All tasks accepted · waiting for final review" }
        return "\(run.acceptedCount) of \(run.tasks.count) tasks accepted · \(beat?.summary ?? "No heartbeat yet")"
    }
}
