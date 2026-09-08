import SwiftUI
import MobileCore

/// Production content view also renders without EventKit or AppState for visual
/// and interaction harnesses. Its fixtures come from the real planner.
struct TodayPlanContent: View {
    let plan: TodayPlan
    let previous: TodayPlan?
    let now: Date
    let isProposal: Bool
    var needsReview = false
    @Binding var expanded: Bool
    var finish: (String) -> Void
    var moreTime: (String) -> Void
    var togglePin: (String) -> Void = { _ in }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            if isProposal { Text("PLAN PREVIEW").font(.system(size: 11, weight: .bold)).tracking(2).foregroundStyle(OrionTheme.accent) }
            if needsReview {
                Text("Saved plan needs review").font(.system(size: 20, weight: .medium, design: .rounded))
                Text("Calendar or task data has changed or needs refreshing. Preview an updated plan before following these saved blocks.")
                    .font(.system(size: 13)).foregroundStyle(OrionTheme.orange)
            } else {
                ViewThatFits(in: .horizontal) {
                    HStack(alignment: .top, spacing: 40) { summary }
                    VStack(alignment: .leading, spacing: 16) { summary }
                }
            }
            Text(plan.reason).font(.system(size: 13)).foregroundStyle(OrionTheme.textSoft)
            if isProposal, let previous {
                let changes = changedTasks(from: previous)
                if !changes.isEmpty {
                    VStack(alignment: .leading, spacing: 5) {
                        Text("What changes").font(.system(size: 12, weight: .semibold))
                        ForEach(changes, id: \.self) { Text($0).font(.system(size: 12)).foregroundStyle(OrionTheme.textSoft) }
                    }
                }
            }
            ForEach(Array(plan.warnings.enumerated()), id: \.offset) { _, warning in
                Text(warning).font(.system(size: 12)).foregroundStyle(OrionTheme.orange)
            }
            let allDay = plan.commitments.filter(\.allDay)
            if !allDay.isEmpty {
                Text("All day: " + allDay.map(\.title).joined(separator: " · ")).font(.system(size: 12)).foregroundStyle(OrionTheme.textSoft)
            }
            DisclosureGroup("\(plan.blocks.count) blocks · \(plan.completedIDs.count) finished · \(plan.deferredIDs.count) deferred", isExpanded: $expanded) {
                VStack(alignment: .leading, spacing: 14) {
                    ForEach(plan.blocks) { block in
                        HStack(alignment: .top, spacing: 16) {
                            Text("\(time(block.start))–\(time(block.end))")
                                .font(.system(size: 11, design: .monospaced)).frame(width: 110, alignment: .leading)
                                .foregroundStyle(OrionTheme.textSoft)
                            VStack(alignment: .leading, spacing: 4) {
                                Text(block.title).font(.system(size: 13, weight: block.contains(now) ? .semibold : .regular))
                                Text(block.kind == .task ? "\(block.pinned ? "Pinned slot" : "Planned work") · estimated \(block.minutes) min" : block.kind == .free ? "Yours to use freely" : block.kind == .commitment ? "Calendar commitment" : "Protected transition")
                                    .font(.system(size: 11)).foregroundStyle(OrionTheme.textSoft)
                                if block.kind == .task, let id = block.sourceID, !isProposal {
                                    HStack(spacing: 14) {
                                        Button("Finish block") { finish(id) }
                                        Button("15 more minutes") { moreTime(id) }
                                        Button(block.pinned ? "Unpin slot" : "Pin slot") { togglePin(id) }
                                    }.buttonStyle(.plain).font(.system(size: 11)).foregroundStyle(OrionTheme.accent)
                                }
                            }
                            Spacer(minLength: 0)
                        }
                    }
                    if !plan.deferredIDs.isEmpty {
                        Text("Deferred: " + plan.tasks.filter { plan.deferredIDs.contains($0.id) }.map(\.title).joined(separator: " · "))
                            .font(.system(size: 12)).foregroundStyle(OrionTheme.orange)
                    }
                    if !plan.completedIDs.isEmpty {
                        Text("Finished in this plan: " + plan.tasks.filter { plan.completedIDs.contains($0.id) }.map(\.title).joined(separator: " · "))
                            .font(.system(size: 12)).foregroundStyle(OrionTheme.green)
                    }
                }.padding(.top, 14)
            }.font(.system(size: 12)).foregroundStyle(OrionTheme.textSoft)
        }
    }

    @ViewBuilder private var summary: some View {
        metric("NOW", plan.current(at: now)?.title ?? "No block at this moment", detail: plan.current(at: now).map { "until " + time($0.end) } ?? "The plan starts at " + time(plan.windowStart))
        metric("NEXT COMMITMENT", plan.nextCommitment(at: now)?.title ?? "No later commitment", detail: plan.nextCommitment(at: now).map { time($0.start) } ?? "Day ends " + time(plan.windowEnd))
        metric("FREE TIME", "\(plan.freeMinutes(after: now)) min", detail: "in the remaining plan")
    }
    private func metric(_ label: String, _ value: String, detail: String) -> some View {
        VStack(alignment: .leading, spacing: 7) {
            Text(label).font(.system(size: 10, weight: .semibold)).tracking(1.8).foregroundStyle(OrionTheme.accent)
            Text(value).font(.system(size: 20, weight: .medium, design: .rounded)).fixedSize(horizontal: false, vertical: true)
            Text(detail).font(.system(size: 12)).foregroundStyle(OrionTheme.textSoft)
        }.frame(maxWidth: 260, alignment: .leading)
    }
    private func time(_ date: Date) -> String {
        let formatter = DateFormatter(); formatter.dateFormat = "HH:mm"; formatter.timeZone = TimeZone(identifier: plan.timeZone)
        return formatter.string(from: date)
    }
    func changedTasks(from old: TodayPlan) -> [String] {
        let changes: [String] = old.blocks.filter { $0.kind == .task }.compactMap { block in
            guard let id = block.sourceID else { return nil }
            if plan.completedIDs.contains(id) { return "\(block.title): finished in this plan." }
            guard let next = plan.blocks.first(where: { $0.kind == .task && $0.sourceID == id }) else {
                guard let source = plan.tasks.first(where: { $0.id == id }) else { return "\(block.title): removed from Reminders; slot released." }
                return source.completedInSource ? "\(block.title): finished in Reminders; slot released." : "\(block.title): deferred."
            }
            if next.pinned != block.pinned {
                return "\(block.title): \(next.pinned ? "pinned" : "unpinned") · \(time(next.start))–\(time(next.end))."
            }
            guard next.start != block.start || next.end != block.end else { return nil }
            return "\(block.title): \(time(block.start))–\(time(block.end)) → \(time(next.start))–\(time(next.end))."
        }
        let oldIDs = Set(old.blocks.filter { $0.kind == .task }.compactMap(\.sourceID))
        let added = plan.blocks.filter { $0.kind == .task && !oldIDs.contains($0.sourceID ?? "") }.map {
            "\($0.title): newly scheduled \(time($0.start))–\(time($0.end)) (\($0.minutes) min)."
        }
        return changes + added
    }
}
