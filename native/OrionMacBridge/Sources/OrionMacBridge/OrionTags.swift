import Foundation

/// The `[orion:<x>]` markers ORION writes into an event's notes (2026-10-16): the kind first
/// (`[orion:study]`), then up to 4 tags (`logged`, `anchor`, `rank-must|high|medium|low`).
enum OrionTags {
    static let maxTags = 4

    /// A comma-separated payload value → valid tags only (each ^[a-z0-9_-]{1,20}$), at most 4, no repeats.
    static func parse(payload text: String?) -> [String] {
        var seen = Set<String>()
        var tags: [String] = []
        for raw in (text ?? "").split(separator: ",") {
            let tag = raw.trimmingCharacters(in: .whitespaces)
            guard tag.range(of: #"^[a-z0-9_-]{1,20}$"#, options: .regularExpression) != nil, seen.insert(tag).inserted else { continue }
            tags.append(tag)
            if tags.count == maxTags { break }
        }
        return tags
    }

    /// The notes text: kind marker first, then each tag.
    static func notes(kind: String, tags: [String]) -> String {
        let markers = ([kind] + tags).map { "[orion:\($0)]" }.joined(separator: " ")
        return "Planned by ORION. It may move this block when your day changes. \(markers)"
    }

    /// Every marker in the notes, in order (kind first).
    static func markers(in notes: String?) -> [String] {
        guard let notes else { return [] }
        let regex = try? NSRegularExpression(pattern: #"\[orion:([a-z0-9_-]+)\]"#)
        let range = NSRange(notes.startIndex..., in: notes)
        return (regex?.matches(in: notes, range: range) ?? []).compactMap { match in
            Range(match.range(at: 1), in: notes).map { String(notes[$0]) }
        }
    }

    /// The first marker, which old readers know as `orion` (letters and underscores only, as before).
    static func kind(in notes: String?) -> String {
        markers(in: notes).first { $0.range(of: #"^[a-z_]+$"#, options: .regularExpression) != nil } ?? ""
    }
}
