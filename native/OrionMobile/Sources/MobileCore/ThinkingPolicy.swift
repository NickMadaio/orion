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

    static let action = try! NSRegularExpression(pattern:
        #"\b(re)?schedul\w*|\bcalendar\b|\bplan\w*\b|\b(move|shift|push|swap|extend|shorten|resize|cancel|skip|drop|delete|remove|clear|book)\b|\b(longer|shorter|earlier|later)\b|\b(block|event|class|lecture|lab|seminar|meeting|appointment)s?\b|\bto-?dos?\b|\btasks?\b|\bremind\w*\b|\b(deadline|due)\b|\b(tomorrow|tonight|this (morning|afternoon|evening))\b|\b(until|before|after|between)\b|\borgani[sz]e\b|\bpriorit\w*\b|\bfocus session\b|\b\d{1,2}(:\d{2})?\s?(am|pm)\b|\b\d{1,2}:\d{2}\b"#,
        options: [.caseInsensitive])

    /// True when the message asks ORION to work something out, not just talk.
    public static func needsReasoning(_ text: String) -> Bool {
        let range = NSRange(text.startIndex..., in: text)
        if action.firstMatch(in: text, range: range) != nil { return true }
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
