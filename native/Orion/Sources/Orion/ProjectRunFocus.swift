import SwiftUI
import AppKit

/*
 The run view: what pressing Start opens (Nick, 2026-09-26).

 "Think of ChatGPT's voice mode — the orb covers your screen, and you swipe down
 to see the chat." Start pulls up only what matters while a run is going: the
 orb, the whole-plan and current-task progress, and the model thinking live.
 The sidebars, run settings and plan tabs step aside; swipe down, press Esc, or
 "Show everything" brings the normal view back.

 Every number here is read from the controller's own state. Nothing is a
 second progress clock.
*/

/// Progress estimates from the controller's recorded stage and the worker's own
/// declared steps. The controller does not publish a per-task percentage, so
/// this says "about" and never claims 100 before the task is accepted.
enum RunProgress {
    /// 0...1 for one task.
    static func fraction(_ task: ProjectAgentStatus.WorkItem) -> Double {
        if task.status == .accepted || task.stage == .accepted { return 1 }
        switch task.stage {
        case .queued, .unknown: return 0
        case .inspect, .implement:
            // "Step 2 of 5" means one step is behind it.
            guard let step = task.subtask, step.total > 0 else { return task.stage == .inspect ? 0.05 : 0.10 }
            let done = Double(max(0, min(step.index - 1, step.total))) / Double(step.total)
            return 0.05 + 0.65 * done
        case .test: return 0.75
        case .repair: return 0.80
        case .review: return 0.90
        case .accepted: return 1
        }
    }

    /// 0...1 for the whole plan, weighted like the controller's own progress.
    /// Held under 100% until the run is complete and its final review passed.
    static func overall(_ run: ProjectAgentStatus) -> Double {
        let total = run.tasks.reduce(0) { $0 + $1.weight }
        guard total > 0 else { return 0 }
        let done = run.tasks.reduce(0) { $0 + $1.weight * fraction($1) } / total
        return run.status == .completed && run.finalReview ? 1 : min(done, 0.99)
    }

    /// 1-based position of the task being worked on, in plan order.
    static func position(_ run: ProjectAgentStatus) -> Int? {
        guard let id = run.activeTask, let index = run.tasks.firstIndex(where: { $0.id == id }) else { return nil }
        return index + 1
    }

    static let rail: [(stage: ProjectAgentStatus.Stage, label: String)] =
        [(.inspect, "Inspect"), (.implement, "Build"), (.test, "Check"), (.review, "Review"), (.accepted, "Accepted")]

    /// Where on the rail a stage sits; repair counts as going back to Build.
    static func railIndex(_ stage: ProjectAgentStatus.Stage) -> Int {
        switch stage {
        case .queued, .unknown: return -1
        case .inspect: return 0
        case .implement, .repair: return 1
        case .test: return 2
        case .review: return 3
        case .accepted: return 4
        }
    }
}

struct ProjectRunFocusView: View {
    let projectName: String
    let run: ProjectAgentStatus?
    let beat: ProjectAgentHeartbeat?
    let activity: ProjectAgentActivity?
    let mood: ProjectMood
    let status: String
    let subline: String
    let live: Bool
    let holding: Bool
    let busy: Bool
    let onPause: () -> Void
    let onStop: () -> Void
    let onResume: () -> Void
    let onDismiss: () -> Void

