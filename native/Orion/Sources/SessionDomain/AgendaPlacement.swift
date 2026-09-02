//
//  Which day an event belongs on — Phase 40, applied to the calendar.
//
//  `AppleCalendarSync.events(on:)` decided this by comparing INSTANTS with
//  `Calendar.current`:
//
//      windowEvents.filter { calendar.isDate($0.start, inSameDayAs: date) ... }
//
//  For a timed event that is right. For an all-day event it is the bug
//  `AllDaySpan` exists to remove, and it is invisible until the machine's zone
//  and the event's zone disagree — which is what happens the day Nick lands in
//  London.
//
//  An all-day event has no instant. EventKit gives it one anyway: midnight in
//  some zone. "8 September, all day", written in London, is stored as
//  2026-09-07T23:00Z. Read back with a New York calendar that instant is 19:00
//  on the SEVENTH, so the event moves a day earlier on the grid. Nothing errors.
//  The trip is simply on the wrong day.
//
//  So the rule here: **an all-day event's day membership is a comparison of
//  civil days and never of instants.** A timed event's still is an instant
//  overlap, because that is what a timed event actually is.
//
//  The other half is `span(from:to:in:)`, which turns EventKit's pair of
//  instants back into the civil days it meant. That conversion carries the
//  off-by-one this whole area is famous for, and it is handled explicitly and
//  tested in both directions rather than left to whoever reads the struct next.
//

import Foundation

public enum AgendaPlacement {

    /// Whether an event appears on `day`.
    ///
    /// `allDay` non-nil means the event is all-day and `start`/`end` are
    /// ignored entirely — that is the point. Passing both is not a
    /// contradiction to resolve; the span is authoritative and the instants are
    /// the lossy form it was recovered from.
    public static func appears(
        allDay: AllDaySpan?,
        start: Date,
        end: Date,
        on day: CivilDay,
        in zone: TimeZone
    ) -> Bool {
        if let allDay {
            return allDay.contains(day)
        }
        // A timed event belongs to a day if it overlaps that day's interval at
        // all — a 23:30-00:30 meeting is on both days, and a multi-day trip
        // must not vanish from the calendar after day one.
        let interval = day.interval(in: zone)
        return start < interval.end && end > interval.start
    }

    /// Recover the civil days an all-day event covers from the instants
    /// EventKit stored it as.
    ///
    /// The off-by-one: an all-day event's end is conventionally EXCLUSIVE —
    /// midnight at the start of the day after the last one. A single-day event
    /// on the 8th is stored as 8th 00:00 to 9th 00:00, and reading the end
    /// naively gives a two-day event that shows up on the 9th as well.
    ///
    /// Detected rather than assumed: the end is treated as exclusive only when
    /// it lands exactly on a day boundary in `zone` AND is after the start day.
    /// Calendars that store an inclusive end (the last day at 23:59:59, which
    /// some sources do) therefore still come out right, because that instant is
    /// not a day boundary.
    public static func span(from start: Date, to end: Date, in zone: TimeZone) -> AllDaySpan {
        let first = CivilDay(of: start, in: zone)
        var last = CivilDay(of: end, in: zone)

        if last > first, end == last.start(in: zone) {
            // Exactly midnight on a later day: the end is exclusive.
            last = previousDay(before: last)
        }
        return AllDaySpan(from: first, through: max(last, first), originalZone: zone)
    }

    /// The day before, without date arithmetic on the components.
    static func previousDay(before day: CivilDay) -> CivilDay {
        day.advanced(by: -1)
    }

    /// The instants an all-day span covers, for anything that must lay it out
    /// on a timeline.
    ///
    /// Exists so callers do not reach for `start(in:)` themselves and quietly
    /// pick the machine's zone; the argument makes the choice visible.
    public static func interval(of span: AllDaySpan, in zone: TimeZone) -> DateInterval {
        span.interval(in: zone)
    }
}
