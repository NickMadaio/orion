import Foundation

/// ORION's own messages as part of the phone's chat thread (WP5, 2026-10-16).
///
/// 2026-10-16: a class nudge reached Nick's lock screen, but when he opened ORION
/// there was nothing to answer. The push and the thread were two separate things:
/// the alert was a notification only, and the chat record behind it carried no
/// conversation, no reply id, and the check-in buttons instead of a reply field.
/// Rule from Nick: "those notifications are him actually MESSAGING me".
/// So every proactive push is also an ORION message in the one thread the chat
/// shows, under the id the reply must carry back (`replyTo`).
///
/// Foundation only, so both the phone and the Mac link share and test it.
public enum OutreachThread {
    /// A proactive message ORION started, as the thread and the notification need it.
    public struct Entry: Equatable, Sendable {
        public let id: String
        public let text: String
        public let conversationID: String
        public let push: Bool
        public let category: String
        /// 2 shows time-sensitive on the phone (the notification extension honours it).
        public let level: Int
        public let kind: String
    }

    /// The category a question gets (text reply); everything else keeps the check-in buttons.
    public static let askCategory = "orion.ask"
    public static let checkinCategory = "orion.checkin"
    /// How long a proactive message stays the thing a typed reply answers (spec 3.5: an ask is answered late).
    public static let replyWindow: TimeInterval = 90 * 60

    /// One line of outreach-outbox.jsonl (`{ id, text, kind, push, urgent, timeSensitive?, askId?, category? }`).
    public static func entry(from item: [String: Any]) -> Entry? {
        guard let id = item["id"] as? String, !id.isEmpty, let text = item["text"] as? String, !text.isEmpty else { return nil }
        let kind = item["kind"] as? String ?? "message"
        let wantsAsk = item["category"] as? String == askCategory || kind == "question" || item["askId"] != nil
        let urgent = (item["urgent"] as? Bool) == true || (item["timeSensitive"] as? Bool) == true
        return Entry(id: id, text: text, conversationID: LinkSchema.threadID, push: item["push"] as? Bool == true,
                     category: wantsAsk ? askCategory : checkinCategory, level: urgent ? 2 : 1, kind: kind)
    }

    /// A check-in tick or ORION-app alert (alerts-outbox.jsonl) is a message too, and answerable.
    public static func entry(fromCheckin alert: [String: Any]) -> Entry? {
        guard let id = alert["id"] as? String, !id.isEmpty, let text = alert["text"] as? String, !text.isEmpty else { return nil }
        let level = (alert["level"] as? Int) ?? 1
        return Entry(id: "checkin-\(id)-\(Int(level))", text: text, conversationID: LinkSchema.threadID, push: true,
                     category: checkinCategory, level: level, kind: "checkin")
    }

    /// What a message in the thread looks like to the reply rule.
    public struct Line: Equatable, Sendable {
        public let id: String
        public let sentAt: Date
        public let fromORION: Bool
        public init(id: String, sentAt: Date, fromORION: Bool) { self.id = id; self.sentAt = sentAt; self.fromORION = fromORION }
    }

    /// The outreach id a typed reply answers: the one he tapped, else the latest ORION-started
    /// message within the window that he has not already replied to. Nil means a plain message.
    public static func replyTarget(thread: [Line], tapped: String? = nil, now: Date = Date()) -> String? {
        if let tapped, thread.contains(where: { $0.id == tapped && $0.fromORION }) { return tapped }
        guard let latest = thread.filter(\.fromORION).max(by: { $0.sentAt < $1.sentAt }) else { return nil }
        guard now.timeIntervalSince(latest.sentAt) <= replyWindow, latest.sentAt <= now else { return nil }
        let answered = thread.contains { !$0.fromORION && $0.sentAt >= latest.sentAt }
        return answered ? nil : latest.id
    }
}
