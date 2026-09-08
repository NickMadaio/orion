import Foundation

public enum TodayPlanScheduler {
    private struct Span {
        var start: Date
        var end: Date
        var minutes: Int { max(0, Int(end.timeIntervalSince(start) / 60)) }
    }

    /// Place whole tasks into real gaps. Fixed events never move, free time is
    /// reserved before selecting work, and leftover work remains explicit.
    public static func propose(
        now: Date, timeZone: String, preferences: TodayPlanPreferences,
        tasks: [TodayPlanTask], commitments: [TodayPlanCommitment],
        completedIDs: Set<String> = [], reason: String, sourceFingerprint: String
    ) throws -> TodayPlan {
        try preferences.validate()
        guard finite(now), let zone = TimeZone(identifier: timeZone) else { throw TodayPlanError.invalidInput }
        var calendar = Calendar(identifier: .gregorian); calendar.timeZone = zone
        let day = calendar.startOfDay(for: now)
        guard let tomorrow = calendar.date(byAdding: .day, value: 1, to: day),
              let nextWake = calendar.date(bySettingHour: preferences.wakeMinute / 60, minute: preferences.wakeMinute % 60, second: 0, of: tomorrow),
              let wake = calendar.date(bySettingHour: preferences.wakeMinute / 60, minute: preferences.wakeMinute % 60, second: 0, of: day),
              let sleep = calendar.date(bySettingHour: (preferences.sleepMinute / 60) % 24, minute: preferences.sleepMinute % 60, second: 0,
                                        of: preferences.sleepMinute == 1440 ? tomorrow : day),
              nextWake.timeIntervalSince(sleep) >= Double(preferences.minimumSleepMinutes * 60)
        else { throw TodayPlanError.invalidPreferences }
        // Never put a new block partly into the minute that already elapsed.
        let roundedNow = Date(timeIntervalSinceReferenceDate: ceil(now.timeIntervalSinceReferenceDate / 60) * 60)
        let start = min(sleep, max(wake, roundedNow))
        let inputs = TodayPlan(day: day, timeZone: timeZone, generatedAt: now, windowStart: start, windowEnd: sleep,
                              preferences: preferences, tasks: tasks, commitments: commitments, blocks: [], completedIDs: completedIDs.sorted(),
                              deferredIDs: [], warnings: [], reason: reason, sourceFingerprint: sourceFingerprint)
        try inputs.validateInputs()
        let fixed = commitments.filter { !$0.allDay && $0.start < tomorrow && $0.end > day }
            .sorted { ($0.start, $0.id) < ($1.start, $1.id) }
        var warnings: [String] = []
        for (index, event) in fixed.enumerated() {
            for other in fixed.dropFirst(index + 1) {
                if other.start >= event.end { break }
                warnings.append("Calendar conflict: \(event.title) overlaps \(other.title).")
            }
            if event.start < wake || event.end > sleep {
                warnings.append("\(event.title) overlaps protected off-hours. The commitment has not been moved.")
            }
        }
        if commitments.contains(where: \.allDay) {
            warnings.append("All-day entries are shown as context. Timed commitments determine availability; block out unavailable hours in Calendar.")
        }
        let clipped: (Date, Date) -> Span? = { a, b in
            let a = max(start, a), b = min(sleep, b)
            return a < b ? Span(start: a, end: b) : nil
        }
        let hard = merge(fixed.compactMap { clipped($0.start, $0.end) })
        let buffer = Double(preferences.transitionMinutes * 60)
        let occupied = merge(fixed.compactMap { clipped($0.start.addingTimeInterval(-buffer), $0.end.addingTimeInterval(buffer)) })
        let transitions = occupied.flatMap { subtract($0, hard) }
        var gaps = start < sleep ? subtract(Span(start: start, end: sleep), occupied) : []
        let available = gaps.reduce(0) { $0 + $1.minutes }
        var budget = max(0, available - preferences.freeMinutes)
        if available < preferences.freeMinutes {
            warnings.append("Only \(available) minutes remain free around commitments; the \(preferences.freeMinutes)-minute free-time target cannot fit.")
        }
        var remaining = tasks.filter { !$0.completedInSource && !completedIDs.contains($0.id) }
        var blocks = fixed.map {
            TodayPlanBlock(id: "event:\($0.id)", sourceID: $0.id, title: $0.title, kind: .commitment, start: $0.start, end: $0.end)
        }
        blocks += transitions.enumerated().map {
            TodayPlanBlock(id: "transition:\($0.offset)", sourceID: nil, title: "Transition time", kind: .transition, start: $0.element.start, end: $0.element.end)
        }
        while budget > 0 {
            // Filter impossible contiguous placements before using the existing
            // DayPlan selection. A long task cannot hide a smaller one that fits.
            let candidates = remaining.filter { task in
                gaps.contains { gap in
                    let end = gap.start.addingTimeInterval(Double(task.minutes * 60))
                    return end <= gap.end && (task.due.map { $0 < now || end <= $0 } ?? true)
                }
            }.sorted { ($0.priority, $0.due ?? .distantFuture, $0.id) < ($1.priority, $1.due ?? .distantFuture, $1.id) }
                .enumerated().compactMap { rank, task in
                    // Keep the established budget selector, but give equal-priority
                    // tasks their deadline order rather than an arbitrary source ID.
                    PlannedTask(id: task.id, title: task.title, estimateMinutes: task.minutes, priority: rank)
                }
            let selection = DayPlan.propose(commitments: [], tasks: candidates, availableMinutes: budget)
            guard let selected = selection.scheduled.first,
                  let task = remaining.first(where: { $0.id == selected.id }),
                  let index = gaps.firstIndex(where: { gap in
                      let end = gap.start.addingTimeInterval(Double(task.minutes * 60))
                      return end <= gap.end && (task.due.map { $0 < now || end <= $0 } ?? true)
                  }) else { break }
            let begin = gaps[index].start
            let end = begin.addingTimeInterval(Double(task.minutes * 60))
            blocks.append(TodayPlanBlock(id: "task:\(task.id)", sourceID: task.id, title: task.title, kind: .task, start: begin, end: end))
            gaps[index].start = end
            if gaps[index].start >= gaps[index].end { gaps.remove(at: index) }
            budget -= task.minutes
            remaining.removeAll { $0.id == task.id }
            if let due = task.due, due < now { warnings.append("\(task.title) is overdue; this is a recovery block, not an on-time promise.") }
        }
        for (index, gap) in gaps.enumerated() where gap.start < gap.end {
            blocks.append(TodayPlanBlock(id: "free:\(index)", sourceID: nil, title: "Intentional free time", kind: .free, start: gap.start, end: gap.end))
        }
        if !remaining.isEmpty { warnings.append("\(remaining.count) task(s) are deferred because their duration, deadline or the protected free-time budget does not fit.") }
        let plan = TodayPlan(day: day, timeZone: timeZone, generatedAt: now, windowStart: start, windowEnd: sleep,
                             preferences: preferences, tasks: tasks, commitments: commitments,
                             blocks: blocks.sorted { ($0.start, $0.id) < ($1.start, $1.id) }, completedIDs: completedIDs.sorted(),
                             deferredIDs: remaining.sorted { ($0.priority, $0.id) < ($1.priority, $1.id) }.map(\.id),
                             warnings: warnings, reason: reason, sourceFingerprint: sourceFingerprint)
        try plan.validate()
        return plan
    }

    private static func merge(_ spans: [Span]) -> [Span] {
        var result: [Span] = []
        for span in spans.sorted(by: { $0.start < $1.start }) {
            if let last = result.last, span.start <= last.end {
                result[result.count - 1].end = max(last.end, span.end)
            } else { result.append(span) }
        }
        return result
    }

    private static func subtract(_ span: Span, _ occupied: [Span]) -> [Span] {
        var cursor = span.start
        var result: [Span] = []
        for busy in occupied {
            if busy.end <= cursor { continue }
            if busy.start >= span.end { break }
            if busy.start > cursor { result.append(Span(start: cursor, end: min(span.end, busy.start))) }
            cursor = max(cursor, busy.end)
            if cursor >= span.end { break }
        }
        if cursor < span.end { result.append(Span(start: cursor, end: span.end)) }
        return result
    }
}
