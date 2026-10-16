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
        ("protected time", 1100, false),
        ("class wrapper", 600, true),
    ]

    /// Fails OPEN: if ANY of the three required sections is missing or comes back
    /// empty (the file was reorganised), the caller sends the whole file instead.
    static func localDigest(_ rules: String, limit: Int) -> String {
        let sections = rules.components(separatedBy: "\n## ").dropFirst().map { chunk -> (heading: String, body: String) in
            let lines = chunk.components(separatedBy: "\n")
            return ((lines.first ?? "").lowercased(), lines.dropFirst().joined(separator: "\n"))
        }
        var parts: [String] = []
        for spec in digestSections {
            guard let section = sections.first(where: { $0.heading.contains(spec.heading) }) else { return "" }
            let text = ruleLines(of: section.body, cap: spec.cap, firstParagraphOnly: spec.firstParagraphOnly)
            if text.isEmpty { return "" }
            parts.append(text)
        }
        return String(parts.joined(separator: "\n").prefix(limit))
    }

    /// Markers of sentences that are the plugin's job (tool commands, machine config).
    private static let skipMarkers = ["orion-", "life-config", "School \u{2192} dorm"]

    /// Splits text into sentences at ". ", "! " or "? " boundaries (so "2.5 hours" survives).
    private static func sentences(of unit: String) -> [String] {
        var out: [String] = [], current = ""
        let chars = Array(unit)
        for (i, ch) in chars.enumerated() {
            current.append(ch)
            if ".!?".contains(ch), i + 1 < chars.count, chars[i + 1] == " " {
                out.append(current); current = ""
            }
        }
        if !current.isEmpty { out.append(current) }
        return out.map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
    }

    /// A unit with its tool/config sentences removed; nil if nothing is left.
    private static func strippedOfToolSentences(_ unit: String) -> String? {
        let kept = sentences(of: unit).filter { s in !skipMarkers.contains(where: s.contains) }
        let text = kept.joined(separator: " ")
        // A bullet reduced to its bare marker carries nothing.
        if text.isEmpty || text == "-" { return nil }
        // If the bullet's first sentence was dropped, keep the rest as a bullet.
        return unit.hasPrefix("- ") && !text.hasPrefix("- ") ? "- " + text : text
    }

    /// Whole bullets (or paragraphs) of a section, verbatim apart from line
    /// wrapping, until `cap`. Units split on blank lines and where unindented
    /// prose follows a bullet. Sentences about tool commands or the machine
    /// config are dropped one by one; the rest of the unit stays.
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
            let isBullet = line.hasPrefix("- ")
            let indented = raw.first == " " || raw.first == "\t"
            let afterBullet = current.first?.hasPrefix("- ") == true
            if isBullet || (afterBullet && !indented) { flush() }
            current.append(line)
        }
        flush()
        // Prose paragraphs of a bulleted section (e.g. "His own words override...")
        // are not rules; only bullets count there. A prose-only section keeps its text.
        if units.contains(where: { $0.hasPrefix("- ") }) { units = units.filter { $0.hasPrefix("- ") } }
        var out: [String] = [], used = 0
        if firstParagraphOnly {
            // One long paragraph is packed sentence by sentence, in order, and stops
            // at the first sentence that no longer fits, so what is kept is a contiguous
            // opening (a unit-level cap would drop the whole paragraph).
            let kept = (units.first.map(sentences(of:)) ?? []).filter { s in !skipMarkers.contains(where: s.contains) }
            var taken: [String] = []
            for sentence in kept {
                if used + sentence.count + 1 > cap { break }
                taken.append(sentence); used += sentence.count + 1
            }
            return taken.joined(separator: " ")
        }
        for unit in units {
            guard let text = strippedOfToolSentences(unit) else { continue }
            if used + text.count + 1 > cap { continue }
            out.append(text); used += text.count + 1
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
