import AVFoundation
import Foundation

/// The live shell around `FollowUpAddressGate`: it keeps the current turn's
/// audio (in memory only), the follow-up window's clock and his level baseline,
/// asks voice ID about the voiced audio, consults the local model on a
/// borderline line, writes the decision log, and calls back on the main thread.
///
/// Main-thread only. A new turn (`turnStarted`) invalidates any check still in
/// flight, so a wake word said during a check is never answered twice.
final class FollowUpAddressChecker {
    /// Voice ID for one stretch of audio (the daemon; tests pass their own).
    private let verify: ([Float], Double, @escaping (VerificationResult) -> Void) -> Void
    private let defaults: UserDefaults
    private let judge: (String, String, @escaping (Bool) -> Void) -> Void
    private let logFile: URL

    private(set) var capture = UtteranceCapture.empty(rate: 16_000)
    private(set) var clock = FollowUpWindowClock.closed
    /// Where the current utterance's audio starts in `capture`, in seconds: the ear's word timings count from here.
    /// Zero for a fresh turn; the end of the first half for the rest of a cut-off sentence.
    private var utteranceOrigin: Double = 0
    private(set) var baseline: VoiceLevelBaseline
    private var generation = 0
    /// A check is waiting on voice ID or the local model.
    private(set) var isChecking = false

    init(verifier: SpeakerVerifier, defaults: UserDefaults = .standard, logFile: URL = AddressDecisionLog.defaultFile,
         judge: @escaping (String, String, @escaping (Bool) -> Void) -> Void = { utterance, last, done in
             AddressJudge.judge(utterance: utterance, orionLast: last, completion: done)
         },
         verify: (([Float], Double, @escaping (VerificationResult) -> Void) -> Void)? = nil) {
        self.verify = verify ?? { samples, rate, done in verifier.verify(samples: samples, sampleRate: rate, completion: done) }
        self.defaults = defaults
        self.judge = judge
        self.logFile = logFile
        self.baseline = VoiceLevelBaseline(stored: defaults.array(forKey: VoiceLevelBaseline.defaultsKey))
    }

    // MARK: Turn lifecycle

    /// A listening turn began. A continuation of a cut-off sentence keeps the
    /// audio and the clock of its first half; a follow-up window starts its clock.
    func turnStarted(followUpWindow: Bool, continuation: Bool, at date: Date = Date()) {
        generation += 1
        isChecking = false
        guard !continuation else { utteranceOrigin = capture.duration; return }
        capture = .empty(rate: capture.rate)
        utteranceOrigin = 0
        clock = followUpWindow ? FollowUpWindowClock.closed.opened(at: date) : .closed
    }

    func heardSpeech(at date: Date) { clock = clock.heardSpeech(at: date) }

    /// A microphone buffer while the turn is being heard.
    func observe(_ buffer: AVAudioPCMBuffer, level: Double) {
        guard let channel = buffer.floatChannelData?[0], buffer.frameLength > 0 else { return }
        let rate = buffer.format.sampleRate
        let base = capture.rate == rate ? capture : .empty(rate: rate)
        let samples = Array(UnsafeBufferPointer(start: channel, count: Int(buffer.frameLength)))
        capture = base.appending(samples: samples, level: level)
    }

    /// The wake word or the key opened this turn: it is his, so its level teaches the baseline.
    func learnFromExplicitTurn() {
        guard let level = capture.speechLevel else { return }
        learn(level)
    }

    private func learn(_ level: Double) {
        baseline = baseline.adding(level)
        defaults.set(baseline.stored, forKey: VoiceLevelBaseline.defaultsKey)
    }

    // MARK: Check

    /// Decide whether follow-up / barge-in speech was said to ORION.
    /// `words`: the ear's word timings for the last utterance, when it gave them; the turn is split at its pauses and
    /// pieces in another voice are dropped first (`SegmentSpeakerFilter`). The verdict's `sendText` is what to send.
    /// `completion(verdict, admitted)` runs on the main thread, unless a newer turn started meanwhile.
    func check(text: String, words: [TimedWord] = [], opening: VoiceTurnOpening, weakAdmitsInARow: Int, orionLast: String,
               completion: @escaping (AddressVerdict, Bool) -> Void) {
        let token = generation
        let level = capture.speechLevel
        let heard = AddressSignals(text: text, opening: opening, weakAdmitsInARow: weakAdmitsInARow,
                                   levelDeltaDB: level.flatMap(baseline.deltaDB), onsetSeconds: clock.onsetSeconds,
                                   orionLast: orionLast)
        isChecking = true
        filterSegments(words) { [weak self] filtered in
            guard let self, self.generation == token else { return }
            var signals = heard
            if let filtered, !filtered.dropped.isEmpty {
                signals.text = filtered.keptText(from: text)
                signals.dropped = filtered.dropped
            }
            self.decide(signals, segmentEvidence: filtered?.evidence, token: token, level: level, completion: completion)
        }
    }

