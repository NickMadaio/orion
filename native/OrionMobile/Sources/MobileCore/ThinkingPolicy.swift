import Foundation

/*
 When ORION thinks before answering (2026-10-07). Nick: "for normal talking no
 thinking ... but there should be a way for orion to say 'this task needs a
 tiny bit better reasoning'". Thinking was off on the Mac for every turn, and a
 one-message schedule change took two messages and four failed tool calls.

   off  ordinary talk
   low  his day, to-dos, times, several steps at once — or for 10 minutes after
        a turn where ORION's own tool calls kept failing (it struggled)
 Local (ollama/) models never think: they cannot, and asking costs a turn.
 The phone route (scripts/lib/thinking-policy.mjs) uses the same rule.
*/
public enum ThinkingPolicy {
    public static let boostSeconds: TimeInterval = 600

    static let verbs = try! NSRegularExpression(pattern:
        #"\b(get rid of|start|move|shift|push|swap|extend|shorten|resize|cancel|skip|drop|delete|remove|clear|book|schedule|reschedule|add|put|replace|rename|fit|make)\b"#,
        options: [.caseInsensitive])
    static let anchors = try! NSRegularExpression(pattern:
        #"\b(before|after|until|between|at least|ending|ends?|same (end|time|as)|instead|then|so i'?m|right after|directly after)\b"#,
        options: [.caseInsensitive])
    static let wholeDay = try! NSRegularExpression(pattern:
        #"\b(plan|schedule|fill|organi[sz]e|redo|rebuild)\b[^.?!]{0,30}\b(my |the )?(day|today|tomorrow|week|evening|afternoon|morning|rest of)\b"#,
        options: [.caseInsensitive])

    /// Narrowed 2026-10-07 ("he doesn't ALWAYS need thinking"): a schedule
    /// change with several parts or anchors, a whole day, or a long message.
    /// One-step commands — end my session, remind me at 6:55, move gym to 6 — don't.
    static let narrative = try! NSRegularExpression(pattern:
        #"\b(gonna|going to|i'?ll|i will|want to|wanna)\b.{0,80}\b(then|so i'?m|by \d|until|before|after)\b"#,
        options: [.caseInsensitive])

    public static func needsReasoning(_ text: String) -> Bool {
        let range = NSRange(text.startIndex..., in: text)
        if narrative.firstMatch(in: text, range: range) != nil { return true }
        if wholeDay.firstMatch(in: text, range: range) != nil { return true }
        let verbCount = verbs.numberOfMatches(in: text, range: range)
        if verbCount >= 2 { return true }
        if verbCount >= 1, anchors.firstMatch(in: text, range: range) != nil { return true }
        return text.split(whereSeparator: \.isWhitespace).count >= 35
    }

    public static func level(for text: String, model: String?, boostedUntil: Date?, now: Date = Date()) -> String {
        if model?.hasPrefix("ollama/") == true { return "off" }
        if let boostedUntil, boostedUntil > now { return "low" }
        return needsReasoning(text) ? "low" : "off"
    }

    /// Two or more failed tool calls in the turn means ORION was guessing.
    public static func struggled(transcript: String, since: Date) -> Bool {
        let iso = ISO8601DateFormatter(); iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let plain = ISO8601DateFormatter()
        let failures = transcript.split(separator: "\n").filter { line in
            guard let row = try? JSONSerialization.jsonObject(with: Data(line.utf8)) as? [String: Any],
                  let stamp = row["timestamp"] as? String, let at = iso.date(from: stamp) ?? plain.date(from: stamp), at >= since,
                  let message = row["message"] as? [String: Any], message["role"] as? String == "toolResult" else { return false }
            if message["isError"] as? Bool == true { return true }
            if let details = message["details"] as? [String: Any], let code = details["exitCode"] as? Int, code != 0 { return true }
            let text = (message["content"] as? [[String: Any]])?.compactMap { $0["text"] as? String }.joined() ?? ""
            return text.hasPrefix("NOTHING WAS") || text.hasPrefix("Orion repeat guard")
        }
        return failures.count >= 2
    }

    /// The same check against the session's transcript file.
    public static func struggled(home: URL, session: String, since: Date) -> Bool {
        guard let transcript = ChatThinking.transcript(home: home, session: session) else { return false }
        return struggled(transcript: transcript, since: since)
    }
}
