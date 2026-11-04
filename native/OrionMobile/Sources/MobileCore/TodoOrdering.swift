import Foundation

/*
 The one order every to-do list is drawn in, on the Mac and the phone (2026-11-02, reworked 2026-11-04).

 Open before done. Overdue first. Then high, medium, low, none, and a to-do with no
 priority is the LOWEST, never the top. Inside the same priority the earlier due comes
 first, then anything undated, then his hand-placed order (TaskNotes "Order:"), then the
 title so equal rows never shuffle between refreshes.

 Overdue is a block, but the block is ranked too: the first version ordered it only by how
 late each item was, so a low item due in October sat above a high one due on Monday and the
 list looked unranked (his complaint, 2026-11-04).

 Pure on purpose: the Mac's Reminders model, the phone's TodoItem, the widget's glance
 Todo and the phone's planner all feed it a Key, so there is exactly one comparator to get
 wrong. JS twin: scripts/lib/life/todo-order.mjs. tests/fixtures/todo-order.json is the
 fixture both must order identically. It orders DISPLAY only; the planner has its own scoring.
*/
public enum TodoOrdering {

    /// What the comparator reads from a to-do, whichever app's type it came from.
    public struct Key: Equatable, Sendable {
        public var done: Bool
        public var priority: TodoPriority
        public var due: Date?
        public var title: String
        public var id: String
        /// His hand-placed position (TaskNotes `order`); only breaks a tie after priority and due.
        public var order: Double?
        public init(done: Bool, priority: TodoPriority, due: Date?, title: String, id: String = "", order: Double? = nil) {
            self.done = done; self.priority = priority; self.due = due; self.title = title; self.id = id; self.order = order
        }
        /// For a source that stores EventKit's 0...9 (1 highest, 0 unset).
        public init(done: Bool, eventKitPriority: Int, due: Date?, title: String, id: String = "", order: Double? = nil) {
            self.init(done: done, priority: TodoPriority(eventKit: eventKitPriority), due: due, title: title, id: id, order: order)
        }
    }

    /// Due before now and not done: the definition the lists already use for the red marker.
    public static func isOverdue(done: Bool, due: Date?, now: Date) -> Bool {
        guard !done, let due else { return false }
        return due < now
    }

    /// 0 high, 1 medium, 2 low, 3 none.
    public static func rank(_ priority: TodoPriority) -> Int {
        switch priority {
        case .high: return 0
        case .medium: return 1
        case .low: return 2
        case .none: return 3
        }
    }

    /// True when `a` is drawn above `b`.
    public static func isOrderedBefore(_ a: Key, _ b: Key, now: Date) -> Bool {
        if a.done != b.done { return !a.done }
        let (lateA, lateB) = (isOverdue(done: a.done, due: a.due, now: now), isOverdue(done: b.done, due: b.due, now: now))
        if lateA != lateB { return lateA }
        let (ra, rb) = (rank(a.priority), rank(b.priority))
        if ra != rb { return ra < rb }
        switch (a.due, b.due) {
        case let (x?, y?) where x != y: return x < y
        case (.some, nil): return true
        case (nil, .some): return false
        default: break
        }
        switch (a.order, b.order) {
        case let (x?, y?) where x != y: return x < y
        case (.some, nil): return true
        case (nil, .some): return false
        default: break
        }
        let byTitle = a.title.localizedCaseInsensitiveCompare(b.title)
        if byTitle != .orderedSame { return byTitle == .orderedAscending }
        return a.id < b.id
    }

    public static func sorted<T>(_ items: [T], now: Date = Date(), key: (T) -> Key) -> [T] {
        items.map { (item: $0, key: key($0)) }.sorted { isOrderedBefore($0.key, $1.key, now: now) }.map(\.item)
    }
}
