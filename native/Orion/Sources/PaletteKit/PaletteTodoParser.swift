import Foundation

/// Reads `orion-tasks list` into to-dos: "- title · due 2026-11-02 · high · ..." with indented sub-task lines under some.
public enum PaletteTodoParser {

    public static func parse(_ output: String, today: String) -> [PaletteTodo] {
        output.split(separator: "\n", omittingEmptySubsequences: true).compactMap { line in
            guard line.hasPrefix("- ") else { return nil }
            let parts = line.dropFirst(2).components(separatedBy: " · ")
            let title = parts[0].trimmingCharacters(in: .whitespaces)
            guard !title.isEmpty else { return nil }
            let due = parts.dropFirst().first { $0.hasPrefix("due ") }.map { String($0.dropFirst(4)).trimmingCharacters(in: .whitespaces) }
            guard let due, let days = daysBetween(today, due) else { return PaletteTodo(title: title, overdue: false, due: "") }
            return PaletteTodo(title: title, overdue: days < 0, due: relative(days))
        }
    }

    private static func daysBetween(_ from: String, _ to: String) -> Int? {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: "UTC")
        formatter.dateFormat = "yyyy-MM-dd"
        guard let a = formatter.date(from: from), let b = formatter.date(from: to) else { return nil }
        return Int((b.timeIntervalSince(a) / 86_400).rounded())
    }

    private static func relative(_ days: Int) -> String {
        switch days {
        case 0: return "today"
        case 1: return "tomorrow"
        case -1: return "yesterday"
        case ..<0: return "\(-days) days ago"
        default: return "in \(days) days"
        }
    }
}
