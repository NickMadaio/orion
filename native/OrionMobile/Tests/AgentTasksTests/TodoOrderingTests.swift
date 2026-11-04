import XCTest
@testable import MobileCore

/// The shared to-do order: overdue, then high / medium / low / none; earliest due,
/// then undated, then title inside a level; done last.
final class TodoOrderingTests: XCTestCase {
    private var cal: Calendar { var c = Calendar(identifier: .gregorian); c.timeZone = TimeZone(identifier: "Europe/London")!; c.firstWeekday = 2; return c }
    /// Tuesday 13 Oct 2026, 10:00 London.
    private var now: Date { cal.date(from: DateComponents(year: 2026, month: 10, day: 13, hour: 10))! }
    private func at(_ d: Int, _ h: Int = 23, _ m: Int = 59) -> Date { cal.date(from: DateComponents(year: 2026, month: 10, day: d, hour: h, minute: m))! }
    private func item(_ id: String, due: Date? = nil, done: Bool = false, priority: TodoPriority = .none, title: String? = nil) -> TodoItem {
        TodoItem(id: id, title: title ?? id, due: due, done: done, priority: priority)
    }
    private func order(_ items: [TodoItem]) -> [String] { TodoOrdering.sorted(items, now: now, key: \.orderKey).map(\.id) }

    func testOverdueLowBeatsHighNotOverdue() {
        let items = [item("high", due: at(20), priority: .high), item("lateLow", due: at(12), priority: .low)]
        XCTAssertEqual(order(items), ["lateLow", "high"])
    }

    func testPriorityLevelsAfterOverdue() {
        let items = [item("none"), item("low", priority: .low), item("med", priority: .medium), item("high", priority: .high), item("late", due: at(1), priority: .none)]
        XCTAssertEqual(order(items), ["late", "high", "med", "low", "none"])
    }

    func testTiesBreakByEarliestDueThenUndatedThenTitle() {
        let items = [item("c", priority: .high), item("b", due: at(20), priority: .high), item("a", due: at(15), priority: .high), item("a2", priority: .high, title: "a2")]
        XCTAssertEqual(order(items), ["a", "b", "a2", "c"])
    }

    func testOverdueBlockIsRankedByPriorityThenHowLateAndMissingPriorityIsLast() {
        let items = [item("olderNone", due: at(2), priority: .none), item("newerHigh", due: at(12), priority: .high),
                     item("olderHigh", due: at(3), priority: .high), item("midLow", due: at(8), priority: .low)]
        XCTAssertEqual(order(items), ["olderHigh", "newerHigh", "midLow", "olderNone"])
    }

    func testHandPlacedOrderBreaksTiesAfterPriorityAndDueButBeforeTitle() {
        let first = TodoOrdering.Key(done: false, priority: .high, due: nil, title: "zzz", id: "1", order: 1)
        let second = TodoOrdering.Key(done: false, priority: .high, due: nil, title: "aaa", id: "2", order: 2)
        let loose = TodoOrdering.Key(done: false, priority: .high, due: nil, title: "bbb", id: "3")
        XCTAssertEqual(TodoOrdering.sorted([loose, second, first], now: now) { $0 }.map(\.id), ["1", "2", "3"])
        let dated = TodoOrdering.Key(done: false, priority: .high, due: at(20), title: "zzz", id: "4", order: 9)
        XCTAssertEqual(TodoOrdering.sorted([first, dated], now: now) { $0 }.map(\.id), ["4", "1"])
    }

    func testTimedDueBeforeNowIsOverdueButLaterTodayIsNot() {
        XCTAssertTrue(TodoOrdering.isOverdue(done: false, due: at(13, 9, 0), now: now))
        XCTAssertFalse(TodoOrdering.isOverdue(done: false, due: at(13, 17, 0), now: now))
        XCTAssertFalse(TodoOrdering.isOverdue(done: false, due: nil, now: now))
    }

    func testDoneItemsStayLastAndAreNeverOverdue() {
        XCTAssertFalse(TodoOrdering.isOverdue(done: true, due: at(1), now: now))
        let items = [item("doneHigh", due: at(1), done: true, priority: .high), item("open", priority: .none), item("doneLow", done: true, priority: .low)]
        XCTAssertEqual(order(items), ["open", "doneHigh", "doneLow"])
    }

    func testEqualKeysFallBackToIdSoOrderIsStable() {
        let items = [item("2", title: "same"), item("1", title: "same")]
        XCTAssertEqual(order(items), ["1", "2"])
        XCTAssertEqual(order(items.reversed()), ["1", "2"])
    }

    func testEveryBoardGroupUsesTheKey() {
        let items = [item("lowToday", due: at(13, 18, 0), priority: .low), item("highToday", due: at(13, 20, 0), priority: .high),
                     item("lateLow", due: at(12), priority: .low), item("lateHigh", due: at(11), priority: .high),
                     item("someLow", priority: .low), item("someHigh", priority: .high)]
        let groups = TodoBoard.upcoming(items, now: now, calendar: cal)
        XCTAssertEqual(groups.map(\.title), ["Overdue", "Today", "No date"])
        XCTAssertEqual(groups.map { $0.items.map(\.id) }, [["lateHigh", "lateLow"], ["highToday", "lowToday"], ["someHigh", "someLow"]])
        XCTAssertEqual(TodoBoard.open(items, now: now).map(\.id), ["lateHigh", "lateLow", "highToday", "someHigh", "lowToday", "someLow"])
        let tagged = ["lowToday", "lateLow", "highToday"].map { id in item(id, due: items.first { $0.id == id }!.due, priority: items.first { $0.id == id }!.priority) }
            .map { var t = $0; t.notes = "Tags: x"; return t }
        XCTAssertEqual(TodoBoard.byTag(tagged, now: now)[0].items.map(\.id), ["lateLow", "highToday", "lowToday"])
    }

    func testDoneListIsOrderedToo() {
        let items = [item("a", done: true), item("b", done: true, priority: .high)]
        XCTAssertEqual(TodoBoard.done(items, now: now).map(\.id), ["b", "a"])
    }
}
