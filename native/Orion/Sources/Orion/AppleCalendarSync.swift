import EventKit
import Foundation

/*
 Today's agenda, read-only.

 The day ring on the Tasks tab has been computing "how much of the day is left"
 from the clock alone, which is the least useful version of that question. Six
 hours left with nothing in them and six hours left with four meetings in them
 are not the same day, and the ring cannot tell them apart without this.

 READ ONLY, and structurally so: there is no save, no remove, and no EKEvent is
 ever mutated anywhere in this file. Reminders needs write access because Orion
 owns a list there; a calendar is a record of commitments made with other
 people, and an assistant quietly moving those is a much larger promise than
 anything here has earned.

 Every calendar is read rather than one — unlike Reminders, where Orion writes
 and therefore confines itself to its own list. Reading everything is the point
 of an agenda: a day is only accurate if it includes the calendar the meeting
 actually landed on.
*/

struct AgendaEvent: Identifiable, Equatable {
    let id: String
    var title: String
    var start: Date
    var end: Date
    var isAllDay: Bool
    var calendarName: String
    /// The dot colour Calendar.app shows, so the agenda is recognisable.
    var colorHex: String?

    var isPast: Bool { end < Date() }
    var isNow: Bool {
        let now = Date()
        return start <= now && end >= now
    }

    var timeLabel: String {
        if isAllDay { return "all day" }
        return start.formatted(date: .omitted, time: .shortened)
    }

    var durationMinutes: Int {
        max(0, Int(end.timeIntervalSince(start) / 60))
    }
}

final class AppleCalendarSync: ObservableObject {

    @Published private(set) var access: AppleRemindersSync.Access = .unknown
    @Published private(set) var events: [AgendaEvent] = []
    @Published private(set) var lastSyncedAt: Date?

    private let store = EKEventStore()
    private var refreshTimer: Timer?
    private var changeObserver: NSObjectProtocol?

    func start() {
        let handle: (Bool, Error?) -> Void = { [weak self] granted, error in
            DispatchQueue.main.async {
                guard let self else { return }
                guard granted else {
                    self.access = .denied(
                        error?.localizedDescription
                            ?? "Allow Orion in System Settings ▸ Privacy & Security ▸ Calendars."
                    )
                    return
                }
                self.access = .granted
                self.refresh()
                self.changeObserver = NotificationCenter.default.addObserver(
                    forName: .EKEventStoreChanged,
                    object: self.store,
                    queue: .main
                ) { [weak self] _ in
                    DispatchQueue.main.async { self?.refresh() }
                }
                // Five minutes: an agenda that is a few minutes stale is fine,
                // and the alternative is waking the store constantly for a
                // screen that is usually not being looked at.
                self.refreshTimer = Timer.scheduledTimer(withTimeInterval: 300, repeats: true) { [weak self] _ in
                    DispatchQueue.main.async { self?.refresh() }
                }
            }
        }
        if #available(macOS 14.0, *) {
            store.requestFullAccessToEvents(completion: handle)
        } else {
            store.requestAccess(to: .event, completion: handle)
        }
    }

    func stop() {
        refreshTimer?.invalidate()
        refreshTimer = nil
        if let changeObserver {
            NotificationCenter.default.removeObserver(changeObserver)
            self.changeObserver = nil
        }
    }

    func refresh() {
        guard access.isGranted else { return }
        let calendar = Calendar.current
        let start = calendar.startOfDay(for: Date())
        guard let end = calendar.date(byAdding: .day, value: 1, to: start) else { return }
        let calendars = store.calendars(for: .event)
        guard !calendars.isEmpty else {
            events = []
            return
        }
        let predicate = store.predicateForEvents(withStart: start, end: end, calendars: calendars)
        // `events(matching:)` is synchronous and can block on a cold store, so
        // it runs off the main thread and publishes back.
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self else { return }
            let mapped = self.store.events(matching: predicate)
                .map { event in
                    AgendaEvent(
                        id: event.eventIdentifier ?? UUID().uuidString,
                        title: event.title ?? "Untitled",
                        start: event.startDate,
                        end: event.endDate,
                        isAllDay: event.isAllDay,
                        calendarName: event.calendar?.title ?? "",
                        colorHex: nil
                    )
                }
                .sorted { left, right in
                    if left.isAllDay != right.isAllDay { return left.isAllDay }
                    return left.start < right.start
                }
            DispatchQueue.main.async {
                self.events = mapped
                self.lastSyncedAt = Date()
            }
        }
    }

    // MARK: - Read-out

    var remaining: [AgendaEvent] { events.filter { !$0.isPast } }
    var current: AgendaEvent? { events.first(where: \.isNow) }
    var next: AgendaEvent? { events.first { !$0.isPast && !$0.isNow } }

    /// Minutes still committed today. This is what makes the day ring honest:
    /// free time is what is left after what you already promised.
    var committedMinutesRemaining: Int {
        let now = Date()
        return remaining
            .filter { !$0.isAllDay }
            .reduce(0) { total, event in
                total + max(0, Int(event.end.timeIntervalSince(max(event.start, now)) / 60))
            }
    }

    var statusLine: String {
        switch access {
        case .unknown: return "checking Calendar access…"
        case .denied(let why), .unavailable(let why): return why
        case .granted:
            if events.isEmpty { return "nothing on the calendar today" }
            return "\(remaining.count) left of \(events.count) today"
        }
    }
}
