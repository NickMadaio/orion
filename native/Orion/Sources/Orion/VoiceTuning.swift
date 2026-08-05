import Foundation

/*
 How long Orion waits before deciding you have stopped talking — and how long
 he is allowed to believe he is still talking.

 Two unrelated-looking numbers live together here because they are the two ends
 of the same complaint: "he cuts me off", and "he thinks he is still speaking
 when he isn't". Both are timing, both were compile-time constants, and both
 needed a rebuild — and therefore a re-grant of Accessibility — to change by a
 tenth of a second. That is the wrong cost for a number whose only correct value
 is found by talking to it and adjusting.

 Plain `UserDefaults`, same as `SummonSettings`: preferences, not secrets, and
 `defaults read com.nickmadaio.orion.app` is how `orion-doctor` reads them back.
 `orion_config_get` / `orion_config_set` in the gateway plugin write the same
 keys, which is what lets Orion retune his own ears when told to.
 */

enum VoiceTuning {

    static let endpointingKey = "OrionVoiceEndpointingMs"
    static let utteranceEndKey = "OrionVoiceUtteranceEndMs"
    static let appleGraceKey = "OrionVoiceAppleFinalGrace"
    static let stallKey = "OrionSpeakingStallTimeout"

    // MARK: - Deciding the speaker has stopped

    /// Milliseconds of silence before Deepgram calls the utterance finished.
    ///
    /// Was a hardcoded 300, described in the source as "responsive without
    /// clipping a speaker who pauses to think". It clipped constantly. 300ms is
    /// shorter than the pause an ordinary person leaves between clauses, so any
    /// sentence with a comma in it got cut in half and the half was sent.
    ///
    /// 900ms is past the natural mid-sentence pause and still well inside the
    /// gap that reads as "your turn". The cost of being wrong in this direction
    /// is half a second of latency; the cost of being wrong in the other is a
    /// truncated question and a wrong answer.
    static let endpointingRange: ClosedRange<Int> = 100...4000
    static let defaultEndpointingMs = 900

    static var endpointingMs: Int {
        get { clampedInt(endpointingKey, default: defaultEndpointingMs, range: endpointingRange) }
        set { UserDefaults.standard.set(clamp(newValue, endpointingRange), forKey: endpointingKey) }
    }

    /// Backstop for when endpointing does not fire at all. Deepgram's own floor
    /// is 1000ms and values below it buy nothing.
    ///
    /// Kept comfortably above `endpointingMs` so it stays a backstop rather than
    /// a competing opinion; `resolvedUtteranceEndMs` enforces that at read time.
    static let utteranceEndRange: ClosedRange<Int> = 1000...8000
    static let defaultUtteranceEndMs = 1800

    static var utteranceEndMs: Int {
        get { clampedInt(utteranceEndKey, default: defaultUtteranceEndMs, range: utteranceEndRange) }
        set { UserDefaults.standard.set(clamp(newValue, utteranceEndRange), forKey: utteranceEndKey) }
    }

    /// The backstop, guaranteed to sit behind the primary signal.
    ///
    /// Raising `endpointingMs` past a stale `utteranceEndMs` would otherwise let
    /// the backstop fire first and re-introduce exactly the clipping the raise
    /// was meant to fix — a setting that silently defeats itself.
    static var resolvedUtteranceEndMs: Int {
        max(utteranceEndMs, endpointingMs + 600)
    }

    /// How long the Apple recogniser is given to produce a final result after
    /// the key comes up. Apple has no tunable endpointing, so this is a wait.
    static let appleGraceRange: ClosedRange<Double> = 0.4...4.0
    static let defaultAppleGrace: Double = 1.2

    static var appleFinalGrace: Double {
        get {
            let stored = UserDefaults.standard.double(forKey: appleGraceKey)
            guard stored > 0 else { return defaultAppleGrace }
            return clamp(stored, appleGraceRange)
        }
        set { UserDefaults.standard.set(clamp(newValue, appleGraceRange), forKey: appleGraceKey) }
    }

    // MARK: - Deciding he has stopped

    /// Seconds without any audio progress before a "speaking" phase is presumed
    /// wedged and force-ended.
    ///
    /// This exists because `.speaking` had exactly one exit: `onFinished`, which
    /// fires from `finishIfDrained()`, which requires `pendingBuffers == 0`. A
    /// scheduled buffer whose completion handler never arrives — the same class
    /// of failure as the `endOfStream` and `SIGHUP` bugs already fixed in this
    /// tree — leaves that counter above zero forever. The phase never ends, and
    /// because every input path is gated on the phase, the microphone is dead
    /// until the app is relaunched. That is the "he still thinks he's speaking"
    /// bug, and no amount of fixing individual TTS paths can rule it out.
    ///
    /// So the state machine gets a floor instead: whatever happens downstream,
    /// `.speaking` terminates. Measured from the last sign of life rather than
    /// from the start, so a genuinely long reply is never cut off — only a
    /// silent one is.
    static let stallRange: ClosedRange<Double> = 4...60
    static let defaultStallTimeout: Double = 12

    static var stallTimeout: Double {
        get {
            let stored = UserDefaults.standard.double(forKey: stallKey)
            guard stored > 0 else { return defaultStallTimeout }
            return clamp(stored, stallRange)
        }
        set { UserDefaults.standard.set(clamp(newValue, stallRange), forKey: stallKey) }
    }

    /// Absolute ceiling on one spoken reply, however much audio is flowing.
    /// A stuck engine that keeps emitting level events would otherwise never
    /// trip the stall check.
    static let absoluteSpeakingCeiling: Double = 300

    // MARK: - Reading back

    /// One line for `orion-doctor` and the preferences pane.
    static var summary: String {
        "endpointing \(endpointingMs)ms · utterance-end \(resolvedUtteranceEndMs)ms · "
            + "apple grace \(String(format: "%.1f", appleFinalGrace))s · "
            + "stall \(Int(stallTimeout))s"
    }

    /// Every tunable in one dictionary, for the gateway config tool.
    static var snapshot: [String: Any] {
        [
            endpointingKey: endpointingMs,
            utteranceEndKey: utteranceEndMs,
            appleGraceKey: appleFinalGrace,
            stallKey: stallTimeout
        ]
    }

    static func reset() {
        for key in [endpointingKey, utteranceEndKey, appleGraceKey, stallKey] {
            UserDefaults.standard.removeObject(forKey: key)
        }
    }

    // MARK: - Helpers

    private static func clamp<T: Comparable>(_ value: T, _ range: ClosedRange<T>) -> T {
        min(range.upperBound, max(range.lowerBound, value))
    }

    /// `integer(forKey:)` returns 0 for an absent key, and 0 is not a legal
    /// value for any of these, so absence and "set to zero" collapse safely.
    private static func clampedInt(
        _ key: String,
        default fallback: Int,
        range: ClosedRange<Int>
    ) -> Int {
        let stored = UserDefaults.standard.integer(forKey: key)
        guard stored > 0 else { return fallback }
        return clamp(stored, range)
    }
}
