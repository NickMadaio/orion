import Foundation

/// A bubble exchange mirrored into the phone's ORION thread (W16-d), so it is never lost.
///
/// One line in outreach-outbox.jsonl, which the link (LinkEngine.deliverOutreach) turns into a phone chat record and a line in the
/// Mac's phone-history archive. `said` makes it his turn answered by ORION (`OutreachThread.Entry.said`), not a new ORION message;
/// `push` is false because he is at the Mac and already read it; no `askId`, so the phone never treats it as a question to answer.
enum BubbleMirror {
    static func outboxRow(reachID: String?, said: String, answer: String, at: Date) -> [String: Any]? {
        let text = answer.trimmingCharacters(in: .whitespacesAndNewlines)
        let words = said.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, !words.isEmpty else { return nil }
        let stamp = Int(at.timeIntervalSince1970)
        return ["id": "bubble-\(reachID ?? "mac")-\(stamp)", "text": text, "said": words, "kind": "bubble-reply",
                "push": false, "urgent": false]
    }

    static func line(reachID: String?, said: String, answer: String, at: Date) -> String? {
        guard let row = outboxRow(reachID: reachID, said: said, answer: answer, at: at),
              let data = try? JSONSerialization.data(withJSONObject: row, options: [.sortedKeys]),
              let json = String(data: data, encoding: .utf8) else { return nil }
        return json + "\n"
    }

    /// Appends the line to the outbox. Best effort: the exchange is already in the Mac chat either way.
    @discardableResult
    static func append(reachID: String?, said: String, answer: String, at: Date = Date(),
                       home: URL = FileManager.default.homeDirectoryForCurrentUser) -> Bool {
        guard let line = line(reachID: reachID, said: said, answer: answer, at: at) else { return false }
        let url = home.appendingPathComponent(".openclaw/orion-controlled/outreach-outbox.jsonl")
        do {
            if !FileManager.default.fileExists(atPath: url.path) {
                try Data().write(to: url, options: .atomic)
            }
            let handle = try FileHandle(forWritingTo: url)
            defer { try? handle.close() }
            try handle.seekToEnd()
            try handle.write(contentsOf: Data(line.utf8))
            return true
        } catch {
            OrionLog.write("[bubble] could not mirror the exchange to the phone: \(error.localizedDescription)")
            return false
        }
    }
}
