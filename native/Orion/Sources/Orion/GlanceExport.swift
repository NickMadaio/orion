import EventKit
import Foundation
import MobileCore

/*
 The calendar half of the Mac's widgets (2026-09-29).

 Widgets draw from a file; ORION Link writes it, but ORION Link has no
 Calendar or Reminders permission and should not ask for one. This app has
 both. So every couple of minutes, and whenever Calendar or Reminders change,
 it writes today's and tomorrow's events, the deadlines ahead and the open
 to-dos to ~/.openclaw/orion-controlled/glance-calendar.json, as a partial
 `OrionGlance`. ORION Link adds the plan, projects, check-ins and tracking and
 publishes the whole thing to the widgets.
*/
@MainActor
final class GlanceExport {
    private let store = EKEventStore()
    private var next = Date.distantPast
    private var observer: NSObjectProtocol?
    private let every: TimeInterval = 120

    static var file: URL {
        FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".openclaw/orion-controlled/glance-calendar.json")
    }

    init() {
        observer = NotificationCenter.default.addObserver(forName: .EKEventStoreChanged, object: store, queue: .main) { [weak self] _ in
            Task { @MainActor in self?.next = .distantPast; self?.tick() }
        }
    }

    func tick(now: Date = Date()) {
        guard now >= next else { return }
        next = now.addingTimeInterval(every)
        guard EKEventStore.authorizationStatus(for: .event) == .fullAccess else { return }
        let calendar = Calendar.current
        let today = calendar.startOfDay(for: now)
        let tomorrow = calendar.date(byAdding: .day, value: 1, to: today)!
        let dayAfter = calendar.date(byAdding: .day, value: 2, to: today)!
        let blocks = events(from: today, to: tomorrow)
        // An event running past midnight (a club until 2 AM) belongs to today only.
        let todayIDs = Set(blocks.map(\.id))
        let tomorrowBlocks = Array(events(from: tomorrow, to: dayAfter).filter { !todayIDs.contains($0.id) }.prefix(6))
        let deadlines = store.events(matching: store.predicateForEvents(withStart: now, end: calendar.date(byAdding: .day, value: 90, to: now)!, calendars: nil))
            .filter { !$0.hasRecurrenceRules && OrionGlance.isDeadline($0.title ?? "") }
            .sorted { $0.startDate < $1.startDate }
            .prefix(6)
            .map { OrionGlance.Deadline(id: $0.calendarItemIdentifier, title: $0.title ?? "Untitled", at: $0.startDate) }
        todos { todos in
            let glance = OrionGlance(generatedAt: now, source: "mac-calendar", blocks: blocks, tomorrow: tomorrowBlocks,
                                     todos: todos, deadlines: Array(deadlines))
            try? GlanceFile.write(glance, to: Self.file)
        }
    }

    private func events(from start: Date, to end: Date) -> [OrionGlance.Block] {
        store.events(matching: store.predicateForEvents(withStart: start, end: end, calendars: nil))
            .filter { !$0.isAllDay }
            .map { event in
                let marker = event.notes.flatMap { notes in
                    notes.range(of: #"\[orion:([a-z_]+)\]"#, options: .regularExpression).map { String(notes[$0].dropFirst(7).dropLast()) }
                }
                let title = event.title ?? "Untitled"
                let kind = OrionGlance.kind(of: title, orionKind: marker)
                return OrionGlance.Block(id: event.calendarItemIdentifier, title: title, start: event.startDate, end: event.endDate,
                                         kind: kind, fixed: marker == nil, location: event.location.flatMap { $0.isEmpty ? nil : $0 })
            }
    }

    /// Open reminders in the Orion list (the Tasks tab's), falling back to every list.
    private func todos(_ done: @escaping @MainActor ([OrionGlance.Todo]) -> Void) {
        guard EKEventStore.authorizationStatus(for: .reminder) == .fullAccess else { done([]); return }
        let lists = store.calendars(for: .reminder)
        let orion = lists.filter { $0.title == "Orion" }
        let predicate = store.predicateForIncompleteReminders(withDueDateStarting: nil, ending: nil, calendars: orion.isEmpty ? nil : orion)
        store.fetchReminders(matching: predicate) { reminders in
            let mapped = (reminders ?? []).prefix(40).map { reminder in
                OrionGlance.Todo(id: reminder.calendarItemIdentifier, title: reminder.title ?? "Untitled",
                                 due: reminder.dueDateComponents?.date, priority: Self.rank(reminder.priority), done: false)
            }
            Task { @MainActor in done(Array(mapped)) }
        }
    }

    /// EventKit's 1 (high) … 9 (low) into 1…3; 0 stays none.
    nonisolated static func rank(_ priority: Int) -> Int {
        switch priority {
        case 1...4: return 1
        case 5: return 2
        case 6...9: return 3
        default: return 0
        }
    }
}
