import XCTest
@testable import Orion

private final class MemoryStore: TodoFloatStore {
    var saved: TodoFloatState?
    var saves = 0
    init(_ initial: TodoFloatState? = nil) { saved = initial }
    func load() -> TodoFloatState { saved ?? TodoFloatState() }
    func save(_ state: TodoFloatState) { saved = state; saves += 1 }
}

private func task(_ id: String, due: Date? = nil, done: Bool = false, completedAt: Date? = nil,
                  title: String? = nil) -> SyncedTask {
    var t = SyncedTask(id: id, title: title ?? id, isComplete: done, hasAlarm: false)
    t.dueDate = due
    t.completionDate = completedAt
    return t
}

final class TodoFloatModelTests: XCTestCase {
    func testStartsCollapsedAndDocked() {
        let model = TodoFloatModel(store: MemoryStore())
        XCTAssertFalse(model.showsDropdown)
        XCTAssertFalse(model.isPoppedOut)
    }

    func testChevronTogglesDropdown() {
        let model = TodoFloatModel(store: MemoryStore())
        model.toggleExpanded()
        XCTAssertTrue(model.showsDropdown)
        model.toggleExpanded()
        XCTAssertFalse(model.showsDropdown)
    }

    func testPopOutHidesDropdownAndRemembersIt() {
        let model = TodoFloatModel(store: MemoryStore())
        model.toggleExpanded()
        model.popOut()
        XCTAssertTrue(model.isPoppedOut)
        XCTAssertFalse(model.showsDropdown, "the same list must not show twice")
        model.closePopOut()
        XCTAssertTrue(model.showsDropdown, "closing the window leaves the dropdown as it was")
    }

    func testChevronWhilePoppedOutDocksBackOpen() {
        let model = TodoFloatModel(store: MemoryStore())
        model.popOut()
        model.toggleExpanded()
        XCTAssertFalse(model.isPoppedOut)
        XCTAssertTrue(model.showsDropdown)
    }

    func testDockOpensDropdown() {
        let model = TodoFloatModel(store: MemoryStore())
        model.popOut()
        model.dock()
        XCTAssertEqual(model.state, TodoFloatState(expanded: true, poppedOut: false))
    }

    func testTogglePopOutWorksWithNoSession() {
        let model = TodoFloatModel(store: MemoryStore())
        model.togglePopOut()
        XCTAssertTrue(model.isPoppedOut)
        model.togglePopOut()
        XCTAssertFalse(model.isPoppedOut)
    }

    func testStateIsPersistedAndRestored() {
        let store = MemoryStore()
        let first = TodoFloatModel(store: store)
        first.toggleExpanded()
        first.popOut()
        let second = TodoFloatModel(store: store)
        XCTAssertEqual(second.state, TodoFloatState(expanded: true, poppedOut: true))
    }

    func testNoOpChangesDoNotWrite() {
        let store = MemoryStore()
        let model = TodoFloatModel(store: store)
        model.closePopOut()
        XCTAssertEqual(store.saves, 0)
    }

    func testUserDefaultsStoreRoundTripsAndToleratesGarbage() throws {
        let suite = "orion.test.todoFloat.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let store = UserDefaultsTodoFloatStore(defaults: defaults)
        XCTAssertEqual(store.load(), TodoFloatState())
        store.save(TodoFloatState(expanded: true, poppedOut: true))
        XCTAssertEqual(store.load(), TodoFloatState(expanded: true, poppedOut: true))
        defaults.set(Data("nope".utf8), forKey: UserDefaultsTodoFloatStore.key)
        XCTAssertEqual(store.load(), TodoFloatState())
    }
}

final class TodoFloatItemsTests: XCTestCase {
    private var calendar: Calendar = {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(identifier: "UTC")!
        return c
    }()
    private lazy var now = calendar.date(from: DateComponents(year: 2026, month: 3, day: 10, hour: 12))!