    @State private var drag: CGFloat = 0
    @State private var escape: Any?
    /// The loop diagram is drawn on a 300×350 canvas; here it is the centrepiece.
    private let dialScale: CGFloat = 1.35

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            topBar
            // Pinned: status, Pause/Stop and the overall number never scroll away.
            header.padding(.horizontal, 32).padding(.top, 4).padding(.bottom, 16)
            Rectangle().fill(OrionTheme.line).frame(height: 1).padding(.horizontal, 32)
            ScrollView {
                HStack(alignment: .top, spacing: 36) {
                    loop
                    VStack(alignment: .leading, spacing: 24) {
                        if let run { plan(run) }
                        if let task = run?.active { current(task) }
                        stream
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .padding(.horizontal, 32).padding(.top, 20).padding(.bottom, 24)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(OrionTheme.ink.opacity(0.97))
        .offset(y: max(0, drag))
        .opacity(1 - min(0.5, Double(max(0, drag)) / 600))
        .gesture(
            DragGesture(minimumDistance: 12)
                .onChanged { value in drag = value.translation.height }
                .onEnded { value in
                    if value.translation.height > 140 || value.predictedEndTranslation.height > 320 { onDismiss() }
                    withAnimation(.spring(response: 0.35, dampingFraction: 0.85)) { drag = 0 }
                }
        )
        // Esc straight from the keyboard, whatever has focus in the window.
        .onAppear {
            escape = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { event in
                guard event.keyCode == 53 else { return event }
                onDismiss(); return nil
            }
        }
        .onDisappear { if let escape { NSEvent.removeMonitor(escape) }; escape = nil }
    }

    // MARK: - Pieces

    private var topBar: some View {
        ZStack {
            Capsule().fill(OrionTheme.textDim).frame(width: 44, height: 5)
                .padding(.vertical, 10).contentShape(Rectangle())
                .onTapGesture(perform: onDismiss)
                .help("Swipe down or click to show everything")
            HStack {
                Text(projectName.uppercased()).font(OrionTheme.mono(10, .semibold)).tracking(1.4)
                    .foregroundStyle(OrionTheme.textDim).lineLimit(1)
                Spacer()
                Button(action: onDismiss) {
                    Label("Show everything", systemImage: "chevron.down").font(.system(size: 12, weight: .medium))
                }
                .buttonStyle(.plain).foregroundStyle(OrionTheme.textSoft)
                .keyboardShortcut(.cancelAction)
                .help("Back to the full project view (Esc)")
            }
        }
        .padding(.horizontal, 32).padding(.top, 10)
    }

    private var header: some View {
        HStack(alignment: .center, spacing: 22) {
            ProjectPulseOrb(mood: mood, size: 46)
            VStack(alignment: .leading, spacing: 6) {
                Text(status).font(.system(size: 24, weight: .semibold, design: .rounded)).tracking(-0.3).foregroundStyle(mood == .idle ? OrionTheme.textSoft : mood.tint)
                    .id(status)
                    .transition(.asymmetric(insertion: .move(edge: .bottom).combined(with: .opacity),
                                            removal: .move(edge: .top).combined(with: .opacity)))
                Text(subline).font(.system(size: 12.5)).foregroundStyle(OrionTheme.textSoft).lineLimit(1)
            }
            .clipped()
            Spacer(minLength: 20)
            controls
            if let run {
                VStack(alignment: .trailing, spacing: 0) {
                    Text("\(Int((RunProgress.overall(run) * 100).rounded(.down)))%")
                        .font(.system(size: 54, weight: .ultraLight, design: .rounded)).monospacedDigit().tracking(-1.5)
                        .foregroundStyle(OrionTheme.text)
                        .contentTransition(.numericText())
                    Text(positionLine(run)).font(OrionTheme.mono(10)).foregroundStyle(OrionTheme.textSoft)
                }
                .padding(.leading, 14)
            }
        }
        .animation(.spring(response: 0.45, dampingFraction: 0.85), value: status)
    }

    /// The worker → tests → self check → review → correct loop, large and live.
    @ViewBuilder private var loop: some View {
        let size = ProjectAgentLoopDial.canvas
        Group {
            if let run { ProjectAgentLoopDial(run: run, beat: beat) } else { ProjectAgentLoopBlueprint() }
        }
        .frame(width: size.width, alignment: .topLeading)
        .scaleEffect(dialScale, anchor: .topLeading)
        .frame(width: size.width * dialScale, height: (size.height + 40) * dialScale, alignment: .topLeading)
    }

    private func positionLine(_ run: ProjectAgentStatus) -> String {
        let done = "\(run.acceptedCount) of \(run.tasks.count) accepted"
        guard let at = RunProgress.position(run) else { return done }
        return "task \(at) of \(run.tasks.count) · \(done)"
    }

    /// One hairline segment per task: done, now (partly filled), parked, waiting.
    private func plan(_ run: ProjectAgentStatus) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("WHOLE PLAN").font(OrionTheme.mono(9, .semibold)).tracking(1.3).foregroundStyle(OrionTheme.textDim)
                Spacer()
                if run.blockedCount > 0 { Text("\(run.blockedCount) parked").font(OrionTheme.mono(10)).foregroundStyle(OrionTheme.orange) }
                if run.correctionCount > 0 { Text("· \(run.correctionCount) added by review").font(OrionTheme.mono(10)).foregroundStyle(OrionTheme.textDim) }
            }
            GeometryReader { proxy in
                let gap: CGFloat = run.tasks.count > 30 ? 2 : 4
                let width = max(2, (proxy.size.width - gap * CGFloat(max(0, run.tasks.count - 1))) / CGFloat(max(1, run.tasks.count)))
                HStack(spacing: gap) {
                    ForEach(run.tasks) { task in segment(task, active: task.id == run.activeTask, width: width, parked: run.isParked(task)) }
                }
            }
            .frame(height: 8)
        }
    }

    private func segment(_ task: ProjectAgentStatus.WorkItem, active: Bool, width: CGFloat, parked: Bool) -> some View {
        let parkedHere = parked || task.status == .blocked
        // A parked task is shown whole, in orange: it is waiting on a person, not 10% done.
        let fill = parkedHere ? 1 : RunProgress.fraction(task)
        let tint = task.status == .accepted ? OrionTheme.green : parked || task.status == .blocked ? OrionTheme.orange : OrionTheme.accent
        return ZStack(alignment: .leading) {
            Capsule().fill(Color.white.opacity(0.08))
            Capsule().fill(tint.opacity(active ? 1 : parkedHere ? 0.55 : 0.85)).frame(width: width * fill)
        }
        .frame(width: width, height: active ? 8 : 5)
        .shadow(color: active ? tint.opacity(0.6) : .clear, radius: 6)
        .help("\(task.title) — \(Int(fill * 100))%")
        .animation(.easeInOut(duration: 0.6), value: fill)
    }

    private func current(_ task: ProjectAgentStatus.WorkItem) -> some View {
        let fraction = RunProgress.fraction(task)
        let at = RunProgress.railIndex(task.stage)
        return VStack(alignment: .leading, spacing: 11) {
            Text("NOW").font(OrionTheme.mono(9, .semibold)).tracking(1.3).foregroundStyle(OrionTheme.textDim)
            HStack(alignment: .firstTextBaseline) {
                Text(task.title).font(.system(size: 18, weight: .semibold)).tracking(-0.2).lineLimit(2)
                Spacer(minLength: 16)
                Text("≈\(Int(fraction * 100))%").font(.system(size: 28, weight: .light, design: .rounded)).monospacedDigit()
                    .foregroundStyle(OrionTheme.accent).contentTransition(.numericText())
                    .help("An estimate from the task's stage and the worker's declared steps")
            }
            GeometryReader { proxy in
                ZStack(alignment: .leading) {
                    Capsule().fill(Color.white.opacity(0.08))
                    Capsule().fill(LinearGradient(colors: [OrionTheme.accent.opacity(0.5), OrionTheme.accent], startPoint: .leading, endPoint: .trailing))
                        .frame(width: proxy.size.width * fraction)
                }
            }
            .frame(height: 4)
            .animation(.easeInOut(duration: 0.6), value: fraction)
            HStack(spacing: 0) {
                ForEach(Array(RunProgress.rail.enumerated()), id: \.offset) { index, step in
                    HStack(spacing: 7) {
                        Circle().fill(index < at ? OrionTheme.green : index == at ? OrionTheme.accent : Color.white.opacity(0.14))
                            .frame(width: index == at ? 9 : 6, height: index == at ? 9 : 6)
                        Text(step.label).font(.system(size: 11.5, weight: index == at ? .semibold : .regular))
                            .foregroundStyle(index == at ? OrionTheme.text : index < at ? OrionTheme.textSoft : OrionTheme.textDim)
                    }
                    if index < RunProgress.rail.count - 1 {
                        Rectangle().fill(index < at ? OrionTheme.green.opacity(0.5) : Color.white.opacity(0.08))
                            .frame(height: 1).frame(maxWidth: .infinity).padding(.horizontal, 10)
                    }
                }
            }
            if let step = task.subtask {
                Text(step.total > 1 ? "Step \(step.index) of \(step.total) · \(step.cleanLabel)" : step.cleanLabel)
                    .font(.system(size: 12.5)).foregroundStyle(OrionTheme.textSoft).lineLimit(2)
            }
            if task.attempts > 1 || (task.corrections ?? 0) > 0 {
                Text("attempt \(task.attempts)\((task.corrections ?? 0) > 0 ? " · \(task.corrections ?? 0) correction(s)" : "")")
                    .font(OrionTheme.mono(10)).foregroundStyle(OrionTheme.textDim)
            }
        }
    }

    @ViewBuilder private var stream: some View {
        if let activity, !activity.isIdle || live {
            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 10) {
                    ThinkingDots(active: activity.streaming, tint: activity.thinking ? OrionTheme.violet : OrionTheme.accent)
                    Text(activity.headline).font(OrionTheme.mono(11, .semibold)).foregroundStyle(OrionTheme.text)
                    Spacer()
                    Text("\(activity.thinkingChars.formatted()) thought · \(activity.outputChars.formatted()) written")
                        .font(OrionTheme.mono(10)).foregroundStyle(OrionTheme.textDim)
                }
                let tail = Self.tail(activity.thinking || activity.output.isEmpty ? activity.trace : activity.output)
                if !tail.isEmpty {
                    Text(tail).font(.system(size: 11.5, design: .monospaced)).foregroundStyle(OrionTheme.textSoft)
                        .lineSpacing(2.5).frame(maxWidth: .infinity, alignment: .bottomLeading)
                        .frame(height: 132, alignment: .bottom).clipped()
                        .mask(LinearGradient(colors: [.clear, .black, .black], startPoint: .top, endPoint: .bottom))
                }
            }
        }
    }

    /// The last few lines of what the model is producing: enough to see it think.
    static func tail(_ text: String, lines: Int = 9, maxChars: Int = 1_400) -> String {
        let clipped = text.count > maxChars ? String(text.suffix(maxChars)) : text
        return clipped.split(separator: "\n", omittingEmptySubsequences: true).suffix(lines).joined(separator: "\n")
    }

    private var controls: some View {
        HStack(spacing: 10) {
            if live {
                if holding {
                    ConsoleButton(title: "Resume", symbol: "play.fill", prominent: true, working: busy, action: onResume)
                } else {
                    ConsoleButton(title: "Pause", symbol: "pause.fill", tint: OrionTheme.blue, working: busy, action: onPause)
                }
                ConsoleButton(title: "Stop", symbol: "stop.fill", tint: OrionTheme.text, working: busy, action: onStop)
            }
            if let beat, let since = beat.since, live {
                Text("\(beat.role == "reviewer" ? "reviewing" : "working") for \(ProjectWorkspace.elapsed(since: since))")
                    .font(OrionTheme.mono(10)).foregroundStyle(OrionTheme.textDim)
            }
        }
    }
}

/// Three dots that breathe while tokens are actually streaming, and rest when not.
struct ThinkingDots: View {
    let active: Bool
    var tint: Color = OrionTheme.accent
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        TimelineView(.animation(paused: !active || reduceMotion)) { context in
            let t = context.date.timeIntervalSinceReferenceDate
            HStack(spacing: 4) {
                ForEach(0..<3) { index in
                    let phase = active ? (sin(t * 5 - Double(index) * 0.8) + 1) / 2 : 0.3
                    Circle().fill(tint.opacity(0.35 + 0.65 * phase)).frame(width: 5, height: 5)
                        .offset(y: active ? -2.5 * phase : 0)
                }
            }
        }
        .accessibilityHidden(true)
    }
}
