import AVFoundation
import XCTest
@testable import Orion

/// The live shell end to end: audio in, word timings in, voice ID per segment, and what is sent and logged.
/// The fake voice ID scores a stretch of audio by its mean sample value, so each second of the test audio
/// carries the score its speaker should get.
final class SegmentFilterCheckerTests: XCTestCase {

    private var dir: URL!
    private var logFile: URL { dir.appendingPathComponent("address.jsonl") }

    override func setUp() {
        dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    }

    override func tearDown() { try? FileManager.default.removeItem(at: dir) }

    private func checker() -> FollowUpAddressChecker {
        let defaults = UserDefaults(suiteName: "segment-filter-\(UUID().uuidString)")!
        return FollowUpAddressChecker(
            verifier: SpeakerVerifier(socketPath: dir.appendingPathComponent("none.sock").path),
            defaults: defaults, logFile: logFile, judge: { _, _, done in done(false) },
            verify: { samples, _, done in
                let score = Double(samples.reduce(0, +)) / Double(max(1, samples.count))
                done(score >= 0.45 ? .match(score: score) : .reject(score: score, threshold: 0.83))
            })
    }

    /// `seconds` of audio at 1 kHz whose samples equal `score`, in 100 ms buffers at `level`.
    private func feed(_ checker: FollowUpAddressChecker, seconds: Double, score: Float, level: Double) {
        let format = AVAudioFormat(standardFormatWithSampleRate: 1_000, channels: 1)!
        for _ in 0..<Int(seconds * 10) {
            let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 100)!
            buffer.frameLength = 100
            for index in 0..<100 { buffer.floatChannelData![0][index] = score }
            checker.observe(buffer, level: level)
        }
    }

    private func run(_ checker: FollowUpAddressChecker, text: String, words: [TimedWord]) -> (AddressVerdict, Bool) {
        let done = expectation(description: "decided")
        var result: (AddressVerdict, Bool)?
        checker.check(text: text, words: words, opening: .bargeIn, weakAdmitsInARow: 0, orionLast: "Let me look.") {
            result = ($0, $1); done.fulfill()
        }
        wait(for: [done], timeout: 3)
        return result!
    }

    func testLoggedWeatherTurnSendsOnlyHisQuestionAndLogsTheRest() throws {
        let gate = checker()
        gate.turnStarted(followUpWindow: false, continuation: false)
        feed(gate, seconds: 2.0, score: 0.60, level: 0.62)   // "What's the weather like tomorrow"
        feed(gate, seconds: 2.0, score: 0.33, level: 0.55)   // "You can take it off too. You know?"
        let text = "What's the weather like tomorrow You can take it off too. You know?"
        let words = TimedWord.aligned([
            TimedWord(text: "what's", start: 0.1, end: 0.4), TimedWord(text: "the", start: 0.4, end: 0.5),
            TimedWord(text: "weather", start: 0.5, end: 0.9), TimedWord(text: "like", start: 0.9, end: 1.1),
            TimedWord(text: "tomorrow", start: 1.1, end: 1.7), TimedWord(text: "you", start: 2.3, end: 2.5),
            TimedWord(text: "can", start: 2.5, end: 2.7), TimedWord(text: "take", start: 2.7, end: 2.9),
            TimedWord(text: "it", start: 2.9, end: 3.0), TimedWord(text: "off", start: 3.0, end: 3.2),
            TimedWord(text: "too", start: 3.2, end: 3.5), TimedWord(text: "you", start: 3.6, end: 3.7),
            TimedWord(text: "know", start: 3.7, end: 3.9),
        ], transcript: text)
        let (verdict, admitted) = run(gate, text: text, words: words)
        XCTAssertTrue(admitted, "\(verdict.reasons)")
        XCTAssertEqual(verdict.sendText, "What's the weather like tomorrow")
        XCTAssertFalse(verdict.sendText.contains("take it off"))

        let deadline = Date().addingTimeInterval(2)
        while !FileManager.default.fileExists(atPath: logFile.path), Date() < deadline { RunLoop.current.run(until: Date().addingTimeInterval(0.05)) }
        let line = try String(contentsOf: logFile, encoding: .utf8)
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(line.utf8)) as? [String: Any])
        let dropped = try XCTUnwrap(object["dropped"] as? [[String: String]])
        XCTAssertEqual(dropped.map { $0["text"] }, ["You can take it off too.", "You know?"])
        XCTAssertEqual(object["text"] as? String, "What's the weather like tomorrow")
    }

    func testWithoutTimingsTheWholeTurnIsJudgedAsBefore() {
        let gate = checker()
        gate.turnStarted(followUpWindow: false, continuation: false)
        feed(gate, seconds: 1.0, score: 0.40, level: 0.5)
        let (verdict, admitted) = run(gate, text: "What time is Fuck", words: [])
        XCTAssertFalse(admitted, "\(verdict.reasons)")
    }

    func testBargeInNameIsVoiceCheckedAndTrimmed() {
        let gate = checker()
        gate.turnStarted(followUpWindow: false, continuation: false)
        feed(gate, seconds: 1.5, score: 0.55, level: 0.6)
        let (verdict, admitted) = run(gate, text: "Still working Timmy, utilize. Orion, what time is", words: [])
        XCTAssertTrue(admitted)
        XCTAssertEqual(verdict.sendText, "Orion, what time is")

        let other = checker()
        other.turnStarted(followUpWindow: false, continuation: false)
        feed(other, seconds: 1.5, score: 0.25, level: 0.6)
        XCTAssertFalse(run(other, text: "Still working Timmy, utilize. Orion, what time is", words: []).1)
    }
}
