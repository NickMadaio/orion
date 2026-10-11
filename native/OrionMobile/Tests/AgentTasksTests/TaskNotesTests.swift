import XCTest
@testable import MobileCore

final class TaskNotesTests: XCTestCase {
    let sample = "2.5 hours a day until it's due\n- [ ] Google Data Analytics · 40%\n- [ ] AWS Cloud Practitioner · 10%\n- [x] CompTIA ITF+ · 100%\nask Sam about vouchers"

    func testParsesSpreadSubtasksAndOther() {
        let notes = TaskNotes.parse(sample)
        XCTAssertEqual(notes.spread, "2.5 hours a day until it's due")
        XCTAssertEqual(notes.subtasks.map(\.title), ["Google Data Analytics", "AWS Cloud Practitioner", "CompTIA ITF+"])
        XCTAssertEqual(notes.subtasks.map(\.percent), [40, 10, 100])
        XCTAssertTrue(notes.subtasks[2].done)
        XCTAssertEqual(notes.other, ["ask Sam about vouchers"])
        XCTAssertEqual(notes.progress, 50)
    }

    func testRoundTripsItsOwnText() {
        let notes = TaskNotes.parse(sample)
        XCTAssertEqual(TaskNotes.parse(notes.text), notes)
    }

    func testPercentIsClampedAndCheckedMeansDone() {
        XCTAssertEqual(TaskNotes.Subtask(title: "x", percent: 140).percent, 100)
        XCTAssertEqual(TaskNotes.parse("- [x] Finished thing").subtasks.first?.percent, 100)
        XCTAssertNil(TaskNotes.parse("just a note").progress)
    }

    func testExplicitSpreadLineAndEmptyNotes() {
        XCTAssertEqual(TaskNotes.parse("- [ ] A · 5%\nspread: 1 hour a day").spread, "1 hour a day")
        XCTAssertEqual(TaskNotes.parse(nil), TaskNotes())
    }

    // Tags and manual order live in the notes so they sync through iCloud Reminders (2026-10-11).
    func testParsesTagsAndOrderWithoutTouchingTheRest() {
        let notes = TaskNotes.parse("2 hours a day\nTags: School, gym , school\nOrder: 2.5\n- [ ] Part one · 20%\nask Sam")
        XCTAssertEqual(notes.tags, ["school", "gym"])
        XCTAssertEqual(notes.order, 2.5)
        XCTAssertEqual(notes.spread, "2 hours a day")
        XCTAssertEqual(notes.subtasks.map(\.title), ["Part one"])
        XCTAssertEqual(notes.other, ["ask Sam"])
        XCTAssertEqual(TaskNotes.parse(notes.text), notes)
    }

    func testTagsAndOrderAloneDoNotBecomeTheSpread() {
        let notes = TaskNotes.parse("Tags: work\nOrder: 1")
        XCTAssertEqual(notes.spread, "")
        XCTAssertEqual(notes.tags, ["work"])
        XCTAssertEqual(TaskNotes.parse(nil).tags, [])
        XCTAssertNil(TaskNotes.parse(nil).order)
    }

    func testOrderBetweenNeighboursOnlyRewritesTheMovedItem() {
        XCTAssertEqual(TaskNotes.order(between: 1, and: 2), 1.5)
        XCTAssertEqual(TaskNotes.order(between: nil, and: 2), 1)
        XCTAssertEqual(TaskNotes.order(between: 3, and: nil), 4)
        XCTAssertEqual(TaskNotes.order(between: nil, and: nil), 0)
    }

    func testSortsByManualOrderThenKeepsTheRestInTheirOriginalOrder() {
        let items = [("c", nil), ("a", 2.0), ("b", 1.0), ("d", nil)] as [(String, Double?)]
        XCTAssertEqual(TaskNotes.sortedByOrder(items, order: { $0.1 }).map(\.0), ["b", "a", "c", "d"])
    }

    func testMovingAnItemReturnsOnlyThePositionsThatChange() {
        // Already placed: only the moved one changes.
        XCTAssertEqual(TaskNotes.reorder(["a", "b", "c"], orders: [0, 1, 2], moving: "c", before: "a"), ["c": -1])
        XCTAssertEqual(TaskNotes.reorder(["a", "b", "c"], orders: [0, 1, 2], moving: "a", before: "c"), ["a": 1.5])
        // First drag ever: everyone gets a position, then the moved one goes between.
        XCTAssertEqual(TaskNotes.reorder(["a", "b", "c"], orders: [nil, nil, nil], moving: "c", before: "b"), ["a": 0, "b": 1, "c": 0.5])
        // Dropping on itself or an unknown id changes nothing.
        XCTAssertEqual(TaskNotes.reorder(["a", "b"], orders: [0, 1], moving: "a", before: "a"), [:])
        XCTAssertEqual(TaskNotes.reorder(["a", "b"], orders: [0, 1], moving: "x", before: "a"), [:])
    }
}
