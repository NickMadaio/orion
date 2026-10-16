import Foundation

enum SchedulingMemory {
    /// The most characters of SCHEDULING.md a LOCAL turn carries.
    static let localDigestLimit = 2100

    /// 2026-10-16 (speed audit): the message is prefixed with up to 12k chars
    /// (about 2.7k tokens) whenever it says schedule|plan|class|nap|commute, and
    /// the next turn carries it again in history, so the block is prefilled twice.
    /// At ~950 tok/s that is about 6 s per hit (7.25 s down to 1.23 s without it).
    ///
    /// Under local routing the plugin already gives the worker SCHEDULING_INSTRUCTIONS
    /// (every orion-reschedule / orion-tasks verb and how to choose one), so the
    /// tool half of SCHEDULING.md is a duplicate. What the plugin does NOT carry is
    /// Nick's standing preferences: protected time and minimums, the priority scale,
    /// the class/commute wrapper. Only those survive, in about `localDigestLimit` chars (2.1k, was 12k; the real rules need ~2k verbatim).
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
            // Fail open: a digest that found nothing must not silently drop the rules.
            if !digest.isEmpty { return "[Nick's scheduling preferences]\n" + digest + "\n\n[Current user request]\n" }
        }
        return "[ORION scheduling preferences — consult with current calendar and Orion to-dos]\n" + String(rules.prefix(12000)) + "\n\n[Current user request]\n"
    }

    /// Sections whose rules the plugin does not carry, in the order they are sent,
    /// each with its own cap. Rule lines are taken VERBATIM, whole, in file order:
    /// an earlier sentence-ranking version dropped "high: sleep and gym protected",
    /// "low", and "Nothing (a nap...) goes into travel time" (the 2026-10-05 nap
    /// incident), which is the opposite of what a digest is for.
    private static let digestSections: [(heading: String, cap: Int, firstParagraphOnly: Bool)] = [
        ("priority scale", 700, false),
        ("protected time", 720, false),
        ("class wrapper", 600, true),
    ]

    /// Fails OPEN: if fewer than two sections are found (the file was reorganised)
    /// or the digest is empty, the caller sends the whole file instead.
    static func localDigest(_ rules: String, limit: Int) -> String {
        let sections = rules.components(separatedBy: "\n## ").dropFirst().map { chunk -> (heading: String, body: String) in
            let lines = chunk.components(separatedBy: "\n")
            return ((lines.first ?? "").lowercased(), lines.dropFirst().joined(separator: "\n"))
        }
        var parts: [String] = []
        for spec in digestSections {
            guard let section = sections.first(where: { $0.heading.contains(spec.heading) }) else { continue }
            let text = ruleLines(of: section.body, cap: spec.cap, firstParagraphOnly: spec.firstParagraphOnly)
            if !text.isEmpty { parts.append(text) }
        }
        guard parts.count >= 2 else { return "" }
        return String(parts.joined(separator: "\n").prefix(limit))
    }

    /// Whole bullets (or paragraphs) of a section, verbatim apart from line
    /// wrapping, until `cap`. Bullets that are about tool commands or the machine
    /// config, or that duplicate the class wrapper, are the plugin's job.
    private static func ruleLines(of body: String, cap: Int, firstParagraphOnly: Bool) -> String {
        var units: [String] = []
        var current: [String] = []
        func flush() {
            if !current.isEmpty { units.append(current.joined(separator: " ")) }
            current = []
        }
        for raw in body.components(separatedBy: "\n") {
            let line = raw.trimmingCharacters(in: .whitespaces)
            if line.isEmpty { if firstParagraphOnly && !current.isEmpty { break }; flush(); continue }
            if line.hasPrefix("(Why this is written down") { break }
            if line.hasPrefix("- ") { flush() }
            current.append(line)
        }
        flush()
        // Prose paragraphs of a bulleted section (e.g. "His own words override...")
        // are not rules; only bullets count there. A prose-only section keeps its text.
        if units.contains(where: { $0.hasPrefix("- ") }) { units = units.filter { $0.hasPrefix("- ") } }
        let skip = ["orion-", "life-config", "School \u{2192} dorm"]
        var out: [String] = [], used = 0
        for unit in units where !skip.contains(where: unit.contains) {
            if used + unit.count + 1 > cap { continue }
            out.append(unit); used += unit.count + 1
        }
        return out.joined(separator: "\n")
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
