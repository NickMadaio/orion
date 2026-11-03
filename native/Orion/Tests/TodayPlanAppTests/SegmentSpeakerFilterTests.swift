import XCTest
@testable import Orion

/// 2026-11-02 23:56: "What's the weather like tomorrow You can take it off too. You know?" reached the model as one
/// line. The second half was somebody else in the room. The ear gives word timings, so a turn can be cut at its pauses
/// and each piece's voice checked; the pieces that clearly are not Nick are dropped before anything is sent.
final class SegmentSpeakerFilterTests: XCTestCase {

    private func words(_ spec: [(String, Double, Double)]) -> [TimedWord] {
        spec.map { TimedWord(text: $0.0, start: $0.1, end: $0.2) }
    }

    private var weatherWords: [TimedWord] {
        words([("What's", 0.1, 0.4), ("the", 0.4, 0.5), ("weather", 0.5, 0.9), ("like", 0.9, 1.1), ("tomorrow", 1.1, 1.7),
               ("You", 2.4, 2.5), ("can", 2.5, 2.7), ("take", 2.7, 2.9), ("it", 2.9, 3.0), ("off", 3.0, 3.2), ("too.", 3.2, 3.5),
               ("You", 3.6, 3.7), ("know?", 3.7, 4.0)])
    }

    // MARK: Splitting

    func testSplitsAtPausesAndSentenceEnds() {
        let segments = SpeechSegments.split(weatherWords)
        XCTAssertEqual(segments.map(\.text), ["What's the weather like tomorrow", "You can take it off too.", "You know?"])
        XCTAssertEqual(segments[0].start, 0.1, accuracy: 0.001)
        XCTAssertEqual(segments[0].end, 1.7, accuracy: 0.001)
    }

    func testOneBreathIsOneSegment() {
        let line = words([("move", 0, 0.3), ("gym", 0.3, 0.6), ("to", 0.6, 0.7), ("seven", 0.7, 1.1)])
        XCTAssertEqual(SpeechSegments.split(line).count, 1)
        XCTAssertTrue(SpeechSegments.split([]).isEmpty)
    }

    func testWordsTakeTheTranscriptsPunctuationWhenTheyLineUp() {
        let raw = words([("what's", 0, 0.3), ("the", 0.3, 0.4), ("time", 0.4, 0.7), ("you", 1.5, 1.6), ("know", 1.6, 1.9)])
        let aligned = TimedWord.aligned(raw, transcript: "What's the time? You know.")
        XCTAssertEqual(aligned.map(\.text), ["What's", "the", "time?", "You", "know."])
        // Counts differ: the ear's own words stand.
        XCTAssertEqual(TimedWord.aligned(raw, transcript: "What's the time").map(\.text), raw.map(\.text))
    }

    // MARK: The logged case and held-out variants

    private func scored(_ segments: [SpeechSegment], _ speakers: [SpeakerEvidence], _ levels: [Double?]) -> [ScoredSegment] {
        zip(segments, zip(speakers, levels)).map { ScoredSegment(segment: $0.0, speaker: $0.1.0, level: $0.1.1) }
    }

    func testLoggedWeatherLineDropsTheOtherVoicesTail() {
        let segments = SpeechSegments.split(weatherWords)
        let result = SegmentSpeakerFilter.filter(scored(segments, [.scored(0.60), .scored(0.33), .unknown("too short")], [0.62, 0.55, 0.55]))
        XCTAssertEqual(result.keptText(from: "What's the weather like tomorrow You can take it off too. You know?"),
                       "What's the weather like tomorrow")
        XCTAssertEqual(result.dropped.map(\.text), ["You can take it off too.", "You know?"])
        XCTAssertEqual(result.evidence, .scored(0.60))
    }

    func testTrailingFragmentTooShortToScoreButMuchQuieterIsDropped() {
        let line = words([("what's", 0, 0.3), ("on", 0.3, 0.4), ("my", 0.4, 0.5), ("calendar", 0.5, 1.0), ("tomorrow", 1.0, 1.6),
                          ("yeah", 2.4, 2.7), ("right", 2.7, 3.0)])
        let segments = SpeechSegments.split(line)
        let result = SegmentSpeakerFilter.filter(scored(segments, [.scored(0.58), .unknown("too short")], [0.60, 0.42]))
        XCTAssertEqual(result.dropped.map(\.text), ["yeah right"])
        XCTAssertTrue(result.dropped[0].reason.contains("dB"), result.dropped[0].reason)
    }

