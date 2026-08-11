//
//  Grid arithmetic, which is the whole of the blank-edge bug.
//
//  A fixed New York calendar so these do not depend on where the suite runs or
//  what week Monday starts on for the machine.
//

import XCTest
@testable import SessionDomain

final class CalendarRangeTests: XCTestCase {

    private let range: CalendarRange = {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "America/New_York")!
        calendar.firstWeekday = 1   // Sunday, as Calendar.app shows it
        return CalendarRange(calendar: calendar)
    }()

    private func date(_ text: String) -> Date {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        formatter.timeZone = TimeZone(identifier: "America/New_York")
        formatter.locale = Locale(identifier: "en_US_POSIX")
        return formatter.date(from: text)!
    }

    private func text(_ value: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        formatter.timeZone = TimeZone(identifier: "America/New_York")
        formatter.locale = Locale(identifier: "en_US_POSIX")
        return formatter.string(from: value)
    }

    // MARK: The grid

    func testAMonthGridIsWholeWeeks() {
        let weeks = range.monthGrid(containing: date("2026-03-15"))

        XCTAssertFalse(weeks.isEmpty)
        for week in weeks {
            XCTAssertEqual(week.count, 7, "a ragged row would shift every weekday column")
        }
    }

    func testTheGridStartsBeforeTheMonthWhenTheMonthStartsMidWeek() {
        // 1 March 2026 is a Sunday, so that month needs no lead.
        XCTAssertEqual(text(range.monthGrid(containing: date("2026-03-15"))[0][0]), "2026-03-01")

        // 1 April 2026 is a Wednesday — the grid has to reach back to 29 March.
        XCTAssertEqual(text(range.monthGrid(containing: date("2026-04-15"))[0][0]), "2026-03-29")
    }

    func testTheGridRunsPastTheEndOfTheMonth() {
        let weeks = range.monthGrid(containing: date("2026-04-15"))
        let last = weeks.last!.last!

        // April ends on a Thursday, so the final week continues into May.
        XCTAssertEqual(text(last), "2026-05-02")
    }

    func testALongMonthStartingLateNeedsSixWeeks() {
        // 1 August 2026 is a Saturday: 31 days plus six days of lead is 37.
        XCTAssertEqual(range.monthGrid(containing: date("2026-08-10")).count, 6)
    }

    // MARK: The visible interval

    /// The blank-edge bug in one assertion: the interval has to cover what is
    /// DRAWN, which for a month view includes days from two other months.
    func testTheVisibleIntervalCoversTheWholeGridNotJustTheMonth() {
        let interval = range.interval(around: date("2026-04-15"), granularity: .month)

        XCTAssertLessThanOrEqual(interval.visible.start, date("2026-03-29"),
                                 "the grid draws 29 March, so it has to be fetched")
        XCTAssertGreaterThan(interval.visible.end, date("2026-05-02"),
                             "and it draws 2 May")
    }

    func testFetchingPadsAWholePageInEachDirection() {
        let interval = range.interval(around: date("2026-04-15"), granularity: .month)

        XCTAssertLessThan(interval.fetch.start, interval.visible.start)
        XCTAssertGreaterThan(interval.fetch.end, interval.visible.end)
    }

    /// The property that makes paging feel instant instead of blank: what was
    /// fetched for this month already contains everything the next month draws.
    func testPagingOneMonthNeedsNoRefetch() {
        let april = range.interval(around: date("2026-04-15"), granularity: .month)
        let may = range.interval(around: date("2026-05-15"), granularity: .month)
        let march = range.interval(around: date("2026-03-15"), granularity: .month)

        XCTAssertTrue(april.covers(may.visible), "paging forward must not blank the grid")
        XCTAssertTrue(april.covers(march.visible), "nor must paging back")
    }

    func testPagingTwoMonthsDoesNeedARefetch() {
        // Not a defect — a statement of the bound. Padding is one page, so two
        // pages is a fetch, and the model has to notice rather than draw a hole.
        let april = range.interval(around: date("2026-04-15"), granularity: .month)
        let june = range.interval(around: date("2026-06-15"), granularity: .month)

        XCTAssertFalse(april.covers(june.visible))
    }

    // MARK: Week and day

    func testAWeekIntervalIsSevenDays() {
        let interval = range.interval(around: date("2026-04-15"), granularity: .week)
        let days = Calendar(identifier: .gregorian).dateComponents(
            [.day], from: interval.visible.start, to: interval.visible.end
        ).day
        XCTAssertEqual(days, 7)
    }

    func testADayIntervalIsOneDay() {
        let interval = range.interval(around: date("2026-04-15"), granularity: .day)
        XCTAssertEqual(text(interval.visible.start), "2026-04-15")
        XCTAssertEqual(text(interval.visible.end), "2026-04-16")
    }

    func testPagingOneWeekOrOneDayAlsoNeedsNoRefetch() {
        let week = range.interval(around: date("2026-04-15"), granularity: .week)
        let nextWeek = range.interval(around: date("2026-04-22"), granularity: .week)
        XCTAssertTrue(week.covers(nextWeek.visible))

        let day = range.interval(around: date("2026-04-15"), granularity: .day)
        let tomorrow = range.interval(around: date("2026-04-16"), granularity: .day)
        XCTAssertTrue(day.covers(tomorrow.visible))
    }

    // MARK: Stepping

    func testSteppingMovesByTheRightUnit() {
        XCTAssertEqual(text(range.step(date("2026-04-15"), by: 1, granularity: .month)),
                       "2026-05-15")
        XCTAssertEqual(text(range.step(date("2026-04-15"), by: -1, granularity: .week)),
                       "2026-04-08")
        XCTAssertEqual(text(range.step(date("2026-04-15"), by: 1, granularity: .day)),
                       "2026-04-16")
    }

    /// The month-length trap: stepping a month from the 31st.
    func testSteppingAMonthFromTheEndOfALongMonthDoesNotSkipAMonth() {
        // 31 March + 1 month has no 31 April. It must land in April, not May.
        let stepped = range.step(date("2026-03-31"), by: 1, granularity: .month)
        XCTAssertTrue(text(stepped).hasPrefix("2026-04"), text(stepped))
    }

    // MARK: Membership

    func testDaysFromNeighbouringMonthsAreMarkedAsSuch() {
        let weeks = range.monthGrid(containing: date("2026-04-15"))
        let leading = weeks[0][0]           // 29 March
        let inside = weeks[1][1]            // early April

        XCTAssertFalse(range.isInMonth(leading, as: date("2026-04-15")),
                       "so it can be drawn dimmer rather than looking like April")
        XCTAssertTrue(range.isInMonth(inside, as: date("2026-04-15")))
    }
}
