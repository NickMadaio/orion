import Foundation
import EventKit
import MobileCore

/*
 The phone's day: Apple Calendar and Reminders, read and edited in place, with
 ORION's own plan from the Mac laid over them.

 Nick (2026-09-25): "it is connected and reads the calender and reminders
 directly, but also pulls from the mac as one unified system, and can edit the
 apple calender and reminders as they should be synced. thus i can see it
 through orion but technically also see it through reminders."

 So Calendar and Reminders are the source of truth for events and to-dos. They
 already sync to this phone through iCloud; edits made here go back the same
 way and show up in Apple's apps and on the Mac. ORION's plan (focus blocks,
 open time) comes from the Mac's published plan and is drawn as ORION's, never
 written into the calendar. Access is asked for only when Nick taps Connect —
 never at launch.
*/
@MainActor
final class PlannerStore: ObservableObject {
    enum Access: Equatable { case notAsked, granted, denied }

    struct Item: Identifiable, Equatable {
        enum Source: Equatable { case calendar(colorHex: String?), orion(TodayPlanBlock.Kind) }
        let id: String
        let title: String
        let start: Date
        let end: Date
        let allDay: Bool
        let source: Source
        let detail: String
        /// Only calendar events can be edited here; ORION's blocks belong to its plan.
        var editable: Bool { if case .calendar = source { return true }; return false }
    }

    struct Todo: Identifiable, Equatable {
        let id: String
        var title: String
        var due: Date?
        var done: Bool
        var priority: Int
        var notes: String
        let listName: String
    }

    @Published private(set) var access: Access = .notAsked
    @Published var day: Date = Calendar.current.startOfDay(for: Date())
    @Published private(set) var events: [Item] = []
    @Published private(set) var todos: [Todo] = []
    @Published private(set) var problem: String?
    /// The Reminders list ORION uses, the same one the Mac's Tasks tab reads.
    static let orionList = "Orion"

    private let store = EKEventStore()
    private var observer: NSObjectProtocol?

    init() {
        let events = EKEventStore.authorizationStatus(for: .event)
        let reminders = EKEventStore.authorizationStatus(for: .reminder)
        if events == .fullAccess && reminders == .fullAccess { access = .granted }
        else if events == .denied || reminders == .denied { access = .denied }
        observer = NotificationCenter.default.addObserver(forName: .EKEventStoreChanged, object: store, queue: .main) { [weak self] _ in
            Task { @MainActor in self?.reload() }
        }
        if access == .granted { reload() }
    }

    func connect() async {
        do {
            let events = try await store.requestFullAccessToEvents()
            let reminders = try await store.requestFullAccessToReminders()
            access = events && reminders ? .granted : .denied
        } catch {
            access = .denied
            problem = "Calendar and Reminders access could not be requested."
        }
        if access == .granted { reload() }
    }

    func show(_ date: Date) {
        day = Calendar.current.startOfDay(for: date)
        reload()
    }

    func reload() {
        guard access == .granted else { return }
        let start = day, end = Calendar.current.date(byAdding: .day, value: 1, to: day) ?? day
        let predicate = store.predicateForEvents(withStart: start, end: end, calendars: nil)
        events = store.events(matching: predicate).map { event in
            Item(id: event.eventIdentifier ?? UUID().uuidString, title: event.title ?? "Untitled",
                 start: event.startDate, end: event.endDate, allDay: event.isAllDay,
                 source: .calendar(colorHex: event.calendar.cgColor.flatMap(Self.hex)),
                 detail: event.calendar.title)
        }
        let calendars = reminderCalendars()
        let open = store.predicateForIncompleteReminders(withDueDateStarting: nil, ending: nil, calendars: calendars)
        let doneToday = store.predicateForCompletedReminders(withCompletionDateStarting: start, ending: end, calendars: calendars)
        store.fetchReminders(matching: open) { [weak self] openItems in
            self?.store.fetchReminders(matching: doneToday) { doneItems in
                let all = (openItems ?? []) + (doneItems ?? [])
                let mapped = all.map(Self.todo)
                Task { @MainActor in self?.todos = mapped.sorted(by: Self.order) }
            }
        }
    }

