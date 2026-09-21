import SwiftUI

/*
 The project agent, as something you can read from across the room.

 Two clocks, not one. The mission asks for progress on the CURRENT task and
 separately for the PLAN as a whole, and they answer different questions:
 "is it stuck?" and "how much is left?". One ring answering both would answer
 neither — a task ring alone hides that four tasks remain, and a plan ring alone
 sits still for forty minutes while a task runs and looks frozen.

 Neither number comes from a model. Plan progress is accepted task WEIGHT over
 total weight; task progress is the recorded stage's position in the lifecycle.
 Nothing here lets an LLM assert "72% complete".

 Layout follows the house taste: no card behind every element, hairlines that
 fade rather than enclose, deliberately unequal columns and staggered vertical
 offsets, one large number per idea.
*/

// MARK: - Stage progression

private extension ProjectAgentStatus.Stage {
    /// Where this stage sits in the task lifecycle, 0...1.
    ///
    /// From the recorded stage, not from elapsed time: a task that has been
    /// implementing for forty minutes is at "implement", and a bar that crept
    /// forward on a timer would be inventing a number.
    var fraction: Double {
        switch self {
        case .queued: return 0
        case .inspect: return 0.2
        case .implement: return 0.45
        case .test: return 0.7
        case .review: return 0.88
        case .repair: return 0.88
        case .accepted: return 1
        case .unknown: return 0
        }
    }

    var label: String {
        self == .unknown ? "Unknown stage" : rawValue.replacingOccurrences(of: "_", with: " ").capitalized
    }
}

// MARK: - Panel

struct ProjectAgentPanel: View {
    let run: ProjectAgentStatus
    let beat: ProjectAgentHeartbeat?
    let activity: ProjectAgentActivity?
    let settings: ProjectAgentSettings?
    @Binding var steering: String
    let controlling: Bool
    let controlError: String?
    let onControl: (ProjectAgentControl.Command) -> Void

    @State private var openDocument: String?
    @State private var showSettings = false

    var body: some View {
        VStack(alignment: .leading, spacing: 30) {
            heading
            clocks
            thinkingChannel
            if run.escalation != nil { escalationBanner }
            taskLedger
            controls
            instructions
        }
    }

    // MARK: Heading

    private var heading: some View {
        VStack(alignment: .leading, spacing: 7) {
            HStack(spacing: 9) {
                Circle()
                    .fill(statusTint)
                    .frame(width: 7, height: 7)
                    .shadow(color: statusTint.opacity(0.8), radius: 5)
                Text(run.status.rawValue.replacingOccurrences(of: "_", with: " ").uppercased())
                    .font(OrionTheme.mono(9, .semibold))
                    .tracking(1.8)
                    .foregroundStyle(OrionTheme.textSoft)
                Text(liveness)
                    .font(OrionTheme.mono(9))
                    .foregroundStyle((beat?.isLive ?? false) ? OrionTheme.textDim : OrionTheme.orange)
            }
            Text(run.tasks.first(where: { $0.id == run.activeTask })?.title ?? planHeadline)
                .font(OrionTheme.display(21))
                .foregroundStyle(OrionTheme.text)
        }
    }

    private var planHeadline: String {
        if run.finalReview { return "Run complete" }
        if run.awaitingFinalReview { return "Awaiting final review" }
        if run.isBlocked { return "Stopped — needs you" }
        return "No task running"
    }

    private var liveness: String {
        guard let beat else { return "no heartbeat recorded" }
        return beat.isLive ? "supervisor live · \(Int(beat.age ?? 0))s ago" : beat.summary
    }

    private var statusTint: Color {
        switch run.status {
        case .running: return OrionTheme.accent
        case .completed: return OrionTheme.green
        case .escalated, .interrupted: return OrionTheme.orange
        case .paused, .budget_exhausted: return OrionTheme.textDim
        default: return OrionTheme.blue
        }
    }

    // MARK: The two clocks

