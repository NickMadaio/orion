import Foundation

/// The word lists `AddressGate` reads. Kept apart from the decision so a new
/// word is a one-line change that the R2 fixtures then check on both sides.
///
/// Every list is curated against what Nick actually says to ORION (and what
/// he says to everyone else). A verb belongs here only if a sentence that
/// STARTS with it is almost always a request: "turn" is not ("Turn customers,
/// eight thousand pounds…" was a rehearsal line), so it only counts before
/// on/off/up/down; "wait" is not ("Wait. Let me see." was room chatter), so it
/// only counts in a short interruption.
enum AddressLexicon {
    static let shortReplyWords = 12
    static let answerWords = 30
    /// Up to this many words, every sentence is checked for a request.
    static let readAllSentencesUpTo = 25

    /// What Deepgram makes of his name.
    static let nameForms: Set<String> = ["orion", "orien", "oryan", "o'ryan", "orian", "oreon"]

    static let chatterWords: Set<String> = ["bro", "bruh", "dude", "bro's"]

    static let fillers: Set<String> = [
        "ok", "okay", "so", "and", "actually", "also", "please", "just", "hey", "yo", "um", "uh", "erm",
        "alright", "oh", "then", "now", "yes", "yeah", "yep", "no", "nope", "sure", "right", "cool", "fine",
        "but", "well", "wait", "hmm", "pissing",
    ]

    static let commandVerbs: Set<String> = [
        "put", "move", "push", "pull", "add", "schedule", "reschedule", "resched", "book", "block", "cancel",
        "delete", "remove", "clear", "set", "change", "make", "create", "start", "stop", "end", "pause", "resume",
        "continue", "remind", "remember", "note", "log", "mark", "save", "show", "open", "close", "play", "read",
        "call", "text", "message", "send", "email", "mute", "unmute", "skip", "snooze", "replan", "redo", "undo",
        "swap", "shift", "extend", "shorten", "leave", "keep", "drop", "plan", "fit", "check", "find", "look",
        "unblock", "launch", "quit", "hide", "lower", "raise",
    ]

    /// Multi-word openers, matched against the start of a sentence after fillers.
    static let requestOpeners: [[String]] = [
        ["can", "you"], ["could", "you"], ["would", "you"], ["will", "you"], ["can", "u"], ["could", "u"],
        ["i", "want", "you"], ["i", "need", "you"], ["i'd", "like", "you"], ["should", "i"], ["do", "i", "have"],
        ["am", "i"], ["is", "there"], ["what's", "on"], ["what's", "my"], ["what's", "next"], ["what's", "the"],
        ["what", "time"], ["how", "long"], ["how", "much"], ["how", "many"], ["never", "mind"], ["nvm"],
        ["thank", "you", "orion"],
    ]

    static let questionWords: Set<String> = ["what", "what's", "when", "when's", "where", "where's", "how", "which"]

    /// A question with one of these in it is about his day, not about the room.
    static let personalAnchors: Set<String> = [
        "my", "today", "tomorrow", "tonight", "weather", "calendar", "schedule", "alarm", "class", "next", "due",
        "deadline", "plan", "gym",
    ]

    static let interruptions = ["stop", "wait", "hold on", "never mind", "nevermind", "nvm", "cancel", "shush", "quiet", "enough"]

    static let yesNo: Set<String> = ["yes", "yeah", "yep", "yup", "no", "nope", "nah", "sure", "ok", "okay", "correct", "right"]

    // MARK: Tokens

    static func words(_ text: String) -> [String] {
        text.lowercased()
            .split { !($0.isLetter || $0.isNumber || $0 == "'") }
            .map(String.init)
            .filter { !$0.isEmpty && $0 != "'" }
    }

    static func sentences(_ text: String) -> [String] {
        text.split { ".?!…;".contains($0) }
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
    }

    static func strippingLeadingFillers(_ words: [String]) -> [String] {
        Array(words.drop { fillers.contains($0) })
    }
}
