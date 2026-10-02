import Foundation

enum SchedulingMemory {
    static func context(for text: String) -> String {
        let relevant = text.range(of: #"\b(schedule|scheduling|plan|planning|reschedule|class|lecture|nap|commute)\b"#, options: [.regularExpression, .caseInsensitive]) != nil
        guard relevant else { return "" }
        let file = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".openclaw/workspace/SCHEDULING.md")
        guard let rules = try? String(contentsOf: file, encoding: .utf8) else {
            return "[Scheduling memory unavailable: read SCHEDULING.md and current tasks/calendar before planning.]\n\n"
        }
        return "[ORION scheduling preferences — consult with current calendar and Orion to-dos]\n" + String(rules.prefix(12000)) + "\n\n[Current user request]\n"
    }
    static func minimumMinutes(for title: String) -> Int {
        let rules = overrides["minimums"] as? [String: Int] ?? [:]
        return rules.filter { title.localizedCaseInsensitiveContains($0.key) && (0...480).contains($0.value) }.map(\.value).max() ?? 0
    }
    static var overrides: [String: Any] {
        let file = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".openclaw/orion-controlled/life-config.json")
        return (try? Data(contentsOf: file)).flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] } ?? [:]
    }
}
