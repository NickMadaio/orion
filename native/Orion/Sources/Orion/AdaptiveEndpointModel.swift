import Foundation

/*
 Whether the speaker is actually done, decided from several signals instead of
 one silence timer.

 THE FINDING THAT FORCED THIS FILE TO EXIST: Nick raised
 `OrionVoiceEndpointingMs` from 900 to 1400 himself (`defaults write`) and
 Orion still cut him off. A bigger number could not fix it, because for a
 hands-free (wake-word) turn — the case where Orion decides on his own when
 the user is done, which is the case that can cut someone off — the number he
 changed was never consulted at all.

 `AppState.checkHandsFree` decided when to stop listening off a SEPARATE,
 hardcoded 1.3-second hangover (`AppState.handsFreeHangover`) that has no
 connection to `VoiceTuning.endpointingMs`. Deepgram's own server-side
 endpointing only gets consulted through `DeepgramStream.onEndOfSpeech`, and
 that callback is a no-op unless `SpeechInput.awaitingFinal` is already true —
 which for a hands-free turn only becomes true once `checkHandsFree`'s own
 timer decides to call `stop()`. So raising the number Nick could see never
 touched the number that was actually ending his turns. That bug is fixed by
 routing hands-free endpointing through THIS model, seeded from the same
 tunable, instead of a second, disconnected timer — see
 `AppState.startHandsFree` / `checkHandsFree`.

 A fixed timer also cannot tell a comma-pause from "I'm done" — both look like
 silence — so this combines four signals instead of trusting one:

   1. TRANSCRIPT STABILITY. Has the interim actually stopped changing? Fed by
      every transcript update, growing OR SHRINKING. The old hands-free logic
      only reset its clock on a LONGER interim
      (`evidence.count > lastSpeechEvidence.count`), so a self-correction — the
      recognizer revising a phrase down before re-extending it — looked
      identical to silence and could end the turn mid-correction. Here, any
      change at all is evidence the speaker is still talking.
   2. TERMINAL PUNCTUATION. `smart_format`/`punctuate` are already sent
      (`DeepgramConfig.url()`); a transcript ending in `.`/`?`/`!` corroborates
      a real stop. Never the sole trigger — see `hasTerminalPunctuation`.
   3. LAST-WORD CONFIDENCE, when Deepgram supplies it (parsed in
      `DeepgramStream.handleResults`, threaded through `SpeechInput.
      onTranscriptConfidence`). A low-confidence ending extends the window:
      an uncertain ending is exactly the case where cutting in costs the most.
   4. CONTINUATION VOCABULARY. Explicit phrases ("hold on", "wait", "I'm not
      done", "one sec") and a trailing conjunction ("and", "but", "because",
      "so") EXTEND the window rather than ending it — a real linguistic signal
      a fixed timer cannot see at all.

 Nothing here touches audio, a socket, or a clock of its own — every method
 takes `now` as a parameter. `Tests/run-turntaking-test.sh` drives this
 against a clock it owns, the same discipline as `StallWatchdog` and
 `RunProgressModel`.
 */
enum EndpointVerdict: Equatable {
    /// Speech is still arriving, or too little silence has passed to judge.
    case keepListening
    /// Silence has passed the base threshold, but a continuation cue or a
    /// low-confidence ending says wait — the window that now applies is
    /// `requiredSilence`, not the base.
    case extending(requiredSilence: TimeInterval)
    /// The speaker is done. Finalize using whatever text has been noted.
    case finalize
}

struct AdaptiveEndpointModel: Equatable {

    // MARK: Configuration

    /// The base silence window — `VoiceTuning.endpointingSeconds`.
    let baseSilence: TimeInterval
    /// The window once a continuation cue or low confidence has been seen.
    /// Clamped to never be shorter than `baseSilence` at init, so a
    /// misconfigured caller cannot make "extend" resolve FASTER than the
    /// ordinary case — that would turn a safety margin into a trap.
    let extendedSilence: TimeInterval

    /// Below this, a reported utterance-level confidence counts as uncertain
    /// enough to extend rather than finalize. Deepgram's own results carry
    /// values comfortably above this for a clean ending in practice; this
    /// floor is for the case where it does not.
    static let lowConfidenceFloor: Double = 0.55

    // MARK: State

    /// The last moment the transcript actually changed. Silence is measured
    /// from here, never from when listening began.
    private(set) var lastEvidenceAt: Date
    private(set) var lastText: String = ""
    private(set) var sawContinuationCue = false
    private(set) var sawLowConfidence = false

