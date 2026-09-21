import SwiftUI

/*
 Project — the branch, not the trunk.

 Nick's picture: Orion is the trunk and a mode is a big branch off it. This tab
 is where that branch is visible. It answers two questions in the order he asked
 them: is it active, and what is it doing.

 The status is READ, never asked for. `scripts/orion-code` writes
 `selfdev-state.json` after every task and this renders it, so the tab cannot
 disagree with the CLI about whether a run is alive. It refreshes on a timer
 rather than watching the file, because a five-second lie about a run measured
 in hours costs nothing and a file watcher that misses a write costs a wrong
 answer for as long as the window stays open.
 */

struct ProjectTab: View {
    @State private var status = SelfDevelopmentStatus.read()
    @State private var work: [String] = SelfDevelopmentStatus.recentWork()
    @State private var agent = ProjectAgentStatus.read()
    @State private var beat = ProjectAgentHeartbeat.read()
    @State private var steering = ""
    @State private var controlError: String?
    @State private var controlling = false
    @State private var mode: ConversationMode = .main

    private let refresh = Timer.publish(every: 5, on: .main, in: .common).autoconnect()

    var body: some View {
        HStack(alignment: .top, spacing: 54) {
            VStack(alignment: .leading, spacing: 34) {
                OrionPanel(padding: 22) { projectAgent }
                OrionPanel(padding: 22) { selfDevelopment }
                OrionPanel(padding: 22) { recentWork }
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            OrionPanel(padding: 18) { modeRail }
                .frame(width: 300)
                .padding(.top, 52)
        }
        .onReceive(refresh) { _ in
            agent = ProjectAgentStatus.read()
            beat = ProjectAgentHeartbeat.read()
            status = SelfDevelopmentStatus.read()
            work = SelfDevelopmentStatus.recentWork()
        }
    }

    private var projectAgent: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Text("PROJECT AGENT").font(.headline)
                Spacer()
                Button("Refresh") { agent = ProjectAgentStatus.read(); beat = ProjectAgentHeartbeat.read() }
            }
            switch agent {
            case .missing:
                Text("No project run configured.").foregroundStyle(.secondary)
            case .unreadable(let message):
                Text(message).foregroundStyle(.orange)
            case .available(let run):
                Text(run.status.rawValue.replacingOccurrences(of: "_", with: " ").capitalized)
                    .font(.title2)
                // Liveness is a separate fact from status. A crashed supervisor
                // leaves "running" published forever; without this line the tab
                // would show a spinner all night for a process that is gone.
                Text(beat?.summary ?? "No heartbeat recorded")
                    .font(.caption)
                    .foregroundStyle((beat?.isLive ?? false) ? Color.secondary : Color.orange)
                Text(run.progressLabel)
                if let escalation = run.escalation {
                    VStack(alignment: .leading, spacing: 5) {
                        Text("BLOCKED — \(escalation.kind.replacingOccurrences(of: "_", with: " "))")
                            .font(.headline).foregroundStyle(.orange)
                        Text(escalation.reason).font(.callout).textSelection(.enabled)
                        if let question = escalation.question {
                            Text(question).font(.callout).foregroundStyle(.secondary).textSelection(.enabled)
                        }
                        if escalation.recommendAstra {
                            Text("An Astra review is recommended. Start it manually in ChatGPT/Codex; nothing here calls it.")
                                .font(.caption).foregroundStyle(.secondary)
                        }
                        Text(escalation.notified ? "You were alerted on Discord." : "Discord alert not delivered.")
                            .font(.caption).foregroundStyle(escalation.notified ? Color.secondary : Color.orange)
                    }
                    .padding(.vertical, 4)
                }
                HStack(spacing: 14) {
                    ZStack {
                        Circle().stroke(Color.secondary.opacity(0.2), lineWidth: 5)
                        Circle().trim(from: 0, to: run.acceptedFraction)
                            .stroke(Color.accentColor, style: StrokeStyle(lineWidth: 5, lineCap: .round))
                            .rotationEffect(.degrees(-90))
                        Text("\(run.acceptedCount)/\(run.tasks.count)").font(.caption)
                    }.frame(width: 56, height: 56)
                        .accessibilityLabel("\(run.acceptedCount) of \(run.tasks.count) tasks accepted")
                    Text(run.awaitingFinalReview ? "Tasks accepted; final review pending" : "Accepted work")
                        .font(.caption).foregroundStyle(.secondary)
                }
                Text("Progress counts accepted task weights. A final review is required for completion.")
                    .font(.caption).foregroundStyle(.secondary)
                if run.status == .interrupted { Text("Interrupted work needs verified recovery before resuming.").font(.caption).foregroundStyle(.orange) }
                if run.reviewerAuthoredChanges > 0 {
                    // Surfaced because it is work that was NOT independently
                    // reviewed: the reviewer wrote it and then judged it.
                    Text("\(run.reviewerAuthoredChanges) change(s) were authored by the review model, not the worker.")
                        .font(.caption).foregroundStyle(.orange)
                }
                if let active = run.active {
                    HStack {
                        if run.status == .running {
                            ProgressView().progressViewStyle(.circular).controlSize(.small)
                                .accessibilityLabel("Task in progress; duration unknown")
                        } else {
                            Image(systemName: active.status == .accepted ? "checkmark.circle" : "pause.circle")
                        }
                        Text(active.title).font(.headline)
                    }
                    Text("Recorded stage: \(active.stage.rawValue) · attempt \(active.attempts)").font(.caption)
                }
                ForEach(run.tasks) { task in
                    VStack(alignment: .leading, spacing: 3) {
                        HStack(spacing: 6) {
                            if task.isCorrection {
                                Image(systemName: "arrow.uturn.backward.circle")
                                    .foregroundStyle(.secondary)
                                    .accessibilityLabel("Added by a review")
                            }
                            Text("\(task.title) · \(task.status.rawValue.replacingOccurrences(of: "_", with: " "))")
                        }
                        if let blocker = task.blocker { Text(blocker).foregroundStyle(.orange) }
                    }.font(.callout)
                }
                HStack {
                    Button("Pause") { control(.pause, run: run) }
                        .disabled(controlling || ![.running, .ready, .waiting_for_review].contains(run.status))
                    Button("Resume") { control(.resume, run: run) }
                        .disabled(controlling || (![.paused, .budget_exhausted].contains(run.status) || run.activeTask != nil || run.escalation != nil))
                }
                TextField("Instruction for the next safe point", text: $steering)
                Button("Send instruction") { control(.steer, run: run) }
                    .disabled(controlling || steering.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || run.status == .completed)
                ForEach(run.steering.suffix(3)) { item in
                    Text("\(item.applied ? "Applied" : "Pending"): \(item.text)").font(.caption)
                }
                ForEach(Array(run.events.suffix(5).enumerated()), id: \.offset) { _, event in
                    Text("\(event.at) · \(event.message)").font(.caption).foregroundStyle(.secondary)
                }
                Text("Run \(run.runId) · revision \(run.revision). Changes are not installation or deployment.")
                    .font(.caption).foregroundStyle(.secondary)
            }
            if controlling { ProgressView("Contacting controller…") }
            if let controlError { Text(controlError).foregroundStyle(.orange).textSelection(.enabled) }
        }
    }

    private func control(_ command: ProjectAgentControl.Command, run: ProjectAgentStatus) {
        controlling = true
        controlError = nil
        let submittedText = steering.trimmingCharacters(in: .whitespacesAndNewlines)
        ProjectAgentControl.send(command, revision: run.revision, text: submittedText) { error in
            controlling = false
            controlError = error
            if error == nil && command == .steer && steering.trimmingCharacters(in: .whitespacesAndNewlines) == submittedText { steering = "" }
            agent = ProjectAgentStatus.read()
        }
    }

    // MARK: - Is it active, and what is it doing

    private var selfDevelopment: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 10) {
                Circle()
                    .fill(activityColour)
                    .frame(width: 9, height: 9)
                Text("LEGACY CODER")
                    .font(.system(size: 11, weight: .semibold))
                    .kerning(1.4)
                    .foregroundStyle(OrionTheme.textDim)
            }

            Text(status.headline)
                .font(.system(size: 22, weight: .medium))
                .foregroundStyle(OrionTheme.text)

            if let detail = status.detail {
                Text(detail)
                    .font(.system(size: 13))
                    .foregroundStyle(OrionTheme.textSoft)
                    .fixedSize(horizontal: false, vertical: true)
            }

            if let started = status.startedAt {
                Text(status.activity == .running
                     ? "since \(started)"
                     : "started \(started)")
                    .font(.system(size: 12))
                    .foregroundStyle(OrionTheme.textDim)
            }

            // Said on every screen that shows this work, because it is the thing
            // most likely to be misread: a green count does not mean the code is
            // in the app.
            Text("Work lands on the orion-selfdev branch in a worktree. "
                 + "Nothing here is installed or pushed.")
                .font(.system(size: 12))
                .foregroundStyle(OrionTheme.textDim)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 2)
        }
    }

    private var activityColour: Color {
        switch status.activity {
        case .running: OrionTheme.green
        case .finished: OrionTheme.blue
        case .stoppedWithoutFinishing: OrionTheme.orange
        case .neverRun: OrionTheme.textDim
        }
    }

    // MARK: - What it actually changed

    private var recentWork: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("LEGACY CODER CHANGES")
                .font(.system(size: 11, weight: .semibold))
                .kerning(1.4)
                .foregroundStyle(OrionTheme.textDim)

            if work.isEmpty {
                Text("Nothing yet.")
                    .font(.system(size: 13))
                    .foregroundStyle(OrionTheme.textSoft)
            } else {
                ForEach(work, id: \.self) { line in
                    Text(line)
                        .font(.system(size: 12, design: .monospaced))
                        .foregroundStyle(OrionTheme.textSoft)
                        .lineLimit(2)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
    }

    // MARK: - Which branch is speaking

    private var modeRail: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text("MODE")
                .font(.system(size: 11, weight: .semibold))
                .kerning(1.4)
                .foregroundStyle(OrionTheme.textDim)

            ForEach(ConversationMode.allCases) { option in
                Button {
                    mode = option
                } label: {
                    VStack(alignment: .leading, spacing: 4) {
                        HStack(spacing: 8) {
                            Circle()
                                .fill(option == mode ? OrionTheme.accent : OrionTheme.textDim)
                                .frame(width: 7, height: 7)
                            Text(option.label)
                                .font(.system(size: 14, weight: option == mode ? .semibold : .regular))
                                .foregroundStyle(option == mode ? OrionTheme.text : OrionTheme.textSoft)
                        }
                        Text(option.summary)
                            .font(.system(size: 11))
                            .foregroundStyle(OrionTheme.textDim)
                            .fixedSize(horizontal: false, vertical: true)
                            .padding(.leading, 15)
                    }
                }
                .buttonStyle(.plain)
            }

            // Honest about what this control does today. A picker that looks
            // like it routes a conversation and only records a preference is
            // the kind of thing that sends someone hunting for a bug in the
            // model when the wire was never connected.
            Text("Offline is chosen for you when the network goes. "
                 + "Switching here records the choice; the conversation route "
                 + "is wired in the plugin, not this window.")
                .font(.system(size: 11))
                .foregroundStyle(OrionTheme.textDim)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 6)
        }
    }
}

/// Mirrors `conversation-modes.ts`. Label and summary only — a mode carries no
/// capability, and there is deliberately nowhere here to put one.
enum ConversationMode: String, CaseIterable, Identifiable {
    case main, project, offline
    var id: String { rawValue }

    var label: String {
        switch self {
        case .main: "Main"
        case .project: "Project"
        case .offline: "Offline"
        }
    }

    var summary: String {
        switch self {
        case .main: "Orion as he is. The trunk."
        case .project: "Its own instructions, its own folder, a bigger model."
        case .offline: "No network. A local model answers; nothing leaves the Mac."
        }
    }
}
