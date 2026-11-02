import Foundation

/*
 The one order every to-do list is drawn in (2026-11-02), on the Mac and the phone.

 "Sort by priority for all categories, overdue the top level": overdue first,
 then high, medium, low, none. Inside a level the earliest due comes first, then
 anything undated, then the title so equal rows never shuffle between refreshes.
 Done items sink below everything open, ordered by the same key, because the
 lists that show them (Done, the Mac's completed tail) always put them last.

 Pure on purpose: the Mac's Reminders model and the phone's TodoItem both feed
 it a Key, so there is exactly one comparator to get wrong. It orders DISPLAY
 only; ORION's planner has its own scoring and does not read this.
*/
public enum TodoOrdering {

    /// What the comparator reads from a to-do, whichever app's type it came from.
    public struct Key: Equatable, Sendable {
        public var done: Bool
        public var priority: TodoPriority
        public var due: Date?
        public var title: String
        public var id: String
        public init(done: Bool, priority: TodoPriority, due: Date?, title: String, id: String = "") {
            self.done = done; self.priority = priority; self.due = due; self.title = title; self.id = id
        }
    }

    /// Due before now and not done: the definition the lists already use for the red marker.
    public static func isOverdue(done: Bool, due: Date?, now: Date) -> Bool {
        guard !done, let due else { return false }
        return due < now
    }

    /// 0 overdue, 1 high, 2 medium, 3 low, 4 none.
    public static func level(_ key: Key, now: Date) -> Int {
        if isOverdue(done: key.done, due: key.due, now: now) { return 0 }
        switch key.priority {
        case .high: return 1
        case .medium: return 2
        case .low: return 3
        case .none: return 4
        }
    }

    /// True when `a` is drawn above `b`.
    public static func isOrderedBefore(_ a: Key, _ b: Key, now: Date) -> Bool {
        if a.done != b.done { return !a.done }
        let (la, lb) = (level(a, now: now), level(b, now: now))
        if la != lb { return la < lb }
        switch (a.due, b.due) {
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
        items.sorted { isOrderedBefore(key($0), key($1), now: now) }
    }
}
