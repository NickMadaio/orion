import Foundation

/// w18 audit2 (item D): the two sentences that keep a question from vanishing without a word.
/// 11-02 23:11, 11-03 00:26, 11-04 11:29 left no reply recorded: a paused turn that failed was dropped (only successes were kept),
/// and speech the address gate refused showed nothing, even when it was plainly a question or a command.
enum LostTurn {
    /// A turn that was paused or orphaned and then failed: say so, with what he asked.
    static func failedLine(question: String) -> String {
        let q = question.trimmingCharacters(in: .whitespacesAndNewlines)
        return q.isEmpty ? "I lost that one — say it again?" : "I lost that one — say it again? (\"\(q)\")"
    }

    private static let lead: Set<String> = ["what", "whats", "what's", "when", "where", "who", "why", "how", "which", "did",
                                           "open", "play", "pause", "set", "remind", "call", "text", "show", "tell", "turn", "start", "stop"]

    /// Question- or command-shaped: it ends with "?" or starts with a question word or an imperative verb, in under a dozen words.
    static func looksAsked(_ text: String) -> Bool {
        let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
        let words = t.lowercased().split(whereSeparator: { $0.isWhitespace })
        guard !words.isEmpty, words.count <= 12 else { return false }
        if t.hasSuffix("?") { return true }
        let first = words[0].trimmingCharacters(in: .punctuationCharacters.subtracting(CharacterSet(charactersIn: "'’")))
        return lead.contains(first.replacingOccurrences(of: "’", with: "'"))
    }

    /// The line shown when the gate refused speech that looked like a question or command; nil for ordinary room talk.
    static func skippedLine(text: String) -> String? {
        let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard looksAsked(t) else { return nil }
        return "I didn't take that as meant for me, so I skipped it: \"\(t)\" Say it again if it was."
    }
}
