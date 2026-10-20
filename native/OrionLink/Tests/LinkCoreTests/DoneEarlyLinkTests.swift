import XCTest
import MobileCore

/// The phone's "Done early" press as the Mac's link receives it (LinkEngine.answerCheckin builds its command from these).
final class DoneEarlyLinkTests: XCTestCase {
    func testThePhonePressReachesTheOneEarlyCommand() throws {
        let sent = try LinkLog.checkin(action: DoneEarly.linkAction).encoded()
        guard case .checkin(let action)? = try? LinkLog.decode(sent) else { return XCTFail("not read back as a check-in") }
        XCTAssertEqual(DoneEarly.rescheduleArguments(forLinkAction: action), ["early"])
    }

    func testEveryEarlyActionTheLinkAcceptsRunsTheEarlyCommand() throws {
        for action in ["done", "done:ci-0a1b2c", "early-block", "early-out-of-class", DoneEarly.linkAction] {
            XCTAssertNoThrow(try LinkLog.checkin(action: action).validated(), action)
            XCTAssertEqual(DoneEarly.rescheduleArguments(forLinkAction: action)?.first, "early", action)
        }
        for action in ["started", "snooze"] { XCTAssertNil(DoneEarly.rescheduleArguments(forLinkAction: action), action) }
    }

    func testTheReplyIsTheOneShortLine() {
        let out = "Nothing is on right now. Next up: CS Lab at 6:10 PM — want to start it early?\nChanged nothing"
        XCTAssertEqual(DoneEarly.summary(from: out), "Nothing is on right now. Next up: CS Lab at 6:10 PM — want to start it early?")
    }

    func testAMacWidgetsDoneBecomesTheCheckinsOwnDone() throws {
        let text = try LinkLog.checkin(action: DoneEarly.checkinDone(id: "ci-0a1b2c")).encoded()
        guard case .checkin(let action)? = try? LinkLog.decode(text) else { return XCTFail("not a check-in") }
        XCTAssertEqual(DoneEarly.rescheduleArguments(forLinkAction: action), ["early", "block", "--checkin", "ci-0a1b2c"])
    }
}
