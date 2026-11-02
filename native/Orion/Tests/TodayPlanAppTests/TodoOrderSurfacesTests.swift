import MobileCore
import XCTest
@testable import Orion

/// The Mac surfaces that feed the shared to-do order (MobileCore.TodoOrdering): Reminders' tasks,
/// the widget's todos, the float, the Home overdue card and the Task lengths list.
@MainActor
final class TodoOrderSurfacesTests: XCTestCase {
    private var calendar: Calendar { var c = Calendar(identifier: .gregorian); c.timeZone = TimeZone(identifier: "Europe/London")!; return c }
    private var now: Date { calendar.date(from: DateComponents(year: 2026, month: 11, day: 2, hour: 10))! }
    private func at(_ day: Int, _ hour: Int = 12) -> Date { calendar.date(from: DateComponents(year: 2026, month: 11, day: day, hour: hour))! }

    private func task(_ id: String, due: Date? = nil, priority: TaskPriority = .none, complete: Bool = false) -> SyncedTask {
        SyncedTask(id: id, title: id, isComplete: complete, dueDate: due, dueHasTime: true, hasAlarm: false, priority: priority)
    }

    func testTaskKeyMapsPriorityBands() {
        XCTAssertEqual(TaskPriority.high.todo, .high)
        XCTAssertEqual(TaskPriority.medium.todo, .medium)
        XCTAssertEqual(TaskPriority.low.todo, .low)
        XCTAssertEqual(TaskPriority.none.todo, TodoPriority.none)
    }

    func testFloatListsOverdueLowAboveHighToday() {
        let tasks = [task("highToday", due: at(2, 20), priority: .high), task("lateLow", due: at(1), priority: .low), task("plainUndated")]
        let ids = TodoFloatItems.today(tasks, now: now, calendar: calendar).map(\.id)
        XCTAssertEqual(ids, ["lateLow", "highToday", "plainUndated"])
    }

    func testWidgetTodosAreOrdered() {
        let todos = [OrionGlance.Todo(id: "none", title: "none"), OrionGlance.Todo(id: "high", title: "high", priority: 1),
                     OrionGlance.Todo(id: "lateLow", title: "lateLow", due: at(1), priority: 3), OrionGlance.Todo(id: "low", title: "low", priority: 3)]
        XCTAssertEqual(GlanceExport.ordered(todos, now: now).map(\.id), ["lateLow", "high", "low", "none"])
    }

    func testTaskLengthsListIsInDisplayOrder() {
        // Scheduler numbers: urgency (-20 overdue, -10 today) plus rank (0 high ... 3 none).
        let tasks = [TodayPlanTask(id: "a-none", title: "a-none", minutes: 30, priority: 3),
                     TodayPlanTask(id: "b-high", title: "b-high", minutes: 30, priority: 0),
                     TodayPlanTask(id: "c-lateLow", title: "c-lateLow", minutes: 30, priority: -20 + 2, due: at(1)),
                     TodayPlanTask(id: "d-done", title: "d-done", minutes: 30, priority: 0, completedInSource: true)]
        let inputs = TodayPlanInputs(tasks: tasks, commitments: [], calendarReadAt: now, tasksReadAt: now,
                                     timeZone: "Europe/London", day: now, fingerprint: "x")
        XCTAssertEqual(inputs.openTasksInDisplayOrder(now: now, calendar: calendar).map(\.id), ["c-lateLow", "b-high", "a-none"])
    }
}