    func testHisOwnAfterthoughtAtTheSameLevelIsKept() {
        let line = words([("what's", 0, 0.3), ("the", 0.3, 0.4), ("weather", 0.4, 0.8), ("tomorrow", 0.8, 1.4),
                          ("and", 2.2, 2.4), ("saturday", 2.4, 3.0)])
        let segments = SpeechSegments.split(line)
        let result = SegmentSpeakerFilter.filter(scored(segments, [.scored(0.61), .unknown("too short")], [0.60, 0.58]))
        XCTAssertTrue(result.dropped.isEmpty)
        XCTAssertEqual(result.keptText(from: "what's the weather tomorrow and saturday"), "what's the weather tomorrow and saturday")
    }

    func testHalvesThatDisagreeKeepOnlyTheNickPart() {
        let line = words([("did", 0, 0.2), ("you", 0.2, 0.3), ("eat", 0.3, 0.6), ("yet", 0.6, 1.2),
                          ("orion", 2.0, 2.4), ("add", 2.4, 2.6), ("milk", 2.6, 2.9), ("to", 2.9, 3.0), ("my", 3.0, 3.1), ("list", 3.1, 3.5)])
        let segments = SpeechSegments.split(line)
        let result = SegmentSpeakerFilter.filter(scored(segments, [.scored(0.28), .scored(0.64)], [0.5, 0.6]))
        XCTAssertEqual(result.keptText(from: "did you eat yet orion add milk to my list"), "orion add milk to my list")
        XCTAssertEqual(result.dropped.first?.text, "did you eat yet")
    }

    func testUnsureTailAfterAWholeRequestIsDropped() {
        let line = words([("move", 0, 0.3), ("gym", 0.3, 0.6), ("to", 0.6, 0.7), ("seven", 0.7, 1.2),
                          ("no", 2.0, 2.2), ("the", 2.2, 2.3), ("other", 2.3, 2.6), ("one", 2.6, 3.1)])
        let segments = SpeechSegments.split(line)
        let result = SegmentSpeakerFilter.filter(scored(segments, [.scored(0.66), .scored(0.42)], [0.6, 0.6]))
        XCTAssertEqual(result.dropped.map(\.text), ["no the other one"])
    }

    func testNoSegmentIsHisLeavesTheWholeLineToTheGate() {
        let segments = SpeechSegments.split(weatherWords)
        let result = SegmentSpeakerFilter.filter(scored(segments, [.scored(0.42), .scored(0.43), .unknown("short")], [0.6, 0.6, 0.6]))
        XCTAssertTrue(result.dropped.isEmpty)
        XCTAssertNil(result.evidence)
    }

    func testAllHisKeepsEverything() {
        let segments = SpeechSegments.split(weatherWords)
        let result = SegmentSpeakerFilter.filter(scored(segments, [.scored(0.6), .scored(0.55), .unknown("short")], [0.6, 0.6, 0.6]))
        XCTAssertTrue(result.dropped.isEmpty)
        XCTAssertEqual(result.evidence, .split(first: 0.55, last: 0.6))
    }

    func testKeptTextRemovesOnlyTheDroppedPieceEvenWhenAWordRepeats() {
        let result = SegmentFilterResult(kept: [], dropped: [.init(text: "You know?", reason: "x")], evidence: nil)
        XCTAssertEqual(result.keptText(from: "You know what's next? You know?"), "You know what's next?")
    }

    // MARK: Audio for a segment

    func testCaptureSlicesAudioAndLevelByTime() {
        var capture = UtteranceCapture.empty(rate: 10)
        capture = capture.appending(samples: Array(repeating: 0.1, count: 10), level: 0.2)   // 0–1 s
        capture = capture.appending(samples: Array(repeating: 0.5, count: 10), level: 0.6)   // 1–2 s
        XCTAssertEqual(capture.samples(from: 1.0, to: 2.0).count, 10)
        XCTAssertEqual(capture.samples(from: 1.0, to: 2.0).first, 0.5)
        XCTAssertEqual(capture.level(from: 1.0, to: 2.0) ?? 0, 0.6, accuracy: 0.001)
        XCTAssertEqual(capture.level(from: 0.0, to: 0.9) ?? 0, 0.2, accuracy: 0.001)
        XCTAssertEqual(capture.duration, 2.0, accuracy: 0.001)
    }

    func testCaptureKeepsTimeWhenTheFrontIsTrimmed() {
        var capture = UtteranceCapture.empty(rate: 10)
        for index in 0..<14 { capture = capture.appending(samples: Array(repeating: Float(index), count: 10), level: 0.5) }
        // 14 s heard, 12 kept: second 13 is still at 13.
        XCTAssertEqual(capture.samples(from: 13.0, to: 14.0).first, 13)
        XCTAssertTrue(capture.samples(from: 0.0, to: 1.0).isEmpty)
    }
}
