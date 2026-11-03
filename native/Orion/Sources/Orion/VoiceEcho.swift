import Foundation
import MobileCore

/// w17 (2026-11-03 10:51): ORION's own cues ("Still working on it…", "Let me look.") came back through the mic as
/// "Still working" and "Let me". Two or three words never reach `SelfEcho`'s three-word floor, so each opened a barge-in,
/// paused the turn and sent the real answer to the bubble unspoken. This is the loose, prefix-friendly match for that.
enum CueEcho {
    /// Is what the mic heard a piece of any of ORION's own recent voices (a cue, an update, a reply, its tail)?
    static func isEcho(heard: String, voices: [String]) -> Bool {
        let heardWords = SelfEcho.words(heard)
        guard !heardWords.isEmpty else { return false }
        return voices.contains { voice in
            let said = SelfEcho.words(voice)
            guard !said.isEmpty else { return false }
            // A word he is saying that ORION did not is Nick, never echo.
            guard SelfEcho.interruptions(in: heard, spoken: voice).isEmpty else { return false }
            if heardWords.count == 1 { return heardWords[0].count >= 3 && said.contains(heardWords[0]) }
            if isOrderedPart(heardWords, of: said) { return true }
            return SelfEcho.isEcho(heard: heard, spoken: voice)
        }
    }

    /// Every heard word, in order, somewhere in the spoken words ("let me" of "let me look", "still working" of "still working on it").
    private static func isOrderedPart(_ part: [String], of whole: [String]) -> Bool {
        var next = whole.startIndex
        for word in part {
            guard let found = whole[next...].firstIndex(of: word) else { return false }
            next = whole.index(after: found)
        }
        return true
    }
}

/// A barge-in that stopped ORION's speech (or kept a held answer out of it) and was then refused by the address gate
/// changes nothing: the interrupted words are said again, once.
struct RefusedBargeInRecovery: Equatable {
    private(set) var interrupted: String?

    static let none = RefusedBargeInRecovery(interrupted: nil)

    /// Speech was stopped (or an answer held back) by something that might be Nick.
    func interrupting(_ text: String) -> RefusedBargeInRecovery {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? self : RefusedBargeInRecovery(interrupted: trimmed)
    }

    /// The gate refused the speech: what to say again, once, and the cleared state.
    func refused() -> (resume: String?, next: RefusedBargeInRecovery) { (interrupted, .none) }

    /// The speech was Nick's after all: nothing resumes.
    func admitted() -> RefusedBargeInRecovery { .none }
}

/// Where an answer goes when its turn was paused by speech that the gate then refused (not said to ORION).
enum RefusedAnswerLanding: Equatable {
    case speak
    case bubble

    /// Spoken only when the reply may be spoken and the room is quiet enough: no newer turn running, nothing already being said.
    static func on(allowsSpeech: Bool, idle: Bool) -> RefusedAnswerLanding {
        allowsSpeech && idle ? .speak : .bubble
    }
}