    // MARK: - Editing, written straight to Calendar and Reminders

    func toggle(_ todo: Todo) {
        guard let reminder = store.calendarItem(withIdentifier: todo.id) as? EKReminder else { return }
        reminder.isCompleted.toggle()
        save(reminder)
    }

    func addTodo(title: String, due: Date?) {
        let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, let calendar = reminderCalendars()?.first ?? store.defaultCalendarForNewReminders() else { return }
        let reminder = EKReminder(eventStore: store)
        reminder.title = trimmed
        reminder.calendar = calendar
        if let due { reminder.dueDateComponents = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute], from: due) }
        save(reminder)
    }

    func update(_ todo: Todo) {
        guard let reminder = store.calendarItem(withIdentifier: todo.id) as? EKReminder else { return }
        reminder.title = todo.title
        reminder.notes = todo.notes.isEmpty ? nil : todo.notes
        reminder.dueDateComponents = todo.due.map { Calendar.current.dateComponents([.year, .month, .day, .hour, .minute], from: $0) }
        reminder.isCompleted = todo.done
        reminder.priority = todo.priority
        save(reminder)
    }

    func deleteTodo(_ todo: Todo) {
        guard let reminder = store.calendarItem(withIdentifier: todo.id) as? EKReminder else { return }
        do { try store.remove(reminder, commit: true) } catch { problem = "That to-do could not be removed." }
        reload()
    }

    func saveEvent(id: String?, title: String, start: Date, end: Date, allDay: Bool) {
        let event = id.flatMap { store.event(withIdentifier: $0) } ?? EKEvent(eventStore: store)
        if event.calendar == nil { event.calendar = store.defaultCalendarForNewEvents }
        event.title = title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "New event" : title
        event.startDate = start
        event.endDate = max(end, start.addingTimeInterval(15 * 60))
        event.isAllDay = allDay
        do { try store.save(event, span: .thisEvent, commit: true) } catch { problem = "The event could not be saved to Calendar." }
        reload()
    }

    func deleteEvent(id: String) {
        guard let event = store.event(withIdentifier: id) else { return }
        do { try store.remove(event, span: .thisEvent, commit: true) } catch { problem = "The event could not be removed." }
        reload()
    }

    /// A plain-text day for the on-phone model: events in order, then open to-dos.
    func summary(of day: Date) -> String {
        guard access == .granted else { return "Calendar and Reminders aren't connected on this iPhone." }
        let start = Calendar.current.startOfDay(for: day)
        guard let end = Calendar.current.date(byAdding: .day, value: 1, to: start) else { return "" }
        let events = store.events(matching: store.predicateForEvents(withStart: start, end: end, calendars: nil))
            .sorted { $0.startDate < $1.startDate }
        let time = { (date: Date) in date.formatted(date: .omitted, time: .shortened) }
        var lines = [day.formatted(date: .complete, time: .omitted) + ":"]
        lines += events.isEmpty ? ["- nothing on the calendar"] : events.map { event in
            event.isAllDay ? "- all day: \(event.title ?? "Event")" : "- \(time(event.startDate))–\(time(event.endDate)) \(event.title ?? "Event")"
        }
        let open = todos.filter { !$0.done }.prefix(12)
        lines.append(open.isEmpty ? "Open to-dos: none" : "Open to-dos:")
        lines += open.map { todo in "- \(todo.title)" + (todo.due.map { " (due \($0.formatted(date: .abbreviated, time: .shortened)))" } ?? "") }
        return lines.joined(separator: "\n")
    }

    /// The next timed event starting after `moment` today, for "what should I do now".
    func nextEvent(after moment: Date) -> (title: String, start: Date)? {
        guard access == .granted, let end = Calendar.current.date(byAdding: .day, value: 1, to: Calendar.current.startOfDay(for: moment)) else { return nil }
        return store.events(matching: store.predicateForEvents(withStart: moment, end: end, calendars: nil))
            .filter { !$0.isAllDay && $0.startDate > moment }
            .min { $0.startDate < $1.startDate }
            .map { ($0.title ?? "Event", $0.startDate) }
    }

    /// The first timed calendar event on `day` — tomorrow's first class, for
    /// working out bedtime and the wake alarm. Nil without access or events.
    /// Tonight's plan that runs late (a club until 02:00): the latest-ending timed
    /// event between 18:00 and 06:00 that ends after 22:30. ORION's own blocks
    /// don't count — only real plans move bedtime.
    func lateFixedEvent(around now: Date) -> (title: String, end: Date)? {
        guard access == .granted else { return nil }
        let calendar = Calendar.current
        let today = calendar.startOfDay(for: now)
        let nightStart = calendar.component(.hour, from: now) < 6 ? calendar.date(byAdding: .day, value: -1, to: today)! : today
        guard let from = calendar.date(bySettingHour: 18, minute: 0, second: 0, of: nightStart),
              let to = calendar.date(byAdding: .hour, value: 12, to: from),
              let lateAfter = calendar.date(bySettingHour: 22, minute: 30, second: 0, of: nightStart) else { return nil }
        return store.events(matching: store.predicateForEvents(withStart: from, end: to, calendars: nil))
            .filter { !$0.isAllDay && $0.endDate > lateAfter && !($0.notes ?? "").contains("[orion:") }
            .max { $0.endDate < $1.endDate }
            .map { ($0.title ?? "Plans", $0.endDate) }
    }

    func firstTimedEvent(on day: Date) -> (title: String, start: Date)? {
        guard access == .granted else { return nil }
        let start = Calendar.current.startOfDay(for: day)
        guard let end = Calendar.current.date(byAdding: .day, value: 1, to: start) else { return nil }
        let events = store.events(matching: store.predicateForEvents(withStart: start, end: end, calendars: nil))
            // Real commitments only: ORION's own blocks ("[orion:…]" in the notes) and
            // events he never goes to ("(optional)") must not set his alarm (2026-09-30).
            .filter { !$0.isAllDay && $0.startDate >= start
                && !($0.notes ?? "").contains("[orion:") && !($0.title ?? "").localizedCaseInsensitiveContains("(optional)") }
            .sorted { $0.startDate < $1.startDate }
        return events.first.map { ($0.title ?? "Event", $0.startDate) }
    }

    /// Reminders arrive on a callback; background runs wait for them.
    func loadTodos() async {
        guard access == .granted else { return }
        let calendars = reminderCalendars()
        let open = store.predicateForIncompleteReminders(withDueDateStarting: nil, ending: nil, calendars: calendars)
        let fetched: [Todo] = await withCheckedContinuation { continuation in
            store.fetchReminders(matching: open) { items in continuation.resume(returning: (items ?? []).map(Self.todo)) }
        }
        todos = fetched.sorted(by: Self.order)
    }

    // MARK: - For the widgets

    /// Today's and tomorrow's timed events as glance blocks, whatever day the Plan
    /// tab is showing. ORION's own calendar blocks ("[orion:study]") are marked movable.
    func glanceBlocks(now: Date = Date()) -> (today: [OrionGlance.Block], tomorrow: [OrionGlance.Block]) {
        guard access == .granted else { return ([], []) }
        let calendar = Calendar.current
        let today = calendar.startOfDay(for: now)
        let tomorrow = calendar.date(byAdding: .day, value: 1, to: today)!
        let after = calendar.date(byAdding: .day, value: 2, to: today)!
        func blocks(_ from: Date, _ to: Date) -> [OrionGlance.Block] {
            store.events(matching: store.predicateForEvents(withStart: from, end: to, calendars: nil))
                .filter { !$0.isAllDay }
                .map { event in
                    let marker = event.notes.flatMap { notes in
                        notes.range(of: #"\[orion:([a-z_]+)\]"#, options: .regularExpression).map { String(notes[$0].dropFirst(7).dropLast()) }
                    }
                    let title = event.title ?? "Untitled"
                    return OrionGlance.Block(id: event.calendarItemIdentifier, title: title, start: event.startDate, end: event.endDate,
                                             kind: OrionGlance.kind(of: title, orionKind: marker), fixed: marker == nil,
                                             location: event.location.flatMap { $0.isEmpty ? nil : $0 })
                }
                .sorted { $0.start < $1.start }
        }
        let todays = blocks(today, tomorrow)
        let todayIDs = Set(todays.map(\.id))   // a club until 2 AM belongs to today only
        return (todays, Array(blocks(tomorrow, after).filter { !todayIDs.contains($0.id) }.prefix(6)))
    }

    /// Open to-dos in the glance's shape; Reminders' 1…9 priority folded to 1…3.
    var glanceTodos: [OrionGlance.Todo] {
        todos.filter { !$0.done }.prefix(40).map { todo in
            let rank = todo.priority == 0 ? 0 : todo.priority <= 4 ? 1 : todo.priority == 5 ? 2 : 3
            return OrionGlance.Todo(id: todo.id, title: todo.title, due: todo.due, priority: rank)
        }
    }

    // MARK: - One day, from every source

    /// Calendar events plus ORION's planned blocks for the same day. The Mac's
    /// commitments are calendar events already, so they are not drawn twice;
    /// transitions are plumbing, not something to look at.
    func schedule(orion plan: TodayPlan?) -> [Item] {
        let range = day..<(Calendar.current.date(byAdding: .day, value: 1, to: day) ?? day)
        let fromPlan = (plan?.blocks ?? []).filter { block in
            // Free time is the gaps themselves; drawn, it buries the calendar under one long block.
            range.contains(block.start) && block.kind != .transition && block.kind != .free
                && (block.kind != .commitment || access != .granted)
        }.map { block in
            Item(id: "orion-\(block.id)", title: block.title, start: block.start, end: block.end, allDay: false,
                 source: .orion(block.kind), detail: "ORION plan")
        }
        // The calendar is the one plan. ORION's day planner writes there; a block
        // from the older on-Mac plan that collides with a calendar event is not
        // drawn on top of it (2026-10-01: two plans layered read as overlaps).
        let timed = events.filter { !$0.allDay }
        let clear = fromPlan.filter { block in !timed.contains { $0.start < block.end && block.start < $0.end } }
        return (events + clear).sorted { $0.start < $1.start }
    }

    // MARK: - Private

    private func reminderCalendars() -> [EKCalendar]? {
        let lists = store.calendars(for: .reminder)
        if let orion = lists.first(where: { $0.title.caseInsensitiveCompare(Self.orionList) == .orderedSame }) { return [orion] }
        return store.defaultCalendarForNewReminders().map { [$0] }
    }

    private func save(_ reminder: EKReminder) {
        do { try store.save(reminder, commit: true) } catch { problem = "Reminders did not accept that change." }
        reload()
    }

    private static func todo(_ reminder: EKReminder) -> Todo {
        Todo(id: reminder.calendarItemIdentifier, title: reminder.title ?? "Untitled",
             due: reminder.dueDateComponents.flatMap { Calendar.current.date(from: $0) },
             done: reminder.isCompleted, priority: reminder.priority, notes: reminder.notes ?? "",
             listName: reminder.calendar.title)
    }

    /// Open before done; then by due date (undated last); then by priority.
    private static func order(_ left: Todo, _ right: Todo) -> Bool {
        if left.done != right.done { return !left.done }
        switch (left.due, right.due) {
        case let (l?, r?) where l != r: return l < r
        case (.some, nil): return true
        case (nil, .some): return false
        default: return (left.priority == 0 ? 10 : left.priority) < (right.priority == 0 ? 10 : right.priority)
        }
    }

    private static func hex(_ color: CGColor) -> String? {
        guard let components = color.converted(to: CGColorSpace(name: CGColorSpace.sRGB)!, intent: .defaultIntent, options: nil)?.components,
              components.count >= 3 else { return nil }
        return String(format: "%02X%02X%02X", Int(components[0] * 255), Int(components[1] * 255), Int(components[2] * 255))
    }
}
