import Foundation

/// What voice ID made of the utterance. Two halves are scored when the
/// utterance is long enough, because one half Nick and one half not is how
/// "other voices are present" shows up.
enum SpeakerEvidence: Equatable {
    case unknown(String)
    case scored(Double)
    case split(first: Double, last: Double)

    init(_ result: VerificationResult) {
        switch result {
        case .match(let score): self = .scored(score)
        case .reject(let score, _): self = .scored(score)
        case .cannotVerify(let reason): self = .unknown(reason)
        }
    }

    /// Two halves scored separately; a half that could not be scored (too short,
    /// daemon hiccup) leaves the other half's score standing alone.
    static func combine(_ first: SpeakerEvidence, _ last: SpeakerEvidence) -> SpeakerEvidence {
        switch (first, last) {
        case (.scored(let a), .scored(let b)): return .split(first: a, last: b)
        case (.scored, _): return first
        case (_, .scored): return last
        default: return first
        }
    }

    var bestScore: Double? {
        switch self {
        case .unknown: return nil
        case .scored(let score): return score
        case .split(let first, let last): return max(first, last)
        }
    }
}

enum SpeakerRead: String, Equatable {
    case nick, notNick, mixed, uncertain, unknown
}

/// Everything known about one utterance that arrived without his name.
struct AddressSignals: Equatable {
    var text: String
    var opening: VoiceTurnOpening
    var weakAdmitsInARow = 0
    var speaker: SpeakerEvidence = .unknown("not checked")
    /// Utterance speech level minus his usual turn level, in dB. nil until the
    /// baseline has a few of his turns.
    var levelDeltaDB: Double?
    /// Seconds from the follow-up window opening to his first word.
    var onsetSeconds: TimeInterval?
    /// What ORION said last.
    var orionLast: String = ""
    /// Pieces of the utterance dropped before this decision because they were another voice
    /// (`SegmentSpeakerFilter`); `text` is what was left. Logged, never sent.
    var dropped: [DroppedSegment] = []
}

struct AddressVerdict: Equatable {
    enum Outcome: String, Equatable { case addressed, notAddressed, borderline }
    let outcome: Outcome
    let score: Int
    let reasons: [String]
    /// The text gate admitted it on length alone (the chain guard counts these).
    let isWeak: Bool
    let speakerRead: SpeakerRead
    let signals: AddressSignals
    /// What goes to ORION when admitted: the line, or the part of it from his name on (`NameTrim`).
    let sendText: String
}

/// "Was that said to ORION?" for follow-up and barge-in speech.
///
/// 2026-11-02, Nick: "he doesn't always know the difference between
/// conversation to him vs background talking". `AddressGate` reads only the
/// words, and in the follow-up window it admits any 2–12 word line once and any
/// 30-word line after a question. Room talk, the TV and Nick talking to someone
/// else are mostly short lines, so they got through.
///
/// This keeps `AddressGate` as the first word (its refusals all stand, and the
/// wake word, key and composer are passed through untouched) and adds four
/// cheap, local signals on top:
///   * vetoes — a voice that is clearly not his, two voices at once, far-field
///     speech, a line said to someone by name, pointing at the room;
///   * a small score — his voice +1, unsure voice −1, quieter than his turns −1,
///     speaking right after ORION +1, late in the window −1, following on from
///     ORION's last turn +1, and (for a line admitted only on length) not
///     following on −2;
///   * a request starts at +2, a length-only line at 0;
///   * ≥ 1 is addressed, < 0 is not, 0 is borderline (the local model may
///     admit it; it fails closed).
/// His name always gets through, as it always has.
enum FollowUpAddressGate {

    /// Voice ID: the app's own match floor, and below this a clear "not him".
    /// Measured on 2026-10-19..11-02 wakes: his 0.45–0.76, the TV 0.27–0.45.
    static let nickScore = 0.45
    static let notNickScore = 0.40
    /// dB under his usual level.
    static let farFieldDB = -12.0
    static let quieterDB = -6.0

    static let strongReasons: Set<String> = ["command", "interruption"]

    /// A barge-in reads a split more strictly: part of it clearly not him, and no part clearly him, is not him
    /// (2026-11-02 23:56, 0.31/0.43 on "What time is Fuck").
    static func read(_ evidence: SpeakerEvidence, opening: VoiceTurnOpening) -> SpeakerRead {
        let general = read(evidence)
        guard opening == .bargeIn, general == .uncertain, case .split(let first, let last) = evidence else { return general }
        return min(first, last) < notNickScore ? .notNick : general
    }

    static func read(_ evidence: SpeakerEvidence) -> SpeakerRead {
        switch evidence {
        case .unknown: return .unknown
        case .scored(let score): return band(score)
        case .split(let first, let last):
            let bands = [band(first), band(last)]
            if bands.allSatisfy({ $0 == .nick }) { return .nick }
            if bands.allSatisfy({ $0 == .notNick }) { return .notNick }
            if bands.contains(.nick) && bands.contains(.notNick) { return .mixed }
            return .uncertain
        }
    }

    private static func band(_ score: Double) -> SpeakerRead {
        score >= nickScore ? .nick : (score < notNickScore ? .notNick : .uncertain)
    }

