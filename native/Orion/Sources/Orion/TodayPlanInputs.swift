import Foundation
import MobileCore
import SessionDomain
import SessionService

struct TodayPlanInputs: Equatable {
    let tasks: [TodayPlanTask]
    let commitments: [TodayPlanCommitment]
    let calendarReadAt: Date
    let tasksReadAt: Date
    let timeZone: String
    let day: Date
    let fingerprint: String

    func isFresh(at now: Date) -> Bool {
        var calendar = Calendar(identifier: .gregorian)
        guard let zone = TimeZone(identifier: timeZone), zone.identifier == TimeZone.current.identifier else { return false }
        calendar.timeZone = zone
        return calendar.isDate(day, inSameDayAs: now)
            && [calendarReadAt, tasksReadAt].allSatisfy { (0...600).contains(now.timeIntervalSince($0)) }
    }

    static func make(events: [AgendaEvent], tasks: [SyncedTask], calendarReadAt: Date,
                     tasksReadAt: Date, now: Date, defaultMinutes: Int) throws -> TodayPlanInputs {
        let zone = TimeZone.current
        var calendar = Calendar(identifier: .gregorian); calendar.timeZone = zone
        let day = calendar.startOfDay(for: now)
        let civilDay = CivilDay(of: now, in: zone)
        let commitments = events.filter {
            AgendaPlacement.appears(allDay: $0.days, start: $0.start, end: $0.end, on: civilDay, in: zone)
        }.map { event in
            // EventKit's identifier can be shared by recurring occurrences.
            TodayPlanCommitment(id: event.id + "@" + String(event.start.timeIntervalSinceReferenceDate),
                                title: event.title, start: event.start, end: event.end, allDay: event.isAllDay)
        }.sorted { $0.id < $1.id }
        let mapped = tasks.map { task -> TodayPlanTask in
            let due: Date? = task.dueDate.flatMap { date in
                if task.dueHasTime { return date }
                return calendar.date(byAdding: .day, value: 1, to: calendar.startOfDay(for: date))?.addingTimeInterval(-1)
            }
            let urgency = due.map { $0 < now ? -20 : (calendar.isDate($0, inSameDayAs: now) ? -10 : 0) } ?? 0
            return TodayPlanTask(id: task.id, title: task.title, minutes: defaultMinutes,
                                 priority: urgency + task.priority.rank, due: due, completedInSource: task.isComplete)
        }.sorted { $0.id < $1.id }
        struct Content: Encodable { let tasks: [TodayPlanTask]; let commitments: [TodayPlanCommitment]; let day: Date; let zone: String }
        let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys]
        let digest = TodayPlanStore.fingerprint(try encoder.encode(Content(tasks: mapped, commitments: commitments, day: day, zone: zone.identifier)))
        return TodayPlanInputs(tasks: mapped, commitments: commitments, calendarReadAt: calendarReadAt,
                               tasksReadAt: tasksReadAt, timeZone: zone.identifier, day: day, fingerprint: digest)
    }
}
