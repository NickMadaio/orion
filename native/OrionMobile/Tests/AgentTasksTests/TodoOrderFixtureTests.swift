import Foundation
import XCTest
@testable import MobileCore

/// One fixture of mixed to-dos (tests/fixtures/todo-order.json, shared with the JS tests), the same order
/// through every shared data path: the phone's list, its groups, the glance the widgets and Home read,
/// and the EventKit key the Mac and the phone's planner build.
final class TodoOrderFixtureTests: XCTestCase {
    struct Row: Decodable { let id: String; let eventKit: Int; let rank: Int; let due: String?; let done: Bool }
    struct Fixture: Decodable { let now: String; let todos: [Row]; let expected: [String] }

    private func load() throws -> Fixture {
        // native/OrionMobile/Tests/AgentTasksTests/<this file> -> repo root.
        var url = URL(fileURLWithPath: #filePath)
        for _ in 0..<5 { url.deleteLastPathComponent() }
        return try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: url.appendingPathComponent("tests/fixtures/todo-order.json")))
    }
    private func date(_ iso: String) -> Date { ISO8601DateFormatter().date(from: iso)! }

    func testTodoItemListAndItsGroupsFollowTheFixtureOrder() throws {
        let f = try load(), now = date(f.now)
        let items = f.todos.reversed().map { TodoItem(id: $0.id, title: $0.id, due: $0.due.map(date), done: $0.done, priority: TodoPriority(eventKit: $0.eventKit)) }
        let open = f.expected.filter { id in !f.todos.first { $0.id == id }!.done }
        XCTAssertEqual(TodoBoard.open(items, now: now).map(\.id), open)
        XCTAssertEqual(TodoBoard.done(items, now: now).map(\.id), ["done-high"])
        XCTAssertEqual(TodoBoard.byTag(items, now: now).flatMap { $0.items.map(\.id) }, open)
        var calendar = Calendar(identifier: .gregorian); calendar.timeZone = TimeZone(identifier: "UTC")!
        let overdue = TodoBoard.upcoming(items, now: now, calendar: calendar).first { $0.title == "Overdue" }
        XCTAssertEqual(overdue?.items.map(\.id), ["late-high", "late-med", "late-low-oldest", "late-none-newest"])
    }

    func testGlanceTodosTheWidgetsAndHomeReadFollowTheFixtureOrder() throws {
        let f = try load(), now = date(f.now)
        let todos = f.todos.reversed().map { OrionGlance.Todo(id: $0.id, title: $0.id, due: $0.due.map(date), priority: $0.rank, done: $0.done) }
        let open = f.expected.filter { id in !f.todos.first { $0.id == id }!.done }
        XCTAssertEqual(OrionGlance.ordered(todos, now: now).map(\.id), open + ["done-high"])
        let glance = OrionGlance(generatedAt: now, source: "test", todos: todos)
        XCTAssertEqual(glance.openTodos(limit: 40, now: now).map(\.id), open)
        XCTAssertEqual(glance.openTodos(limit: 3, now: now).map(\.id), Array(open.prefix(3)), "cut after ordering, not before")
    }

    func testEventKitKeysTheMacAndThePlannerBuildFollowTheFixtureOrder() throws {
        let f = try load(), now = date(f.now)
        XCTAssertEqual(f.todos.map { OrionGlance.rank(eventKit: $0.eventKit) }, f.todos.map(\.rank))
        let keys = f.todos.reversed().map { TodoOrdering.Key(done: $0.done, eventKitPriority: $0.eventKit, due: $0.due.map(date), title: $0.id, id: $0.id) }
        XCTAssertEqual(TodoOrdering.sorted(keys, now: now) { $0 }.map(\.id), f.expected)
    }
}
