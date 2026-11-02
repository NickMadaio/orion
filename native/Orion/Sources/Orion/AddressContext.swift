import Foundation

/// What the words say about WHO a line was said to, beyond `AddressGate`'s
/// "does it read like a request". Used only for speech that arrived without
/// his name (follow-up window, barge-in) — see `FollowUpAddressGate`.
enum AddressContext {

    // MARK: Someone else is being spoken to

    /// "Did you see that, Sam?", "Sam, come look", "are you guys ready",
    /// "that's crazy, man." — the name (or "the room") of whoever the line was
    /// said to, when it was plainly not ORION. Deepgram capitalises names, so a
    /// capitalised word set off by a comma at either end is a vocative; a
    /// lowercase one counts only for the handful of words that address people.
    static func otherAddressee(_ heard: String) -> String? {
        let raw = heard.trimmingCharacters(in: .whitespacesAndNewlines)
        let words = AddressLexicon.words(raw)
        let joined = " " + words.joined(separator: " ") + " "
        if groupAddress.contains(where: { joined.contains(" \($0) ") }) { return "the room" }
        guard words.count >= 2 else { return nil }
        if let word = trailingVocative(raw), isAddressee(word) { return word }
        if let word = leadingVocative(raw), isAddressee(word) { return word }
        return nil
    }

    private static func trailingVocative(_ raw: String) -> String? {
        firstCapture(#",\s*([A-Za-z][A-Za-z']*)\s*[.?!…]*\s*$"#, in: raw)
    }

    private static func leadingVocative(_ raw: String) -> String? {
        firstCapture(#"^(?:(?:hey|yo|oh)\s+)?([A-Za-z][A-Za-z']*)\s*,"#, in: raw)
    }

    private static func isAddressee(_ word: String) -> Bool {
        let lower = word.lowercased()
        if AddressLexicon.nameForms.contains(lower) { return false }
        if peopleWords.contains(lower) { return true }
        guard word.first?.isUppercase == true else { return false }
        return !notNames.contains(lower) && !AddressLexicon.fillers.contains(lower)
            && !AddressLexicon.selfAddressStarts.contains(lower) && !AddressLexicon.commandVerbs.contains(lower)
    }

    private static func firstCapture(_ pattern: String, in text: String) -> String? {
        guard let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]),
              let match = regex.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)),
              match.numberOfRanges > 1, let range = Range(match.range(at: 1), in: text) else { return nil }
        return String(text[range])
    }

    /// Lowercase words that only ever address a person in the room.
    static let peopleWords: Set<String> = ["man", "guys", "bro", "dude", "babe", "mom", "dad", "mate", "sir", "girl", "bud"]

    /// Phrases spoken to more than one person — never to ORION.
    static let groupAddress = ["you guys", "y'all", "yall", "you two", "you all", "both of you"]

    /// Capitalised words that sit next to a comma but are not names.
    static let notNames: Set<String> = [
        "please", "thanks", "too", "now", "then", "though", "again", "anyway", "maybe", "today", "tomorrow", "tonight",
        "later", "first", "instead", "either", "honestly", "seriously", "basically", "look", "listen", "anyways",
        "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday", "nick", "i", "otherwise",
        "afterwards", "after", "before", "morning", "evening", "what", "why", "how", "when", "where",
    ]

    // MARK: Pointing at the room

    /// "look at this", "check this out", "come here": a request, but about
    /// something in the room ORION cannot see — said to whoever is next to him.
    static func isDeicticAside(_ heard: String) -> Bool {
        let words = AddressLexicon.strippingLeadingFillers(AddressLexicon.words(heard))
        return deicticOpeners.contains { words.starts(with: $0) }
    }

    static let deicticOpeners: [[String]] = [
        ["look", "at", "this"], ["look", "at", "that"], ["look", "at", "him"], ["look", "at", "her"],
        ["check", "this", "out"], ["check", "that", "out"], ["check", "it", "out"], ["watch", "this"],
        ["see", "this"], ["come", "here"], ["come", "look"], ["come", "see"], ["look", "look"],
    ]

    // MARK: Following on from ORION

    /// The line carries on from what ORION just said: it shares a content word
    /// with it, opens with an acknowledgement, or — after a question — opens
    /// with a yes or a no.
    static func relates(_ heard: String, to orionLast: String, afterQuestion: Bool) -> Bool {
        let words = AddressLexicon.words(AddressGate.normalized(heard))
        guard !words.isEmpty, !orionLast.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return false }
        let leading = words.drop { ["um", "uh", "oh", "ok", "okay", "alright", "hmm"].contains($0) }
        if acknowledgements.contains(where: { leading.starts(with: $0) }) { return true }
        if afterQuestion, let first = leading.first, AddressLexicon.yesNo.contains(first) { return true }
        let theirs = contentWords(AddressLexicon.words(orionLast))
        return !contentWords(words).isDisjoint(with: theirs)
    }

    static func contentWords(_ words: [String]) -> Set<String> {
        Set(words.filter { $0.count >= 3 && !overlapStopwords.contains($0) && !$0.allSatisfy(\.isNumber) })
    }

    static let acknowledgements: [[String]] = [
        ["thanks"], ["thank", "you"], ["perfect"], ["sounds", "good"], ["sounds", "great"], ["that", "works"],
        ["do", "it"], ["do", "that"], ["go", "ahead"], ["got", "it"], ["nice"], ["great"], ["awesome"],
        ["that's", "fine"], ["that's", "good"], ["that's", "perfect"], ["sweet"], ["bet"],
    ]

    /// Too common to say two lines are about the same thing.
    static let overlapStopwords: Set<String> = [
        "the", "and", "you", "your", "you're", "that", "this", "with", "for", "but", "not", "are", "was", "were",
        "have", "has", "had", "what", "what's", "just", "like", "know", "think", "going", "gonna", "about", "there",
        "then", "they", "them", "will", "would", "could", "should", "can", "want", "need", "get", "got", "now",
        "all", "any", "out", "too", "yes", "yeah", "okay", "sure", "it's", "i'm", "don't", "did", "does", "its",
        "one", "how", "who", "why", "when", "where", "let", "let's", "here", "his", "her", "him", "she", "our",
        "from", "into", "some", "done", "mean", "kind", "really", "also", "back", "well", "still", "say", "see",
    ]
}
