import Foundation

/// Where things sit on a calendar-style day grid.
///
/// Pure arithmetic, so the SwiftUI layer only draws. Items that overlap in time
/// share the width in columns, the way a calendar app lays out a double-booked
/// hour; an item never overlaps another on screen, and a cluster of overlapping
/// items all use the same column count so their widths agree.
public struct DaySlot: Sendable, Equatable {
    public let id: String
    public let start: Date
    public let end: Date

    public init(id: String, start: Date, end: Date) {
        self.id = id
        self.start = start
        // A zero-length or inverted item still gets a visible sliver.
        self.end = max(end, start.addingTimeInterval(15 * 60))
    }
}

public struct DayPlacement: Sendable, Equatable {
    public let id: String
    /// Minutes from the top of the visible range.
    public let top: Double
    public let height: Double
    public let column: Int
    public let columns: Int
}

public enum DayLayout {
    /// Lay out `slots` within `[rangeStart, rangeStart + hours)`. Anything
    /// outside the range is clipped to it; anything wholly outside is dropped.
    public static func place(_ slots: [DaySlot], rangeStart: Date, hours: Int) -> [DayPlacement] {
        let rangeEnd = rangeStart.addingTimeInterval(TimeInterval(hours * 3600))
        let visible = slots
            .filter { $0.end > rangeStart && $0.start < rangeEnd }
            .sorted { ($0.start, $0.end, $0.id) < ($1.start, $1.end, $1.id) }

        var placements: [DayPlacement] = []
        var cluster: [(slot: DaySlot, column: Int)] = []
        var clusterEnd = Date.distantPast
        var columnEnds: [Date] = []

        func flush() {
            let count = max(1, (cluster.map(\.column).max() ?? 0) + 1)
            for entry in cluster {
                let start = max(entry.slot.start, rangeStart), end = min(entry.slot.end, rangeEnd)
                placements.append(DayPlacement(id: entry.slot.id,
                    top: start.timeIntervalSince(rangeStart) / 60,
                    // True length: a 15-minute floor drew a 10-minute block over the next one.
                    height: max(1, end.timeIntervalSince(start) / 60),
                    column: entry.column, columns: count))
            }
            cluster = []; columnEnds = []
        }

        for slot in visible {
            if slot.start >= clusterEnd { flush() }
            // First column whose last item has ended.
            let column = columnEnds.firstIndex { $0 <= slot.start } ?? columnEnds.count
            if column == columnEnds.count { columnEnds.append(slot.end) } else { columnEnds[column] = slot.end }
            cluster.append((slot, column))
            clusterEnd = max(clusterEnd, slot.end)
        }
        flush()
        return placements
    }

    /// The hours worth showing: from an hour before the first item (or 07:00)
    /// to an hour after the last (or 22:00), whole hours, in `calendar`.
    public static func visibleHours(for slots: [DaySlot], on day: Date, calendar: Calendar) -> (start: Date, hours: Int) {
        let midnight = calendar.startOfDay(for: day)
        let hour = { (date: Date) in calendar.dateComponents([.hour], from: midnight, to: date).hour ?? 0 }
        let first = slots.map { hour($0.start) }.min().map { max(0, $0 - 1) } ?? 7
        let last = slots.map { hour($0.end) + 1 }.max().map { min(24, $0 + 1) } ?? 22
        let from = min(first, 7), to = max(last, 22)
        return (calendar.date(byAdding: .hour, value: from, to: midnight) ?? midnight, max(1, to - from))
    }
}
