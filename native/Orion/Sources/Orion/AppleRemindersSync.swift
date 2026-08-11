import EventKit
import Foundation

/*
 The task list, kept in Apple Reminders.

 Why Reminders rather than Orion's own store: a task you can only see on this
 Mac, in this window, is a worse to-do list than the one already on your phone.
 Reminders is the thing that will actually interrupt you at 4pm on the bus, and
 that is most of what a task is for. So Orion does not own the tasks — it owns
 a *view* of them, and everything it writes lands somewhere Nick already looks.

 Note this is NOT the same thing as `ReminderService`, which polls the plugin's
 `reminders.json` for timers and alarms. That is a countdown that has to fire
 while the app is open. This is durable, dated, and syncs to every device.

 Scoped deliberately narrow. Orion reads and writes ONE list, named "Orion",
 which it creates if absent. Full Reminders access is what macOS grants — there
 is no per-list permission — so the restraint has to live here, and it does:
 every fetch is predicated on that single calendar, and nothing else is ever
 touched. A general "manage all your reminders" surface would be a much larger
 promise than the one being made.

 The sync is last-writer-wins on a per-task basis rather than a merge. Both
 sides are small, single-user, and low-frequency; a real merge would be more
 code to be wrong in, and the failure it protects against — editing the same
 task in two places within one refresh window — costs one re-tick.
*/

/// One task, as the dashboard sees it. Mirrors an `EKReminder` in the Orion list.
struct SyncedTask: Identifiable, Equatable {
    /// `EKReminder.calendarItemIdentifier`. Stable across edits and devices.
    let id: String
    var title: String
    var isComplete: Bool

    /// WHEN it was completed, from `EKReminder.completionDate`.
    ///
    /// Needed by the calendar, which draws what actually happened on a day
    /// rather than what was scheduled for it. A task due Monday and finished on
    /// Thursday belongs on Thursday in a record of the week, and `dueDate`
    /// cannot say that.
    var completionDate: Date?

    var dueDate: Date?
    var hasAlarm: Bool
    /// Real, and syncs — `EKReminder.priority`. See TaskPriority.
    var priority: TaskPriority = .none
    /// 0...1, and LOCAL — EventKit has no percent-complete field.
    var progress: Double = 0

    /// What the list sorts by. Overdue first because it is the only category
    /// that is actually urgent, then priority, then when it is due. Sorting by
    /// due date alone buries a high-priority task with no date under a week of
    /// trivia that happens to be dated.
    var sortKey: (Int, Int, Date) {
        (isOverdue ? 0 : 1, priority.rank, dueDate ?? .distantFuture)
    }

    var isOverdue: Bool {
        guard let dueDate, !isComplete else { return false }
        return dueDate < Date()
    }
}

/*
 Deliberately not `@MainActor`, matching the rest of this app: the audio taps,
 the AppKit callbacks and the socket reader all hop to the main thread by hand,
 and Package.swift opts the target back into the Swift 5 language mode for
 exactly that reason. EventKit's fetch completion arrives on an arbitrary
 queue, so every publish below hops explicitly.
*/
final class AppleRemindersSync: ObservableObject {

    enum Access: Equatable {
        case unknown
        case granted
        case denied(String)
        /// EventKit is present but the list could not be prepared.
        case unavailable(String)

        var isGranted: Bool { self == .granted }
    }

    @Published private(set) var access: Access = .unknown
    @Published private(set) var tasks: [SyncedTask] = []
    @Published private(set) var lastSyncedAt: Date?
    @Published private(set) var lastError: String?

    /// The one list Orion is allowed to touch.
    static let listTitle = "Orion"

    private let store = EKEventStore()
    private var calendar: EKCalendar?
    private var refreshTimer: Timer?
    private var changeObserver: NSObjectProtocol?

    // MARK: - Lifecycle

