import Foundation

/// A notification only the phone sent (the bedtime ladder, "Morning. Your apps are unlocked", the Screen Time notes),
/// mirrored into the chat thread as an ORION message so Nick's reply has something to answer, and logged on the Mac as
/// outreach so reply-context binds the reply to it (2026-11-02, W10-E: "when I reply he doesn't always realise I'm
/// replying to what he just said").
///
/// The mirror is the same LinkCommand shape the Mac writes for its own outreach (device "orion", status done, the
/// thread's conversation, askId = a stable id), told apart from the Mac's by the id prefix, so no new CloudKit field.
public enum PhoneMirror {
    public static let idPrefix = "phone."
    /// Notification identifier prefixes that are ORION speaking from the phone alone.
    public static let notificationPrefixes = ["orion.night.", "orion.screen."]
    public static let ledgerKey = "orion.mirror.sent"
    static let ledgerLimit = 300

    /// `askId` for a notification: its identifier, kept to the characters outreach ids allow, under 80.
    public static func id(forNotification identifier: String) -> String {
        let clean = String(identifier.unicodeScalars.map { scalar -> Character in
            (scalar.isASCII && (CharacterSet.alphanumerics.contains(scalar) || "._:-".unicodeScalars.contains(scalar))) ? Character(scalar) : "-"
        })
        return String((idPrefix + clean).prefix(80))
    }

    public static func isMirrorID(_ id: String?) -> Bool { id?.hasPrefix(idPrefix) == true }

    public static func isPhoneLocal(identifier: String) -> Bool { notificationPrefixes.contains { identifier.hasPrefix($0) } }

    /// The fields of the thread record (LinkSchema names), so the app, the extension and the tests agree.
    public struct Record: Equatable, Sendable {
        public let recordName: String
        public let fields: [String: String]
    }

    public static func record(id: String, text: String) -> Record {
        Record(recordName: id, fields: [
            LinkSchema.commandText: "",
            LinkSchema.commandDevice: "orion",
            LinkSchema.commandKind: LinkCommandKind.chat.rawValue,
            LinkSchema.commandStatus: LinkCommandStatus.done.rawValue,
            LinkSchema.commandReply: text,
            LinkSchema.commandConversation: LinkSchema.threadID,
            LinkSchema.commandAskID: id,
        ])
    }

    /// The Mac side: a mirror record becomes `orion-reach <text> --already-sent phone --id <id> ...`.
    /// `at` is when the notification really fired, so the Mac's thread keeps that time and not the hour it was mirrored.
    public static func reachArguments(id: String, text: String, at: Date? = nil) -> [String]? {
        guard isMirrorID(id) else { return nil }
        let body = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !body.isEmpty else { return nil }
        return [String(body.prefix(500)), "--already-sent", "phone", "--id", id, "--kind", "update", "--why", "phone notification"]
            + (at.map { ["--at", ISO8601DateFormatter().string(from: $0)] } ?? [])
    }

    /// A delivered phone notification waiting to be mirrored.
    public struct Delivered: Equatable, Sendable {
        public let identifier: String
        public let body: String
        public let date: Date
        public init(identifier: String, body: String, date: Date) { self.identifier = identifier; self.body = body; self.date = date }
    }

    /// Families where a newer message replaces an older one ("It's 22:18 … It's 22:26 … It's 22:36" is one nudge, said three times).
    public static let supersedingPrefixes = ["orion.night."]

    /// A sweep of the notification center finds every nudge since the app last ran, in a pile (2026-11-03: 65 bedtime lines in one
    /// minute, and three arriving together at 22:44 for 22:18, 22:26 and 22:36). Of a superseding family only the newest is
    /// mirrored; the rest are returned so the caller can mark them seen. Oldest first.
    public static func condense(_ items: [Delivered]) -> (keep: [Delivered], superseded: [Delivered]) {
        var superseded: [Delivered] = []
        var keep: [Delivered] = []
        for item in items.sorted(by: { $0.date < $1.date }) {
            let family = supersedingPrefixes.first { item.identifier.hasPrefix($0) }
            if let family, let older = keep.firstIndex(where: { $0.identifier.hasPrefix(family) }) {
                superseded.append(keep.remove(at: older))
            }
            keep.append(item)
        }
        return (keep, superseded)
    }

    /// Ids already sent, oldest first, capped. A pure value so dedupe is testable.
    public struct Ledger: Equatable, Sendable {
        public private(set) var ids: [String]
        public init(ids: [String] = []) { self.ids = ids }
        public func contains(_ id: String) -> Bool { ids.contains(id) }
        /// The entries not yet sent, once each, in order.
        public func fresh<T>(_ items: [T], id: (T) -> String) -> [T] {
            var seen = Set(ids)
            return items.filter { seen.insert(id($0)).inserted }
        }
        public func adding(_ id: String) -> Ledger {
            guard !contains(id) else { return self }
            return Ledger(ids: Array((ids + [id]).suffix(PhoneMirror.ledgerLimit)))
        }
    }
}
