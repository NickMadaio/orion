import Foundation

/// What a chat line may show (the phone's copy of scripts/lib/reach/chat-text.mjs, so history written before the fix is clean too):
/// internal job output is hidden, notify headers and digests become their sentences, clock times are 12-hour.
public enum ChatSanitizer {
    private static let job = try! NSRegularExpression(pattern: #"^\s*\[[a-z][a-z0-9-]*\]\s"#)
    private static let eventHeader = try! NSRegularExpression(pattern: #"^\s*Orion \| (?!HELD UPDATES|\d+ UPDATES)[A-Z][A-Z -]*[A-Z] \| [^\n]*\n"#)
    private static let heldHeader = try! NSRegularExpression(pattern: #"^\s*Orion \| HELD UPDATES \| [^\n]*\n"#)
    private static let retryHeader = try! NSRegularExpression(pattern: #"^\s*Orion \| \d+ UPDATES THAT DID NOT GO OUT\n"#)
    private static let noAction = try! NSRegularExpression(pattern: #"\n?No action needed\.\s*$"#)
    private static let heldLine = try! NSRegularExpression(pattern: #"^- \[[A-Z][A-Z -]*[A-Z]\] [a-z0-9-]+: (.*)$"#)
    private static let retryLine = try! NSRegularExpression(pattern: #"^- [a-z0-9-]+: (.*)$"#)
    private static let clock = try! NSRegularExpression(pattern: #"(?<![\w:])(\d{2}):([0-5]\d)(?![\w:]|\s?[AaPp]\.?[Mm])"#)

    /// The text to show, or nil when the line is plumbing and must not appear at all.
    public static func display(_ text: String) -> String? {
        guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, !matches(job, text) else { return nil }
        let clean = twelveHour(unwrap(text)).trimmingCharacters(in: .whitespacesAndNewlines)
        return clean.isEmpty ? nil : clean
    }

    /// Two-digit 24-hour times become 12-hour. 10-12 are ambiguous ("what was 12:30 to 3:30?") and left alone.
    public static func twelveHour(_ text: String) -> String {
        let source = text as NSString
        var out = ""
        var cursor = 0
        for match in clock.matches(in: text, range: NSRange(location: 0, length: source.length)) {
            out += source.substring(with: NSRange(location: cursor, length: match.range.location - cursor))
            let whole = source.substring(with: match.range)
            let hour = Int(source.substring(with: match.range(at: 1))) ?? 99
            if hour > 23 || (10...12).contains(hour) { out += whole }
            else { out += "\(hour % 12 == 0 ? 12 : hour % 12):\(source.substring(with: match.range(at: 2))) \(hour >= 12 ? "PM" : "AM")" }
            cursor = match.range.location + match.range.length
        }
        return out + source.substring(from: cursor)
    }

    private static func matches(_ regex: NSRegularExpression, _ text: String) -> Bool {
        regex.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)) != nil
    }

    private static func strip(_ regex: NSRegularExpression, _ text: String) -> String {
        regex.stringByReplacingMatches(in: text, range: NSRange(text.startIndex..., in: text), withTemplate: "")
    }

    private static func sentences(_ body: String, line: NSRegularExpression) -> String {
        body.split(separator: "\n", omittingEmptySubsequences: true).map { raw -> String in
            let l = raw.trimmingCharacters(in: .whitespaces)
            guard let m = line.firstMatch(in: l, range: NSRange(l.startIndex..., in: l)), let r = Range(m.range(at: 1), in: l) else { return l }
            return String(l[r])
        }.filter { !$0.isEmpty }.joined(separator: "\n")
    }

    private static func unwrap(_ text: String) -> String {
        if matches(heldHeader, text) { return sentences(strip(heldHeader, text), line: heldLine) }
        if matches(retryHeader, text) { return sentences(strip(retryHeader, text), line: retryLine) }
        if matches(eventHeader, text) { return strip(noAction, strip(eventHeader, text)).trimmingCharacters(in: .whitespacesAndNewlines) }
        return text
    }
}
