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
