import Foundation

/// What a to-do's notes hold (2026-10-06): how to spread the work across days,
/// the subtasks with how far along each is, and anything else he wrote.
///
///     2.5 hours a day until it's due
///     - [ ] Google Data Analytics · 40%
///     - [x] CompTIA ITF+ · 100%
///
/// Kept in the Reminders notes so it syncs to every device through iCloud and
/// reads the same in the Reminders app. ORION's planner (scripts/lib/life/
/// task-notes.mjs) parses the identical format; only the parent is scheduled.
public struct TaskNotes: Equatable, Sendable {
    public struct Subtask: Equatable, Identifiable, Sendable {
        public var id: String { title }
        public var title: String
        public var percent: Int
        public var done: Bool { percent >= 100 }
        public init(title: String, percent: Int = 0) {
            self.title = title
            self.percent = min(100, max(0, percent))
        }
    }

    public var spread: String
    public var subtasks: [Subtask]
    /// Lines that are neither the spread nor a subtask, kept as he wrote them.
    public var other: [String]
    /// His tags for filtering, lowercased and unique ("Tags: school, gym"). In the notes so they
    /// sync through iCloud Reminders: EventKit does not expose Reminders' own tags (2026-10-11).
    public var tags: [String]
    /// Manual position in the list ("Order: 2.5"); nil = not placed by hand yet.
    public var order: Double?

    public init(spread: String = "", subtasks: [Subtask] = [], other: [String] = [], tags: [String] = [], order: Double? = nil) {
        self.spread = spread
        self.subtasks = subtasks
        self.other = other
        self.tags = TaskNotes.cleanTags(tags)
        self.order = order
    }

    /// Lowercased, trimmed, unique, in first-seen order.
    public static func cleanTags(_ raw: [String]) -> [String] {
        var seen: [String] = []
        for tag in raw.map({ $0.trimmingCharacters(in: .whitespaces).trimmingCharacters(in: CharacterSet(charactersIn: "#")).lowercased() })
        where !tag.isEmpty && !seen.contains(tag) { seen.append(tag) }
        return seen
    }

    /// A position between two neighbours, so a drag rewrites only the moved item.
    public static func order(between before: Double?, and after: Double?) -> Double {
        switch (before, after) {
        case let (b?, a?): return (b + a) / 2
        case let (nil, a?): return a - 1
        case let (b?, nil): return b + 1
        case (nil, nil): return 0
        }
    }

    /// New positions after dragging `moving` to just above `target`, for a list shown in `ids` order
    /// with `orders` as its current positions. Returns only what changed: normally just the moved item;
    /// on the first drag every item is given its current position so the list keeps its look.
    public static func reorder(_ ids: [String], orders: [Double?], moving: String, before target: String) -> [String: Double] {
        guard moving != target, ids.contains(moving), ids.contains(target), ids.count == orders.count else { return [:] }
        var changes: [String: Double] = [:]
        var placed = orders
        if placed.contains(where: { $0 == nil }) {
            for (index, id) in ids.enumerated() where placed[index] != Double(index) { placed[index] = Double(index); changes[id] = Double(index) }
        }
        let rest = zip(ids, placed).filter { $0.0 != moving }
        guard let at = rest.firstIndex(where: { $0.0 == target }) else { return changes }
        changes[moving] = order(between: at > 0 ? rest[at - 1].1 : nil, and: rest[at].1)
        return changes
    }

    /// Items placed by hand first (by their order), then the rest as they came.
    public static func sortedByOrder<T>(_ items: [T], order: (T) -> Double?) -> [T] {
        let indexed = items.enumerated().map { ($0.offset, $0.element) }
        return indexed.sorted { lhs, rhs in
            switch (order(lhs.1), order(rhs.1)) {
            case let (l?, r?): return l == r ? lhs.0 < rhs.0 : l < r
            case (.some, nil): return true
            case (nil, .some): return false
            case (nil, nil): return lhs.0 < rhs.0
            }
        }.map(\.1)
    }

    /// Average progress of the subtasks, or nil when there are none.
    public var progress: Int? {
        subtasks.isEmpty ? nil : subtasks.map(\.percent).reduce(0, +) / subtasks.count
    }

    public static func parse(_ notes: String?) -> TaskNotes {
        var result = TaskNotes()
        for raw in (notes ?? "").components(separatedBy: .newlines) {
            let line = raw.trimmingCharacters(in: .whitespaces)
            if line.isEmpty { continue }
            if let sub = subtask(from: line) { result.subtasks.append(sub); continue }
            let lower = line.lowercased()
            if lower.hasPrefix("tags:") {
                result.tags = cleanTags(result.tags + String(line.dropFirst(5)).components(separatedBy: ","))
                continue
            }
            if lower.hasPrefix("order:"), let value = Double(line.dropFirst(6).trimmingCharacters(in: .whitespaces)) {
                result.order = value
                continue
            }
            // Details written while there is no spread are marked so they are not read as one (2026-10-13).
            if lower.hasPrefix("notes:") {
                result.other.append(String(line.dropFirst(6)).trimmingCharacters(in: .whitespaces))
                continue
            }
            if line.lowercased().hasPrefix("spread:") {
                result.spread = String(line.dropFirst(7)).trimmingCharacters(in: .whitespaces)
            } else if result.spread.isEmpty && result.subtasks.isEmpty && result.other.isEmpty {
                result.spread = line
            } else {
                result.other.append(line)
            }
        }
        return result
    }

    /// "- [ ] Title · 40%" / "- [x] Title" / "- Title 40%".
    private static func subtask(from line: String) -> Subtask? {
        guard line.hasPrefix("- ") else { return nil }
        var body = String(line.dropFirst(2))
        var checked = false
        if body.hasPrefix("[ ] ") { body = String(body.dropFirst(4)) }
        else if body.lowercased().hasPrefix("[x] ") { body = String(body.dropFirst(4)); checked = true }
        var percent = checked ? 100 : 0
        if let range = body.range(of: #"\s*[·\-–]?\s*(\d{1,3})\s*%\s*$"#, options: .regularExpression) {
            let digits = body[range].filter(\.isNumber)
            percent = checked ? 100 : (Int(digits) ?? 0)
            body.removeSubrange(range)
        }
        let title = body.trimmingCharacters(in: .whitespaces)
        return title.isEmpty ? nil : Subtask(title: title, percent: percent)
    }

    public var text: String {
        var lines: [String] = []
        if !spread.trimmingCharacters(in: .whitespaces).isEmpty { lines.append(spread.trimmingCharacters(in: .whitespaces)) }
        lines += subtasks.map { "- [\($0.done ? "x" : " ")] \($0.title) · \($0.percent)%" }
        // With no spread, a first free line would read back as the spread: mark it.
        let marked = lines.isEmpty && !other.isEmpty ? ["Notes: \(other[0])"] + other.dropFirst() : other
        lines += marked
        if !tags.isEmpty { lines.append("Tags: \(tags.joined(separator: ", "))") }
        if let order { lines.append("Order: \(order == order.rounded() ? String(Int(order)) : String(order))") }
        return lines.joined(separator: "\n")
    }
}
