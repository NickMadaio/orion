//
//  What the calendar is looking at, and therefore what has to be fetched.
//
//  The rule the plan is explicit about: fetch the VISIBLE INTERVAL plus padding,
//  never a hard-coded number of days. A fixed window is wrong in both
//  directions at once — too small at the edges, so paging back a month shows a
//  blank grid until a refetch lands; and too large in the middle, so every
//  redraw asks EventKit for weeks nobody is looking at.
//
//  A month grid is not a month. It starts on the weekday the month starts on,
//  which means up to six days of the previous month are on screen, and it runs
//  to the end of the last week, which means up to twelve days of the next. Those
//  days are visible, so they are part of the interval — that is exactly the
//  blank-edge bug, and it is why the interval is derived from the GRID rather
//  than from the month.
//
//  Pure, so "does paging back a month leave a hole" is a test rather than
//  something you find by clicking.
//

import Foundation

public enum CalendarGranularity: String, Codable, Sendable, CaseIterable {
    case month, week, day

    public var title: String { rawValue.capitalized }
}

/// The interval on screen, and the wider one worth having in hand.
public struct VisibleInterval: Equatable, Sendable {
    /// Exactly what is drawn.
    public let visible: DateInterval

    /// What to fetch: the visible interval plus padding on both sides, so
    /// paging one step in either direction is already covered.
    public let fetch: DateInterval

    public init(visible: DateInterval, fetch: DateInterval) {
        self.visible = visible
        self.fetch = fetch
    }

    public func covers(_ other: DateInterval) -> Bool {
        fetch.start <= other.start && fetch.end >= other.end
    }
}

public struct CalendarRange {

    public let calendar: Calendar

    public init(calendar: Calendar = .current) {
        self.calendar = calendar
    }

    /// One page of padding in each direction — computed as the ACTUAL
    /// neighbouring pages, not as a date-arithmetic guess at their size.
    ///
    /// The obvious implementation adds one month to each end of the visible
    /// interval, and it is wrong. A month grid does not span a month: April's
    /// grid runs 29 Mar – 2 May, and May's runs 26 Apr – 6 Jun. Adding one
    /// month to April's END lands on 2 June, four days short of what May
    /// actually draws — so paging forward showed a grid with its last row
    /// empty until a refetch landed, which is precisely the blank-edge bug this
    /// is supposed to prevent.
    ///
    /// Taking the union of the previous, current and next pages' visible
    /// intervals cannot be short, because it is made of the very intervals it
    /// has to cover.
    public func interval(around date: Date, granularity: CalendarGranularity) -> VisibleInterval {
        let visible = visibleInterval(around: date, granularity: granularity)

        let previous = visibleInterval(around: step(date, by: -1, granularity: granularity),
                                       granularity: granularity)
        let next = visibleInterval(around: step(date, by: 1, granularity: granularity),
                                   granularity: granularity)

        return VisibleInterval(
            visible: visible,
            fetch: DateInterval(start: min(previous.start, visible.start),
                                end: max(next.end, visible.end))
        )
    }

    /// Exactly what is drawn, which for a month is the GRID and not the month.
    public func visibleInterval(around date: Date,
                                granularity: CalendarGranularity) -> DateInterval {
        switch granularity {
        case .day:
            let start = calendar.startOfDay(for: date)
            let end = calendar.date(byAdding: .day, value: 1, to: start) ?? start
            return DateInterval(start: start, end: end)

        case .week:
            let start = startOfWeek(containing: date)
            let end = calendar.date(byAdding: .day, value: 7, to: start) ?? start
            return DateInterval(start: start, end: end)

        case .month:
            let weeks = monthGrid(containing: date)
            guard let first = weeks.first?.first, let last = weeks.last?.last else {
                let start = startOfMonth(containing: date)
                let end = calendar.date(byAdding: .month, value: 1, to: start) ?? start
                return DateInterval(start: start, end: end)
            }
            let end = calendar.date(byAdding: .day, value: 1, to: last) ?? last
            return DateInterval(start: first, end: end)
        }
    }

    // MARK: The grid

    /// The weeks a month view actually draws, each a full seven days.
    ///
    /// Always whole weeks, including the leading and trailing days that belong
    /// to the neighbouring months. Drawing a ragged first row instead is the
    /// other way to solve this and it makes every date's weekday column shift,
    /// which is the one thing a month grid exists to keep steady.
    public func monthGrid(containing date: Date) -> [[Date]] {
        let monthStart = startOfMonth(containing: date)
        guard let range = calendar.range(of: .day, in: .month, for: monthStart) else { return [] }

        let gridStart = startOfWeek(containing: monthStart)
        let daysInMonth = range.count

        // How many whole weeks it takes to cover the leading padding plus the
        // month. Five for most months, six when a long month starts late in the
        // week, four for a February that starts exactly on the first weekday.
        let lead = calendar.dateComponents([.day], from: gridStart, to: monthStart).day ?? 0
        let weeks = Int(ceil(Double(lead + daysInMonth) / 7.0))

        return (0..<weeks).map { week in
            (0..<7).compactMap { day in
                calendar.date(byAdding: .day, value: week * 7 + day, to: gridStart)
            }
        }
    }

    // MARK: Navigation

    public func step(_ date: Date, by amount: Int,
                     granularity: CalendarGranularity) -> Date {
        switch granularity {
        case .month: return calendar.date(byAdding: .month, value: amount, to: date) ?? date
        case .week:  return calendar.date(byAdding: .weekOfYear, value: amount, to: date) ?? date
        case .day:   return calendar.date(byAdding: .day, value: amount, to: date) ?? date
        }
    }

    // MARK: Boundaries

    public func startOfMonth(containing date: Date) -> Date {
        calendar.date(from: calendar.dateComponents([.year, .month], from: date))
            ?? calendar.startOfDay(for: date)
    }

    public func startOfWeek(containing date: Date) -> Date {
        let components = calendar.dateComponents(
            [.yearForWeekOfYear, .weekOfYear], from: date
        )
        return calendar.date(from: components) ?? calendar.startOfDay(for: date)
    }

    public func isSameDay(_ a: Date, _ b: Date) -> Bool {
        calendar.isDate(a, inSameDayAs: b)
    }

    public func isInMonth(_ day: Date, as reference: Date) -> Bool {
        calendar.isDate(day, equalTo: reference, toGranularity: .month)
    }
}
