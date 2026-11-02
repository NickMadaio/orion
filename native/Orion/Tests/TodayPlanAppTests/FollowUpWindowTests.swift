import XCTest
@testable import Orion

/// The timing, level and logging halves of the follow-up address check.
final class FollowUpWindowTests: XCTestCase {

    private let t0 = Date(timeIntervalSince1970: 1_000_000)

    // MARK: Window clock

    func testOnsetIsMeasuredFromWhenTheWindowOpened() {
        let clock = FollowUpWindowClock.closed.opened(at: t0).heardSpeech(at: t0.addingTimeInterval(1.4))
        XCTAssertEqual(clock.onsetSeconds ?? -1, 1.4, accuracy: 0.001)
    }

    func testOnlyTheFirstSpeechCounts() {
        let clock = FollowUpWindowClock.closed.opened(at: t0)
            .heardSpeech(at: t0.addingTimeInterval(2))
            .heardSpeech(at: t0.addingTimeInterval(5))
        XCTAssertEqual(clock.onsetSeconds ?? -1, 2, accuracy: 0.001)
    }

    func testNoWindowNoOnset() {
        XCTAssertNil(FollowUpWindowClock.closed.heardSpeech(at: t0).onsetSeconds)
        XCTAssertNil(FollowUpWindowClock.closed.opened(at: t0).onsetSeconds)
        XCTAssertNil(FollowUpWindowClock.closed.opened(at: t0).heardSpeech(at: t0.addingTimeInterval(1)).closed().onsetSeconds)
    }

    func testSpeechBeforeTheWindowIsNotAnOnset() {
        let clock = FollowUpWindowClock.closed.opened(at: t0).heardSpeech(at: t0.addingTimeInterval(-0.5))
        XCTAssertNil(clock.onsetSeconds)
    }

    func testOnsetBands() {
        XCTAssertEqual(FollowUpTiming.band(onset: 0.6), .quick)
        XCTAssertEqual(FollowUpTiming.band(onset: FollowUpTiming.quickOnset), .quick)
        XCTAssertEqual(FollowUpTiming.band(onset: 3), .neutral)
        XCTAssertEqual(FollowUpTiming.band(onset: FollowUpTiming.lateOnset), .late)
        XCTAssertEqual(FollowUpTiming.band(onset: nil), .neutral)
        // Late must fall inside the 6 s follow-up grace or it could never fire.
        XCTAssertLessThan(FollowUpTiming.lateOnset, 6)
    }

    // MARK: Utterance capture

    func testSpeechLevelIgnoresTheSilenceBeforeHeSpoke() {
        var capture = UtteranceCapture.empty(rate: 16_000)
        for _ in 0..<40 { capture = capture.appending(samples: [Float](repeating: 0, count: 160), level: 0.1) }
        for _ in 0..<20 { capture = capture.appending(samples: [Float](repeating: 0.2, count: 160), level: 0.7) }
        XCTAssertEqual(capture.speechLevel ?? 0, 0.7, accuracy: 0.05)
    }

    func testVoicedSamplesAreOnlyTheLoudPartsInOrder() {
        var capture = UtteranceCapture.empty(rate: 1_000)
        capture = capture.appending(samples: [1, 1], level: 0.7)
        capture = capture.appending(samples: [0, 0], level: 0.1)
        capture = capture.appending(samples: [2, 2], level: 0.72)
        XCTAssertEqual(capture.voicedSamples(), [1, 1, 2, 2])
    }

    func testVoicedSamplesKeepTheMostRecentSeconds() {
        var capture = UtteranceCapture.empty(rate: 10)
        for i in 0..<10 { capture = capture.appending(samples: [Float](repeating: Float(i), count: 10), level: 0.7) }
        let voiced = capture.voicedSamples(maxSeconds: 3)
        XCTAssertEqual(voiced.count, 30)
        XCTAssertEqual(voiced.first, 7)
    }

    func testCaptureIsBounded() {
        var capture = UtteranceCapture.empty(rate: 100)
        for _ in 0..<200 { capture = capture.appending(samples: [Float](repeating: 0.1, count: 100), level: 0.5) }
        XCTAssertLessThanOrEqual(capture.sampleCount, Int(100 * UtteranceCapture.maxSeconds) + 100)
    }

    func testEmptyCaptureHasNoLevel() {
        XCTAssertNil(UtteranceCapture.empty(rate: 16_000).speechLevel)
    }

    func testSpeakerSegmentsSplitALongUtterance() {
        let long = [Float](repeating: 0.1, count: 3_000)
        XCTAssertEqual(UtteranceCapture.speakerSegments(long, rate: 1_000).count, 2)
        let short = [Float](repeating: 0.1, count: 1_500)
        XCTAssertEqual(UtteranceCapture.speakerSegments(short, rate: 1_000).count, 1)
        XCTAssertEqual(UtteranceCapture.speakerSegments([], rate: 1_000).count, 0)
    }

