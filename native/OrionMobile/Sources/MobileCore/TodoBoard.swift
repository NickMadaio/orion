import Foundation

/*
 The to-do list's shared logic (2026-10-13), for the Mac's Tasks tab and the
 phone's Plan tab. Modelled on his old Notion list: views for to do / upcoming /
 by tag / done, a priority and coloured tags on every row, and — the part the
 old ORION list lacked — everything settable while adding, from one line:

     essay #school !high fri 5pm

 Tags, order, spread and subtasks still live in the reminder's notes
 (TaskNotes), so they sync through iCloud and ORION's planner reads them.
*/

/// Reminders' priority in the three bands he uses. EventKit stores 1–9 (1 highest).
public enum TodoPriority: Int, CaseIterable, Sendable, Identifiable {
    case none, low, medium, high
    public var id: Int { rawValue }

    public init(eventKit raw: Int) {
        switch raw {
        case 1...4: self = .high
        case 5: self = .medium
        case 6...9: self = .low
        default: self = .none
        }
    }

    public var eventKit: Int {
        switch self { case .none: 0; case .low: 9; case .medium: 5; case .high: 1 }
    }

    public var label: String {
        switch self { case .none: "none"; case .low: "low"; case .medium: "medium"; case .high: "high" }
    }
}

/// One to-do as both apps' lists draw it.
public struct TodoItem: Identifiable, Equatable, Sendable {
    public let id: String
    public var title: String
    /// A date-only due is stored at 23:59 that day (the planner's convention, scripts/orion-tasks).
    public var due: Date?
    public var done: Bool
    public var priority: TodoPriority
    public var notes: String

    public init(id: String, title: String, due: Date? = nil, done: Bool = false, priority: TodoPriority = .none, notes: String = "") {
        self.id = id; self.title = title; self.due = due; self.done = done; self.priority = priority; self.notes = notes
    }

    public var parsed: TaskNotes { TaskNotes.parse(notes) }
    public var tags: [String] { parsed.tags }
}

/// What a quick-add line asks for.
public struct TodoDraft: Equatable, Sendable {
    public var title: String
    public var priority: TodoPriority = .none
    public var tags: [String] = []
    public var due: Date?
    public var dueHasTime = false
    public init(title: String, priority: TodoPriority = .none, tags: [String] = [], due: Date? = nil, dueHasTime: Bool = false) {
        self.title = title; self.priority = priority; self.tags = tags; self.due = due; self.dueHasTime = dueHasTime
    }
}

/// A stable colour per tag, as an index into a palette each app draws (Notion's nine).
public enum TodoTagColor {
    public static let count = 9
    public static func index(for tag: String) -> Int {
        // FNV-1a: stable across launches and devices, unlike Hasher.
        var hash: UInt32 = 2_166_136_261
        for byte in tag.lowercased().utf8 { hash = (hash ^ UInt32(byte)) &* 16_777_619 }
        return Int(hash % UInt32(count))
    }

    /// Colours for a whole set of tags with no two alike while there are nine or fewer: each
    /// takes its own hashed colour, or the next free one (in alphabetical order, so stable).
    public static func assign(_ tags: [String]) -> [String: Int] {
        var taken = Set<Int>()
        var result: [String: Int] = [:]
        for tag in Set(tags.map { $0.lowercased() }).sorted() {
            var index = self.index(for: tag)
            if taken.count < count { while taken.contains(index) { index = (index + 1) % count } }
            taken.insert(index)
            result[tag] = index
        }
        return result
    }
}

/// A heading and the to-dos under it.
public struct TodoGroup: Identifiable, Equatable, Sendable {
    public var id: String { title }
    public let title: String
    public let items: [TodoItem]
    /// Set for a by-tag group, so the heading can be drawn in the tag's colour.
    public let tag: String?
}

public enum TodoBoard {
    /// Open to-dos in his order (dragged by hand), narrowed to any of `tags` when given.
    public static func open(_ items: [TodoItem], tags: Set<String> = []) -> [TodoItem] {
        let ordered = TaskNotes.sortedByOrder(items.filter { !$0.done }, order: { $0.parsed.order })
        guard !tags.isEmpty else { return ordered }
        return ordered.filter { !tags.isDisjoint(with: $0.tags) }
    }

    public static func done(_ items: [TodoItem], tags: Set<String> = []) -> [TodoItem] {
        items.filter { $0.done && (tags.isEmpty || !tags.isDisjoint(with: $0.tags)) }
    }