    static func decide(_ signals: AddressSignals) -> AddressVerdict {
        let base = AddressGate.classify(signals.text, opening: signals.opening, weakAdmitsInARow: signals.weakAdmitsInARow)
        let speaker = read(signals.speaker, opening: signals.opening)
        func verdict(_ outcome: AddressVerdict.Outcome, _ score: Int, _ reasons: [String],
                     send: String? = nil) -> AddressVerdict {
            AddressVerdict(outcome: outcome, score: score, reasons: reasons, isWeak: base.isWeak,
                           speakerRead: speaker, signals: signals, sendText: send ?? signals.text)
        }
        let textReason = "text: \(base.reason)"
        guard !signals.opening.isExplicit, signals.opening != .wake else {
            return verdict(base.addressed ? .addressed : .notAddressed, 0, [textReason])
        }
        guard base.addressed else { return verdict(.notAddressed, 0, [textReason]) }
        if base.reason == "name" { return nameVerdict(signals, speaker: speaker, textReason: textReason, verdict: verdict) }
        if let veto = veto(signals, speaker: speaker) { return verdict(.notAddressed, 0, [textReason, veto]) }
        // A barge-in is at least as strict as a follow-up: without his voice it has to be a whole request.
        if signals.opening == .bargeIn, speaker != .nick, !RequestShape.isWhole(signals.text) {
            return verdict(.notAddressed, 0, [textReason, "barge-in without his voice (\(scoreText(signals.speaker))) and not a whole request"])
        }
        let (score, reasons) = tally(signals, speaker: speaker, baseReason: base.reason)
        let outcome: AddressVerdict.Outcome = score >= 1 ? .addressed : (score < 0 ? .notAddressed : .borderline)
        return verdict(outcome, score, [textReason] + reasons)
    }

    /// His name gets through, from the name on. On a barge-in a voice that is clearly not his does not (the room says
    /// "Orion" too); the follow-up window keeps the old rule.
    private static func nameVerdict(_ signals: AddressSignals, speaker: SpeakerRead, textReason: String,
                                    verdict: (AddressVerdict.Outcome, Int, [String], String?) -> AddressVerdict) -> AddressVerdict {
        if signals.opening == .bargeIn, speaker == .notNick {
            return verdict(.notAddressed, 0, [textReason, "barge-in voice is not Nick (\(scoreText(signals.speaker)))"], nil)
        }
        let kept = NameTrim.fromName(signals.text)
        let reasons = kept == signals.text ? [textReason] : [textReason, "room words before his name dropped"]
        return verdict(.addressed, 0, reasons, kept)
    }

    /// Any one of these alone means it was not said to ORION.
    private static func veto(_ signals: AddressSignals, speaker: SpeakerRead) -> String? {
        if speaker == .notNick { return "voice is not Nick (\(scoreText(signals.speaker)))" }
        if speaker == .mixed { return "other voices in the utterance (\(scoreText(signals.speaker)))" }
        if let delta = signals.levelDeltaDB, delta <= farFieldDB { return String(format: "far-field (%.0f dB)", delta) }
        if let who = AddressContext.otherAddressee(signals.text) { return "said to \(who)" }
        if AddressContext.isDeicticAside(signals.text),
           !AddressContext.relates(signals.text, to: signals.orionLast, afterQuestion: false) {
            return "pointing at something in the room"
        }
        return nil
    }

    private static func tally(_ signals: AddressSignals, speaker: SpeakerRead, baseReason: String) -> (Int, [String]) {
        var parts: [(Int, String)] = []
        let strong = strongReasons.contains(baseReason)
        parts.append((strong ? 2 : 0, strong ? "a request" : "admitted on length only"))
        switch speaker {
        case .nick: parts.append((1, "voice is Nick (\(scoreText(signals.speaker)))"))
        case .uncertain: parts.append((-1, "voice unsure (\(scoreText(signals.speaker)))"))
        case .unknown, .notNick, .mixed: break
        }
        if let delta = signals.levelDeltaDB, delta <= quieterDB {
            parts.append((-1, String(format: "quieter than his turns (%.0f dB)", delta)))
        }
        if case .followUp = signals.opening {
            switch FollowUpTiming.band(onset: signals.onsetSeconds) {
            case .quick: parts.append((1, String(format: "right after ORION (%.1fs)", signals.onsetSeconds ?? 0)))
            case .late: parts.append((-1, String(format: "late in the window (%.1fs)", signals.onsetSeconds ?? 0)))
            case .neutral: break
            }
        }
        if let follows = followsOn(signals, baseReason: baseReason) {
            parts.append(follows ? (1, "follows ORION's last turn") : (-2, "unrelated to ORION's last turn"))
        }
        return (parts.reduce(0) { $0 + $1.0 }, parts.map(\.1))
    }

    /// true/false when it matters; nil when a request is unrelated (a new
    /// request is allowed to change the subject).
    private static func followsOn(_ signals: AddressSignals, baseReason: String) -> Bool? {
        var afterQuestion = false
        if case .followUp(let asked) = signals.opening { afterQuestion = asked }
        if AddressContext.relates(signals.text, to: signals.orionLast, afterQuestion: afterQuestion) { return true }
        if baseReason == "answer", AddressLexicon.words(signals.text).count <= AddressLexicon.shortReplyWords { return true }
        return strongReasons.contains(baseReason) ? nil : false
    }

    private static func scoreText(_ evidence: SpeakerEvidence) -> String {
        switch evidence {
        case .unknown(let reason): return reason
        case .scored(let score): return String(format: "%.2f", score)
        case .split(let first, let last): return String(format: "%.2f/%.2f", first, last)
        }
    }
}