    init(now: Date, baseSilence: TimeInterval, extendedSilence: TimeInterval) {
        self.baseSilence = baseSilence
        self.extendedSilence = max(baseSilence, extendedSilence)
        self.lastEvidenceAt = now
    }

    /// New transcript text arrived — interim or final, growing or shrinking.
    /// ANY change resets the silence clock; only a truly unchanged transcript
    /// counts as silence. `confidence` is whatever the ear supplied for this
    /// result, or nil if it did not.
    mutating func noteTranscript(_ text: String, confidence: Double? = nil, at now: Date) {
        if text != lastText {
            lastEvidenceAt = now
            lastText = text
        }
        sawContinuationCue = AdaptiveEndpointModel.hasContinuationCue(text)
        if let confidence {
            sawLowConfidence = confidence < AdaptiveEndpointModel.lowConfidenceFloor
        }
    }

    /// What to do given the silence observed so far. Pure function of state —
    /// safe to call as often as a caller likes without side effects.
    func verdict(at now: Date) -> EndpointVerdict {
        let silence = now.timeIntervalSince(lastEvidenceAt)
        let needsExtension = sawContinuationCue || sawLowConfidence
        let required = needsExtension ? extendedSilence : baseSilence
        guard silence >= required else {
            return needsExtension ? .extending(requiredSilence: required) : .keepListening
        }
        return .finalize
    }

    /// How much silence counts as "worth pausing to consider", short of
    /// actually deciding anything. Used by `TurnTakingModel` to distinguish
    /// `listening.capturing` from `listening.possiblePause` even in the
    /// ordinary case with no continuation cue at all — the substate that
    /// models "a pause is happening" is not the same moment as the substate
    /// that acts on it.
    static func considerationThreshold(baseSilence: TimeInterval) -> TimeInterval {
        baseSilence * 0.4
    }

    /// Whether the text looks like a real sentence end. Corroborating
    /// evidence only — see the file header; never the sole trigger.
    static func hasTerminalPunctuation(_ text: String) -> Bool {
        guard let last = text.trimmingCharacters(in: .whitespacesAndNewlines).last else { return false }
        return last == "." || last == "?" || last == "!"
    }

    // MARK: Continuation vocabulary

    /// Explicit phrases that mean "I am not finished".
    static let continuationPhrases: [String] = [
        "hold on", "hold up", "wait", "i'm not done", "im not done",
        "one sec", "one second", "hang on", "give me a second", "not finished",
        "not done yet"
    ]
    /// A trailing conjunction is a clause that is obviously reaching for a
    /// second half.
    static let trailingConjunctions: Set<String> = ["and", "but", "because", "so", "or"]

    static func hasContinuationCue(_ text: String) -> Bool {
        let lower = text.lowercased().trimmingCharacters(in: .whitespacesAndNewlines)
        guard !lower.isEmpty else { return false }
        for phrase in continuationPhrases where lower.contains(phrase) { return true }
        let words = lower
            .split(whereSeparator: { !$0.isLetter && $0 != "'" })
            .map(String.init)
        guard let last = words.last else { return false }
        return trailingConjunctions.contains(last)
    }

    // MARK: Combining a preserved partial with what followed it

    /// Joins a transcript that was preserved when endpointing fired early
    /// with whatever was said next, as one sentence rather than two
    /// disconnected ones. This is the highest-value repair in the whole
    /// pass: "he cut me off" used to mean the first half was gone; now it
    /// means the sentence arrived a little late, in one piece.
    static func appendContinuation(_ continuation: String, to preserved: String) -> String {
        let left = preserved.trimmingCharacters(in: .whitespacesAndNewlines)
        let right = continuation.trimmingCharacters(in: .whitespacesAndNewlines)
        if left.isEmpty { return right }
        if right.isEmpty { return left }
        return left + " " + right
    }

    // MARK: "Continue what you were saying"

    static let resumePhrases: Set<String> = [
        "continue", "keep going", "go on", "go ahead", "please continue",
        "what were you saying", "finish that", "finish what you were saying",
        "keep talking", "continue what you were saying"
    ]

    /// True when the text is a request to resume an interrupted reply rather
    /// than a new question.
    static func isResumeRequest(_ text: String) -> Bool {
        let normalized = text
            .lowercased()
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .trimmingCharacters(in: CharacterSet(charactersIn: ".?!"))
        return resumePhrases.contains(normalized)
    }
}
