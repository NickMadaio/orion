//
//  The liveness watermark, and the case it exists for.
//
//  Without it the domain knows when the app came back but not when it died, so
//  the entire gap has to be written off. These tests pin the bound: at most one
//  heartbeat interval is lost, and the log does not grow without limit paying
//  for it.
//

import XCTest
@testable import SessionDomain

final class HeartbeatTests: XCTestCase {

    /// The motivating case, stated plainly: a crash near the end of a long
    /// block must not void the block.
    func testACrashAtMinute49OfA50MinuteBlockKeepsThe49Minutes() {
        let harness = Harness()
        harness.start(Harness.fullPlan())

        harness.advance(minutes: 49)

        // The app dies and comes back a minute later.
        harness.advanceWhileDown(minutes: 1)
        harness.noteProcessStart()

        let served = harness.now().servedInPhase
        XCTAssertGreaterThanOrEqual(served, 49 * 60 - Harness.heartbeatInterval,
                                    "at most one heartbeat interval may be lost")
        XCTAssertLessThanOrEqual(served, 49 * 60)
        XCTAssertEqual(harness.status, .running(.focus), "and the block is still going")
    }

    func testWhatIsLostToACrashIsBoundedByTheHeartbeatInterval() {
        let harness = Harness()
        harness.start(Harness.fullPlan())
        harness.advance(minutes: 20)

        // Die immediately after a heartbeat, in the worst possible place: just
        // before the next one would have been written.
        harness.advanceWhileDown(seconds: Harness.heartbeatInterval - 1)
        harness.advanceWhileDown(minutes: 5)
        harness.noteProcessStart()

        let lost = 20 * 60 - harness.now().servedInPhase
        XCTAssertLessThanOrEqual(lost, Harness.heartbeatInterval,
                                 "the unbounded version of this bug voided whole blocks")
    }

    // MARK: The log stays small

    func testHeartbeatsCoalesceRatherThanAccumulating() {
        let harness = Harness()
        harness.start(Harness.fullPlan())

        harness.advance(minutes: 50)   // 100 heartbeat intervals

        let beats = harness.state!.events.filter { $0.kind == .processAlive }.count
        XCTAssertEqual(beats, 1, "a trailing heartbeat is replaced, never appended to")
        XCTAssertLessThan(harness.state!.events.count, 5,
                          "a 50-minute session must not produce a 100-event log")
    }

    func testARealEventBreaksTheCoalescingSoThePreviousWatermarkIsKept() {
        let harness = Harness()
        harness.start(Harness.fullPlan())
        harness.advance(minutes: 5)
        harness.send(.pause)
        harness.send(.resume)
        harness.advance(minutes: 5)

        let beats = harness.state!.events.filter { $0.kind == .processAlive }.count
        XCTAssertEqual(beats, 2, "one watermark per run stretch, not one per session")
    }

    func testTheHeartbeatMovesForwardInTime() {
        let harness = Harness()
        harness.start(Harness.fullPlan())
        harness.advance(minutes: 1)
        let first = harness.state!.events.last!.stamp.wall

        harness.advance(minutes: 1)
        let second = harness.state!.events.last!.stamp.wall

        XCTAssertGreaterThan(second, first)
    }

    // MARK: It cannot cause damage

    func testAHeartbeatNeverChangesTheDerivedAnswer() {
        let harness = Harness()
        harness.start(Harness.fullPlan())
        harness.advance(minutes: 10)

        let before = harness.now()
        harness.heartbeat()
        harness.heartbeat()
        harness.heartbeat()
        let after = harness.now()

        XCTAssertEqual(before.servedInPhase, after.servedInPhase, accuracy: 0.001)
        XCTAssertEqual(before.status, after.status)
        XCTAssertEqual(before.phaseIndex, after.phaseIndex)
    }

    func testAHeartbeatOnAFinishedSessionIsIgnored() {
        let harness = Harness()
        harness.start()
        harness.send(.finishEarly)
        let before = harness.state!

        harness.heartbeat()

        XCTAssertEqual(harness.state!, before, "nothing is written after the terminal event")
    }

    func testHeartbeatsDoNotDisturbAPause() {
        let harness = Harness()
        harness.start(Harness.fullPlan())
        harness.advance(minutes: 5)
        harness.send(.pause)

        harness.advance(minutes: 30)

        XCTAssertEqual(harness.status, .paused)
        XCTAssertEqual(harness.now().servedInPhase, 5 * 60, accuracy: 0.001,
                       "heartbeating while paused must not serve time")
    }
}
