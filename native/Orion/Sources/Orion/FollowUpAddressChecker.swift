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
    private let verifier: SpeakerVerifier
    private let defaults: UserDefaults
    private let judge: (String, String, @escaping (Bool) -> Void) -> Void
    private let logFile: URL

    private(set) var capture = UtteranceCapture.empty(rate: 16_000)
    private(set) var clock = FollowUpWindowClock.closed
    private(set) var baseline: VoiceLevelBaseline
    private var generation = 0
    /// A check is waiting on voice ID or the local model.
    private(set) var isChecking = false

    init(verifier: SpeakerVerifier, defaults: UserDefaults = .standard, logFile: URL = AddressDecisionLog.defaultFile,
         judge: @escaping (String, String, @escaping (Bool) -> Void) -> Void = { utterance, last, done in
             AddressJudge.judge(utterance: utterance, orionLast: last, completion: done)
         }) {
        self.verifier = verifier
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
        guard !continuation else { return }
        capture = .empty(rate: capture.rate)
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
    /// `completion(verdict, admitted)` runs on the main thread, unless a newer turn started meanwhile.
    func check(text: String, opening: VoiceTurnOpening, weakAdmitsInARow: Int, orionLast: String,
               completion: @escaping (AddressVerdict, Bool) -> Void) {
        let token = generation
        let level = capture.speechLevel
        let signals = AddressSignals(text: text, opening: opening, weakAdmitsInARow: weakAdmitsInARow,
                                     levelDeltaDB: level.flatMap(baseline.deltaDB), onsetSeconds: clock.onsetSeconds,
                                     orionLast: orionLast)
        let textOnly = AddressGate.classify(text, opening: opening, weakAdmitsInARow: weakAdmitsInARow)
        // Refused by the words, or his name: voice ID cannot change the answer.
        guard textOnly.addressed, textOnly.reason != "name" else {
            finish(FollowUpAddressGate.decide(signals), judged: nil, level: level, completion: completion)
            return
        }
        isChecking = true
        speakerEvidence { [weak self] evidence in
            guard let self, self.generation == token else { return }
            var heard = signals
            heard.speaker = evidence
            let verdict = FollowUpAddressGate.decide(heard)
            guard verdict.outcome == .borderline else {
                self.finish(verdict, judged: nil, level: level, completion: completion)
                return
            }
            self.judge(text, orionLast) { [weak self] judged in
                guard let self, self.generation == token else { return }
                self.finish(verdict, judged: judged, level: level, completion: completion)
            }
        }
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
        verifier.verify(samples: first, sampleRate: rate) { [weak self] head in
            guard let self, segments.count > 1 else { completion(SpeakerEvidence(head)); return }
            self.verifier.verify(samples: segments[1], sampleRate: rate) { tail in
                completion(SpeakerEvidence.combine(SpeakerEvidence(head), SpeakerEvidence(tail)))
            }
        }
    }
}
