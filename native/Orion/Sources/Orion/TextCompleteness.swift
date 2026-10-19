import Foundation

/*
 Did a completion stop on purpose, or run out of budget mid-sentence?

 The old guard looked at the last character only: `.!?"`. That rejected good text
 that ends in a closing bracket, a curly quote, an emoji, markdown emphasis or a
 bullet that carries no full stop, and it showed nothing instead. This reads the
 whole ending, and rejects only what really looks cut: a trailing word with no
 terminator, an unclosed quote or bracket, or a dangling connective.
*/
enum TextCompleteness {
    private static let terminators: Set<Character> = [".", "!", "?", "\u{2026}"]
    private static let closers: Set<Character> = ["\"", "'", "\u{201D}", "\u{2019}", ")", "]", "}", "*", "_", "`", "~"]
    private static let dangling: Set<String> = [
        "a", "an", "the", "and", "or", "but", "of", "to", "in", "on", "with", "for", "at", "by", "from", "that", "which",
        "is", "are", "was", "were", "your", "my", "his", "her", "their", "its", "as", "than", "because", "while", "so", "if",
        "about", "into", "over", "under", "between", "after", "before", "who", "whose", "this", "these", "those", "be", "been",
    ]

    static func isComplete(_ raw: String) -> Bool {
        let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let lastChar = text.last else { return false }
        // Structured output is not prose: its own schema validates it, and a closing brace is not a sentence.
        if text.hasPrefix("{") || text.hasPrefix("[{") || text.hasPrefix("[\"") { return false }
        if endsInTerminator(text) { return true }
        if unbalanced(text) { return false }
        if ",;:-\u{2013}\u{2014}/&(".contains(lastChar) { return false }
        // A quote, bracket, emphasis mark, emoji or a list item: complete unless the words themselves stop on a connective.
        let tail = trailingWord(of: stripDecoration(text))
        if isListItem(lastLine(of: text)), listItemLooksCut(text, tail: tail) { return false }
        let decorated = lastChar != lastWordCharacter(of: text) || isListItem(lastLine(of: text))
        guard decorated else { return false }
        return !dangling.contains(tail.lowercased()) && !tail.isEmpty
    }

    /// Ends in . ! ? or an ellipsis, ignoring trailing quotes, brackets, emphasis marks, emoji and spaces.
    private static func endsInTerminator(_ text: String) -> Bool {
        guard let core = stripDecoration(text).last else { return false }
        return terminators.contains(core)
    }

    private static func stripDecoration(_ text: String) -> String {
        var scalars = Array(text.unicodeScalars)
        while let last = scalars.last, isDecoration(last) { scalars.removeLast() }
        var view = String.UnicodeScalarView(); view.append(contentsOf: scalars)
        return String(view)
    }

    private static func isDecoration(_ s: Unicode.Scalar) -> Bool {
        s.properties.isWhitespace || closers.contains(Character(s)) || isEmojiPart(s)
    }

    private static func isEmojiPart(_ s: Unicode.Scalar) -> Bool {
        s.value == 0xFE0F || s.value == 0x200D || (s.value > 0x2000 && s.properties.isEmoji)
            || (0x1F3FB...0x1F3FF).contains(s.value)
    }

    /// An odd number of straight quotes, or more openers than closers.
    private static func unbalanced(_ text: String) -> Bool {
        func count(_ c: Character) -> Int { text.reduce(0) { $0 + ($1 == c ? 1 : 0) } }
        if count("\"") % 2 != 0 { return true }
        if count("\u{201C}") != count("\u{201D}") { return true }
        if count("(") > count(")") || count("[") > count("]") || count("{") > count("}") { return true }
        // an unclosed code span or bold run
        return text.components(separatedBy: "`").count % 2 == 0 || text.components(separatedBy: "**").count % 2 == 0
    }

    private static func lastLine(of text: String) -> String {
        text.split(separator: "\n", omittingEmptySubsequences: true).last.map(String.init) ?? text
    }

    /// A final list item with no terminator is cut when the items above it end
    /// in full stops and this one does not (a cut-off item in a punctuated
    /// list). Mid-word cuts cannot be told from jargon without a dictionary,
    /// which is not safe off the main thread, so they are not checked. A
    /// complete short item ("- call the dentist") passes.
    private static func listItemLooksCut(_ text: String, tail: String) -> Bool {
        let lines = text.split(separator: "\n", omittingEmptySubsequences: true).map(String.init)
        let earlier = lines.dropLast().filter { isListItem($0) }
        if !earlier.isEmpty, earlier.allSatisfy({ endsInTerminator($0.trimmingCharacters(in: .whitespacesAndNewlines)) }) {
            return true
        }
        return false
    }

    /// "- item", "* item", "\u{2022} item", "3. item", "2) item".
    static func isListItem(_ line: String) -> Bool {
        line.trimmingCharacters(in: .whitespaces)
            .range(of: #"^(?:[-*\u{2022}\u{2013}]|\d{1,2}[.)])\s+\S"#, options: .regularExpression) != nil
    }

    private static func trailingWord(of text: String) -> String {
        let word = text.split(whereSeparator: { $0.isWhitespace }).last.map(String.init) ?? ""
        return word.trimmingCharacters(in: .punctuationCharacters.union(.symbols))
    }

    private static func lastWordCharacter(of text: String) -> Character? {
        stripDecoration(text).last
    }
}
