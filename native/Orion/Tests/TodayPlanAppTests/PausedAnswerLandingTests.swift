import XCTest
@testable import Orion

/// 2026-11-02 23:01: "What's the weather gonna be like tomorrow?" was asked aloud. Room speech at :25 paused the turn, the address gate
/// dropped that speech at :38 as not said to ORION, and the answer landed at :46 into `pausedReplacementText`, waiting for a
/// "continue" nobody said. The chat got no reply at all. A paused answer is held only while he is still finishing his own sentence.
final class PausedAnswerLandingTests: XCTestCase {

    func testAnswerAfterRoomSpeechWasDroppedGoesToTheChat() {
        XCTAssertEqual(PausedAnswerLanding.on(seedWasRoom: true, listening: false), .bubble)
    }

    func testAnswerWhileTheRoomIsStillBeingHeardStillGoesToTheChat() {
        XCTAssertEqual(PausedAnswerLanding.on(seedWasRoom: true, listening: true), .bubble)
    }

    func testAnswerAfterTheConversationClosedGoesToTheChat() {
        XCTAssertEqual(PausedAnswerLanding.on(seedWasRoom: false, listening: false), .bubble)
    }

    func testAnswerWhileHeIsFinishingHisSentenceIsHeldForContinue() {
        XCTAssertEqual(PausedAnswerLanding.on(seedWasRoom: false, listening: true), .hold)
    }
}

/// 2026-11-02 23:11: two spoken weather questions in a row, each paused by speech the gate then dropped. Sending the second cleared
/// the first's paused generation, so its answer (landing at 23:12:08) matched nothing and was thrown away. A turn whose
/// interruption was room speech is orphaned: its answer goes to the chat whenever it lands, whatever turn is live by then.
final class OrphanedAnswersTests: XCTestCase {

    func testAnOrphanedTurnIsClaimedOnce() {
        let ledger = OrphanedAnswers().adding(7)
        let (first, after) = ledger.claiming(7)
        XCTAssertTrue(first)
        XCTAssertFalse(after.claiming(7).0)
    }

    func testOtherTurnsAreNotClaimed() {
        XCTAssertFalse(OrphanedAnswers().adding(7).claiming(8).0)
    }

    func testTwoOrphansBothLand() {
        let ledger = OrphanedAnswers().adding(3).adding(5)
        let (three, rest) = ledger.claiming(3)
        XCTAssertTrue(three)
        XCTAssertTrue(rest.claiming(5).0)
    }
}

/// w18 audit2 (item D): every question gets an answer, or an explicit "I lost that". The last silent holes were a paused turn that
/// FAILED (only successes were kept), and a question-shaped utterance the address gate refused with nothing shown.
final class LostTurnTests: XCTestCase {

    func testAFailedPausedTurnSaysItWasLostAndNamesTheQuestion() {
        XCTAssertEqual(LostTurn.failedLine(question: "What's the weather like tomorrow?"),
                       "I lost that one — say it again? (\"What's the weather like tomorrow?\")")
        XCTAssertEqual(LostTurn.failedLine(question: ""), "I lost that one — say it again?")
    }

    func testQuestionsThatTheGateRefusedAreNotLeftSilent() {
        for q in ["What time is it?", "What's the weather like tomorrow?", "whats the weather like tomorrow", "what time is it", "Did you say the weather?", "open amazon uk"] {
            XCTAssertNotNil(LostTurn.skippedLine(text: q), q)
        }
    }

    func testRoomChatterStaysSilent() {
        for t in ["Sounds good. Thank you.", "Well, that was a lot faster. Not much better. Thank you.", "yeah", "haha no way", "I'm going to bed soon"]
            { XCTAssertNil(LostTurn.skippedLine(text: t), t) }
    }

    func testTheSkippedLineAsksForARepeatWithoutSpeakingForHim() {
        XCTAssertEqual(LostTurn.skippedLine(text: "What time is it?"),
                       "I didn't take that as meant for me, so I skipped it: \"What time is it?\" Say it again if it was.")
    }
}
