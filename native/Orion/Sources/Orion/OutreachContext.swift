import Foundation

/// One line of outreach.jsonl: something ORION said to him first.
struct OutreachRow: Equatable {
    var id: String?
    var text: String
    var at: Date
    var held: Bool
    /// The structured question orion-reach attached (`--ask`), when there is one.
    var ask: OutreachAsk? = nil
    /// Why ORION sent it (`--why`).
    var why: String? = nil
}

/// `ask` of an outreach row (contract C4): `{ askId, type, window: { date, start, end|null }, place, title }`.
struct OutreachAsk: Equatable {
    var askId: String?
    var type: String
    var windowStart: String? = nil
    var windowEnd: String? = nil
    var place: String? = nil
    var title: String? = nil
}

/// The id of the question open on this Mac right now (a bubble or a spoken one), set by
/// `SpokenQuestionFollowUp`'s owner. An explicit id beats the timed guess.
enum OutreachReplyTo {
    private static let lock = NSLock()
    private static var value: String?
    static var current: String? {
        get { lock.lock(); defer { lock.unlock() }; return value }
        set { lock.lock(); defer { lock.unlock() }; value = newValue }
    }
}

enum OutreachContext {
    /// Past this a message is no longer plausibly what he is answering.
    static let window: TimeInterval = 25 * 60
    /// An ask sent while he was away is answered late (a text from the gym).
    static let askWindow: TimeInterval = 90 * 60

    static func window(for row: OutreachRow) -> TimeInterval { row.ask == nil ? window : askWindow }

    /// Window bounds arrive as "HH:MM" text or as minutes since midnight.
    private static func clock(_ raw: Any?) -> String? {
        if let text = raw as? String, !text.isEmpty { return text }
        if let minutes = raw as? Int { return String(format: "%02d:%02d", minutes / 60 % 24, minutes % 60) }
        return nil
    }

    static func parseAsk(_ raw: Any?) -> OutreachAsk? {
        guard let object = raw as? [String: Any], let type = object["type"] as? String else { return nil }
        let window = object["window"] as? [String: Any]
        return OutreachAsk(askId: object["askId"] as? String, type: type,
                           windowStart: clock(window?["start"]), windowEnd: clock(window?["end"]),
                           place: object["place"] as? String, title: object["title"] as? String ?? object["blockId"] as? String)
    }

    static func parse(jsonl: String) -> [OutreachRow] {
        let fractional = ISO8601DateFormatter(); fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let plain = ISO8601DateFormatter()
        return jsonl.split(separator: "\n").compactMap { line in
            guard let row = try? JSONSerialization.jsonObject(with: Data(line.utf8)) as? [String: Any],
                  let text = row["text"] as? String,
                  let stamp = row["at"] as? String,
                  let at = fractional.date(from: stamp) ?? plain.date(from: stamp) else { return nil }
            return OutreachRow(id: row["id"] as? String, text: text, at: at, held: row["channel"] as? String == "hold",
                              ask: parseAsk(row["ask"]), why: row["why"] as? String)
        }
    }

    static func label(for row: OutreachRow, now: Date) -> String {
        let minutes = max(0, Int(now.timeIntervalSince(row.at) / 60))
        guard let ask = row.ask else {
            return "[ORION context: you messaged him first, \(minutes) min ago: \"\(row.text.prefix(200))\". This message MAY be his answer.]\n"
        }
        return "[ORION context: \(minutes) min ago you asked \"\(row.text.prefix(200))\" (\(describe(ask))). If he says what he did or is doing, log it.]\n"
    }

    /// "blank ask about 14:00-now, he is away" / "finish resume, planned 14:00-16:00, not started".
    static func describe(_ ask: OutreachAsk) -> String {
        let span = ask.windowStart.map { "\($0)-\(ask.windowEnd ?? "now")" }
        var parts: [String]
        switch ask.type {
        case "blank": parts = ["blank ask" + (span.map { " about \($0)" } ?? "")]
        case "mismatch": parts = [ask.title ?? "a planned block"] + (span.map { ["planned \($0)", "not started"] } ?? [])
        case "voice-repeat": parts = ["a spoken question he may not have heard"]
        default: parts = [ask.type + " ask" + (span.map { " about \($0)" } ?? "")]
        }
        if let place = ask.place, !place.isEmpty {
            parts.append(place == "away" || place == "home" ? "he is \(place)" : "he is at \(place)")
        }
        return parts.joined(separator: ", ")
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
    /// An explicit `replyTo` (the question open right now) wins over the timed guess:
    /// it skips the "no turn since" rule, but keeps the window and "only once".
    func prefix(rows: [OutreachRow], now: Date = Date(), replyTo: String? = nil) -> String {
        lock.lock(); defer { lock.unlock() }
        defer { lastTurnAt = now }
        if let replyTo, let row = rows.first(where: { $0.id == replyTo && !$0.held }) {
            guard row.at <= now, now.timeIntervalSince(row.at) <= OutreachContext.window(for: row), row.id != consumedID else { return "" }
            consumedID = row.id
            return OutreachContext.label(for: row, now: now)
        }
        guard let latest = rows.filter({ !$0.held }).max(by: { $0.at < $1.at }) else { return "" }
        guard now.timeIntervalSince(latest.at) <= OutreachContext.window(for: latest), latest.at <= now else { return "" }
        if let lastTurnAt, lastTurnAt >= latest.at { return "" }
        if let id = latest.id, id == consumedID { return "" }
        consumedID = latest.id
        return OutreachContext.label(for: latest, now: now)
    }
}
