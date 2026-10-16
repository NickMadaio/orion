import AppKit
import EventKit
import Foundation
import SessionDomain

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
    /// The civil days an all-day event covers. Nil for a timed event.
    ///
    /// Phase 40. EventKit hands an all-day event a pair of INSTANTS — midnight
    /// in some zone — and deciding which day it belongs to by comparing those
    /// instants against `Calendar.current` moves the event a day when the
    /// machine's zone and the event's zone disagree. "8 September, all day"
    /// written in London is stored as 2026-09-07T23:00Z, which a New York
    /// calendar reads as the SEVENTH.
    ///
    /// So the span is recovered once, at fetch time, in the zone the event was
    /// written in, and every later question about which day it is on goes
    /// through `AgendaPlacement` and compares civil days. The instants stay for
    /// layout, which is what they are actually good for.
    var days: AllDaySpan?
    var calendarName: String
    /// The dot colour Calendar.app shows, so the agenda is recognisable.
    ///
    /// Was always nil — fetched as a hardcoded `nil` and then used to decide a
    /// tint, which is why every block on the timeline was the same blue
    /// regardless of which calendar it came from. Now real, which is most of
    /// what makes a day legible at a glance: you know what a thing IS from its
    /// colour before you read its name.
    var colorHex: String?

    /// True when Orion created it.
    var isOrionMade: Bool = false
    /// Which calendar it lives on, so an editor can preselect it.
    var calendarID: String = ""
    /// Subscribed and birthday calendars refuse writes at the EventKit level.
    /// A technical limit, not a policy — surfaced so the UI can explain rather
    /// than fail on save.
    var isReadOnly: Bool = false
    /// Other people are on this. Saving sends them an update.
    var hasAttendees: Bool = false

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
    @Published private(set) var loadedInterval: DateInterval?
    @Published private(set) var loadedTimeZone: TimeZone?
    private var refreshGeneration = UUID()
    @Published private(set) var lastError: String?
    /// Which day the schedule is showing. Changing it reloads if it falls
    /// outside the window already held.
    @Published var selectedDate: Date = Calendar.current.startOfDay(for: Date())

    private let store = EKEventStore()
    private var refreshTimer: Timer?
    private var changeObserver: NSObjectProtocol?
    /// Event identifiers Orion created. See the header for why this exists.
    private var createdIDs: Set<String> = []

    /// Every calendar EventKit can see, so "my Google event is missing" has an
    /// answer instead of a shrug. This file had no logging and no way to
    /// inspect what it was reading, which makes an empty day and an
    /// unconnected account look identical.
    @Published private(set) var calendars: [CalendarInfo] = []

    struct CalendarInfo: Identifiable, Equatable {
        let id: String
        let title: String
        /// The account it comes from — "iCloud", "Google", "On My Mac".
        let source: String
        /// Google arrives as CalDAV; iCloud has its own type.
        let kind: String
        let writable: Bool
        var eventsInWindow: Int
    }

    /// True when at least one calendar comes from a Google account.
    var hasGoogle: Bool {
        calendars.contains { $0.source.localizedCaseInsensitiveContains("google")
            || $0.source.localizedCaseInsensitiveContains("gmail") }
    }

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
    ///
    /// The membership rule lives in `AgendaPlacement` and is deliberately
    /// different for the two kinds of event: an all-day event is compared as
    /// CIVIL DAYS, a timed one as instants. This used to be a single instant
    /// comparison for both, which put an all-day event on the wrong day
    /// whenever the machine's zone differed from the event's — invisible until
    /// the machine moves.
    ///
    /// A multi-day event still appears on every day it covers; otherwise a trip
    /// vanishes from the calendar after day one.
    func events(on date: Date) -> [AgendaEvent] {
        let zone = TimeZone.current
        let day = CivilDay(of: date, in: zone)
        return windowEvents
            .filter {
                AgendaPlacement.appears(allDay: $0.days, start: $0.start, end: $0.end,
                                        on: day, in: zone)
            }
            .sorted { left, right in
                if left.isAllDay != right.isAllDay { return left.isAllDay }
                return left.start < right.start
            }
    }

    /// The civil days an all-day event covers, read in the zone it was written in.
    ///
    /// `event.timeZone` is nil for most all-day events, which is EventKit
    /// saying "this one floats". Falling back to the current zone is correct at
    /// FETCH time — it is the same zone the instants were just resolved in —
    /// and is exactly what must not happen later, when the machine may have
    /// moved. Doing it once, here, is what makes everything downstream
    /// zone-independent.
    static func allDaySpan(of event: EKEvent) -> AllDaySpan? {
        guard event.isAllDay else { return nil }
        return AgendaPlacement.span(from: event.startDate, to: event.endDate,
                                    in: event.timeZone ?? TimeZone.current)
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
                    OrionLog.write("[calendar] access DENIED — \(error?.localizedDescription ?? "no reason given")")
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
                self.refreshTimer?.invalidate()
                self.refreshTimer = Timer.scheduledTimer(withTimeInterval: 300, repeats: true) { [weak self] _ in
                    DispatchQueue.main.async { self?.refresh() }
                }
            }
        }
        OrionLog.write("[calendar] requesting access")
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

    /// Fetch an ARBITRARY interval, for the calendar's visible range.
    ///
    /// Separate from `refresh()`, which keeps its own fixed fortnight for the
    /// day timeline. The month grid needs whatever is on screen plus padding,
    /// and a fixed window is wrong in both directions at once: too small at the
    /// edges, so paging shows a blank grid until a refetch lands, and too large
    /// in the middle, so every redraw asks EventKit for weeks nobody is looking
    /// at.
    ///
    /// Synchronous EventKit work stays off the main thread — `events(matching:)`
    /// can block on a cold store, and a grid that freezes while it pages reads
    /// as broken.
    func fetch(interval: DateInterval, completion: @escaping ([AgendaEvent], String?) -> Void) {
        guard access.isGranted else {
            return completion([], "Calendar access has not been granted, so what is "
                              + "scheduled is unknown.")
        }
        let calendars = store.calendars(for: .event)
        guard !calendars.isEmpty else {
            return completion([], "No calendar accounts are set up on this Mac.")
        }

        let predicate = store.predicateForEvents(withStart: interval.start,
                                                 end: interval.end, calendars: calendars)
        let created = createdIDs

        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self else { return completion([], nil) }
            let mapped = self.store.events(matching: predicate).map { event in
                AgendaEvent(
                    id: event.eventIdentifier ?? UUID().uuidString,
                    title: event.title ?? "Untitled",
                    start: event.startDate,
                    end: event.endDate,
                    isAllDay: event.isAllDay,
                    days: AppleCalendarSync.allDaySpan(of: event),
                    calendarName: event.calendar?.title ?? "",
                    colorHex: AppleCalendarSync.hex(from: event.calendar?.cgColor),
                    isOrionMade: created.contains(event.eventIdentifier ?? ""),
                    calendarID: event.calendar?.calendarIdentifier ?? "",
                    isReadOnly: !(event.calendar?.allowsContentModifications ?? false),
                    hasAttendees: (event.attendees?.count ?? 0) > 0
                )
            }
            DispatchQueue.main.async { completion(mapped, nil) }
        }
    }

    func refresh() {
        let generation = UUID()
        refreshGeneration = generation
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
            self.calendars = []
            lastError = "No calendar accounts are set up on this Mac. Add one in System Settings ▸ Internet Accounts — a Google account with Calendars enabled shows up here automatically."
            OrionLog.write("[calendar] EventKit returned ZERO calendars — no accounts configured, or access is limited")
            return
        }
        let predicate = store.predicateForEvents(withStart: start, end: end, calendars: calendars)
        let created = createdIDs

        // `events(matching:)` is synchronous and can block on a cold store, so
        // it runs off the main thread and publishes back.
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self else { return }

            // One fetch, walked once. Counting per calendar in a second pass
            // would mean asking EventKit for the same window twice.
            let raw = self.store.events(matching: predicate)
            var mapped: [AgendaEvent] = []
            var counts: [String: Int] = [:]
            mapped.reserveCapacity(raw.count)

            for event in raw {
                let id: String = event.eventIdentifier ?? UUID().uuidString
                if let calendarID = event.calendar?.calendarIdentifier {
                    counts[calendarID, default: 0] += 1
                }
                mapped.append(AgendaEvent(
                    id: id,
                    title: event.title ?? "Untitled",
                    start: event.startDate,
                    end: event.endDate,
                    isAllDay: event.isAllDay,
                    days: AppleCalendarSync.allDaySpan(of: event),
                    calendarName: event.calendar?.title ?? "",
                    colorHex: AppleCalendarSync.hex(from: event.calendar?.cgColor),
                    isOrionMade: created.contains(id),
                    calendarID: event.calendar?.calendarIdentifier ?? "",
                    isReadOnly: !(event.calendar?.allowsContentModifications ?? false),
                    hasAttendees: (event.attendees?.count ?? 0) > 0
                ))
            }

            var described: [CalendarInfo] = []
            for calendar in calendars {
                let identifier: String = calendar.calendarIdentifier
                described.append(CalendarInfo(
                    id: identifier,
                    title: calendar.title,
                    source: calendar.source?.title ?? "unknown",
                    kind: AppleCalendarSync.describe(calendar.source?.sourceType),
                    writable: calendar.allowsContentModifications,
                    eventsInWindow: counts[identifier] ?? 0
                ))
            }
            described.sort { left, right in
                if left.source != right.source { return left.source < right.source }
                return left.title < right.title
            }

            var parts: [String] = []
            for info in described {
                parts.append(info.source + "/" + info.title + ":" + String(info.eventsInWindow))
            }
            let summary: String = "[calendar] " + String(described.count) + " calendar(s), "
                + String(mapped.count) + " event(s) in window — " + parts.joined(separator: ", ")

            DispatchQueue.main.async {
                guard self.refreshGeneration == generation, self.access.isGranted else { return }
                self.loadedInterval = DateInterval(start: start, end: end)
                self.loadedTimeZone = calendar.timeZone
                self.lastError = nil
                self.windowEvents = mapped
                self.calendars = described
                self.lastSyncedAt = Date()
                // 2026-10-16 UI audit #7: identical every 5 min poll; on change, or hourly.
                OrionLog.write(summary, key: "calendar-summary", repeatAfter: 3600)
            }
        }
    }

    /// A calendar's colour as `RRGGBB`.
    ///
    /// Converted through sRGB rather than read straight off the CGColor:
    /// calendar colours arrive in whatever space the account uses, and reading
    /// raw components from a non-RGB space yields nonsense rather than an
    /// error.
    static func hex(from cgColor: CGColor?) -> String? {
        guard let cgColor,
              let converted = NSColor(cgColor: cgColor)?.usingColorSpace(.sRGB)
        else { return nil }
        let red = Int((converted.redComponent * 255).rounded())
        let green = Int((converted.greenComponent * 255).rounded())
        let blue = Int((converted.blueComponent * 255).rounded())
        return String(format: "%02X%02X%02X", red, green, blue)
    }

    /// Google Calendar reaches macOS over CalDAV, so its source type is
    /// `.calDAV` and its title is the account name — which is how "is Google
    /// connected" is answered without a Google API anywhere.
    static func describe(_ type: EKSourceType?) -> String {
        switch type {
        case .local: "On this Mac"
        case .exchange: "Exchange"
        case .calDAV: "CalDAV / Google"
        case .mobileMe: "iCloud"
        case .subscribed: "Subscribed"
        case .birthdays: "Birthdays"
        default: "Unknown"
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

    /// Anything on a writable calendar.
    ///
    /// This was deliberately narrowed to Orion's own events, and it was
    /// widened deliberately too: the request was to edit the calendar, and it
    /// is the user's calendar. What has NOT been widened is anything automatic
    /// — every change here comes from a sheet the user opened and a button they
    /// pressed, deletion asks twice because it cannot be undone, and an event
    /// with other people on it says out loud that saving will notify them.
    func canEdit(_ event: AgendaEvent) -> Bool { !event.isReadOnly }

    /// Move, rename or re-time an existing event.
    func update(
        _ event: AgendaEvent,
        title: String,
        start: Date,
        end: Date,
        isAllDay: Bool,
        calendar: EKCalendar? = nil
    ) -> Bool {
        let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard canEdit(event), !trimmed.isEmpty,
              let stored = store.event(withIdentifier: event.id)
        else {
            lastError = event.isReadOnly
                ? "That calendar is read-only — subscribed and birthday calendars cannot be changed."
                : "Could not find that event any more. Reload and try again."
            return false
        }

        stored.title = trimmed
        stored.isAllDay = isAllDay
        stored.startDate = start
        stored.endDate = max(end, start.addingTimeInterval(isAllDay ? 0 : 300))
        if let calendar, calendar.allowsContentModifications { stored.calendar = calendar }

        do {
            // `.thisEvent` rather than `.futureEvents`: changing one occurrence
            // of a repeating event should not silently rewrite the series.
            try store.save(stored, span: .thisEvent, commit: true)
            lastError = nil
            OrionLog.write("[calendar] updated event on \(stored.calendar?.title ?? "?")")
            refresh()
            return true
        } catch {
            lastError = "Could not save: \(error.localizedDescription)"
            return false
        }
    }

    func delete(_ event: AgendaEvent) {
        guard canEdit(event),
              let stored = store.event(withIdentifier: event.id)
        else {
            lastError = "That calendar is read-only."
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