    private func at(day: Int, hour: Int = 9) -> Date {
        calendar.date(from: DateComponents(year: 2026, month: 3, day: day, hour: hour))!
    }

    func testKeepsTodayOverdueAndUndatedDropsFuture() {
        let tasks = [task("tomorrow", due: at(day: 11)), task("today", due: at(day: 10, hour: 17)),
                     task("late", due: at(day: 8)), task("undated")]
        let ids = Set(TodoFloatItems.today(tasks, now: now, calendar: calendar).map(\.id))
        XCTAssertEqual(ids, ["today", "late", "undated"])
    }

    func testCompletedTodayStaysVisibleButOldCompletionsGo() {
        let tasks = [task("doneNow", done: true, completedAt: at(day: 10, hour: 11)),
                     task("doneOld", done: true, completedAt: at(day: 3)),
                     task("open", due: at(day: 10, hour: 18))]
        let result = TodoFloatItems.today(tasks, now: now, calendar: calendar)
        XCTAssertEqual(result.map(\.id), ["open", "doneNow"], "open first, finished-today after")
    }

    func testOpenCountIgnoresCompleted() {
        let tasks = [task("a", due: at(day: 10, hour: 18)),
                     task("b", done: true, completedAt: at(day: 10, hour: 8))]
        XCTAssertEqual(TodoFloatItems.openCount(tasks, now: now, calendar: calendar), 1)
    }

    func testLimitCapsTheList() {
        let tasks = (0..<10).map { task("t\($0)") }
        XCTAssertEqual(TodoFloatItems.today(tasks, now: now, calendar: calendar, limit: 4).count, 4)
    }
}

final class TodoCompletionTests: XCTestCase {
    func testOpenTaskIsCompleted() {
        var calls: [(String, Bool)] = []
        let found = TodoCompletion.toggle(id: "a", in: [task("a")]) { calls.append(($0, $1)) }
        XCTAssertTrue(found)
        XCTAssertEqual(calls.count, 1)
        XCTAssertEqual(calls.first?.0, "a")
        XCTAssertEqual(calls.first?.1, true)
    }

    func testDoneTaskIsReopened() {
        var calls: [(String, Bool)] = []
        TodoCompletion.toggle(id: "a", in: [task("a", done: true)]) { calls.append(($0, $1)) }
        XCTAssertEqual(calls.first?.1, false)
    }

    func testUnknownIdDoesNothing() {
        var called = false
        let found = TodoCompletion.toggle(id: "zzz", in: [task("a")]) { _, _ in called = true }
        XCTAssertFalse(found)
        XCTAssertFalse(called)
    }
}

final class FloatPanelResizeTests: XCTestCase {
    private let screen = CGRect(x: 0, y: 0, width: 1000, height: 800)

    func testKeepsTopEdgeWhenGrowing() {
        let current = CGRect(x: 100, y: 400, width: 300, height: 80)
        let next = FloatPanelResize.frame(current: current, newSize: CGSize(width: 300, height: 280), visible: screen)
        XCTAssertEqual(next.maxY, current.maxY)
        XCTAssertEqual(next.minX, 100)
    }

    func testSlidesUpWhenItWouldLeaveTheBottomOfTheScreen() {
        let current = CGRect(x: 100, y: 28, width: 300, height: 80)
        let next = FloatPanelResize.frame(current: current, newSize: CGSize(width: 300, height: 280), visible: screen)
        XCTAssertEqual(next.minY, 0)
        XCTAssertEqual(next.height, 280)
    }

    func testPullsBackFromTheRightEdge() {
        let current = CGRect(x: 800, y: 400, width: 150, height: 80)
        let next = FloatPanelResize.frame(current: current, newSize: CGSize(width: 300, height: 80), visible: screen)
        XCTAssertEqual(next.maxX, 1000)
    }
}

final class HitTargetTests: XCTestCase {
    func testMinimumIsAtLeastTwentyEightPoints() {
        XCTAssertGreaterThanOrEqual(HitTarget.minimum, 28)
    }
}
