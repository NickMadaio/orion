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
    @State private var mode: ConversationMode = .main

    private let refresh = Timer.publish(every: 5, on: .main, in: .common).autoconnect()

    var body: some View {
        HStack(alignment: .top, spacing: 54) {
            VStack(alignment: .leading, spacing: 34) {
                OrionPanel(padding: 22) { selfDevelopment }
                OrionPanel(padding: 22) { recentWork }
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            OrionPanel(padding: 18) { modeRail }
                .frame(width: 300)
                .padding(.top, 52)
        }
        .onReceive(refresh) { _ in
            status = SelfDevelopmentStatus.read()
            work = SelfDevelopmentStatus.recentWork()
        }
    }

    // MARK: - Is it active, and what is it doing

    private var selfDevelopment: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 10) {
                Circle()
                    .fill(activityColour)
                    .frame(width: 9, height: 9)
                Text("SELF-DEVELOPMENT")
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
            Text("WHAT IT CHANGED")
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