    /// Tags on the open to-dos, in first-seen order.
    public static func allTags(_ items: [TodoItem]) -> [String] {
        TaskNotes.cleanTags(open(items).flatMap(\.tags))
    }

    public static func byTag(_ items: [TodoItem]) -> [TodoGroup] {
        let openItems = open(items)
        var groups = allTags(items).map { tag in TodoGroup(title: tag, items: openItems.filter { $0.tags.contains(tag) }, tag: tag) }
        let untagged = openItems.filter { $0.tags.isEmpty }
        if !untagged.isEmpty { groups.append(TodoGroup(title: "No tag", items: untagged, tag: nil)) }
        return groups
    }

    /// Overdue, today, tomorrow, the rest of this week by day, next week, later, no date.
    public static func upcoming(_ items: [TodoItem], tags: Set<String> = [], now: Date = Date(), calendar: Calendar = .current) -> [TodoGroup] {
        let today = calendar.startOfDay(for: now)
        let weekEnd = calendar.dateInterval(of: .weekOfYear, for: now)?.end ?? today.addingTimeInterval(7 * 86_400)
        let nextWeekEnd = calendar.date(byAdding: .day, value: 7, to: weekEnd) ?? weekEnd
        var order: [String] = []
        var buckets: [String: [TodoItem]] = [:]
        func put(_ title: String, _ item: TodoItem) {
            if buckets[title] == nil { order.append(title) }
            buckets[title, default: []].append(item)
        }
        let dated = open(items, tags: tags).filter { $0.due != nil }.sorted { $0.due! < $1.due! }
        for item in dated {
            let due = item.due!
            let day = calendar.startOfDay(for: due)
            let days = calendar.dateComponents([.day], from: today, to: day).day ?? 0
            if due < now { put("Overdue", item) }
            else if days == 0 { put("Today", item) }
            else if days == 1 { put("Tomorrow", item) }
            else if day < weekEnd { put(weekdayName(due, calendar: calendar), item) }
            else if day < nextWeekEnd { put("Next week", item) }
            else { put("Later", item) }
        }
        var groups = ["Overdue", "Today", "Tomorrow"].compactMap { title in buckets[title].map { TodoGroup(title: title, items: $0, tag: nil) } }
        groups += order.filter { !["Overdue", "Today", "Tomorrow", "Next week", "Later"].contains($0) }.map { TodoGroup(title: $0, items: buckets[$0]!, tag: nil) }
        groups += ["Next week", "Later"].compactMap { title in buckets[title].map { TodoGroup(title: title, items: $0, tag: nil) } }
        let undated = open(items, tags: tags).filter { $0.due == nil }
        if !undated.isEmpty { groups.append(TodoGroup(title: "No date", items: undated, tag: nil)) }
        return groups
    }

    /// A date-only due is 23:59; anything else was given a time.
    public static func hasTime(_ date: Date, calendar: Calendar = .current) -> Bool {
        let c = calendar.dateComponents([.hour, .minute], from: date)
        return !(c.hour == 23 && c.minute == 59)
    }

    /// "Today", "Tomorrow 9:30 AM", "Fri", "2 Nov".
    public static func dueLabel(_ date: Date, now: Date = Date(), calendar: Calendar = .current) -> String {
        let days = calendar.dateComponents([.day], from: calendar.startOfDay(for: now), to: calendar.startOfDay(for: date)).day ?? 0
        let day: String
        switch days {
        case 0: day = "Today"
        case 1: day = "Tomorrow"
        case -1: day = "Yesterday"
        case 2...6: day = String(weekdayName(date, calendar: calendar).prefix(3))
        default:
            let c = calendar.dateComponents([.day, .month], from: date)
            day = "\(c.day ?? 1) \(monthNames[(c.month ?? 1) - 1].prefix(3).capitalized)"
        }
        return hasTime(date, calendar: calendar) ? "\(day) \(clock(date, calendar: calendar))" : day
    }

    /// "5 PM", "9:30 AM".
    public static func clock(_ date: Date, calendar: Calendar = .current) -> String {
        let c = calendar.dateComponents([.hour, .minute], from: date)
        let hour = c.hour ?? 0, minute = c.minute ?? 0
        let twelve = hour % 12 == 0 ? 12 : hour % 12
        return "\(twelve)\(minute == 0 ? "" : String(format: ":%02d", minute)) \(hour < 12 ? "AM" : "PM")"
    }

    static func weekdayName(_ date: Date, calendar: Calendar) -> String {
        weekdayNames[calendar.component(.weekday, from: date) - 1].capitalized
    }

    static let weekdayNames = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"]
    static let monthNames = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"]
}
