import SwiftUI

/// One run-log line split into its mono timestamp and the message. `run.log` lines are "<ISO time> message";
/// anything else keeps an empty time column.
struct ProjectLogLine: Identifiable, Equatable {
    let id: Int
    let time: String
    let message: String

    static func parse(_ log: String, limit: Int = 60) -> [ProjectLogLine] {
        let formatter = ISO8601DateFormatter(); formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let plain = ISO8601DateFormatter()
        let lines = log.split(separator: "\n", omittingEmptySubsequences: true).suffix(limit)
        return lines.enumerated().map { index, raw in
            let line = String(raw)
            if let space = line.firstIndex(of: " "),
               let date = formatter.date(from: String(line[..<space])) ?? plain.date(from: String(line[..<space])) {
                return ProjectLogLine(id: index, time: date.formatted(date: .omitted, time: .standard),
                                      message: String(line[line.index(after: space)...]))
            }
            return ProjectLogLine(id: index, time: "", message: line)
        }
    }
}

/*
 The Activity pane as a quiet log: the model stream as a hairline-marked well, the run log as compact rows with a
 mono timestamp column, tasks as small status dots, and recent checkpoints as a dotted trail. New lines ease in.
*/
struct ProjectActivityView: View {
    let activity: ProjectAgentActivity?
    let run: ProjectAgentStatus?
    let runLog: String
    let live: Bool
    let openFullLog: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 26) {
            if let activity { streamSection(activity) }
            if let run {
                HairlineSection(title: "Run log", trailing: nil, hue: live ? OrionTheme.green.opacity(0.8) : Color.white.opacity(0.36), spacing: 10, accessory: {
                    if live { Circle().fill(OrionTheme.green).frame(width: 5, height: 5).shadow(color: OrionTheme.green, radius: 3) }
                    Button(action: openFullLog) {
                        Text("OPEN FULL LOG ↗").font(OrionTheme.mono(9, .medium)).tracking(1.4).foregroundStyle(OrionTheme.textSoft)
                    }.buttonStyle(.plain)
                }) { logWell }
                HairlineSection(title: "Tasks", spacing: 4) {
                    VStack(alignment: .leading, spacing: 0) { ForEach(run.tasks) { taskRow($0) } }
                }
                HairlineSection(title: "Recent checkpoints", spacing: 10) {
                    VStack(alignment: .leading, spacing: 7) {
                        ForEach(run.events.suffix(20).reversed(), id: \.at) { event in
                            HStack(alignment: .firstTextBaseline, spacing: 10) {
                                Circle().fill(Color.white.opacity(0.22)).frame(width: 4, height: 4).offset(y: -1)
                                Text(event.message).font(.system(size: 12)).foregroundStyle(OrionTheme.textSoft)
                            }
                            .transition(.opacity.combined(with: .move(edge: .top)))
                        }
                    }
                }
            }
        }
        .animation(OrionMotion.enter, value: run?.events.count)
    }

    private func streamSection(_ activity: ProjectAgentActivity) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 10) {
                Image(systemName: live ? "sparkles" : "clock.arrow.circlepath").font(.system(size: 12)).foregroundStyle(live ? OrionTheme.green : OrionTheme.textDim)
                Text(activity.note ?? activity.headline).font(OrionTheme.serif(16)).foregroundStyle(OrionTheme.text)
                Spacer()
                Text(live ? "LIVE MODEL STREAM" : "LAST MODEL STREAM").font(OrionTheme.mono(8.5, .semibold)).tracking(1.8)
                    .foregroundStyle(live ? OrionTheme.green : OrionTheme.textDim)
            }
            if !activity.trace.isEmpty {
                ScrollView {
                    Text(activity.trace).font(OrionTheme.mono(11.5)).foregroundStyle(OrionTheme.textSoft).lineSpacing(3)
                        .textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading)
                }
                .frame(height: 150).padding(.leading, 16)
                .overlay(alignment: .leading) { FadingVerticalHairline(peak: 0.3) }
            }
        }
    }

    private var logWell: some View {
        let lines = ProjectLogLine.parse(runLog)
        return ScrollView {
            VStack(alignment: .leading, spacing: 5) {
                if lines.isEmpty {
                    Text("Waiting for the first log entry…").font(OrionTheme.mono(11)).foregroundStyle(OrionTheme.textDim)
                }
                ForEach(lines) { line in
                    HStack(alignment: .firstTextBaseline, spacing: 12) {
                        Text(line.time).font(OrionTheme.mono(9.5)).foregroundStyle(OrionTheme.textDim).frame(width: 62, alignment: .leading)
                        Text(line.message).font(OrionTheme.mono(11)).foregroundStyle(Color.white.opacity(0.72))
                            .frame(maxWidth: .infinity, alignment: .leading).textSelection(.enabled)
                    }
                    .transition(.opacity.combined(with: .offset(y: 6)))
                }
            }
            .animation(OrionMotion.enter, value: lines.count)
        }
        .frame(height: 190).padding(.leading, 16)
        .overlay(alignment: .leading) { FadingVerticalHairline(peak: live ? 0.5 : 0.3) }
    }

    private func taskRow(_ task: ProjectAgentStatus.WorkItem) -> some View {
        HStack(alignment: .center, spacing: 12) {
            ProjectPlanNode(state: task.status == .accepted ? .done : task.status == .blocked ? .blocked
                            : task.status == .running ? .doing : .todo)
                .scaleEffect(0.8)
            Text(task.title).font(.system(size: 13, weight: .medium)).foregroundStyle(OrionTheme.text.opacity(task.status == .accepted ? 0.7 : 1))
            Spacer(minLength: 10)
            Text((task.subtask?.caption ?? task.status.rawValue.replacingOccurrences(of: "_", with: " ")).uppercased())
                .font(OrionTheme.mono(9)).tracking(1).foregroundStyle(OrionTheme.textDim).lineLimit(1)
        }
        .padding(.vertical, 8)
    }
}
