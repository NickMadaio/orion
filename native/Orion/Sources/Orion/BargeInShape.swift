import Foundation

/// Is the line a whole request: one that asks for something and does not stop partway through?
///
/// 2026-11-02 23:56: "What time is Fuck" (a cut question with an expletive after it, on an unsure voice
/// 0.31/0.43) passed the barge-in gate on "a request" alone, because "what time" opens a request. A barge-in that is
/// not clearly his voice now has to be a whole request: a request opener, and no dangling last word once trailing
/// fillers and expletives are set aside.
enum RequestShape {
    /// Words a request never ends on. "that", "this" and "it" are left out: "cancel that" and "what time is it" are whole.
    static let danglers: Set<String> = AddressLexicon.hardTrailers.union([
        "to", "for", "with", "of", "at", "in", "on", "from", "by", "about", "into", "is", "are", "was", "were", "be",
    ])
    /// Said after a sentence has already broken off, never the end of one.
    static let junkTail: Set<String> = [
        "fuck", "fucking", "shit", "damn", "dammit", "crap", "ugh", "um", "uh", "erm", "hmm", "oh", "like", "man", "bro",
    ]

    static func isWhole(_ text: String) -> Bool {
        let words = AddressLexicon.words(AddressGate.normalized(text))
        guard !words.isEmpty else { return false }
        if AddressGate.isShortInterruption(words) { return true }
        guard AddressGate.hasCommandCue(AddressGate.normalized(text), wordCount: words.count) else { return false }
        let core = Array(words.reversed().drop { junkTail.contains($0) }.reversed())
        guard let last = core.last else { return false }
        return !danglers.contains(last)
    }
}

/// "Still working Timmy, utilize. Orion, what time is": room words (here ORION's own "Still working on it." cue
/// coming back through the microphone) in front of his name. What he said to ORION starts at his name.
enum NameTrim {
    /// Openers that belong with the name ("hey orion …").
    private static let greetings: Set<String> = ["hey", "ok", "okay", "yo", "hi", "oi"]
    /// After the name, at least this many words, or the name was the end of his own request ("… lights off orion").
    static let minimumAfterName = 2

    /// The line from his name on, or the line unchanged when the words before the name are his own request or
    /// only a greeting, or the name ends the line.
    static func fromName(_ text: String) -> String {
        let tokens = wordRanges(text)
        guard let index = tokens.firstIndex(where: { AddressLexicon.nameForms.contains($0.word) }), index > 0 else { return text }
        let before = tokens[..<index].map(\.word)
        if before.allSatisfy(greetings.contains) { return text }
        guard tokens.count - index - 1 >= minimumAfterName else { return text }
        let prefix = String(text[..<tokens[index].range.lowerBound])
        if AddressGate.hasCommandCue(AddressGate.normalized(prefix), wordCount: before.count) { return text }
        return String(text[tokens[index].range.lowerBound...]).trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func wordRanges(_ text: String) -> [(word: String, range: Range<String.Index>)] {
        var result: [(String, Range<String.Index>)] = []
        var start: String.Index?
        var index = text.startIndex
        func close(at end: String.Index) {
            guard let begin = start else { return }
            let word = text[begin..<end].lowercased().replacingOccurrences(of: "\u{2019}", with: "'")
            if word != "'" { result.append((word, begin..<end)) }
            start = nil
        }
        while index < text.endIndex {
            let char = text[index]
            if char.isLetter || char.isNumber || char == "'" || char == "\u{2019}" {
                if start == nil { start = index }
            } else {
                close(at: index)
            }
            index = text.index(after: index)
        }
        close(at: text.endIndex)
        return result
    }
}