    private func decide(_ signals: AddressSignals, segmentEvidence: SpeakerEvidence?, token: Int, level: Double?,
                        completion: @escaping (AddressVerdict, Bool) -> Void) {
        let textOnly = AddressGate.classify(signals.text, opening: signals.opening, weakAdmitsInARow: signals.weakAdmitsInARow)
        // Refused by the words, or his name in the follow-up window: voice ID cannot change the answer.
        // (On a barge-in his name still needs a voice that is not clearly someone else's.)
        guard textOnly.addressed, textOnly.reason != "name" || signals.opening == .bargeIn else {
            finish(FollowUpAddressGate.decide(signals), judged: nil, level: level, completion: completion)
            return
        }
        let decideWith: (SpeakerEvidence) -> Void = { [weak self] evidence in
            guard let self, self.generation == token else { return }
            var heard = signals
            heard.speaker = evidence
            let verdict = FollowUpAddressGate.decide(heard)
            guard verdict.outcome == .borderline else {
                self.finish(verdict, judged: nil, level: level, completion: completion)
                return
            }
            self.judge(heard.text, heard.orionLast) { [weak self] judged in
                guard let self, self.generation == token else { return }
                self.finish(verdict, judged: judged, level: level, completion: completion)
            }
        }
        if let segmentEvidence { decideWith(segmentEvidence) } else { speakerEvidence(decideWith) }
    }

    /// Voice ID on each piece of the utterance long enough to score, then `SegmentSpeakerFilter`.
    /// nil when there are no timings, one piece only, or the timings do not line up with the audio held.
    private func filterSegments(_ words: [TimedWord], completion: @escaping (SegmentFilterResult?) -> Void) {
        let segments = SpeechSegments.split(words)
        let origin = utteranceOrigin
        guard segments.count >= 2, let end = segments.last?.end, origin + end <= capture.duration + 0.75 else {
            completion(nil)
            return
        }
        let snapshot = capture
        scoreSegments(segments[...], origin: origin, capture: snapshot, scored: []) { scored in
            completion(SegmentSpeakerFilter.filter(scored))
        }
    }

    private func scoreSegments(_ remaining: ArraySlice<SpeechSegment>, origin: Double, capture: UtteranceCapture,
                               scored: [ScoredSegment], completion: @escaping ([ScoredSegment]) -> Void) {
        guard let segment = remaining.first else { completion(scored); return }
        let from = origin + segment.start - 0.05, to = origin + segment.end + 0.05
        let level = capture.level(from: from, to: to)
        let next: (SpeakerEvidence) -> Void = { [weak self] evidence in
            let item = ScoredSegment(segment: segment, speaker: evidence, level: level)
            self?.scoreSegments(remaining.dropFirst(), origin: origin, capture: capture, scored: scored + [item], completion: completion)
        }
        let audio = capture.samples(from: from, to: to)
        guard segment.duration >= SegmentSpeakerFilter.minimumScoredSeconds, !audio.isEmpty else {
            next(.unknown("too short"))
            return
        }
        verify(audio, capture.rate) { next(SpeakerEvidence($0)) }
    }

    private func finish(_ verdict: AddressVerdict, judged: Bool?, level: Double?,
                        completion: (AddressVerdict, Bool) -> Void) {
        isChecking = false
        let admitted = verdict.outcome == .addressed || (verdict.outcome == .borderline && judged == true)
        AddressDecisionLog.record(AddressDecisionLog.line(verdict: verdict, signals: verdict.signals, judged: judged, at: Date()), to: logFile)
        if admitted, verdict.speakerRead == .nick, let level { learn(level) }
        completion(verdict, admitted)
    }

    /// Voice ID on the voiced audio: two halves when long enough, else the whole.
    private func speakerEvidence(_ completion: @escaping (SpeakerEvidence) -> Void) {
        let rate = capture.rate
        let segments = UtteranceCapture.speakerSegments(capture.voicedSamples(), rate: rate)
        guard let first = segments.first else { completion(.unknown("no voiced audio")); return }
        verify(first, rate) { [weak self] head in
            guard let self, segments.count > 1 else { completion(SpeakerEvidence(head)); return }
            self.verify(segments[1], rate) { tail in
                completion(SpeakerEvidence.combine(SpeakerEvidence(head), SpeakerEvidence(tail)))
            }
        }
    }
}
