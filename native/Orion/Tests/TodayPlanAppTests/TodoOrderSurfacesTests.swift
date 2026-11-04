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

    // MARK: One fixture, every Mac data path (tests/fixtures/todo-order.json, shared with MobileCore and the JS tests)

    private struct Row: Decodable { let id: String; let eventKit: Int; let rank: Int; let due: String?; let done: Bool }
    private struct Fixture: Decodable { let now: String; let todos: [Row]; let expected: [String] }

    private func fixture() throws -> Fixture {
        var url = URL(fileURLWithPath: #filePath)
        for _ in 0..<5 { url.deleteLastPathComponent() }   // native/Orion/Tests/TodayPlanAppTests/<file> -> repo root
        return try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: url.appendingPathComponent("tests/fixtures/todo-order.json")))
    }
    private func date(_ iso: String) -> Date { ISO8601DateFormatter().date(from: iso)! }

    func testRemindersTasksTheTasksTabAndHomeReadFollowTheFixtureOrder() throws {
        let f = try fixture(), now = date(f.now)
        let tasks = f.todos.reversed().map { row in
            SyncedTask(id: row.id, title: row.id, isComplete: row.done, dueDate: row.due.map(date), dueHasTime: true, hasAlarm: false,
                       priority: TaskPriority.from(row.eventKit))
        }
        XCTAssertEqual(TodoOrdering.sorted(tasks, now: now, key: \.orderKey).map(\.id), f.expected, "AppleRemindersSync.tasks")
        // The Tasks tab hands the same fields to the shared screen as TodoItems.
        let items = tasks.map { TodoItem(id: $0.id, title: $0.title, due: $0.dueDate, done: $0.isComplete, priority: $0.priority.todo) }
        XCTAssertEqual(TodoBoard.open(items, now: now).map(\.id) + TodoBoard.done(items, now: now).map(\.id), f.expected, "Plan tab")
        let open = tasks.filter { !$0.isComplete }
        XCTAssertEqual(TodoFloatItems.today(open, now: now, calendar: calendar).map(\.id).prefix(4), ArraySlice(f.expected.prefix(4)), "float")
        XCTAssertEqual(TodoOrdering.sorted(open.filter { $0.dueDate.map { $0 < now } ?? false }, now: now, key: \.orderKey).map(\.id),
                       ["late-high", "late-med", "late-low-oldest", "late-none-newest"], "Home overdue card")
    }

    func testWidgetExportAndTheMacsGlanceFollowTheFixtureOrder() throws {
        let f = try fixture(), now = date(f.now)
        let todos = f.todos.reversed().map { OrionGlance.Todo(id: $0.id, title: $0.id, due: $0.due.map(date), priority: OrionGlance.rank(eventKit: $0.eventKit), done: $0.done) }
        XCTAssertEqual(GlanceExport.ordered(todos, now: now).map(\.id), f.expected)
    }

    func testADateOnlyDueIsNotOverdueUntilTheDayIsOver() {
        let components = DateComponents(year: 2026, month: 11, day: 4)
        let due = GlanceExport.due(components)
        XCTAssertEqual(due.map { Calendar.current.component(.hour, from: $0) }, 23)
        let task = SyncedTask(id: "t", title: "t", isComplete: false, dueDate: Calendar.current.date(from: components), dueHasTime: false, hasAlarm: false)
        XCTAssertFalse(TodoOrdering.isOverdue(done: false, due: task.orderKey.due, now: Calendar.current.date(from: DateComponents(year: 2026, month: 11, day: 4, hour: 10))!))
    }
}
