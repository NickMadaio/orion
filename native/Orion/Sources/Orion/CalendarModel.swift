//
//  What the calendar knows: facts only.
//
//  Gate 8 ships REAL DATA and no scoring. A coloured day that means "you did
//  well" needs a policy, a version, and an honest "insufficient data" state, and
//  inventing one before the facts are on screen means shipping an opinion with
//  nothing underneath it. So: events, completed reminders, deadlines, and the
//  focus sessions that actually happened. Nothing is rated.
//
//  Three sources, three failure modes, three separate disclosures. An empty day
//  because Calendar access was denied and an empty day because nothing happened
//  are different facts, and this project's worst bugs have been exactly that
//  conflation.
//

import Foundation
import Combine
import SwiftUI
import SessionDomain
import SessionService

/// One thing that happened, or is going to.
struct CalendarEntry: Identifiable, Equatable {
    enum Kind: Equatable {
        case event(colorHex: String?)
        /// A reminder, on the day it was FINISHED.
        case completed
        /// A reminder, on the day it is DUE and not yet done.
        case deadline(overdue: Bool)
        /// A focus session, from Orion's own history.
        case focus(minutes: Int, reason: FinishReason)
    }

    let id: String
    let title: String
    let start: Date
    let end: Date
    let kind: Kind
    let isAllDay: Bool

    var tint: Color {
        switch kind {
        case .event(let hex): return hex.flatMap(Color.init(orionHex:)) ?? OrionTheme.blue
        case .completed: return OrionTheme.green
        case .deadline(let overdue): return overdue ? OrionTheme.red : OrionTheme.orange
        case .focus: return OrionTheme.accent
        }
    }
}

final class CalendarModel: ObservableObject {

    @Published private(set) var focusDate = Date()
    @Published private(set) var granularity: CalendarGranularity = .month
    @Published private(set) var entriesByDay: [String: [CalendarEntry]] = [:]
    @Published private(set) var isLoading = false

    /// One line per source that could not be read. Shown, never swallowed.
    @Published private(set) var disclosures: [String] = []

    let range: CalendarRange

    private let agenda: AppleCalendarSync
    private let reminders: AppleRemindersSync
    private let history: SessionHistory

    /// What has already been fetched, so paging inside it costs nothing.
    private var fetched: DateInterval?

    private let dayFormatter: DateFormatter

    init(agenda: AppleCalendarSync, reminders: AppleRemindersSync,
         history: SessionHistory, calendar: Calendar = .current) {
        self.agenda = agenda
        self.reminders = reminders
        self.history = history
        self.range = CalendarRange(calendar: calendar)

        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = calendar.timeZone
        self.dayFormatter = formatter

        reload(force: true)
    }

    // MARK: Navigation

    func show(_ granularity: CalendarGranularity) {
        self.granularity = granularity
        reload(force: true)
    }

    func step(_ amount: Int) {
        focusDate = range.step(focusDate, by: amount, granularity: granularity)
        reload(force: false)
    }

    func goToToday() {
        focusDate = Date()
        reload(force: false)
    }

    func focus(on day: Date) {
        focusDate = day
        reload(force: false)
    }

    var visible: VisibleInterval {
        range.interval(around: focusDate, granularity: granularity)
    }

    var weeks: [[Date]] { range.monthGrid(containing: focusDate) }

    func key(for day: Date) -> String { dayFormatter.string(from: day) }

    func entries(on day: Date) -> [CalendarEntry] {
        entriesByDay[key(for: day)] ?? []
    }

    // MARK: Loading

    /// Refetch only when the visible interval leaves what is already in hand.
    ///
    /// This is what makes paging feel instant: the padded fetch already contains
    /// the neighbouring pages, so a step is pure redraw. Two steps is a fetch,
    /// and that is a stated bound rather than a hole in the grid.
    func reload(force: Bool) {
        let interval = visible
        if !force, let fetched, fetched.start <= interval.visible.start,
           fetched.end >= interval.visible.end {
            rebuildLocalSources(interval.fetch)
            return
        }

        isLoading = true
        let wanted = interval.fetch

        agenda.fetch(interval: wanted) { [weak self] events, failure in
            guard let self else { return }
            self.fetched = wanted
            self.isLoading = false

            var byDay: [String: [CalendarEntry]] = [:]
            var problems: [String] = []

            if let failure { problems.append(failure) }

            for event in events {
                let entry = CalendarEntry(
                    id: "event:\(event.id)", title: event.title,
                    start: event.start, end: event.end,
                    kind: .event(colorHex: event.colorHex), isAllDay: event.isAllDay
                )
                byDay[self.key(for: event.start), default: []].append(entry)
            }

            self.entriesByDay = byDay
            self.disclosures = problems
            self.rebuildLocalSources(wanted)
        }
    }

    /// Reminders and focus history come from memory and a local file, so they
    /// are cheap and are rebuilt on every pass rather than cached alongside the
    /// EventKit fetch.
    private func rebuildLocalSources(_ interval: DateInterval) {
        var byDay = entriesByDay
        var problems = disclosures.filter { !$0.hasPrefix("Tasks") && !$0.hasPrefix("Focus") }

        // Strip anything previously derived from the local sources, so a rebuild
        // replaces rather than accumulates.
        for (day, entries) in byDay {
            byDay[day] = entries.filter { entry in
                if case .event = entry.kind { return true }
                return false
            }
        }

        if reminders.access.isGranted {
            for task in reminders.tasks {
                if task.isComplete, let done = task.completionDate,
                   interval.contains(done) {
                    byDay[key(for: done), default: []].append(CalendarEntry(
                        id: "done:\(task.id)", title: task.title,
                        start: done, end: done, kind: .completed, isAllDay: false
                    ))
                } else if !task.isComplete, let due = task.dueDate, interval.contains(due) {
                    byDay[key(for: due), default: []].append(CalendarEntry(
                        id: "due:\(task.id)", title: task.title,
                        start: due, end: due,
                        kind: .deadline(overdue: due < Date()), isAllDay: false
                    ))
                }
            }
        } else {
            problems.append("Tasks: Reminders access has not been granted, so what was "
                            + "completed and what is due are unknown.")
        }

        do {
            for record in try history.records() where interval.contains(record.startedAt) {
                byDay[record.dayKey, default: []].append(CalendarEntry(
                    id: "focus:\(record.sessionID)",
                    title: record.task,
                    start: record.startedAt, end: record.endedAt,
                    kind: .focus(minutes: Int((record.servedFocusSeconds / 60).rounded()),
                                 reason: record.reason),
                    isAllDay: false
                ))
            }
        } catch {
            problems.append("Focus history could not be read: \(error.localizedDescription)")
        }

        for (day, entries) in byDay {
            byDay[day] = entries.sorted { $0.start < $1.start }
        }

        entriesByDay = byDay
        disclosures = problems
    }
}

// MARK: - Colour

extension Color {
    /// `#RRGGBB`, as `AppleCalendarSync` stores it.
    init?(orionHex hex: String) {
        var text = hex.trimmingCharacters(in: .whitespaces)
        if text.hasPrefix("#") { text.removeFirst() }
        guard text.count == 6, let value = UInt32(text, radix: 16) else { return nil }
        self.init(
            red: Double((value >> 16) & 0xFF) / 255,
            green: Double((value >> 8) & 0xFF) / 255,
            blue: Double(value & 0xFF) / 255
        )
    }
}
