import XCTest
@testable import MobileCore

final class DoneEarlyTests: XCTestCase {
    func testTheButtonIsCalledDoneEarlyWithACheckmark() {
        XCTAssertEqual(DoneEarly.label, "Done early")
        XCTAssertEqual(DoneEarly.symbol, "checkmark.circle")
    }

    func testAccessibilityTextNamesTheButtonAndWhatItEnds() {
        XCTAssertEqual(DoneEarly.accessibilityLabel(for: nil), "Done early")
        XCTAssertEqual(DoneEarly.accessibilityLabel(for: .init(kind: "none")), "Done early")
        XCTAssertEqual(DoneEarly.accessibilityLabel(for: .init(kind: "block", title: "Finish resume", blockKind: "task")), "Done early: Finish resume")
        XCTAssertEqual(DoneEarly.accessibilityLabel(for: .init(kind: "after-class", classTitle: "CS1802")), "Done early: CS1802")
        for context in [nil, EarlyFinishContext(kind: "none"), .init(kind: "block", title: "x"), .init(kind: "after-class", classTitle: "x")] {
            let text = DoneEarly.accessibilityLabel(for: context) + DoneEarly.accessibilityHint(for: context)
            XCTAssertFalse(text.localizedCaseInsensitiveContains("out early"), "the old wording is gone everywhere")
        }
        XCTAssertTrue(DoneEarly.accessibilityHint(for: .init(kind: "none")).contains("Nothing is on right now"), "with nothing on it still works and says so")
    }

    func testEveryLinkActionRunsTheOneEarlyCommand() {
        XCTAssertEqual(DoneEarly.rescheduleArguments(forLinkAction: DoneEarly.linkAction), ["early"], "the planner decides what is current")
        XCTAssertEqual(DoneEarly.rescheduleArguments(forLinkAction: "done"), ["early", "block", "--checkin", "latest"])
        XCTAssertEqual(DoneEarly.rescheduleArguments(forLinkAction: "early-block"), ["early", "block"])
        XCTAssertEqual(DoneEarly.rescheduleArguments(forLinkAction: "early-out-of-class"), ["early", "out-of-class"])
        XCTAssertNil(DoneEarly.rescheduleArguments(forLinkAction: "snooze"))
        XCTAssertNil(DoneEarly.rescheduleArguments(forLinkAction: "early-home"))
    }

    func testTheMacButtonModes() {
        XCTAssertEqual(DoneEarly.rescheduleArguments(mode: "auto"), ["early"])
        XCTAssertEqual(DoneEarly.rescheduleArguments(mode: "out-of-class"), ["early", "out-of-class"])
        XCTAssertNil(DoneEarly.rescheduleArguments(mode: "home"))
    }

    func testThePhonePressIsAValidCheckinAnswer() throws {
        XCTAssertNoThrow(try LinkLog.checkin(action: DoneEarly.linkAction).validated())
        let text = try LinkLog.checkin(action: DoneEarly.linkAction).encoded()
        guard case .checkin(let action)? = try? LinkLog.decode(text) else { return XCTFail("the Mac must read the press back as a check-in") }
        XCTAssertEqual(DoneEarly.rescheduleArguments(forLinkAction: action), ["early"])
    }

    func testOnlyTheFirstLineIsTheAnswer() {
        let output = "Nice — Finish resume is done and checked off. Next: CS Lab at 6:10 PM.\nChanged Tuesday 2026-10-20:\n  finished Finish resume at 14:40"
        XCTAssertEqual(DoneEarly.summary(from: output), "Nice — Finish resume is done and checked off. Next: CS Lab at 6:10 PM.")
        XCTAssertEqual(DoneEarly.summary(from: "\n  \n"), "Done.")
        XCTAssertLessThanOrEqual(DoneEarly.summary(from: String(repeating: "a", count: 900)).count, 240)
    }

    func testTheContextDecodesFromAnOldAndANewPlanner() throws {
        let old = try JSONDecoder().decode(EarlyFinishContext.self, from: Data(#"{"kind":"block","id":"b","title":"Study"}"#.utf8))
        XCTAssertEqual(old, EarlyFinishContext(kind: "block", title: "Study"))
        let new = try JSONDecoder().decode(EarlyFinishContext.self, from: Data(#"{"kind":"block","id":"b","title":"Gym","blockKind":"activity"}"#.utf8))
        XCTAssertEqual(new.blockKind, "activity")
    }

    func testACheckinsDoneCarriesItsOwnIDAndActsOnThatBlockOnly() throws {
        XCTAssertEqual(DoneEarly.checkinDone(id: "ci-a1b2c3"), "done:ci-a1b2c3")
        XCTAssertEqual(DoneEarly.checkinDone(id: nil), "done")
        XCTAssertEqual(DoneEarly.checkinDone(id: "ci-a1b2c3; rm -rf"), "done", "an id of any other shape is never sent")
        XCTAssertEqual(DoneEarly.rescheduleArguments(forLinkAction: "done:ci-a1b2c3"), ["early", "block", "--checkin", "ci-a1b2c3"])
        XCTAssertEqual(DoneEarly.checkinID(fromLinkAction: "done:ci-a1b2c3"), "ci-a1b2c3")
        XCTAssertNil(DoneEarly.checkinID(fromLinkAction: "done:../x"))
        XCTAssertNil(DoneEarly.rescheduleArguments(forLinkAction: "done:../x"))
        XCTAssertNoThrow(try LinkLog.checkin(action: "done:ci-a1b2c3").validated())
        XCTAssertThrowsError(try LinkLog.checkin(action: "done:evil").validated())
        for arguments in [DoneEarly.rescheduleArguments(forLinkAction: "done"), DoneEarly.rescheduleArguments(forLinkAction: "done:ci-a1b2c3")] {
            XCTAssertTrue(arguments?.contains("--checkin") == true, "a check-in's Done is never 'whatever is current'")
        }
    }
}
