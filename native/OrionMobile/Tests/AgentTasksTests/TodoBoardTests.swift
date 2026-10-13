import XCTest
@testable import MobileCore

/// The to-do list's shared logic (2026-10-13): one-line quick add, tag colours,
/// and the views from his old Notion list (to do, upcoming, by tag, done).
final class TodoBoardTests: XCTestCase {
    private var cal: Calendar { var c = Calendar(identifier: .gregorian); c.timeZone = TimeZone(identifier: "Europe/London")!; c.firstWeekday = 2; return c }
    /// Tuesday 13 Oct 2026, 10:00 London.
    private var now: Date { cal.date(from: DateComponents(year: 2026, month: 10, day: 13, hour: 10))! }
    private func at(_ d: Int, _ h: Int = 23, _ m: Int = 59, month: Int = 10) -> Date { cal.date(from: DateComponents(year: 2026, month: month, day: d, hour: h, minute: m))! }
    private func parse(_ s: String) -> TodoDraft { TodoQuickAdd.parse(s, now: now, calendar: cal) }

    func testTagsAndPriorityAreTakenOutOfTheTitle() {
        let d = parse("Clean room #home !high")
        XCTAssertEqual(d.title, "Clean room")
        XCTAssertEqual(d.tags, ["home"])
        XCTAssertEqual(d.priority, .high)
        XCTAssertNil(d.due)
        XCTAssertEqual(parse("Visa !!").priority, .medium)
        XCTAssertEqual(parse("Wash car !low #car #weekend").tags, ["car", "weekend"])
        XCTAssertEqual(parse("Wash car !").priority, .low)
    }

    func testATrailingDayIsTheDueDateWithoutATime() {
        let d = parse("Essay #school fri")
        XCTAssertEqual(d.title, "Essay")
        XCTAssertEqual(d.due, at(16))
        XCTAssertFalse(d.dueHasTime)
        XCTAssertEqual(parse("Essay due tomorrow").due, at(14))
        XCTAssertEqual(parse("Essay tmrw").due, at(14))
        XCTAssertEqual(parse("Essay today").due, at(13))
        XCTAssertEqual(parse("Essay tue").due, at(13), "today's weekday is today")
        XCTAssertEqual(parse("Essay next week").due, at(19))
        XCTAssertEqual(parse("Essay by oct 20").due, at(20))
        XCTAssertEqual(parse("Essay 3 nov").due, at(3, month: 11))
    }

    func testATimeMakesItATimedDueDate() {
        let d = parse("Call the bank fri 5pm")
        XCTAssertEqual(d.title, "Call the bank")
        XCTAssertEqual(d.due, at(16, 17, 0))
        XCTAssertTrue(d.dueHasTime)
        XCTAssertEqual(parse("Call the bank at 9:30").due, at(14, 9, 30), "a time already past today means tomorrow")
        XCTAssertEqual(parse("Call the bank 17:15").due, at(13, 17, 15))
        XCTAssertEqual(parse("Call the bank tonight").due, at(13, 20, 0))
    }

    func testDayWordsInsideTheTitleStayInTheTitle() {
        let d = parse("Plan sat hike with Sam")
        XCTAssertEqual(d.title, "Plan sat hike with Sam")
        XCTAssertNil(d.due)
        XCTAssertEqual(parse("Read chapter 5").title, "Read chapter 5")
        XCTAssertEqual(parse("A - Parental stuff").title, "A - Parental stuff")
        XCTAssertEqual(parse("today").title, "today", "a title that is only a date word is kept")
    }

    func testTagColoursAreStableAndSpread() {
        XCTAssertEqual(TodoTagColor.index(for: "school"), TodoTagColor.index(for: "School"))
        XCTAssertEqual(TodoTagColor.index(for: "school"), TodoTagColor.index(for: "school"))
        let spread = Set(["school", "gym", "home", "work", "errands", "car", "quiz", "homework"].map(TodoTagColor.index(for:)))
        XCTAssertGreaterThanOrEqual(spread.count, 5)
        XCTAssertTrue((0..<TodoTagColor.count).contains(TodoTagColor.index(for: "anything")))
    }

