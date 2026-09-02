//
//  The calendar's day-membership rule, and the bug it replaces.
//
//  Every all-day assertion here is written so that it FAILS under the old
//  instant-comparison rule. That is the whole point of the file: a test for
//  this that only exercises the same-zone case passes on both implementations
//  and proves nothing, which is exactly how the original survived.
//

import XCTest
@testable import SessionDomain

final class AgendaPlacementTests: XCTestCase {

    private let london = TimeZone(identifier: "Europe/London")!
    private let newYork = TimeZone(identifier: "America/New_York")!

    private func instant(_ iso: String) -> Date {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        guard let date = formatter.date(from: iso) else {
            fatalError("test fixture is not an ISO-8601 instant: \(iso)")
        }
        return date
    }

    private func day(_ key: String) -> CivilDay {
        guard let day = CivilDay(key: key) else { fatalError("bad fixture day \(key)") }
        return day
    }

    // MARK: - The defect

    /// The measured case. "8 September, all day", written in London, is stored
    /// as 2026-09-07T23:00Z. Read with a New York calendar that instant is
    /// 19:00 on the SEVENTH — so the old rule put the event on the wrong day.
    func testAnAllDayEventDoesNotMoveWhenReadFromAnotherZone() {
        let span = AgendaPlacement.span(
            from: instant("2026-09-07T23:00:00Z"),   // 8 Sep 00:00 London
            to: instant("2026-09-08T23:00:00Z"),     // 9 Sep 00:00 London, exclusive
            in: london)

        XCTAssertEqual(span.from.key, "2026-09-08")
        XCTAssertEqual(span.through.key, "2026-09-08", "one day, not two")

        // Read in New York — the zone that used to break it.
        XCTAssertTrue(AgendaPlacement.appears(
            allDay: span, start: .distantPast, end: .distantFuture,
            on: day("2026-09-08"), in: newYork))
        XCTAssertFalse(AgendaPlacement.appears(
            allDay: span, start: .distantPast, end: .distantFuture,
            on: day("2026-09-07"), in: newYork),
            "the old instant rule put it here")

        // And in London, where it was written.
        XCTAssertTrue(AgendaPlacement.appears(
            allDay: span, start: .distantPast, end: .distantFuture,
            on: day("2026-09-08"), in: london))
    }

    /// The same event read in every zone this system knows lands on the same
    /// civil day. A single counter-example zone would let a future change pass
    /// on this machine and fail on Nick's.
    func testAnAllDaySpanIsTheSameDayInEveryZone() {
        let span = AgendaPlacement.span(
            from: instant("2026-09-07T23:00:00Z"),
            to: instant("2026-09-08T23:00:00Z"),
            in: london)

        for identifier in IANAZone.accepted {
            guard let zone = TimeZone(identifier: identifier) else { continue }
            XCTAssertTrue(AgendaPlacement.appears(
                allDay: span, start: .distantPast, end: .distantFuture,
                on: day("2026-09-08"), in: zone), identifier)
            XCTAssertFalse(AgendaPlacement.appears(
                allDay: span, start: .distantPast, end: .distantFuture,
                on: day("2026-09-09"), in: zone), identifier)
        }
    }

    // MARK: - The off-by-one

    func testAnExclusiveMidnightEndDoesNotAddAnExtraDay() {
        let span = AgendaPlacement.span(
            from: instant("2026-09-08T00:00:00Z"),
            to: instant("2026-09-09T00:00:00Z"),
            in: TimeZone(identifier: "GMT")!)

        XCTAssertEqual(span.dayCount, 1, "8th to 9th-exclusive is ONE day")
        XCTAssertEqual(span.days.map(\.key), ["2026-09-08"])
    }

    /// Some sources store the last day inclusive, at 23:59:59. That instant is
    /// not a day boundary, so it must NOT be shortened.
    func testAnInclusiveEndIsNotShortened() {
        let span = AgendaPlacement.span(
            from: instant("2026-09-08T00:00:00Z"),
            to: instant("2026-09-09T23:59:59Z"),
            in: TimeZone(identifier: "GMT")!)

        XCTAssertEqual(span.days.map(\.key), ["2026-09-08", "2026-09-09"],
                       "an inclusive end keeps its last day")
    }