    private var clocks: some View {
        HStack(alignment: .top, spacing: 46) {
            VStack(alignment: .leading, spacing: 9) {
                RingMeter(
                    progress: run.acceptedFraction,
                    value: "\(min(run.finalReview ? 100 : 99, Int((run.acceptedFraction * 100).rounded(.down))))",
                    caption: "plan",
                    subcaption: "\(run.acceptedCount)/\(run.tasks.count) accepted",
                    tint: OrionTheme.accent,
                    diameter: 132
                )
                Text(planFootnote)
                    .font(OrionTheme.mono(8))
                    .foregroundStyle(OrionTheme.textDim)
                    .frame(width: 148, alignment: .leading)
            }

            // Offset rather than aligned: a grid of two equal rings reads as a
            // settings form, and these are not equal in importance.
            VStack(alignment: .leading, spacing: 9) {
                RingMeter(
                    progress: run.active?.stage.fraction ?? (run.awaitingFinalReview ? 1 : 0),
                    value: taskRingValue,
                    caption: "task",
                    subcaption: run.active.map { "attempt \($0.attempts)" } ?? "—",
                    tint: run.isBlocked ? OrionTheme.orange : OrionTheme.violet,
                    diameter: 104
                )
                Text(run.active?.stage.label ?? "Nothing in flight")
                    .font(OrionTheme.mono(8))
                    .foregroundStyle(OrionTheme.textDim)
                    .frame(width: 120, alignment: .leading)
            }
            .padding(.top, 26)

            Spacer(minLength: 0)
        }
    }

    private var taskRingValue: String {
        guard let active = run.active else { return "—" }
        return "\(Int((active.stage.fraction * 100).rounded()))"
    }

    private var planFootnote: String {
        var parts = ["accepted weight, capped until final review"]
        if run.correctionCount > 0 { parts.append("\(run.correctionCount) task(s) added by review") }
        if run.blockedCount > 0 { parts.append("\(run.blockedCount) blocked") }
        return parts.joined(separator: " · ")
    }

    // MARK: Live thinking

