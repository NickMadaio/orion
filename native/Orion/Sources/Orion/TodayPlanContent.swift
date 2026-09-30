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
        VStack(alignment: .leading, spacing: 12) {
            if needsReview {
                Label("Your calendar or tasks changed since this plan was made. Replan to fit them in.",
                      systemImage: "exclamationmark.circle")
                    .font(.system(size: 12)).foregroundStyle(OrionTheme.orange)
                    .fixedSize(horizontal: false, vertical: true)
            } else if !isProposal {
                summary
            }
            if isProposal {
                Text(plan.reason).font(.system(size: 12)).foregroundStyle(OrionTheme.textSoft)
                    .fixedSize(horizontal: false, vertical: true)
                if let previous {
                    let changes = changedTasks(from: previous)
                    if !changes.isEmpty {
                        VStack(alignment: .leading, spacing: 4) {
                            ForEach(changes, id: \.self) { Text("· " + $0).font(.system(size: 11)).foregroundStyle(OrionTheme.textSoft) }
                        }
                    }
                }
            }
            ForEach(Array(plan.warnings.enumerated()), id: \.offset) { _, warning in
                Text(warning).font(.system(size: 11)).foregroundStyle(OrionTheme.orange)
                    .fixedSize(horizontal: false, vertical: true)
            }
            let allDay = plan.commitments.filter(\.allDay)
            if !allDay.isEmpty {
                Text("All day · " + allDay.map(\.title).joined(separator: " · "))
                    .font(.system(size: 11)).foregroundStyle(OrionTheme.textSoft)
            }
            DisclosureGroup(isExpanded: $expanded) {
                VStack(alignment: .leading, spacing: 2) {
                    ForEach(plan.blocks.filter { $0.kind != .transition }) { block in row(block) }
                    if !plan.deferredIDs.isEmpty {
                        Text("Didn't fit today · " + plan.tasks.filter { plan.deferredIDs.contains($0.id) }.map(\.title).joined(separator: " · "))
                            .font(.system(size: 11)).foregroundStyle(OrionTheme.orange).padding(.top, 6)
                    }
                    if !plan.completedIDs.isEmpty {
                        Text("Done · " + plan.tasks.filter { plan.completedIDs.contains($0.id) }.map(\.title).joined(separator: " · "))
                            .font(.system(size: 11)).foregroundStyle(OrionTheme.green).padding(.top, 2)
                    }
                }.padding(.top, 8)
            } label: {
                Text("\(plan.blocks.filter { $0.kind == .task }.count) tasks · \(plan.freeMinutes) min free\(plan.completedIDs.isEmpty ? "" : " · \(plan.completedIDs.count) done")")
                    .font(.system(size: 11, weight: .medium)).foregroundStyle(OrionTheme.textDim)
            }
        }
    }

    /// Now and next in one glance.
    private var summary: some View {
        let current = plan.current(at: now)
        let next = plan.next(at: now)
        return VStack(alignment: .leading, spacing: 4) {
            Text(current.map { "Now · \($0.title)" } ?? (next.map { "Next · \($0.title)" } ?? "Nothing left in today's plan"))
                .font(.system(size: 17, weight: .semibold, design: .rounded))
            Text([current.map { "until \(time($0.end))" }, current == nil ? next.map { "at \(time($0.start))" } : next.map { "then \($0.title) at \(time($0.start))" },
                  "\(plan.freeMinutes(after: now)) min free left"].compactMap { $0 }.joined(separator: " · "))
                .font(OrionTheme.mono(10)).foregroundStyle(OrionTheme.textSoft)
        }
    }

    private func row(_ block: TodayPlanBlock) -> some View {
        let live = block.contains(now)
        let past = block.end <= now
        return HStack(alignment: .center, spacing: 10) {
            Text(time(block.start)).font(OrionTheme.mono(10)).foregroundStyle(OrionTheme.textDim).frame(width: 40, alignment: .leading)
            RoundedRectangle(cornerRadius: 1.5).fill(tint(block.kind)).frame(width: 3, height: 22)
            VStack(alignment: .leading, spacing: 1) {
                Text(block.title).font(.system(size: 12.5, weight: live ? .semibold : .regular)).lineLimit(1)
                Text("\(block.minutes) min\(block.kind == .free ? " · yours" : block.kind == .commitment ? " · calendar" : "")\(block.pinned ? " · pinned" : "")")
                    .font(.system(size: 10)).foregroundStyle(OrionTheme.textDim)
            }
            Spacer(minLength: 6)
            if block.kind == .task, let id = block.sourceID, !isProposal, !past {
                HStack(spacing: 10) {
                    icon("checkmark", "Mark done in this plan") { finish(id) }
                    icon("plus", "15 more minutes") { moreTime(id) }
                    icon(block.pinned ? "pin.fill" : "pin", block.pinned ? "Unpin" : "Keep this slot") { togglePin(id) }
                }
            }
        }
        .padding(.vertical, 4).padding(.horizontal, 6)
        .background(live ? OrionTheme.accent.opacity(0.08) : .clear, in: RoundedRectangle(cornerRadius: 6))
        .opacity(past ? 0.45 : 1)
    }

    private func icon(_ name: String, _ help: String, _ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: name).font(.system(size: 10, weight: .semibold)).foregroundStyle(OrionTheme.accent)
        }
        .buttonStyle(.plain).help(help).accessibilityLabel(help)
    }

    private func tint(_ kind: TodayPlanBlock.Kind) -> Color {
        switch kind {
        case .task: return OrionTheme.accent
        case .free: return OrionTheme.green
        case .commitment: return OrionTheme.violet
        case .transition: return OrionTheme.textDim
        }
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