    func testAMultiDayTripCoversEveryDayItSpans() {
        let span = AgendaPlacement.span(
            from: instant("2026-09-07T00:00:00Z"),
            to: instant("2026-09-10T00:00:00Z"),
            in: TimeZone(identifier: "GMT")!)

        XCTAssertEqual(span.days.map(\.key), ["2026-09-07", "2026-09-08", "2026-09-09"])
        for key in ["2026-09-07", "2026-09-08", "2026-09-09"] {
            XCTAssertTrue(AgendaPlacement.appears(
                allDay: span, start: .distantPast, end: .distantFuture,
                on: day(key), in: newYork), key)
        }
        XCTAssertFalse(AgendaPlacement.appears(
            allDay: span, start: .distantPast, end: .distantFuture,
            on: day("2026-09-10"), in: newYork))
    }

    /// A zero-length all-day span still covers its own day rather than nothing.
    func testAnEndEqualToTheStartIsStillOneDay() {
        let span = AgendaPlacement.span(
            from: instant("2026-09-08T00:00:00Z"),
            to: instant("2026-09-08T00:00:00Z"),
            in: TimeZone(identifier: "GMT")!)
        XCTAssertEqual(span.dayCount, 1)
    }

    // MARK: - Timed events

    func testATimedEventAppearsOnTheDayItOverlaps() {
        let start = instant("2026-09-08T13:00:00Z")   // 09:00 New York
        let end = instant("2026-09-08T14:00:00Z")

        XCTAssertTrue(AgendaPlacement.appears(
            allDay: nil, start: start, end: end, on: day("2026-09-08"), in: newYork))
        XCTAssertFalse(AgendaPlacement.appears(
            allDay: nil, start: start, end: end, on: day("2026-09-07"), in: newYork))
    }

    /// A timed event genuinely IS zone-dependent, and must stay so. 02:00 UTC
    /// is the 8th in London and the 7th in New York, and both readings are
    /// correct — this is the difference between a moment and a day.
    func testATimedEventIsZoneDependentAndThatIsCorrect() {
        let start = instant("2026-09-08T02:00:00Z")
        let end = instant("2026-09-08T03:00:00Z")

        XCTAssertTrue(AgendaPlacement.appears(
            allDay: nil, start: start, end: end, on: day("2026-09-08"), in: london))
        XCTAssertTrue(AgendaPlacement.appears(
            allDay: nil, start: start, end: end, on: day("2026-09-07"), in: newYork))
    }

    /// A meeting across midnight is on both days.
    func testATimedEventCrossingMidnightAppearsOnBothDays() {
        let start = instant("2026-09-08T03:30:00Z")   // 23:30 on the 7th, New York
        let end = instant("2026-09-08T04:30:00Z")     // 00:30 on the 8th

        XCTAssertTrue(AgendaPlacement.appears(
            allDay: nil, start: start, end: end, on: day("2026-09-07"), in: newYork))
        XCTAssertTrue(AgendaPlacement.appears(
            allDay: nil, start: start, end: end, on: day("2026-09-08"), in: newYork))
    }

    /// The boundary is half-open: an event ending exactly at midnight belongs
    /// to the day it ran in, not to the one that starts as it finishes.
    func testAnEventEndingExactlyAtMidnightDoesNotSpillIntoTheNextDay() {
        let dayStart = day("2026-09-08").start(in: newYork)
        let start = dayStart.addingTimeInterval(-3600)

        XCTAssertTrue(AgendaPlacement.appears(
            allDay: nil, start: start, end: dayStart, on: day("2026-09-07"), in: newYork))
        XCTAssertFalse(AgendaPlacement.appears(
            allDay: nil, start: start, end: dayStart, on: day("2026-09-08"), in: newYork))
    }

    /// A timed event on a DST day still resolves against the real 23- or
    /// 25-hour interval, because `day.interval(in:)` is built from the next
    /// day's start rather than by adding 86,400 seconds.
    func testATimedEventOnADSTDayUsesTheRealDayLength() {
        let fallBack = day("2026-10-25")            // London gains an hour
        let lateThatNight = instant("2026-10-25T23:30:00Z")

        XCTAssertTrue(AgendaPlacement.appears(
            allDay: nil, start: lateThatNight, end: lateThatNight.addingTimeInterval(600),
            on: fallBack, in: london))
        XCTAssertEqual(fallBack.hours(in: london), 25, accuracy: 0.001)
    }
}