    func start() {
        requestAccess { [weak self] granted in
            guard let self, granted else { return }
            self.refresh()
            // Reminders edited on the phone arrive here as a store change.
            self.changeObserver = NotificationCenter.default.addObserver(
                forName: .EKEventStoreChanged,
                object: self.store,
                queue: .main
            ) { [weak self] _ in
                // Hop to the main actor explicitly: the notification queue is
                // main, but the closure is not isolated and Swift 5 mode will
                // not assume it.
                DispatchQueue.main.async { self?.refresh() }
            }
            // A backstop for the case where the change notification does not
            // arrive — a sleeping Mac, or an iCloud push that lands quietly.
            self.refreshTimer = Timer.scheduledTimer(withTimeInterval: 120, repeats: true) { [weak self] _ in
                DispatchQueue.main.async { self?.refresh() }
            }
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

    private func requestAccess(_ completion: @escaping (Bool) -> Void) {
        let handle: (Bool, Error?) -> Void = { [weak self] granted, error in
            DispatchQueue.main.async {
                guard let self else { return }
                if granted {
                    self.access = .granted
                    self.prepareCalendar()
                } else {
                    // Say where to fix it. "Denied" with no route to undo it is
                    // the least useful thing a permission failure can say.
                    self.access = .denied(
                        error?.localizedDescription
                            ?? "Allow Orion in System Settings ▸ Privacy & Security ▸ Reminders."
                    )
                }
                completion(granted)
            }
        }
        if #available(macOS 14.0, *) {
            store.requestFullAccessToReminders(completion: handle)
        } else {
            store.requestAccess(to: .reminder, completion: handle)
        }
    }

    /// Find the Orion list, or make it.
    private func prepareCalendar() {
        if let existing = store.calendars(for: .reminder)
            .first(where: { $0.title == Self.listTitle }) {
            calendar = existing
            return
        }
        let created = EKCalendar(for: .reminder, eventStore: store)
        created.title = Self.listTitle
        // `defaultCalendarForNewReminders` picks a source that can actually
        // hold reminders — iCloud when it is on, Local otherwise. Choosing a
        // source by hand is how you end up writing into a source that silently
        // refuses to save.
        created.source = store.defaultCalendarForNewReminders()?.source
            ?? store.sources.first { $0.sourceType == .local }
        guard created.source != nil else {
            access = .unavailable("No Reminders account is available to hold the Orion list.")
            return
        }
        do {
            try store.saveCalendar(created, commit: true)
            calendar = created
        } catch {
            access = .unavailable("Could not create the Orion list: \(error.localizedDescription)")
        }
    }

    // MARK: - Reading

    func refresh() {
        guard access.isGranted else { return }
        if calendar == nil { prepareCalendar() }
        guard let calendar else { return }
        // Predicated on the one list. This is the scope promise, in code.
        let predicate = store.predicateForReminders(in: [calendar])
        store.fetchReminders(matching: predicate) { [weak self] found in
            let mapped = (found ?? [])
                .map { reminder in
                    let id = reminder.calendarItemIdentifier
                    return SyncedTask(
                        id: id,
                        title: reminder.title ?? "Untitled",
                        isComplete: reminder.isCompleted,
                        completionDate: reminder.completionDate,
                        dueDate: reminder.dueDateComponents?.date,
                        hasAlarm: !(reminder.alarms ?? []).isEmpty,
                        priority: TaskPriority.from(reminder.priority),
                        progress: reminder.isCompleted ? 1 : TaskProgressStore.shared.progress(for: id)
                    )
                }
                // Completed sink to the bottom; above that, overdue, then
                // priority, then due date. The list should answer "what now".
                .sorted { left, right in
                    if left.isComplete != right.isComplete { return !left.isComplete }
                    if left.sortKey != right.sortKey { return left.sortKey < right.sortKey }
                    return left.title < right.title
                }
            DispatchQueue.main.async {
                guard let self else { return }
                self.tasks = mapped
                self.lastSyncedAt = Date()
                TaskProgressStore.shared.prune(keeping: Set(mapped.map(\.id)))
            }
        }
    }

    // MARK: - Writing

    func add(_ title: String, due: Date? = nil, priority: TaskPriority = .none) {
        let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, access.isGranted else { return }
        if calendar == nil { prepareCalendar() }
        guard let calendar else { return }

        let reminder = EKReminder(eventStore: store)
        reminder.calendar = calendar
        reminder.title = trimmed
        reminder.priority = priority.rawValue
        if let due {
            reminder.dueDateComponents = Calendar.current.dateComponents(
                [.year, .month, .day, .hour, .minute], from: due
            )
            // A due date alone is a label; it does not notify. The alarm is the
            // entire reason for putting tasks in Reminders, so a dated task
            // always gets one.
            reminder.addAlarm(EKAlarm(absoluteDate: due))
        }
        commit(reminder)
    }

    func setComplete(_ id: String, _ complete: Bool) {
        mutate(id) { reminder in
            reminder.isCompleted = complete
            // Clearing the date on completion would lose when it was due, so
            // only the flag changes. EventKit sets completionDate itself.
        }
    }

    func setDue(_ id: String, _ due: Date?) {
        mutate(id) { reminder in
            // Replace rather than add: setting a new time on a task that
            // already had one would otherwise leave the old alarm in place and
            // fire twice.
            for alarm in reminder.alarms ?? [] { reminder.removeAlarm(alarm) }
            if let due {
                reminder.dueDateComponents = Calendar.current.dateComponents(
                    [.year, .month, .day, .hour, .minute], from: due
                )
                reminder.addAlarm(EKAlarm(absoluteDate: due))
            } else {
                reminder.dueDateComponents = nil
            }
        }
    }

    func setPriority(_ id: String, _ priority: TaskPriority) {
        mutate(id) { $0.priority = priority.rawValue }
    }

    /// Local only — see TaskPriority for why there is nowhere to sync this to.
    /// Reaching 100% does NOT complete the task: "done enough to stop thinking
    /// about" and "done" are different claims, and only the tick makes the
    /// second one.
    func setProgress(_ id: String, _ progress: Double) {
        TaskProgressStore.shared.set(progress, for: id)
        guard let index = tasks.firstIndex(where: { $0.id == id }) else { return }
        tasks[index].progress = min(1, max(0, progress))
    }

    func rename(_ id: String, to title: String) {
        let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        mutate(id) { $0.title = trimmed }
    }

    func remove(_ id: String) {
        guard access.isGranted,
              let reminder = store.calendarItem(withIdentifier: id) as? EKReminder
        else { return }
        do {
            try store.remove(reminder, commit: true)
            tasks.removeAll { $0.id == id }
            refresh()
        } catch {
            lastError = "Could not delete: \(error.localizedDescription)"
        }
    }

    private func mutate(_ id: String, _ change: (EKReminder) -> Void) {
        guard access.isGranted,
              let reminder = store.calendarItem(withIdentifier: id) as? EKReminder
        else { return }
        change(reminder)
        commit(reminder)
    }

    private func commit(_ reminder: EKReminder) {
        do {
            try store.save(reminder, commit: true)
            lastError = nil
            refresh()
        } catch {
            lastError = error.localizedDescription
        }
    }

    // MARK: - Read-out

    var openCount: Int { tasks.filter { !$0.isComplete }.count }
    var doneCount: Int { tasks.filter(\.isComplete).count }
    var overdueCount: Int { tasks.filter(\.isOverdue).count }

    /// One line for the section header and for `orion-doctor`.
    var statusLine: String {
        switch access {
        case .unknown: return "checking Reminders access…"
        case .denied(let why): return why
        case .unavailable(let why): return why
        case .granted:
            guard let lastSyncedAt else { return "connected" }
            return "synced \(lastSyncedAt.formatted(date: .omitted, time: .shortened))"
        }
    }
}
