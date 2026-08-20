//
//  What the calendar knows: facts only.
//
//  Facts first: events, completed reminders, deadlines, and the focus sessions
//  that actually happened. The one derived thing is the day's score, and it is
//  derived HERE, once per reload, rather than in a cell body — a SwiftUI grid
//  asks a cell for its body far more often than the data changes.
//
//  The score's rules live in SessionDomain/DayScore.swift, including the one
//  that matters: an input that is missing is excluded, never counted as zero.
//
//  Three sources, three failure modes, three separate disclosures. An empty day
//  because Calendar access was denied and an empty day because nothing happened
//  are different facts, and this project's worst bugs have been exactly that
//  conflation.
//

import Foundation
import Combine
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

    /// The day the detail list is showing. Separate from `focusDate`, which is
    /// which PAGE is on screen — clicking the 3rd while looking at March should
    /// select it, not navigate away.
    @Published private(set) var selectedDay = Date()

    /// One score per day, computed once per reload rather than per cell. A
    /// SwiftUI grid asks for a cell's body far more often than the data changes.
    @Published private(set) var scoresByDay: [String: DayScore] = [:]

    /// One line per source that could not be read. Shown, never swallowed.
    @Published private(set) var disclosures: [String] = []

    let range: CalendarRange

    private let agenda: AppleCalendarSync
    private let reminders: AppleRemindersSync
    private let history: SessionHistory
    private let health: HealthLog
    private var cancellables = Set<AnyCancellable>()

    /// What has already been fetched, so paging inside it costs nothing.
    private var fetched: DateInterval?

    private let dayFormatter: DateFormatter

    init(agenda: AppleCalendarSync, reminders: AppleRemindersSync,
         history: SessionHistory, health: HealthLog, calendar: Calendar = .current) {
        self.agenda = agenda
        self.reminders = reminders
        self.history = history
        self.health = health
        self.range = CalendarRange(calendar: calendar)

        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = calendar.timeZone
        self.dayFormatter = formatter

        // EventKit returns completed reminders asynchronously. Rebuild when
        // that answer arrives; otherwise the calendar's first pass misses the
        // completion markers until someone manually changes the page.
        reminders.$completedEverywhere
            .dropFirst()
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in self?.reload(force: false) }
            .store(in: &cancellables)

        health.$dailyRecords
            .dropFirst()
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in self?.rebuildScores() }
            .store(in: &cancellables)

        health.$caloriesByDay
            .dropFirst()
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in self?.rebuildScores() }
            .store(in: &cancellables)

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
        selectedDay = day
        reload(force: false)
    }

    /// Pick a day without changing the page.
    func select(_ day: Date) {
        selectedDay = day
    }

    /// A double click is an intentional request to inspect the selected date,
    /// rather than merely move the selection inside the month/week grid.
    func showDay(_ day: Date) {
        granularity = .day
        focusDate = day
        selectedDay = day
        reload(force: true)
    }

    /// The seven days around the selected one.
    var weekDays: [Date] {
        let start = range.startOfWeek(containing: focusDate)
        return (0..<7).compactMap {
            range.calendar.date(byAdding: .day, value: $0, to: start)
        }
    }

    func score(on day: Date) -> DayScore? { scoresByDay[key(for: day)] }

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
            // Completions come from EVERY list, deadlines only from Orion's.
            // Reading widely is what makes the calendar true; writing narrowly
            // is the promise that was actually worth keeping.
            for task in reminders.completedEverywhere {
                if let done = task.completionDate, interval.contains(done) {
                    byDay[key(for: done), default: []].append(CalendarEntry(
                        id: "done:\(task.id)", title: task.title,
                        start: done, end: done, kind: .completed, isAllDay: false
                    ))
                }
            }
            for task in reminders.tasks {
                if !task.isComplete, let due = task.dueDate, interval.contains(due) {
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
            var grouped: [String: [HistoryRecord]] = [:]
            for record in try history.records() where interval.contains(record.startedAt) {
                grouped[record.dayKey, default: []].append(record)
                byDay[record.dayKey, default: []].append(CalendarEntry(
                    id: "focus:\(record.sessionID)",
                    title: record.task,
                    start: record.startedAt, end: record.endedAt,
                    kind: .focus(minutes: Int((record.servedFocusSeconds / 60).rounded()),
                                 reason: record.reason),
                    isAllDay: false
                ))
            }
            historyByDay = grouped
        } catch {
            problems.append("Focus history could not be read: \(error.localizedDescription)")
        }

        for (day, entries) in byDay {
            byDay[day] = entries.sorted { $0.start < $1.start }
        }

        entriesByDay = byDay
        disclosures = problems
        rebuildScores()
    }

    /// Score each visible day from the facts already gathered.
    ///
    /// Four sources, and the point of the rewrite is that ANY of them can carry
    /// a day on its own. Whoop is the one that arrives unattended — it scores
    /// every night whether or not Nick ran a focus session — so a day with
    /// nothing but a recovery and a sleep still gets a number and a colour,
    /// marked provisional rather than withheld. Everything absent is passed as
    /// unavailable, never as zero.
    private func rebuildScores() {
        var scores: [String: DayScore] = [:]

        let days = Set(entriesByDay.keys)
            .union(health.dailyRecords.keys)
            .union(historyByDay.keys)

        for day in days {
            let entries = entriesByDay[day] ?? []
            var inputs = DayScoring.focusInputs(records: historyByDay[day] ?? [])

            // Ticked off against left overdue. A deadline that has not passed
            // yet is not counted against the day it is due on.
            var completed = 0
            var overdue = 0
            for entry in entries {
                switch entry.kind {
                case .completed: completed += 1
                case .deadline(let isOverdue): if isOverdue { overdue += 1 }
                default: break
                }
            }
            inputs.append(DayScoring.tasksInput(completed: completed, overdue: overdue))

            let healthDay = health.record(for: day)
            inputs.append(DayScoring.recoveryInput(percent: healthDay?.recovery))
            inputs.append(DayScoring.sleepInput(percent: healthDay?.sleepPerformance))

            // The band comes from that day's own recovery — a 14 strain is a
            // good day on green and an overreach on red.
            let band = StrainTarget.forRecovery(healthDay?.recovery)
            inputs.append(DayScoring.exertionInput(strain: healthDay?.strain,
                                                   bandLow: band.low, bandHigh: band.high))

            inputs.append(DayScoring.selfCareInput(
                bottles: healthDay?.waterBottles ?? 0,
                bottleGoal: Self.bottleGoal,
                supplementsTaken: healthDay?.supplementIDs.count ?? 0,
                supplementsPlanned: health.supplements.count
            ))
            inputs.append(DayScoring.nutritionInput(calories: health.caloriesByDay[day] ?? 0,
                                                    goal: health.nutritionGoals.calories))

            scores[day] = DayScoring.score(dayKey: day, inputs: inputs)
        }

        scoresByDay = scores
    }

    /// Nine bottles is the day's water, as the hydration control already assumes.
    private static let bottleGoal = 9

    /// History records grouped by day, so scoring does not re-read the file per
    /// cell.
    private var historyByDay: [String: [HistoryRecord]] = [:]
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