    // MARK: Level baseline

    func testBaselineNeedsAFewTurnsBeforeItSpeaks() {
        let base = VoiceLevelBaseline.empty.adding(0.6).adding(0.62)
        XCTAssertNil(base.reference)
        XCTAssertNil(base.deltaDB(for: 0.3))
        let ready = base.adding(0.64)
        XCTAssertEqual(ready.reference ?? 0, 0.62, accuracy: 0.0001)
    }

    func testDeltaIsInDecibels() {
        let base = VoiceLevelBaseline(levels: [0.6, 0.6, 0.6])
        // The normalised scale spans 45 dB.
        XCTAssertEqual(base.deltaDB(for: 0.4) ?? 0, -9, accuracy: 0.001)
    }

    func testBaselineKeepsOnlyRecentTurnsAndIsImmutable() {
        var base = VoiceLevelBaseline.empty
        for i in 0..<30 { base = base.adding(Double(i) / 100) }
        XCTAssertEqual(base.levels.count, VoiceLevelBaseline.capacity)
        let before = base
        _ = base.adding(0.9)
        XCTAssertEqual(base, before)
    }

    func testBaselineRoundTripsAndRejectsJunk() {
        let base = VoiceLevelBaseline(levels: [0.5, 0.6, 0.7])
        XCTAssertEqual(VoiceLevelBaseline(stored: base.stored), base)
        XCTAssertEqual(VoiceLevelBaseline(stored: ["x", 2.0, -1, 0.5]), VoiceLevelBaseline(levels: [0.5]))
        XCTAssertEqual(VoiceLevelBaseline(stored: nil), .empty)
    }

    // MARK: Local-model judge

