import Foundation

enum SchedulingMemory {
    /// The most characters of SCHEDULING.md a LOCAL turn carries.
    static let localDigestLimit = 800

    /// 2026-10-16 (speed audit): the message is prefixed with up to 12k chars
    /// (about 2.7k tokens) whenever it says schedule|plan|class|nap|commute, and
    /// the next turn carries it again in history, so the block is prefilled twice.
    /// At ~950 tok/s that is about 6 s per hit (7.25 s down to 1.23 s without it).
    ///
    /// Under local routing the plugin already gives the worker SCHEDULING_INSTRUCTIONS
    /// (every orion-reschedule / orion-tasks verb and how to choose one), so the
    /// tool half of SCHEDULING.md is a duplicate. What the plugin does NOT carry is
    /// Nick's standing preferences: protected time and minimums, the priority scale,
    /// the class/commute wrapper. Only those survive, in `localDigestLimit` chars.
    /// Cloud turns (routing off, shadow, or schedule-to-cloud on) keep the full file.
    static func context(for text: String) -> String {
        context(for: text, localRouting: LocalRoutingMode.current(),
                rules: { try? String(contentsOf: rulesFile, encoding: .utf8) })
    }

    static var rulesFile: URL {
        FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".openclaw/workspace/SCHEDULING.md")
    }

    static func context(for text: String, localRouting: LocalRoutingMode, rules: () -> String?) -> String {
        let relevant = text.range(of: #"\b(schedule|scheduling|plan|planning|reschedule|class|lecture|nap|commute)\b"#, options: [.regularExpression, .caseInsensitive]) != nil
        guard relevant else { return "" }
        guard let rules = rules() else {
            return "[Scheduling memory unavailable: read SCHEDULING.md and current tasks/calendar before planning.]\n\n"
        }
        if localRouting.servesSchedulingLocally {
            let digest = localDigest(rules, limit: localDigestLimit)
            return digest.isEmpty ? "" : "[Nick's scheduling preferences]\n" + digest + "\n\n[Current user request]\n"
        }
        return "[ORION scheduling preferences — consult with current calendar and Orion to-dos]\n" + String(rules.prefix(12000)) + "\n\n[Current user request]\n"
    }

    /// Preference sections and each one's share of the budget, in order. Sections
    /// that are mostly command usage (they name `orion-` tools three or more
    /// times) are the plugin's job and are skipped.
    private static let preferenceSections: [(heading: String, share: Double)] =
        [("protected time", 0.42), ("priority scale", 0.30), ("class wrapper", 0.28)]

    static func localDigest(_ rules: String, limit: Int) -> String {
        let sections = rules.components(separatedBy: "\n## ").dropFirst().map { chunk -> (heading: String, body: String) in
            let lines = chunk.split(separator: "\n", omittingEmptySubsequences: true).map(String.init)
            return ((lines.first ?? "").lowercased(), lines.dropFirst().joined(separator: "\n"))
        }
        var parts: [String] = []
        for (heading, share) in preferenceSections {
            guard let section = sections.first(where: { $0.heading.contains(heading) }),
                  section.body.components(separatedBy: "orion-").count - 1 < 3
            else { continue }
            let text = sentences(of: section.body, within: Int(Double(limit) * share))
            if !text.isEmpty { parts.append(text) }
        }
        return String(parts.joined(separator: " ").prefix(limit))
    }

    /// Whole sentences of a section, flattened to one line, until `budget` chars.
    /// The "(Why this is written down ...)" story is history, not a rule.
    private static func sentences(of body: String, within budget: Int) -> String {
        var flat = body.replacingOccurrences(of: "**", with: "")
        if let why = flat.range(of: "(Why this is written down") { flat = String(flat[..<why.lowerBound]) }
        flat = flat.split(whereSeparator: \.isNewline)
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .map { $0.hasPrefix("- ") ? String($0.dropFirst(2)) : $0 }
            .joined(separator: " ")
        // Rules first: a sentence with a number or a hard word ("at least", "never",
        // "protected") is a preference; the rest is explanation. Kept in file order.
        let pieces = flat.components(separatedBy: ". ").filter { !$0.isEmpty }
            .map { $0.hasSuffix(".") ? $0 : $0 + "." }
        let hard = ["at least", "never", "protect", "must", "always", "first class", "last class", "keep ", "real classes"]
        func score(_ sentence: String) -> Int {
            let lower = sentence.lowercased()
            return (lower.contains(where: \.isNumber) ? 1 : 0) + (hard.contains(where: lower.contains) ? 2 : 0)
        }
        var chosen = Set<Int>(), used = 0
        for index in pieces.indices.sorted(by: { (score(pieces[$0]), -$0) > (score(pieces[$1]), -$1) }) {
            let cost = pieces[index].count + 1
            if used + cost > budget { continue }
            chosen.insert(index); used += cost
        }
        return pieces.indices.filter(chosen.contains).map { pieces[$0] }.joined(separator: " ")
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
