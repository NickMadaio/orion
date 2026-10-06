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

    public init(spread: String = "", subtasks: [Subtask] = [], other: [String] = []) {
        self.spread = spread
        self.subtasks = subtasks
        self.other = other
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
        lines += other
        return lines.joined(separator: "\n")
    }
}