    func testJudgeParsesStrictJSONOnly() {
        XCTAssertTrue(AddressJudge.parse(#"{"addressed": true}"#))
        XCTAssertTrue(AddressJudge.parse("```json\n{\"addressed\":true}\n```"))
        XCTAssertFalse(AddressJudge.parse(#"{"addressed": false}"#))
        XCTAssertFalse(AddressJudge.parse(#"{"addressed": "true"}"#))
        XCTAssertFalse(AddressJudge.parse("yes"))
        XCTAssertFalse(AddressJudge.parse(#"{"addressed": true, "note": "x"} and also"#))
        XCTAssertFalse(AddressJudge.parse(""))
    }

    func testJudgeFailsClosed() {
        let down = expectation(description: "down")
        AddressJudge.judge(utterance: "hm", orionLast: "Done.", complete: { _ in throw LocalModelError.unreachable }) { verdict in
            XCTAssertFalse(verdict); down.fulfill()
        }
        let yes = expectation(description: "yes")
        AddressJudge.judge(utterance: "hm", orionLast: "Done.", complete: { _ in #"{"addressed":true}"# }) { verdict in
            XCTAssertTrue(verdict); yes.fulfill()
        }
        wait(for: [down, yes], timeout: 2)
    }

    func testJudgePromptQuotesBothSidesAndIsBounded() {
        let prompt = AddressJudge.prompt(utterance: String(repeating: "a", count: 2_000), orionLast: "Want me to move gym?")
        XCTAssertTrue(prompt.contains("Want me to move gym?"))
        XCTAssertTrue(prompt.contains("\"addressed\""))
        XCTAssertLessThan(prompt.count, 2_000)
    }

    // MARK: Decision log

    func testLogRecordCarriesReasonsAndNoAudio() throws {
        let verdict = FollowUpAddressGate.decide(AddressSignals(
            text: "Did you see that, Sam?", opening: .followUp(afterQuestion: false),
            speaker: .scored(0.7), levelDeltaDB: -2, onsetSeconds: 0.8, orionLast: "Done."))
        let line = AddressDecisionLog.line(verdict: verdict, signals: verdict.signals, judged: nil, at: t0)
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(line.utf8)) as? [String: Any])
        XCTAssertEqual(object["addressed"] as? Bool, false)
        XCTAssertEqual(object["opening"] as? String, "followUp")
        XCTAssertNotNil(object["reasons"] as? [String])
        XCTAssertEqual(object["speakerScore"] as? Double, 0.7)
        XCTAssertNil(object["audio"])
        XCTAssertFalse(line.contains("\n"))
    }

    func testLogAppendsAndRotates() throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let file = dir.appendingPathComponent("address.jsonl")
        defer { try? FileManager.default.removeItem(at: dir) }
        AddressDecisionLog.append("{\"a\":1}", to: file, maxBytes: 20)
        AddressDecisionLog.append("{\"a\":2}", to: file, maxBytes: 20)
        AddressDecisionLog.append("{\"a\":3}", to: file, maxBytes: 20)
        let text = try String(contentsOf: file, encoding: .utf8)
        XCTAssertTrue(text.hasSuffix("{\"a\":3}\n"))
        XCTAssertLessThanOrEqual(text.utf8.count, 20)
        XCTAssertTrue(FileManager.default.fileExists(atPath: file.path + ".1"))
    }

    // MARK: Checker (voice ID unreachable, so it fails open to "unknown")

    private func makeChecker(judge: Bool? = nil, judged: @escaping () -> Void = {}) -> (FollowUpAddressChecker, URL) {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let defaults = UserDefaults(suiteName: "followup-\(UUID().uuidString)")!
        let checker = FollowUpAddressChecker(
            verifier: SpeakerVerifier(socketPath: dir.appendingPathComponent("none.sock").path),
            defaults: defaults, logFile: dir.appendingPathComponent("a.jsonl"),
            judge: { _, _, done in judged(); done(judge ?? false) })
        return (checker, dir)
    }

    private func run(_ checker: FollowUpAddressChecker, _ text: String, orion: String = "Done, gym is at 7 now.") -> (AddressVerdict, Bool)? {
        var out: (AddressVerdict, Bool)?
        checker.check(text: text, opening: .followUp(afterQuestion: false), weakAdmitsInARow: 0, orionLast: orion) { out = ($0, $1) }
        return out
    }

    func testCheckerAdmitsARequestAndRefusesTheRoom() {
        let (checker, dir) = makeChecker()
        defer { try? FileManager.default.removeItem(at: dir) }
        checker.turnStarted(followUpWindow: true, continuation: false, at: t0)
        XCTAssertEqual(run(checker, "move my reading block to 9")?.1, true)
        XCTAssertEqual(run(checker, "Did you see that, Sam?")?.1, false)
        XCTAssertFalse(checker.isChecking)
    }

    func testBorderlineAsksTheModelAndFailsClosed() {
        var asked = 0
        let (yes, dirA) = makeChecker(judge: true, judged: { asked += 1 })
        let (no, dirB) = makeChecker(judge: false)
        defer { try? FileManager.default.removeItem(at: dirA); try? FileManager.default.removeItem(at: dirB) }
        for checker in [yes, no] {
            checker.turnStarted(followUpWindow: true, continuation: false, at: t0)
            checker.heardSpeech(at: t0.addingTimeInterval(4.5))
        }
        // A request, late in the window: 2 - 1 = 1 -> admitted without the model.
        XCTAssertEqual(run(yes, "open the notes app")?.1, true)
        XCTAssertEqual(asked, 0)
        // Unknown voice, late, related: 0 + 1 - 1 = 0 -> borderline.
        XCTAssertEqual(run(yes, "wait is gym still with sam")?.0.outcome, .borderline)
        XCTAssertEqual(run(yes, "wait is gym still with sam")?.1, true)
        XCTAssertEqual(run(no, "wait is gym still with sam")?.1, false)
        XCTAssertGreaterThan(asked, 0)
    }

    func testANewTurnDropsAStaleCheck() {
        var release: ((Bool) -> Void)?
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: dir) }
        let checker = FollowUpAddressChecker(
            verifier: SpeakerVerifier(socketPath: dir.appendingPathComponent("none.sock").path),
            defaults: UserDefaults(suiteName: "followup-\(UUID().uuidString)")!, logFile: dir.appendingPathComponent("a.jsonl"),
            judge: { _, _, done in release = done })
        checker.turnStarted(followUpWindow: true, continuation: false, at: t0)
        checker.heardSpeech(at: t0.addingTimeInterval(4.5))
        var called = false
        checker.check(text: "wait is gym still with sam", opening: .followUp(afterQuestion: false),
                      weakAdmitsInARow: 0, orionLast: "Done, gym is at 7 now.") { _, _ in called = true }
        XCTAssertTrue(checker.isChecking)
        checker.turnStarted(followUpWindow: false, continuation: false)
        release?(true)
        XCTAssertFalse(called)
    }

    func testContinuationKeepsTheFirstHalfsClock() {
        let (checker, dir) = makeChecker()
        defer { try? FileManager.default.removeItem(at: dir) }
        checker.turnStarted(followUpWindow: true, continuation: false, at: t0)
        checker.heardSpeech(at: t0.addingTimeInterval(1))
        checker.turnStarted(followUpWindow: true, continuation: true, at: t0.addingTimeInterval(9))
        XCTAssertEqual(checker.clock.onsetSeconds ?? -1, 1, accuracy: 0.001)
        checker.turnStarted(followUpWindow: false, continuation: false)
        XCTAssertNil(checker.clock.onsetSeconds)
    }
}
