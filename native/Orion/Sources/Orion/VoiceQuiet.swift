import Foundation

/// "Don't reply unless I say Orion" / "I'm rehearsing": a window in which only
/// an explicit address opens a turn. Cleared by his name (or the key, or the
/// composer), or by itself after `defaultDuration`.
///
/// Value type, replaced rather than mutated: `started(at:)`, `cleared()`,
/// `after(_:opening:)` each return the next window.
struct QuietWindow: Equatable {
    /// Long enough for a rehearsal or a call, short enough that forgetting to
    /// say his name does not leave ORION deaf to follow-ups for the evening.
    static let defaultDuration: TimeInterval = 45 * 60

    let until: Date?

    static let off = QuietWindow(until: nil)

    func started(at now: Date, duration: TimeInterval = QuietWindow.defaultDuration) -> QuietWindow {
        QuietWindow(until: now.addingTimeInterval(duration))
    }

    func cleared() -> QuietWindow { .off }

    func isActive(at now: Date) -> Bool {
        guard let until else { return false }
        return now < until
    }

    /// While quiet, only an explicit opening or his name in what was said.
    func admits(_ heard: String, opening: VoiceTurnOpening, at now: Date) -> Bool {
        guard isActive(at: now) else { return true }
        return opening.isExplicit || AddressGate.mentionsName(AddressGate.normalized(heard))
    }

    /// The window after a turn: an explicit address clears it, anything else leaves it.
    func after(_ heard: String, opening: VoiceTurnOpening) -> QuietWindow {
        opening.isExplicit || AddressGate.mentionsName(AddressGate.normalized(heard)) ? .off : self
    }

    /// Spoken requests for silence. Read against the whole utterance (not only
    /// its start) because the request is often the tail: "im doing work shush up".
    static func isRequest(_ heard: String) -> Bool {
        let text = " " + AddressLexicon.words(AddressGate.normalized(heard)).joined(separator: " ") + " "
        return requestPhrases.contains { text.contains(" \($0) ") }
    }

    private static let requestPhrases = [
        "don't reply unless", "dont reply unless", "don't respond unless", "dont respond unless",
        "don't answer unless", "dont answer unless", "don't talk unless", "dont talk unless",
        "only reply when", "only reply if", "only respond when", "only respond if", "only answer when", "only answer if",
        "i'm rehearsing", "im rehearsing", "i am rehearsing", "i'm practising", "im practising", "i am practising",
        "i'm practicing", "im practicing", "i am practicing", "i'm presenting", "im presenting", "i am presenting",
        "be quiet", "shush", "shut up", "stop listening", "go quiet", "quiet mode", "not talking to you",
        "i'm on a call", "im on a call",
    ]

    static let acknowledgement = "Okay — I'll stay quiet until you say “Orion”."
}

/// The same failure, about to be said aloud twice inside ten minutes, is said
/// once. 2026-10-26: "Not done: 6:00 AM–6:00 AM is shorter than 5 minutes" was
/// spoken 30 times in 14 minutes. The text still reaches the bubble; only the
/// voice is spared.
struct SpokenFailureMemory: Equatable {
    static let window: TimeInterval = 10 * 60

    private let entries: [Entry]
    private struct Entry: Equatable { let key: String; let at: Date }

    static let empty = SpokenFailureMemory(entries: [])

    var count: Int { entries.count }

    func shouldSuppress(_ text: String, at now: Date) -> Bool {
        guard Self.isFailure(text) else { return false }
        let key = Self.key(text)
        return entries.contains { $0.key == key && now.timeIntervalSince($0.at) < Self.window }
    }

    /// The memory after `text` was spoken at `now` (non-failures are not kept).
    func recording(_ text: String, at now: Date) -> SpokenFailureMemory {
        let live = entries.filter { now.timeIntervalSince($0.at) < Self.window }
        guard Self.isFailure(text) else { return SpokenFailureMemory(entries: live) }
        return SpokenFailureMemory(entries: live + [Entry(key: Self.key(text), at: now)])
    }

    /// A reply that reports something not done, or asks again because it could
    /// not act. Matched on ORION's own fixed phrasings, which is what repeats.
    static func isFailure(_ text: String) -> Bool {
        let lower = text.lowercased().replacingOccurrences(of: "\u{2019}", with: "'")
        return failureMarks.contains { lower.contains($0) }
    }

    private static let failureMarks = [
        "not done", "haven't changed anything", "nothing was started or changed", "connection error",
        "i couldn't", "i can't ", "couldn't be booked", "that doesn't fit", "isn't on your day",
        "what time or how long do you mean", "say it again", "no movable block",
    ]

    /// Times and numbers collapse, so "6:00 AM–6:00 AM" and "6:03 AM–6:03 AM" are one failure.
    static func key(_ text: String) -> String {
        let lower = text.lowercased()
        var key = ""
        var lastWasDigit = false
        for character in lower {
            if character.isNumber {
                if !lastWasDigit { key.append("#") }
                lastWasDigit = true
            } else {
                lastWasDigit = false
                if character.isLetter || character == " " { key.append(character) }
            }
        }
        return key.split(separator: " ").joined(separator: " ")
    }
}
