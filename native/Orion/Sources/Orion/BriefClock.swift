import Foundation
import SessionDomain

/// Calendar facts use the civil date. Activity logs deliberately keep their
/// separate 4am logical-day boundary; it must not label another day's agenda.
struct BriefClock: Equatable {
    let now: Date
    var timeZone: TimeZone = .current
    var calendar: Calendar {
        var value = Calendar(identifier: .gregorian); value.timeZone = timeZone; return value
    }
    var dateKey: String {
        let formatter = DateFormatter(); formatter.calendar = calendar; formatter.timeZone = timeZone
        formatter.locale = Locale(identifier: "en_US_POSIX"); formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: now)
    }
    var heading: String {
        let formatter = DateFormatter(); formatter.calendar = calendar; formatter.timeZone = timeZone
        formatter.setLocalizedDateFormatFromTemplate("EEEE MMMM d")
        return formatter.string(from: now).uppercased()
    }
    var hour: Int { calendar.component(.hour, from: now) }
    var greeting: String {
        switch hour {
        case 0..<4: return "Up late"
        case 4..<12: return "Good morning"
        case 12..<18: return "Good afternoon"
        default: return "Good evening"
        }
    }
    var salutation: String {
        switch hour {
        case 0..<4: return "Here's the day ahead"
        case 4..<12: return "Good morning"
        case 12..<18: return "Here's where the day stands"
        default: return "Here's what's left of today"
        }
    }
    func needsSourceRefresh(after previous: BriefClock) -> Bool {
        dateKey != previous.dateKey || timeZone != previous.timeZone
    }
    func readingIsFresh(_ readAt: Date?) -> Bool {
        guard let readAt else { return false }
        // A fetch may finish between the last UI tick and this render.
        let age = now.timeIntervalSince(readAt)
        return age >= -30 && age <= 600
    }
    func calendarReadingIsCurrent(readAt: Date?, interval: DateInterval?, zone: TimeZone?) -> Bool {
        guard readingIsFresh(readAt), zone == timeZone, let interval,
              let day = calendar.dateInterval(of: .day, for: now) else { return false }
        return interval.start <= day.start && interval.end >= day.end
    }
    func eventsToday(_ events: [AgendaEvent]) -> [AgendaEvent] {
        let civil = CivilDay(of: now, in: timeZone)
        return events.filter { AgendaPlacement.appears(allDay: $0.days, start: $0.start, end: $0.end, on: civil, in: timeZone) }
    }
    func remainingMinutes(_ events: [AgendaEvent]) -> Int {
        eventsToday(events).filter { !$0.isAllDay && $0.end > now }.reduce(0) {
            $0 + max(0, Int(min($1.end, calendar.date(byAdding: .day, value: 1, to: calendar.startOfDay(for: now))!).timeIntervalSince(max($1.start, now)) / 60))
        }
    }
    func dueDate(_ task: SyncedTask) -> Date? {
        guard let due = task.dueDate else { return nil }
        return task.dueHasTime ? due : calendar.date(byAdding: .day, value: 1, to: calendar.startOfDay(for: due))?.addingTimeInterval(-1)
    }
    func dueToday(_ tasks: [SyncedTask]) -> [SyncedTask] {
        tasks.filter { task in
            guard !task.isComplete, let due = dueDate(task) else { return false }
            return due >= now && calendar.isDate(due, inSameDayAs: now)
        }
    }
    func overdue(_ tasks: [SyncedTask]) -> [SyncedTask] {
        tasks.filter { !$0.isComplete && (dueDate($0).map { $0 < now } ?? false) }
    }
}
