import Foundation

/// A claim on the messages waiting in a JSONL outbox.
///
/// 2026-10-16 audit (#6): LinkEngine emptied alerts-outbox.jsonl BEFORE the
/// CloudKit save, so a failed save lost the message. Claiming moves the lines to
/// `<outbox>.processing`; `complete()` (after a confirmed save) deletes it. If it
/// is never completed, the next `claim` picks the same lines up again, ahead of
/// anything new, so a failure is a retry and a crash loses nothing.
public struct OutboxClaim {
    public let items: [[String: Any]]
    private let processing: URL

    public static func claim(_ outbox: URL) -> OutboxClaim? {
        let fm = FileManager.default
        let processing = URL(fileURLWithPath: outbox.path + ".processing")
        let fresh = (try? String(contentsOf: outbox, encoding: .utf8)) ?? ""
        if fm.fileExists(atPath: processing.path) {
            // Left over from a failed or interrupted save: retry it, then what came after.
            if !fresh.isEmpty { append(fresh, to: processing) }
            try? fm.removeItem(at: outbox)
        } else if !fresh.isEmpty {
            do { try fm.moveItem(at: outbox, to: processing) } catch { return nil }
        } else {
            return nil
        }
        guard let text = try? String(contentsOf: processing, encoding: .utf8), !text.isEmpty else {
            try? fm.removeItem(at: processing); return nil
        }
        let items = text.split(separator: "\n").compactMap { try? JSONSerialization.jsonObject(with: Data($0.utf8)) as? [String: Any] }
        return OutboxClaim(items: items, processing: processing)
    }

    /// The save was confirmed: the claimed lines are done.
    public func complete() { try? FileManager.default.removeItem(at: processing) }

    /// Put alerts that did not come from this outbox (a check-in tick already advanced its state) back for retry.
    public static func requeue(_ alerts: [[String: Any]], to outbox: URL) throws {
        let lines = try alerts.map { String(decoding: try JSONSerialization.data(withJSONObject: $0), as: UTF8.self) + "\n" }
        append(lines.joined(), to: outbox)
    }

    /// The phone alert level for an outreach line: urgent is 2, which the
    /// phone's notification extension makes time-sensitive.
    public static func alertLevel(urgent: Any?) -> Int { (urgent as? Bool) == true ? 2 : 1 }

    private static func append(_ text: String, to url: URL) {
        let data = Data((text.hasSuffix("\n") ? text : text + "\n").utf8)
        if let handle = try? FileHandle(forWritingTo: url) {
            handle.seekToEndOfFile(); handle.write(data); try? handle.close()
        } else {
            try? data.write(to: url, options: .atomic)
        }
    }
}
