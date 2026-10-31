import Foundation

/// How a voice turn began. The gate's first question is not what was said but
/// what opened the microphone: a key press, the typed composer and his name are
/// explicit; everything else opened on its own.
enum VoiceTurnOpening: Equatable {
    /// The wake word ("Orion"). Voice ID has already had its say.
    case wake
    case pushToTalk
    case typed
    /// The ear reopened by itself after ORION finished speaking.
    /// `afterQuestion` is true when that reply asked him something.
    case followUp(afterQuestion: Bool)
    /// Confident speech heard while ORION was thinking or speaking.
    case bargeIn

    var isExplicit: Bool {
        switch self {
        case .wake, .pushToTalk, .typed: return true
        case .followUp, .bargeIn: return false
        }
    }
}

struct AddressDecision: Equatable {
    let addressed: Bool
    let reason: String
    /// Admitted only because it was short — a reply-shaped line with no
    /// command in it. Two of those in a row is how a rehearsal chains, so the
    /// caller counts them (`weakAdmitsInARow`).
    let isWeak: Bool
}

/// "Was that said to ORION?" — deterministic, local, and free.
///
/// History, because this is the second gate. The first (2026-10-07) asked a
/// local qwen model and was removed on 2026-10-08 for dropping five real
/// follow-ups in one morning. With nothing in its place, every turn that
/// opened without his name went straight to the brain, and on 2026-10-25/26
/// one wake word was followed by 17 turns of room chatter (three of them
/// saved as memories) and 36 turns of a rehearsed presentation (30 x "Not
/// done: 6:00 AM–6:00 AM is shorter than 5 minutes"). Every one of those was
/// opened by a barge-in during `.thinking`: speech paused the turn, a new
/// listening turn opened, its text was sent, and the next sentence paused
/// THAT turn. A chain with no address check anywhere on it.
///
/// This gate is deliberately asymmetric rather than clever:
///   * the key and the composer are never second-guessed; the wake word (a
///     detector that fires on television) must not be followed by overheard
///     speech — see `classifyWake`;
///   * half a sentence with no command in it is never sent;
///   * his name anywhere always gets through;
///   * a barge-in must carry a command — an interruption with nothing to do
///     is somebody else's conversation;
///   * a follow-up window also takes short replies and answers to a question
///     ORION just asked, because that is what the 2026-10-08 gate got wrong.
/// The fixtures in `VoiceAddressGateTests` are the R2 transcripts on both sides.
enum AddressGate {

    static func classify(_ heard: String, opening: VoiceTurnOpening, weakAdmitsInARow: Int = 0) -> AddressDecision {
        if opening == .pushToTalk || opening == .typed { return .init(addressed: true, reason: "explicit", isWeak: false) }
        let text = normalized(heard)
        if mentionsName(text) { return .init(addressed: true, reason: "name", isWeak: false) }
        let words = AddressLexicon.words(text)
        if opening == .wake { return classifyWake(heard, text: text, words: words) }
        if isChatter(text, words: words) { return .init(addressed: false, reason: "room chatter", isWeak: false) }
        if hasCommandCue(text, wordCount: words.count) { return .init(addressed: true, reason: "command", isWeak: false) }
        if isShortInterruption(words) { return .init(addressed: true, reason: "interruption", isWeak: false) }
        if endsMidClause(words) { return .init(addressed: false, reason: "trailing fragment", isWeak: false) }
        guard case .followUp(let afterQuestion) = opening else {
            return .init(addressed: false, reason: "interruption with no command", isWeak: false)
        }
        if afterQuestion, isAnswer(words) { return .init(addressed: true, reason: "answer", isWeak: false) }
        if (2...AddressLexicon.shortReplyWords).contains(words.count) {
            guard weakAdmitsInARow < 1 else { return .init(addressed: false, reason: "second short line in a row", isWeak: true) }
            return .init(addressed: true, reason: "short reply", isWeak: true)
        }
        return .init(addressed: false, reason: "no address cue", isWeak: false)
    }

    /// 2026-10-31 (build 1052): the wake word fired twice on a body-cam video
    /// (voice ID failed open once and accepted the video at 0.459 once), and
    /// both fragments reached the gateway because a wake opening used to be
    /// explicit. The wake word is a detector, not a key: what follows it still
    /// has to read like something said to ORION. A request always does; so does
    /// any whole line he could have said. Overheard speech joins mid-sentence
    /// or trails off, and that is all this refuses.
    static func classifyWake(_ heard: String, text: String, words: [String]) -> AddressDecision {
        if hasCommandCue(text, wordCount: words.count) { return .init(addressed: true, reason: "command", isWeak: false) }
        if isShortInterruption(words) { return .init(addressed: true, reason: "interruption", isWeak: false) }
        if looksOverheard(heard) { return .init(addressed: false, reason: "overheard after a wake", isWeak: false) }
        return .init(addressed: true, reason: "wake", isWeak: false)
    }

