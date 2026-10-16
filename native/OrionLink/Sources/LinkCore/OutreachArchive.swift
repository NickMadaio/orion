import Foundation
import MobileCore

/// Writes a proactive message into the Mac's chat archive, so it is a real turn in the
/// thread (the Mac app, `orion-remote` context and the phone's history all read it).
/// WP2's `orion-reach` (and anything else that sends a push) needs nothing more than a line
/// in outreach-outbox.jsonl: LinkEngine calls this and writes the matching CloudKit chat record.
public enum OutreachArchive {
    /// Returns false when the archive could not take it (the CloudKit record is still written).
    @discardableResult
    public static func append(_ entry: OutreachThread.Entry, at: Date, to store: ChatStore) -> Bool {
        if (try? store.load(entry.conversationID)) == nil {
            let seed = ChatConversation(id: entry.conversationID, title: "ORION", createdAt: at, updatedAt: at, model: nil, messages: [])
            guard (try? store.save(seed)) != nil else { return false }
        }
        let message = ChatMessage(id: entry.id + "-orion", role: .orion, text: entry.text, at: at, device: "mac")
        return (try? store.merge([message], into: entry.conversationID)) != nil
    }
}