    func testATagSetGetsDistinctColours() {
        let tags = ["school", "career", "admin", "home", "weekend", "car", "gym"]
        let colours = TodoTagColor.assign(tags)
        XCTAssertEqual(Set(colours.values).count, tags.count)
        XCTAssertEqual(colours, TodoTagColor.assign(tags.reversed()))
    }

    private func item(_ id: String, due: Date? = nil, done: Bool = false, priority: TodoPriority = .none, notes: String = "") -> TodoItem {
        TodoItem(id: id, title: id, due: due, done: done, priority: priority, notes: notes)
    }

    func testUpcomingGroupsByDay() {
        let items = [item("late", due: at(12)), item("today", due: at(13, 18, 0)), item("tmrw", due: at(14)),
                     item("fri", due: at(16)), item("next", due: at(21)), item("later", due: at(2, month: 11)), item("someday"),
                     item("finished", due: at(13), done: true)]
        let groups = TodoBoard.upcoming(items, now: now, calendar: cal)
        XCTAssertEqual(groups.map(\.title), ["Overdue", "Today", "Tomorrow", "Friday", "Next week", "Later", "No date"])
        XCTAssertEqual(groups.map { $0.items.map(\.id) }, [["late"], ["today"], ["tmrw"], ["fri"], ["next"], ["later"], ["someday"]])
    }

    func testByTagGroupsEachTagAndUntagged() {
        let items = [item("a", notes: "Tags: school, quiz"), item("b", notes: "Tags: school"), item("c")]
        let groups = TodoBoard.byTag(items)
        XCTAssertEqual(groups.map(\.title), ["school", "quiz", "No tag"])
        XCTAssertEqual(groups[0].items.map(\.id), ["a", "b"])
    }

    func testFiltersAndOrder() {
        let items = [item("b", notes: "Order: 2"), item("a", notes: "Order: 1\nTags: gym"), item("done", done: true)]
        XCTAssertEqual(TodoBoard.open(items).map(\.id), ["a", "b"])
        XCTAssertEqual(TodoBoard.open(items, tags: ["gym"]).map(\.id), ["a"])
        XCTAssertEqual(TodoBoard.done(items).map(\.id), ["done"])
        XCTAssertEqual(TodoBoard.allTags(items), ["gym"])
    }

    func testPriorityMapsToEventKit() {
        XCTAssertEqual(TodoPriority(eventKit: 1), .high)
        XCTAssertEqual(TodoPriority(eventKit: 3), .high)
        XCTAssertEqual(TodoPriority(eventKit: 5), .medium)
        XCTAssertEqual(TodoPriority(eventKit: 9), .low)
        XCTAssertEqual(TodoPriority(eventKit: 0), .none)
        XCTAssertEqual(TodoPriority.medium.eventKit, 5)
    }

    func testDueLabels() {
        XCTAssertEqual(TodoBoard.dueLabel(at(13), now: now, calendar: cal), "Today")
        XCTAssertEqual(TodoBoard.dueLabel(at(13, 17, 0), now: now, calendar: cal), "Today 5 PM")
        XCTAssertEqual(TodoBoard.dueLabel(at(14, 9, 30), now: now, calendar: cal), "Tomorrow 9:30 AM")
        XCTAssertEqual(TodoBoard.dueLabel(at(16), now: now, calendar: cal), "Fri")
        XCTAssertEqual(TodoBoard.dueLabel(at(12), now: now, calendar: cal), "Yesterday")
        XCTAssertEqual(TodoBoard.dueLabel(at(2, month: 11), now: now, calendar: cal), "2 Nov")
        XCTAssertFalse(TodoBoard.hasTime(at(16)))
        XCTAssertTrue(TodoBoard.hasTime(at(16, 9, 0)))
    }
}
