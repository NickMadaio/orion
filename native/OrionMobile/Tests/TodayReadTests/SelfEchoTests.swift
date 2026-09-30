import XCTest
@testable import MobileCore

final class SelfEchoTests: XCTestCase {
    let reply = "It's 7:59 PM. Your Marketing lecture is done and the rest of today is open."

    func testHisOwnReplyHeardBackIsEcho() {
        XCTAssertTrue(SelfEcho.isEcho(heard: "it's 7 59 pm your marketing lecture is done", spoken: reply))
        XCTAssertTrue(SelfEcho.isEcho(heard: "The rest of today is open.", spoken: reply))
    }

    func testNickTalkingOverHimIsNot() {
        XCTAssertFalse(SelfEcho.isEcho(heard: "actually move my gym to tomorrow", spoken: reply))
        XCTAssertFalse(SelfEcho.isEcho(heard: "wait what time is the club tonight", spoken: reply))
    }

    func testShortWordsStayNicks() {
        XCTAssertFalse(SelfEcho.isEcho(heard: "stop", spoken: "Stop by the shop"))
        XCTAssertFalse(SelfEcho.isEcho(heard: "the rest", spoken: reply))
    }

    func testWhileSpeakingShortFragmentsOfHisOwnAreEcho() {
        XCTAssertTrue(SelfEcho.isEchoWhileSpeaking(heard: "It's", spoken: reply))
        XCTAssertTrue(SelfEcho.isEchoWhileSpeaking(heard: "marketing lecture", spoken: reply))
        XCTAssertTrue(SelfEcho.isEchoWhileSpeaking(heard: "stop", spoken: "Stop by the shop"), "his own word, heard back")
        XCTAssertFalse(SelfEcho.isEchoWhileSpeaking(heard: "stop", spoken: reply), "Nick's word")
        XCTAssertFalse(SelfEcho.isEchoWhileSpeaking(heard: "wait no", spoken: reply))
        XCTAssertFalse(SelfEcho.isEchoWhileSpeaking(heard: "gym tomorrow", spoken: reply))
        XCTAssertFalse(SelfEcho.isEchoWhileSpeaking(heard: "actually move my gym to tomorrow", spoken: reply))
    }

    func testHisOwnNameInHisOwnSentenceIsEcho() {
        let intro = "I'm Orion, your external executive function."
        XCTAssertTrue(SelfEcho.isEchoWhileSpeaking(heard: "orion", spoken: intro))
        XCTAssertTrue(SelfEcho.isEchoWhileSpeaking(heard: "I'm Orion your", spoken: intro))
        XCTAssertFalse(SelfEcho.isEchoWhileSpeaking(heard: "Orion stop", spoken: intro), "stop is not in his sentence")
        XCTAssertEqual(SelfEcho.interruptions(in: "orion wait", spoken: intro), ["wait"])
    }

    func testNothingSaidOrHeardIsNotEcho() {
        XCTAssertFalse(SelfEcho.isEcho(heard: "", spoken: reply))
        XCTAssertFalse(SelfEcho.isEcho(heard: "what is on tomorrow", spoken: ""))
    }
}
