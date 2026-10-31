import XCTest
@testable import Orion

/// 2026-10-31 17:40: Escape cancelled the turn at :24, during the inbound-turn
/// settle wait, before the gateway process existed, so there was nothing to
/// kill, and the fragment still reached the gateway at :27. The flag is what
/// the agent queue checks before it starts the process.
final class TurnCancellationTests: XCTestCase {

    func testANewTurnIsLive() {
        XCTAssertFalse(TurnCancellation().isCancelled)
    }

    func testCancelIsSeenFromAnotherThread() {
        let flag = TurnCancellation()
        let seen = expectation(description: "seen on the agent queue")
        flag.cancel()
        DispatchQueue(label: "test.agent").async {
            XCTAssertTrue(flag.isCancelled)
            seen.fulfill()
        }
        wait(for: [seen], timeout: 2)
    }

    func testCancellingOneTurnLeavesTheNextAlone() {
        let first = TurnCancellation()
        first.cancel()
        XCTAssertFalse(TurnCancellation().isCancelled)
    }
}
