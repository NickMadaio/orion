import XCTest
import MobileCore
@testable import Orion

/// Wave 14 (Plan tab): the pure decisions behind the rounder Plan page. Which colour family a block's timeline
/// node takes, which dots a month day shows, how the access warnings fold into one capsule, which way a month
/// slides, and how full the rings are.
final class Wave14PlanTests: XCTestCase {

    // MARK: Timeline node families

    func testCommitmentsAreClassesUnlessTheyAreTravel() {
        XCTAssertEqual(PlanBlockFamily.of(kind: .commitment, title: "CS1800 Discrete Structures"), .classTime)
        XCTAssertEqual(PlanBlockFamily.of(kind: .commitment, title: "Commute to campus"), .travel)
        XCTAssertEqual(PlanBlockFamily.of(kind: .transition, title: "Buffer"), .travel)
    }

    func testMovementTasksAreTheirOwnFamily() {
        XCTAssertEqual(PlanBlockFamily.of(kind: .task, title: "Gym"), .move)
        XCTAssertEqual(PlanBlockFamily.of(kind: .task, title: "Evening run"), .move)
        XCTAssertEqual(PlanBlockFamily.of(kind: .task, title: "Finish resume"), .task)
        // "running" inside a word that is not about moving must not count.
        XCTAssertEqual(PlanBlockFamily.of(kind: .task, title: "Prune old branches"), .task)
    }

    func testFreeTimeIsFree() {
        XCTAssertEqual(PlanBlockFamily.of(kind: .free, title: "Intentional free time"), .free)
    }

    // MARK: Month dots

    private func entry(_ id: String, _ kind: CalendarEntry.Kind) -> CalendarEntry {
        CalendarEntry(id: id, title: id, start: Date(timeIntervalSince1970: 0), end: Date(timeIntervalSince1970: 60),
                      kind: kind, isAllDay: false)
    }

    func testADayWithNothingHasNoDots() {
        let dots = CalendarDots.make(for: [])
        XCTAssertTrue(dots.shown.isEmpty)
        XCTAssertEqual(dots.overflow, 0)
    }

    func testOneDotPerKindOfThingNotPerThing() {
        let entries = [entry("a", .event(colorHex: "#FF0000")), entry("b", .event(colorHex: "#FF0000")),
                       entry("c", .completed), entry("d", .completed)]
        let dots = CalendarDots.make(for: entries)
        XCTAssertEqual(dots.shown.map(\.id), ["a", "c"])
        XCTAssertEqual(dots.overflow, 0)
    }

    func testDotsCapAndCountWhatDidNotFit() {
        let entries = [entry("a", .event(colorHex: "#111111")), entry("b", .event(colorHex: "#222222")),
                       entry("c", .event(colorHex: "#333333")), entry("d", .completed),
                       entry("e", .deadline(overdue: true)), entry("f", .focus(minutes: 25, reason: .completed))]
        let dots = CalendarDots.make(for: entries, limit: 4)
        XCTAssertEqual(dots.shown.count, 4)
        XCTAssertEqual(dots.overflow, 2)
    }

    func testOverdueAndDueAreDifferentDots() {
        let dots = CalendarDots.make(for: [entry("a", .deadline(overdue: true)), entry("b", .deadline(overdue: false))])
        XCTAssertEqual(dots.shown.count, 2)
    }

    // MARK: Access capsule

    func testNoWarningsNoCapsule() {
        XCTAssertNil(PlanNotice.make(disclosures: [], remindersGranted: true))
    }

    func testCalendarAndRemindersFoldIntoOneCapsule() throws {
        let notice = try XCTUnwrap(PlanNotice.make(
            disclosures: ["Calendar access has not been granted, so what is scheduled is unknown.",
                          "Tasks: Reminders access has not been granted, so what was completed and what is due are unknown."],
            remindersGranted: false))
        XCTAssertEqual(notice.title, "Calendar and Reminders access needed")
        XCTAssertEqual(notice.details.count, 2)
        XCTAssertTrue(notice.needsSettings)
    }

    func testRemindersAloneStillShowsWhenTheCalendarSaysNothing() throws {
        let notice = try XCTUnwrap(PlanNotice.make(disclosures: [], remindersGranted: false))
        XCTAssertEqual(notice.title, "Reminders access needed")
        XCTAssertTrue(notice.needsSettings)
    }

    func testAReadFailureIsNotAPermissionProblem() throws {
        let notice = try XCTUnwrap(PlanNotice.make(disclosures: ["Focus history could not be read: disk"], remindersGranted: true))
        XCTAssertEqual(notice.title, "Some of the calendar could not be read")
        XCTAssertFalse(notice.needsSettings)
    }

    // MARK: Month travel

    func testMonthSlidesTheWayTimeMoves() {
        let calendar = Calendar(identifier: .gregorian)
        let nov = calendar.date(from: DateComponents(year: 2026, month: 11, day: 2))!
        let dec = calendar.date(from: DateComponents(year: 2026, month: 12, day: 1))!
        XCTAssertEqual(MonthTravel.direction(from: nov, to: dec), 1)
        XCTAssertEqual(MonthTravel.direction(from: dec, to: nov), -1)
        XCTAssertEqual(MonthTravel.direction(from: nov, to: nov), 0)
    }

    // MARK: Rings

    func testOpenRingIsTheShareStillOpen() {
        XCTAssertEqual(PlanRings.openFraction(open: 3, total: 4), 0.75, accuracy: 0.0001)
        XCTAssertEqual(PlanRings.openFraction(open: 0, total: 0), 0)
        XCTAssertEqual(PlanRings.openFraction(open: 5, total: 2), 1)
    }
}
