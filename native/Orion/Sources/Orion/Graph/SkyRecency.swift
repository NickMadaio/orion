import Foundation

/// Which nodes learned something in the last 36 hours — they get a slow shimmer on the graph.
///
/// The knowledge script dates a fact by the day it came from (`KnowledgeCitation.date`, "2026-11-02"), on the fact's
/// own source and on the node's sources. A day stamp is read as that day's noon: the honest middle of "sometime that
/// day". Undated nodes never shimmer. Bulk guard: when more than 30% look new, that is a rebuild restamping
/// everything (the calendar, the health log), not news, so nothing shimmers.
enum SkyRecency {
    static let window: TimeInterval = 36 * 3600
    static let bulkLimit = 0.30

    static func flags(_ nodes: [KnowledgeNode], now: Date, calendar: Calendar = .current) -> [Bool] {
        let flags = nodes.map { node in
            newest(node, calendar: calendar).map { now.timeIntervalSince($0) < window && $0.timeIntervalSince(now) < 12 * 3600 } ?? false
        }
        let share = Double(flags.filter { $0 }.count) / Double(max(nodes.count, 1))
        return share > bulkLimit ? Array(repeating: false, count: nodes.count) : flags
    }

    static func newest(_ node: KnowledgeNode, calendar: Calendar = .current) -> Date? {
        let stamps = node.facts.compactMap { $0.source?.date } + node.sources.compactMap(\.date)
        return stamps.compactMap { date($0, calendar: calendar) }.max()
    }

    /// "2026-11-02" as local noon, or a full ISO-8601 timestamp as itself.
    static func date(_ text: String, calendar: Calendar = .current) -> Date? {
        if text.count > 10, let full = ISO8601DateFormatter().date(from: text) { return full }
        let parts = text.prefix(10).split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return nil }
        var c = DateComponents()
        c.year = parts[0]; c.month = parts[1]; c.day = parts[2]; c.hour = 12
        return calendar.date(from: c)
    }
}