    // MARK: Signals

    /// Ends on a word no sentence ends on ("and then", "…with the"): half a
    /// sentence, whoever said it.
    static func endsMidClause(_ words: [String]) -> Bool {
        guard let last = words.last else { return false }
        if AdaptiveEndpointModel.trailingConjunctions.contains(last) { return true }
        // "…and somebody": a new clause's subject, with nothing after it.
        guard ["somebody", "someone"].contains(last), words.count >= 2 else { return false }
        return ["and", "but", "so", "when", "then", "if", "because"].contains(words[words.count - 2])
    }

    /// Speech the microphone caught partway through. Deepgram punctuates and
    /// capitalises what it hears, so in a punctuated line a lowercase first
    /// letter means it joined someone mid-sentence ("views with clicking
    /// conversation rates shown on the slides."; a question is exempt), and a
    /// missing full stop means they were still going ("…and somebody").
    /// Apple's on-device ear does neither, so for an unpunctuated line only the
    /// trailing word counts.
    static func looksOverheard(_ heard: String) -> Bool {
        let raw = normalizedKeepingCase(heard)
        if endsMidClause(AddressLexicon.words(raw)) { return true }
        let punctuated = raw.contains { ".,?!…".contains($0) }
        guard punctuated else { return false }
        if !AdaptiveEndpointModel.hasTerminalPunctuation(raw) { return true }
        // A whole question after his name is for ORION however it was cased.
        if raw.hasSuffix("?") { return false }
        guard let first = raw.first(where: { $0.isLetter }) else { return false }
        return first.isLowercase
    }

    /// `normalized` without the lowercasing.
    private static func normalizedKeepingCase(_ text: String) -> String {
        let value = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard value.lowercased().hasPrefix("(continuing"), let close = value.firstIndex(of: ")") else { return value }
        return String(value[value.index(after: close)...]).trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// Lowercased, curly quotes straightened, and the app's own
    /// "(Continuing — …)" prefix removed: that sentence is ORION's, not his.
    static func normalized(_ text: String) -> String {
        var value = text.lowercased()
            .replacingOccurrences(of: "\u{2019}", with: "'")
            .replacingOccurrences(of: "\u{2018}", with: "'")
        if value.hasPrefix("(continuing"), let close = value.firstIndex(of: ")") {
            value = String(value[value.index(after: close)...])
        }
        return value.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    static func mentionsName(_ text: String) -> Bool {
        AddressLexicon.words(text).contains { AddressLexicon.nameForms.contains($0) }
    }

    /// Two people talking: Deepgram's interruption dash, or the words he uses
    /// with friends and never with ORION.
    static func isChatter(_ text: String, words: [String]) -> Bool {
        if text.contains(" -- ") || text.hasSuffix("--") || text.hasPrefix("--") { return true }
        return words.contains { AddressLexicon.chatterWords.contains($0) }
    }

    /// A sentence that starts the way a request to ORION starts. Only the first
    /// two sentences are read in a long utterance, because a monologue will
    /// eventually start a sentence with almost any verb.
    static func hasCommandCue(_ text: String, wordCount: Int) -> Bool {
        let sentences = AddressLexicon.sentences(text)
        let considered = wordCount <= AddressLexicon.readAllSentencesUpTo ? sentences : Array(sentences.prefix(2))
        return considered.contains { sentenceIsRequest($0) }
    }

    static func sentenceIsRequest(_ sentence: String) -> Bool {
        let words = AddressLexicon.strippingLeadingFillers(AddressLexicon.words(sentence))
        guard let head = words.first else { return false }
        let rest = Array(words.dropFirst())
        if AddressLexicon.requestOpeners.contains(where: { opener in words.starts(with: opener) }) { return true }
        if head == "let's" || head == "lets" { return rest.first.map(AddressLexicon.commandVerbs.contains) ?? false }
        if head == "turn" { return rest.first.map { ["on", "off", "up", "down"].contains($0) } ?? false }
        if head == "tell" || head == "give" { return rest.first == "me" }
        if AddressLexicon.commandVerbs.contains(head) { return true }
        if AddressLexicon.questionWords.contains(head) {
            return words.contains { AddressLexicon.personalAnchors.contains($0) }
        }
        return false
    }

    /// "Stop", "wait, stop", "never mind" — four words or fewer.
    static func isShortInterruption(_ words: [String]) -> Bool {
        guard (1...4).contains(words.count) else { return false }
        let joined = words.joined(separator: " ")
        return AddressLexicon.interruptions.contains { joined.contains($0) }
    }

    /// Something that answers a question: a yes/no word on its own, or a
    /// reply of reasonable length.
    static func isAnswer(_ words: [String]) -> Bool {
        if words.count == 1 { return AddressLexicon.yesNo.contains(words[0]) }
        return (2...AddressLexicon.answerWords).contains(words.count)
    }
}
