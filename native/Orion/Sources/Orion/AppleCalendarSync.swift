import EventKit
import Foundation

/*
 Today's agenda, read-only.

 The day ring on the Tasks tab has been computing "how much of the day is left"
 from the clock alone, which is the least useful version of that question. Six
 hours left with nothing in them and six hours left with four meetings in them
 are not the same day, and the ring cannot tell them apart without this.

 READS EVERYTHING, WRITES ONLY WHAT IT MADE.

 This used to be read-only and structurally so. It now creates events, because
 a day view you cannot put anything into is a poster of your calendar rather
 than a calendar. The promise is narrowed rather than dropped: Orion can CREATE
 an event, and can change or delete one ONLY if Orion created it. Every event
 it makes is recorded in `orion-created-events.json`, and `canEdit` is checked
 against that before any mutation.

 That line is where it is for a reason. A calendar is a record of commitments
 made with other people, and an assistant quietly moving a meeting somebody
 else booked is a much larger promise than "let me block out an hour".

 GOOGLE CALENDAR NEEDS NO CODE HERE. Adding the Google account in System
 Settings ▸ Internet Accounts with Calendars enabled makes macOS sync it over
 CalDAV, and EventKit then returns those events as ordinary EKEvents through
 the same fetch below — already merged with iCloud, one permission, offline
 handled. The Google Calendar API would mean a second OAuth grant, a client,
 sync tokens and a manual merge across two id spaces, to arrive at what this
 already returns.

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

    /// True when Orion created it, so it is safe to change.
    var isOrionMade: Bool = false

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
    /// Everything in the loaded window, not just today.
    @Published private(set) var windowEvents: [AgendaEvent] = []
    @Published private(set) var lastSyncedAt: Date?
    @Published private(set) var lastError: String?
    /// Which day the schedule is showing. Changing it reloads if it falls
    /// outside the window already held.
    @Published var selectedDate: Date = Calendar.current.startOfDay(for: Date())

    private let store = EKEventStore()
    private var refreshTimer: Timer?
    private var changeObserver: NSObjectProtocol?
    /// Event identifiers Orion created. See the header for why this exists.
    private var createdIDs: Set<String> = []

    private var createdURL: URL {
        let directory = URL(fileURLWithPath: NSHomeDirectory())
            .appendingPathComponent(".openclaw/orion-controlled", isDirectory: true)
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        return directory.appendingPathComponent("orion-created-events.json")
    }

    private func loadCreatedIDs() {
        guard let data = try? Data(contentsOf: createdURL),
              let decoded = try? JSONDecoder().decode([String].self, from: data)
        else { return }
        createdIDs = Set(decoded)
    }

    private func rememberCreated(_ id: String) {
        createdIDs.insert(id)
        guard let data = try? JSONEncoder().encode(Array(createdIDs)) else { return }
        try? data.write(to: createdURL, options: .atomic)
    }

    /// The seven days the week strip shows, starting on the selected date's
    /// week.
    var weekDays: [Date] {
        let calendar = Calendar.current
        guard let start = calendar.dateInterval(of: .weekOfYear, for: selectedDate)?.start
        else { return [] }
        return (0..<7).compactMap { calendar.date(byAdding: .day, value: $0, to: start) }
    }

    /// Events on one day, ready to lay out.
    func events(on date: Date) -> [AgendaEvent] {
        let calendar = Calendar.current
        return windowEvents
            .filter { calendar.isDate($0.start, inSameDayAs: date) || spans(date, $0) }
            .sorted { left, right in
                if left.isAllDay != right.isAllDay { return left.isAllDay }
                return left.start < right.start
            }
    }

    /// A multi-day event should appear on every day it covers, not only the one
    /// it began on — otherwise a trip vanishes from the calendar after day one.
    private func spans(_ date: Date, _ event: AgendaEvent) -> Bool {
        let calendar = Calendar.current
        let day = calendar.startOfDay(for: date)
        guard let dayEnd = calendar.date(byAdding: .day, value: 1, to: day) else { return false }
        return event.start < dayEnd && event.end > day
    }

    /// How busy each day of the week is, 0...1, for the strip's density marks.
    func load(for date: Date) -> Double {
        let minutes = events(on: date)
            .filter { !$0.isAllDay }
            .reduce(0) { $0 + $1.durationMinutes }
        // Ten hours of commitments reads as a full day.
        return min(1, Double(minutes) / 600)
    }

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
                self.loadCreatedIDs()
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
        // A fortnight centred on the selected week, so paging a day either way
        // never waits on a fetch. EventKit is fast, but a day view that goes
        // blank for a frame while it loads reads as broken.
        guard let weekStart = calendar.dateInterval(of: .weekOfYear, for: selectedDate)?.start,
              let start = calendar.date(byAdding: .day, value: -7, to: weekStart),
              let end = calendar.date(byAdding: .day, value: 21, to: weekStart)
        else { return }

        let calendars = store.calendars(for: .event)
        guard !calendars.isEmpty else {
            windowEvents = []
            lastError = "No calendar accounts are set up on this Mac. Add one in System Settings ▸ Internet Accounts — a Google account with Calendars enabled shows up here automatically."
            return
        }
        lastError = nil
        let predicate = store.predicateForEvents(withStart: start, end: end, calendars: calendars)
        let created = createdIDs

        // `events(matching:)` is synchronous and can block on a cold store, so
        // it runs off the main thread and publishes back.
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self else { return }
            let mapped = self.store.events(matching: predicate).map { event in
                let id = event.eventIdentifier ?? UUID().uuidString
                return AgendaEvent(
                    id: id,
                    title: event.title ?? "Untitled",
                    start: event.startDate,
                    end: event.endDate,
                    isAllDay: event.isAllDay,
                    calendarName: event.calendar?.title ?? "",
                    colorHex: nil,
                    isOrionMade: created.contains(id)
                )
            }
            DispatchQueue.main.async {
                self.windowEvents = mapped
                self.lastSyncedAt = Date()
            }
        }
    }

    // MARK: - Writing

    /// Calendars that can actually hold a new event.
    ///
    /// Subscribed and birthday calendars are read-only, and offering one in a
    /// picker produces a save that fails after the user has typed everything.
    var writableCalendars: [EKCalendar] {
        store.calendars(for: .event).filter(\.allowsContentModifications)
    }

    var defaultCalendar: EKCalendar? {
        store.defaultCalendarForNewEvents ?? writableCalendars.first
    }

    @discardableResult
    func createEvent(
        title: String,
        start: Date,
        end: Date,
        isAllDay: Bool = false,
        calendar: EKCalendar? = nil,
        notes: String? = nil
    ) -> Bool {
        let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard access.isGranted, !trimmed.isEmpty,
              let target = calendar ?? defaultCalendar
        else {
            lastError = "No writable calendar is available."
            return false
        }

        let event = EKEvent(eventStore: store)
        event.calendar = target
        event.title = trimmed
        event.notes = notes
        event.isAllDay = isAllDay
        event.startDate = start
        // An event that ends before it starts is silently accepted by EventKit
        // and then renders as a zero-height block nobody can click.
        event.endDate = max(end, start.addingTimeInterval(isAllDay ? 0 : 300))

        do {
            try store.save(event, span: .thisEvent, commit: true)
            if let id = event.eventIdentifier { rememberCreated(id) }
            lastError = nil
            refresh()
            return true
        } catch {
            lastError = "Could not save the event: \(error.localizedDescription)"
            return false
        }
    }

    /// Only what Orion made. See the header.
    func canEdit(_ event: AgendaEvent) -> Bool { event.isOrionMade }

    func delete(_ event: AgendaEvent) {
        guard canEdit(event),
              let stored = store.event(withIdentifier: event.id)
        else {
            lastError = "Orion only removes events it created."
            return
        }
        do {
            try store.remove(stored, span: .thisEvent, commit: true)
            createdIDs.remove(event.id)
            refresh()
        } catch {
            lastError = "Could not remove the event: \(error.localizedDescription)"
        }
    }

    // MARK: - Read-out

    /// Today, which is what the brief and the vitals strip mean by "events".
    var events: [AgendaEvent] { events(on: Date()) }

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