    private var thinkingChannel: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 9) {
                ThinkingPulse(active: activity?.thinking ?? false, streaming: activity?.streaming ?? false)
                Text(activity?.headline ?? "No activity recorded")
                    .font(OrionTheme.mono(9, .semibold))
                    .tracking(1.2)
                    .foregroundStyle(activity?.isIdle == false ? OrionTheme.textSoft : OrionTheme.textDim)
                Spacer()
                if let activity, activity.thinkingChars > 0 {
                    Text("\(activity.thinkingChars) chars of reasoning")
                        .font(OrionTheme.mono(8))
                        .foregroundStyle(OrionTheme.textDim)
                }
            }

            if let activity, !activity.trace.isEmpty || !activity.output.isEmpty {
                ScrollView {
                    VStack(alignment: .leading, spacing: 10) {
                        if !activity.trace.isEmpty {
                            Text(activity.trace)
                                .font(OrionTheme.mono(10))
                                .foregroundStyle(OrionTheme.textSoft)
                                .textSelection(.enabled)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                        if !activity.output.isEmpty {
                            Text(activity.output)
                                .font(OrionTheme.mono(10))
                                .foregroundStyle(OrionTheme.text)
                                .textSelection(.enabled)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                    }
                    .padding(.vertical, 2)
                }
                .frame(maxHeight: 150)
                .scrollIndicators(.never)
            } else {
                Text("The reasoning channel fills while a model generates. It is a live view, not the audit record — the journal keeps that.")
                    .font(OrionTheme.mono(9))
                    .foregroundStyle(OrionTheme.textDim)
            }
        }
        .padding(.leading, 13)
        .overlay(alignment: .leading) { fadingRule }
    }

    // MARK: Escalation

    private var escalationBanner: some View {
        VStack(alignment: .leading, spacing: 7) {
            if let escalation = run.escalation {
                Text("BLOCKED · \(escalation.kind.replacingOccurrences(of: "_", with: " ").uppercased())")
                    .font(OrionTheme.mono(9, .semibold))
                    .tracking(1.6)
                    .foregroundStyle(OrionTheme.orange)
                Text(escalation.reason)
                    .font(OrionTheme.mono(11))
                    .foregroundStyle(OrionTheme.text)
                    .textSelection(.enabled)
                if let question = escalation.question {
                    Text(question)
                        .font(OrionTheme.mono(10))
                        .foregroundStyle(OrionTheme.textSoft)
                        .textSelection(.enabled)
                }
                HStack(spacing: 14) {
                    if escalation.recommendAstra {
                        Text("ASTRA REVIEW RECOMMENDED — start it yourself; nothing here calls it")
                            .font(OrionTheme.mono(8, .semibold))
                            .tracking(1.2)
                            .foregroundStyle(OrionTheme.violet)
                    }
                    Text(escalation.notified ? "alerted on Discord" : "Discord alert NOT delivered")
                        .font(OrionTheme.mono(8))
                        .foregroundStyle(escalation.notified ? OrionTheme.textDim : OrionTheme.orange)
                }
            }
        }
        .padding(.leading, 13)
        .overlay(alignment: .leading) {
            Rectangle().fill(OrionTheme.orange.opacity(0.5)).frame(width: 1)
        }
    }

    // MARK: Tasks

    private var taskLedger: some View {
        VStack(alignment: .leading, spacing: 9) {
            Text("PLAN")
                .font(OrionTheme.mono(8, .semibold))
                .tracking(1.8)
                .foregroundStyle(OrionTheme.textDim)
            ForEach(run.tasks) { task in
                HStack(alignment: .firstTextBaseline, spacing: 11) {
                    Text(task.status == .accepted ? "●" : task.status == .blocked ? "▲" : task.status == .running ? "◆" : "○")
                        .font(OrionTheme.mono(9))
                        .foregroundStyle(tint(for: task.status))
                    VStack(alignment: .leading, spacing: 2) {
                        HStack(spacing: 7) {
                            Text(task.title)
                                .font(OrionTheme.mono(11))
                                .foregroundStyle(task.status == .accepted ? OrionTheme.textSoft : OrionTheme.text)
                            if task.isCorrection {
                                Text("FROM REVIEW")
                                    .font(OrionTheme.mono(7, .semibold))
                                    .tracking(1.1)
                                    .foregroundStyle(OrionTheme.violet)
                            }
                        }
                        if let blocker = task.blocker {
                            Text(blocker)
                                .font(OrionTheme.mono(9))
                                .foregroundStyle(OrionTheme.orange)
                        }
                    }
                    Spacer(minLength: 12)
                    if let commit = task.commit {
                        Text(String(commit.prefix(8)))
                            .font(OrionTheme.mono(9))
                            .foregroundStyle(OrionTheme.textDim)
                    }
                }
                .onTapGesture { toggle(ProjectAgentInstructions.contract(for: task).id) }
                if openDocument == ProjectAgentInstructions.contract(for: task).id {
                    documentBody(ProjectAgentInstructions.contract(for: task).body)
                }
            }
            if run.reviewerAuthoredChanges > 0 {
                Text("\(run.reviewerAuthoredChanges) change(s) were authored by the REVIEW model, not the worker — that work was not independently reviewed.")
                    .font(OrionTheme.mono(9))
                    .foregroundStyle(OrionTheme.orange)
                    .padding(.top, 3)
            }
        }
    }

    private func tint(for status: ProjectAgentStatus.TaskStatus) -> Color {
        switch status {
        case .accepted: return OrionTheme.green
        case .blocked: return OrionTheme.orange
        case .running: return OrionTheme.accent
        case .awaiting_review: return OrionTheme.violet
        default: return OrionTheme.textDim
        }
    }

    // MARK: Controls

    private var controls: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("CONTROL")
                .font(OrionTheme.mono(8, .semibold))
                .tracking(1.8)
                .foregroundStyle(OrionTheme.textDim)

            HStack(spacing: 10) {
                OutlineAction(title: "Pause", tint: OrionTheme.textSoft,
                              enabled: !controlling && [.running, .ready, .waiting_for_review].contains(run.status)) {
                    onControl(.pause)
                }
                OutlineAction(title: "Resume", tint: OrionTheme.accent,
                              enabled: !controlling && [.paused, .budget_exhausted].contains(run.status)
                                       && run.activeTask == nil && run.escalation == nil) {
                    onControl(.resume)
                }
                if run.escalation != nil {
                    // The controller requires a note, so the button must too.
                    // Offering an action the CLI will refuse teaches people the
                    // panel is lying to them, and this is the one moment they
                    // are already unsure what is going on.
                    OutlineAction(title: "Resolve escalation", tint: OrionTheme.orange,
                                  enabled: !controlling && !steering.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty) {
                        onControl(.resolve)
                    }
                    if steering.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                        Text("write a note below first")
                            .font(OrionTheme.mono(8))
                            .foregroundStyle(OrionTheme.textDim)
                    }
                }
                Spacer()
                if controlling {
                    Text("contacting controller…")
                        .font(OrionTheme.mono(9))
                        .foregroundStyle(OrionTheme.textDim)
                }
            }

            VStack(alignment: .leading, spacing: 6) {
                TextField(run.escalation == nil
                          ? "Instruction — delivered at the next task boundary"
                          : "Note — why this escalation is now safe to continue",
                          text: $steering, axis: .vertical)
                    .textFieldStyle(.plain)
                    .font(OrionTheme.mono(11))
                    .foregroundStyle(OrionTheme.text)
                    .lineLimit(1...4)
                    .padding(.vertical, 7)
                    .overlay(alignment: .bottom) { fadingRuleHorizontal }

                HStack(spacing: 10) {
                    OutlineAction(title: "Send instruction", tint: OrionTheme.blue,
                                  enabled: !controlling && !steering.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                                           && run.status != .completed) {
                        onControl(.steer)
                    }
                    Text("Steering never interrupts a task mid-flight; it is applied at the next boundary.")
                        .font(OrionTheme.mono(8))
                        .foregroundStyle(OrionTheme.textDim)
                }
            }

            ForEach(run.steering.suffix(3)) { item in
                Text("\(item.applied ? "applied" : "pending") · \(item.text)")
                    .font(OrionTheme.mono(9))
                    .foregroundStyle(item.applied ? OrionTheme.textDim : OrionTheme.blue)
            }

            if let controlError {
                Text(controlError)
                    .font(OrionTheme.mono(10))
                    .foregroundStyle(OrionTheme.orange)
                    .textSelection(.enabled)
            }
        }
    }

    // MARK: Instructions and settings

    private var instructions: some View {
        VStack(alignment: .leading, spacing: 11) {
            HStack {
                Text("AGENT OPERATING SYSTEM")
                    .font(OrionTheme.mono(8, .semibold))
                    .tracking(1.8)
                    .foregroundStyle(OrionTheme.textDim)
                Spacer()
                Button(showSettings ? "Hide settings" : "Settings") { showSettings.toggle() }
                    .buttonStyle(.plain)
                    .font(OrionTheme.mono(9))
                    .foregroundStyle(OrionTheme.textSoft)
            }

            if showSettings { settingsBody }

            ForEach(ProjectAgentInstructions.load()) { document in
                VStack(alignment: .leading, spacing: 4) {
                    HStack(alignment: .firstTextBaseline, spacing: 9) {
                        Text(openDocument == document.id ? "▾" : "▸")
                            .font(OrionTheme.mono(9))
                            .foregroundStyle(OrionTheme.textDim)
                        Text(document.title)
                            .font(OrionTheme.mono(11, .semibold))
                            .foregroundStyle(OrionTheme.text)
                        Text(document.subtitle)
                            .font(OrionTheme.mono(9))
                            .foregroundStyle(OrionTheme.textDim)
                    }
                    .contentShape(Rectangle())
                    .onTapGesture { toggle(document.id) }
                    if openDocument == document.id { documentBody(document.body) }
                }
            }
        }
    }

    private var settingsBody: some View {
        VStack(alignment: .leading, spacing: 5) {
            if let settings {
                ForEach(settings.summaryRows, id: \.0) { row in
                    HStack(alignment: .firstTextBaseline) {
                        Text(row.0)
                            .font(OrionTheme.mono(9))
                            .foregroundStyle(OrionTheme.textDim)
                            .frame(width: 168, alignment: .leading)
                        Text(row.1)
                            .font(OrionTheme.mono(10))
                            .foregroundStyle(row.1 == "DISABLED" ? OrionTheme.orange
                                             : row.1 == "ENABLED" ? OrionTheme.green : OrionTheme.text)
                    }
                }
            } else {
                Text("No agentic config exists, so unattended execution is OFF.")
                    .font(OrionTheme.mono(10))
                    .foregroundStyle(OrionTheme.orange)
            }
            // Read-only on purpose. `enabled` is the switch that decides whether
            // a model may change real code while nobody is watching, and it
            // lives outside the repository precisely so moving it takes a
            // deliberate act. A toggle in a window is not that act.
            Text("Settings are edited in \(ProjectAgentSettings.url.path) — deliberately a file, not a switch in this window.")
                .font(OrionTheme.mono(8))
                .foregroundStyle(OrionTheme.textDim)
                .textSelection(.enabled)
                .padding(.top, 4)
        }
        .padding(.leading, 13)
        .overlay(alignment: .leading) { fadingRule }
        .padding(.bottom, 6)
    }

    private func documentBody(_ text: String) -> some View {
        ScrollView {
            Text(text)
                .font(OrionTheme.mono(10))
                .foregroundStyle(OrionTheme.textSoft)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.vertical, 4)
        }
        .frame(maxHeight: 280)
        .scrollIndicators(.never)
        .padding(.leading, 18)
        .overlay(alignment: .leading) { fadingRule.padding(.leading, 5) }
    }

    private func toggle(_ id: String) {
        openDocument = openDocument == id ? nil : id
    }

    /// A hairline that fades out rather than enclosing anything.
    private var fadingRule: some View {
        LinearGradient(colors: [OrionTheme.line, OrionTheme.line.opacity(0)],
                       startPoint: .top, endPoint: .bottom)
            .frame(width: 1)
    }

    private var fadingRuleHorizontal: some View {
        LinearGradient(colors: [OrionTheme.line, OrionTheme.line.opacity(0)],
                       startPoint: .leading, endPoint: .trailing)
            .frame(height: 1)
    }
}

