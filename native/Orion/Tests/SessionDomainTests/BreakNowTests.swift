//
//  "Break now", from the phone and from chat: end the focus block that is running, start its break, and let the next
//  focus block follow. Not a pause: a pause stops the clock, a break is time served as rest.
//

import XCTest
@testable import SessionDomain

final class BreakNowTests: XCTestCase {

    func testBreakNowDuringFocusStartsTheBreakAndTheNextBlockFollows() {
        let harness = Harness()
        harness.start()
        harness.advance(seconds: 30)

        let result = harness.send(.breakNow)

        XCTAssertTrue(result.applied)
        XCTAssertEqual(harness.status, .running(.rest))
        XCTAssertEqual(harness.now().phaseIndex, 1)
        XCTAssertEqual(harness.now().servedFocus, 30, accuracy: 0.001, "the thirty seconds worked still count")

        harness.advance(minutes: 1)
        XCTAssertEqual(harness.status, .running(.focus), "the break runs its length, then the next focus block starts")
        XCTAssertEqual(harness.now().phaseIndex, 2)
    }

    func testBreakNowIsRefusedWhenPausedOrAlreadyOnABreak() {
        let harness = Harness()
        harness.start()
        harness.send(.pause)
        XCTAssertFalse(harness.send(.breakNow).applied)
        XCTAssertEqual(harness.lastRejection, .notApplicable("A focus block has to be running to start a break from it."))

        harness.send(.resume)
        harness.advance(minutes: 2)
        XCTAssertEqual(harness.status, .running(.rest))
        XCTAssertFalse(harness.send(.breakNow).applied)
    }

    func testBreakNowOnTheLastBlockSaysThereIsNoBreakPlannedAndChangesNothing() {
        let harness = Harness()
        harness.start()
        harness.advance(minutes: 3)
        XCTAssertEqual(harness.status, .running(.focus))
        XCTAssertEqual(harness.now().phaseIndex, 2)

        let result = harness.send(.breakNow)

        XCTAssertFalse(result.applied)
        XCTAssertEqual(result.rejection, .notApplicable("No break is planned after this block."))
        XCTAssertEqual(harness.status, .running(.focus))
    }

    func testBreakNowRetryIsNotASecondBreak() {
        let harness = Harness()
        harness.start()
        harness.advance(seconds: 20)
        let request = RequestID("retry-1")
        XCTAssertTrue(harness.send(.breakNow, requestID: request).applied)
        let again = harness.send(.breakNow, requestID: request)
        XCTAssertEqual(again.rejection, .alreadyApplied(request))
        XCTAssertEqual(harness.now().phaseIndex, 1)
    }
}
