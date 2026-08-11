//
//  The cycle, and the ways it gets interrupted.
//
//  Every test here drives stub clocks, so nothing waits and nothing is flaky.
//  The plan under test is the short one — 2 minutes focus, 1 minute rest,
//  2 minutes focus — because it is the same code path as 50/10/50/10/50 and it
//  fits in your head.
//

import XCTest
@testable import SessionDomain

final class SessionCycleTests: XCTestCase {

    // MARK: The normal cycle

    func testFullCycleRunsThroughEveryPhaseAndCompletes() {
        let harness = Harness()
        harness.start()

        XCTAssertEqual(harness.status, .running(.focus))
        XCTAssertEqual(harness.now().phaseIndex, 0)

        harness.advance(minutes: 2)
        XCTAssertEqual(harness.status, .running(.rest), "two minutes served ends the first block")
        XCTAssertEqual(harness.now().phaseIndex, 1)

        harness.advance(minutes: 1)
        XCTAssertEqual(harness.status, .running(.focus))
        XCTAssertEqual(harness.now().phaseIndex, 2)

        harness.advance(minutes: 2)
        XCTAssertEqual(harness.status, .readyToComplete,
                       "everything served, but nothing has archived it yet")

        harness.completeIfServed()
        XCTAssertEqual(harness.status, .finished(.completed))

        let reconciliation = harness.now()
        XCTAssertEqual(reconciliation.servedFocus, 240, accuracy: 0.001)
        XCTAssertEqual(reconciliation.servedRest, 60, accuracy: 0.001)
        XCTAssertEqual(reconciliation.completedFocusBlocks, 2)
        XCTAssertFalse(reconciliation.approximate, "nothing here needed the wall clock")
    }

    func testServedTimeAccumulatesWithinAPhase() {
        let harness = Harness()
        harness.start()

        harness.advance(seconds: 45)

        let reconciliation = harness.now()
        XCTAssertEqual(reconciliation.servedInPhase, 45, accuracy: 0.001)
        XCTAssertEqual(reconciliation.remainingInPhase, 75, accuracy: 0.001)
    }

    // MARK: Pause and resume

    func testPauseStopsTheClockAndResumeStartsItAgain() {
        let harness = Harness()
        harness.start()
        harness.advance(seconds: 30)

        harness.send(.pause)
        XCTAssertEqual(harness.status, .paused)

        harness.advance(minutes: 10)
        XCTAssertEqual(harness.now().servedInPhase, 30, accuracy: 0.001,
                       "ten minutes paused served nothing")
        XCTAssertEqual(harness.now().uncounted, 600, accuracy: 0.001)

        harness.send(.resume)
        XCTAssertEqual(harness.status, .running(.focus))

        harness.advance(seconds: 30)
        XCTAssertEqual(harness.now().servedInPhase, 60, accuracy: 0.001)
    }

    func testPausingWhenNothingIsRunningIsRejected() {
        let harness = Harness()
        harness.start()
        harness.send(.pause)

        let result = harness.send(.pause)

        XCTAssertFalse(result.applied)
        XCTAssertEqual(result.rejection, .notApplicable("Nothing is running to pause."))
    }

    func testAPausedSessionDoesNotPromptAboutTheTimeItWasPaused() {
        let harness = Harness()
        harness.start()
        harness.send(.pause)
        harness.advance(minutes: 45)
        harness.send(.resume)

        XCTAssertTrue(harness.now().effects.absences.isEmpty,
                      "pausing is a decision, not an absence to account for")
    }

    // MARK: Break shortening

    func testSkippingARestGoesStraightToTheNextFocusBlock() {
        let harness = Harness()
        harness.start()
        harness.advance(minutes: 2)
        XCTAssertEqual(harness.status, .running(.rest))

        harness.advance(seconds: 10)
        harness.send(.skipRest)

        XCTAssertEqual(harness.status, .running(.focus))
        XCTAssertEqual(harness.now().phaseIndex, 2)
        XCTAssertEqual(harness.now().servedRest, 10, accuracy: 0.001,
                       "the ten seconds actually rested still count")
    }

    func testShorteningARestLeavesExactlyTheRequestedTime() {
        let harness = Harness()
        harness.start()
        harness.advance(minutes: 2)
        harness.advance(seconds: 10)

        harness.send(.shortenRest(to: 20))

        XCTAssertEqual(harness.now().remainingInPhase, 20, accuracy: 0.001)

        harness.advance(seconds: 19)
        XCTAssertEqual(harness.status, .running(.rest))

        harness.advance(seconds: 2)
        XCTAssertEqual(harness.status, .running(.focus))
    }

    func testARestCanBeShortenedTwice() {
        let harness = Harness()
        harness.start()
        harness.advance(minutes: 2)

        harness.send(.shortenRest(to: 40))
        harness.advance(seconds: 10)
        harness.send(.shortenRest(to: 5))

        XCTAssertEqual(harness.now().remainingInPhase, 5, accuracy: 0.001,
                       "the later command wins")
    }

    func testShorteningIsRejectedDuringAFocusBlock() {
        let harness = Harness()
        harness.start()

        let result = harness.send(.shortenRest(to: 30))

        XCTAssertFalse(result.applied)
        XCTAssertEqual(result.rejection, .notApplicable("There is no break running to shorten."))
    }