// MARK: - Pieces

/// The "is it alive" indicator. Driven by streamed tokens, never by status.
private struct ThinkingPulse: View {
    let active: Bool
    let streaming: Bool
    @State private var phase = false

    var body: some View {
        Circle()
            .fill(active ? OrionTheme.violet : streaming ? OrionTheme.accent : OrionTheme.textDim.opacity(0.5))
            .frame(width: 7, height: 7)
            .shadow(color: (active ? OrionTheme.violet : OrionTheme.accent).opacity(active || streaming ? 0.85 : 0), radius: 6)
            .scaleEffect(phase && (active || streaming) ? 1.45 : 1)
            .opacity(phase && (active || streaming) ? 0.55 : 1)
            .animation(active || streaming
                       ? .easeInOut(duration: 0.75).repeatForever(autoreverses: true)
                       : .default, value: phase)
            .onAppear { phase = true }
            .accessibilityLabel(active ? "Model is thinking" : streaming ? "Model is writing" : "Idle")
    }
}

/// Outline, not filled: the house taste is line-art over chrome.
private struct OutlineAction: View {
    let title: String
    let tint: Color
    let enabled: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(OrionTheme.mono(10, .medium))
                .foregroundStyle(enabled ? tint : OrionTheme.textDim.opacity(0.6))
                .padding(.horizontal, 13)
                .padding(.vertical, 6)
                .overlay {
                    RoundedRectangle(cornerRadius: 7)
                        .stroke(enabled ? tint.opacity(0.42) : OrionTheme.line, lineWidth: 1)
                }
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
    }
}
