import XCTest
@testable import Orion

/// 2026-11-03 10:51: "Still working" and "Let me" (his own cues, heard back) opened barge-ins that paused the turn,
/// so the weather answers were written to the chat and never spoken.
final class CueEchoTests: XCTestCase {
    private let cues = ["Still working on it, one more sec.", "Let me look.", "Hmm, let me think about that."]

    func testOwnCuePiecesAreEcho() {
        for heard in ["Still working", "Let me", "still working on it", "Let me look", "let me think", "hmm let me", "Let me look."] {
            XCTAssertTrue(CueEcho.isEcho(heard: heard, voices: cues), heard)
        }
    }

    func testTheRealQuestionIsNotEcho() {
        for heard in ["What's the weather like today", "whats on my calendar tmrw", "let me know when its done",
                      "orion what time is it", "stop", "wait", "no thats not it", "me", ""] {
            XCTAssertFalse(CueEcho.isEcho(heard: heard, voices: cues), heard)
        }
    }

    func testInterruptionWordNotInTheCueIsNickEvenInsideCueWords() {
        XCTAssertFalse(CueEcho.isEcho(heard: "let me stop", voices: cues))
        XCTAssertTrue(CueEcho.isEcho(heard: "wait", voices: ["Wait, one sec."]))
    }

    func testNoVoicesMeansNoEcho() {
        XCTAssertFalse(CueEcho.isEcho(heard: "Still working", voices: []))
        XCTAssertFalse(CueEcho.isEcho(heard: "Still working", voices: ["", " "]))
    }

    func testLongHeardFallsBackToTheWordShareRule() {
        XCTAssertTrue(CueEcho.isEcho(heard: "its sixty eight and sunny", voices: ["It's sixty-eight and sunny today."]))
    }

    func testSelfEchoDecisionLine() {
        let line = AddressDecisionLog.selfEchoLine(text: "Still working", opening: .bargeIn, at: Date(timeIntervalSince1970: 0))
        XCTAssertTrue(line.contains("\"outcome\":\"selfEcho\""), line)
        XCTAssertTrue(line.contains("\"opening\":\"bargeIn\""), line)
        XCTAssertTrue(line.contains("\"addressed\":false"), line)
    }

    // MARK: Refused barge-in is a no-op for speech

    func testSpeakingThenRefusedBargeInSaysTheAnswerAgain() {
        let answer = "It's sixty-eight and sunny today."
        let stopped = RefusedBargeInRecovery.none.interrupting(answer)   // speech stopped when he seemed to talk
        let (resume, next) = stopped.refused()                           // the gate: not said to ORION
        XCTAssertEqual(resume, answer)
        XCTAssertNil(next.refused().resume, "said again once, never twice")
    }

    func testRefusedBargeInOverAHeldAnswerSpeaksItWhenIdle() {
        XCTAssertEqual(RefusedAnswerLanding.on(allowsSpeech: true, idle: true), .speak)
        XCTAssertEqual(RefusedAnswerLanding.on(allowsSpeech: true, idle: false), .bubble)
        XCTAssertEqual(RefusedAnswerLanding.on(allowsSpeech: false, idle: true), .bubble)
    }

    func testGenuineBargeInStillStopsAndNothingResumes() {
        // A real interruption: speech stops (BargeInPolicy), the gate admits him, and nothing is said again.
        XCTAssertTrue(BargeInPolicy.isInterruption(mode: .voiceRestricted, heardText: "orion stop", energy: 0.5,
                                                   currentlySpoken: "It's sixty-eight and sunny today."))
        let stopped = RefusedBargeInRecovery.none.interrupting("It's sixty-eight and sunny today.")
        XCTAssertNil(stopped.admitted().refused().resume)
    }

    func testOwnCueNeverReachesTheInterruptionPolicy() {
        XCTAssertTrue(CueEcho.isEcho(heard: "Let me", voices: ["Let me look."]))
        XCTAssertFalse(BargeInPolicy.isInterruption(mode: .voiceRestricted, heardText: "let me look", energy: 0.5,
                                                    currentlySpoken: "Let me look."))
    }

    func testBlankInterruptionRecordsNothing() {
        XCTAssertNil(RefusedBargeInRecovery.none.interrupting("  ").refused().resume)
    }
}
