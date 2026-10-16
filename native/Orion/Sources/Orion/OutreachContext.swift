import Foundation

/// One line of outreach.jsonl: something ORION said to him first.
struct OutreachRow: Equatable {
    var id: String?
    var text: String
    var at: Date
    var held: Bool
}

enum OutreachContext {
    /// Past this a message is no longer plausibly what he is answering.
    static let window: TimeInterval = 25 * 60

    static func parse(jsonl: String) -> [OutreachRow] {
        let fractional = ISO8601DateFormatter(); fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let plain = ISO8601DateFormatter()
        return jsonl.split(separator: "\n").compactMap { line in
            guard let row = try? JSONSerialization.jsonObject(with: Data(line.utf8)) as? [String: Any],
                  let text = row["text"] as? String,
                  let stamp = row["at"] as? String,
                  let at = fractional.date(from: stamp) ?? plain.date(from: stamp) else { return nil }
            return OutreachRow(id: row["id"] as? String, text: text, at: at, held: row["channel"] as? String == "hold")
        }
    }

    static func label(for row: OutreachRow, now: Date) -> String {
        let minutes = max(0, Int(now.timeIntervalSince(row.at) / 60))
        return "[ORION context: you messaged him first, \(minutes) min ago: \"\(row.text.prefix(200))\". This message MAY be his answer.]\n"
    }
}

/// Decides, per turn, whether an outreach message rides along.
///
/// 2026-10-16 audit (#5): the last 3 messages from 6 hours were attached to every
/// reply, so a 6:54 PM "put the oyster card there?" rode along on 14+ turns,
/// "start a focus session" among them. Now: only the single most recent message,
/// within `OutreachContext.window`, only if no turn happened since it was sent,
/// and only once.
final class OutreachTracker {
    private let lock = NSLock()
    private var lastTurnAt: Date?
    private var consumedID: String?

    /// Call once per turn: returns the context line ("" for none) and records the turn.
    func prefix(rows: [OutreachRow], now: Date = Date()) -> String {
        lock.lock(); defer { lock.unlock() }
        defer { lastTurnAt = now }
        guard let latest = rows.filter({ !$0.held }).max(by: { $0.at < $1.at }) else { return "" }
        guard now.timeIntervalSince(latest.at) <= OutreachContext.window, latest.at <= now else { return "" }
        if let lastTurnAt, lastTurnAt >= latest.at { return "" }
        if let id = latest.id, id == consumedID { return "" }
        consumedID = latest.id
        return OutreachContext.label(for: latest, now: now)
    }
}
