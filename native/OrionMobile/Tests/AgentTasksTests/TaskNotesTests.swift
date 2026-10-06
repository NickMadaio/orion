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
}
