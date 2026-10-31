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

    // MARK: REV3 #8: a cancel stops its own turn's process, never the next one

    private func sleeper() throws -> Process {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/bin/sleep")
        p.arguments = ["30"]
        try p.run()
        return p
    }

    func testCancelStopsTheProcessAttachedToItsOwnTurn() throws {
        let turn = TurnCancellation()
        let process = try sleeper()
        turn.attach(process)
        turn.cancel()
        process.waitUntilExit()
        XCTAssertFalse(process.isRunning)
    }

    func testCancellingAnOldTurnLeavesTheNextTurnsProcessAlone() throws {
        let old = TurnCancellation()
        let next = TurnCancellation()
        let process = try sleeper()
        defer { process.terminate() }
        next.attach(process)
        old.cancel()
        Thread.sleep(forTimeInterval: 0.3)
        XCTAssertTrue(process.isRunning, "the old turn's cancel killed the new turn's process")
    }

    func testAProcessStartedAfterTheCancelIsStoppedAtOnce() throws {
        let turn = TurnCancellation()
        turn.cancel()
        let process = try sleeper()
        turn.attach(process)
        process.waitUntilExit()
        XCTAssertFalse(process.isRunning)
    }

    func testADetachedProcessIsNotStopped() throws {
        let turn = TurnCancellation()
        let process = try sleeper()
        defer { process.terminate() }
        turn.attach(process)
        turn.detach(process)
        turn.cancel()
        Thread.sleep(forTimeInterval: 0.3)
        XCTAssertTrue(process.isRunning)
    }
}