    // MARK: Idle

    func testARestEndingWhileIdleWaitsAndKeepsWaiting() {
        let harness = Harness()
        harness.start()
        harness.advance(minutes: 2)

        harness.send(.noteIdle)
        harness.advance(minutes: 1)

        XCTAssertEqual(harness.status, .waitingForReturn(afterRestIndex: 1),
                       "the break ended while he was away; it must not roll into focus")

        // And it STAYS waiting, however long he is gone.
        harness.advance(minutes: 30)
        XCTAssertEqual(harness.status, .waitingForReturn(afterRestIndex: 1))
        XCTAssertEqual(harness.now().servedFocus, 120, accuracy: 0.001,
                       "not one second of the second block was served while he was away")
    }

    func testComingBackReleasesTheHold() {
        let harness = Harness()
        harness.start()
        harness.advance(minutes: 2)
        harness.send(.noteIdle)
        harness.advance(minutes: 5)
        XCTAssertEqual(harness.status, .waitingForReturn(afterRestIndex: 1))

        harness.send(.noteReturned)
        harness.advance(seconds: 30)

        XCTAssertEqual(harness.status, .running(.focus))
        XCTAssertEqual(harness.now().servedInPhase, 30, accuracy: 0.001)
    }

    func testGoingIdleDuringFocusStillCountsTheTime() {
        // Deliberate: the domain does not decide that idleness means absence.
        // Enforcement is Gate 5's job, and idle-during-focus is what it acts on.
        let harness = Harness()
        harness.start()
        harness.send(.noteIdle)
        harness.advance(seconds: 60)

        XCTAssertEqual(harness.now().servedInPhase, 60, accuracy: 0.001)
        XCTAssertEqual(harness.status, .running(.focus))
    }

    // MARK: Early completion

    func testFinishingEarlyArchivesAsSuccess() {
        let harness = Harness()
        harness.start()
        harness.advance(minutes: 1)

        harness.send(.finishEarly)

        XCTAssertEqual(harness.status, .finished(.early))
        let record = harness.now().effects.historyRecords.first
        XCTAssertEqual(record?.reason, .early)
        XCTAssertEqual(record?.reason.isSuccess, true, "early is a success, by decision")
        XCTAssertEqual(record?.servedFocusSeconds ?? 0, 60, accuracy: 0.001)
        XCTAssertEqual(record?.plannedFocusSeconds ?? 0, 240, accuracy: 0.001)
    }

    func testAbandoningIsADifferentFactFromFinishingEarly() {
        let harness = Harness()
        harness.start()
        harness.advance(minutes: 1)

        harness.send(.abandon)

        XCTAssertEqual(harness.status, .finished(.abandoned))
        XCTAssertEqual(harness.now().effects.historyRecords.first?.reason, .abandoned)
        XCTAssertEqual(harness.now().effects.historyRecords.first?.reason.isSuccess, false)
    }

    func testNothingAppliesAfterTheSessionEnds() {
        let harness = Harness()
        harness.start()
        harness.send(.finishEarly)

        let result = harness.send(.pause)

        XCTAssertFalse(result.applied)
        XCTAssertEqual(result.rejection, .sessionFinished(SessionID("S1")))
    }

    func testTimeAfterTheFinishEventIsNotServed() {
        let harness = Harness()
        harness.start()
        harness.advance(minutes: 1)
        harness.send(.finishEarly)

        harness.advance(minutes: 30)

        XCTAssertEqual(harness.now().servedFocus, 60, accuracy: 0.001)
    }

    // MARK: Starting

    func testStartingWhileASessionIsRunningIsRefused() {
        let harness = Harness()
        harness.start()

        let result = harness.start(Harness.shortPlan(session: SessionID("S2")))

        XCTAssertFalse(result.applied)
        XCTAssertEqual(result.rejection, .sessionAlreadyRunning(SessionID("S1")))
        XCTAssertEqual(harness.state?.id, SessionID("S1"), "the running one is untouched")
    }

    func testStartingAfterOneFinishedIsAllowed() {
        let harness = Harness()
        harness.start()
        harness.send(.finishEarly)

        let result = harness.start(Harness.shortPlan(session: SessionID("S2")))

        XCTAssertTrue(result.applied)
        XCTAssertEqual(harness.state?.id, SessionID("S2"))
    }

    func testAPlanWithNoFocusBlockIsRefused() {
        let harness = Harness()
        let empty = SessionPlan(sessionID: SessionID("S9"), phases: [], task: "nothing")

        let result = harness.send(.start(plan: empty))

        XCTAssertFalse(result.applied)
        XCTAssertEqual(result.rejection, .invalidPlan("it has no phases"))
    }

    // MARK: The full-length plan

    func testTheRealFiftyTenFiftyPlanHasTheShapeItShould() {
        let plan = Harness.fullPlan()

        XCTAssertEqual(plan.phases.map(\.kind), [.focus, .rest, .focus, .rest, .focus])
        XCTAssertEqual(plan.focusDuration, 150 * 60, accuracy: 0.001)
        XCTAssertEqual(plan.totalPlannedDuration, 170 * 60, accuracy: 0.001)
        XCTAssertEqual(plan.phases.last?.kind, .focus, "never end on a break")
    }
}
