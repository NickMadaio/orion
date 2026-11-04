import XCTest
@testable import Orion

/// w18: a typed turn must not vanish when the overlay closes, and a typed-overlay URL must not raise the dashboard.
final class TypedSummonHandoffTests: XCTestCase {

    func testClosingTheOverlayMidTurnDocksIt() {
        XCTAssertTrue(TypedSummonHandoff.shouldDock(hasUserInput: true, phase: .thinking))
        XCTAssertTrue(TypedSummonHandoff.shouldDock(hasUserInput: true, phase: .speaking))
    }

    func testClosingAnIdleOrEmptyOverlayDocksNothing() {
        XCTAssertFalse(TypedSummonHandoff.shouldDock(hasUserInput: true, phase: .idle))
        XCTAssertFalse(TypedSummonHandoff.shouldDock(hasUserInput: false, phase: .thinking))
        XCTAssertFalse(TypedSummonHandoff.shouldDock(hasUserInput: true, phase: .listening))
    }

    func testReopenShowsTheDashboardNormally() {
        let policy = ReopenPolicy()
        XCTAssertTrue(policy.showsDashboard(now: Date(), typedSummonVisible: false))
    }

    func testReopenIsQuietRightAfterATypedSummon() {
        var policy = ReopenPolicy()
        let t0 = Date(timeIntervalSince1970: 1_000)
        policy.noteTypedSummon(now: t0)
        XCTAssertFalse(policy.showsDashboard(now: t0.addingTimeInterval(0.5), typedSummonVisible: false))
        XCTAssertFalse(policy.showsDashboard(now: t0.addingTimeInterval(ReopenPolicy.quietSeconds - 0.1), typedSummonVisible: false))
        XCTAssertTrue(policy.showsDashboard(now: t0.addingTimeInterval(ReopenPolicy.quietSeconds + 0.1), typedSummonVisible: false))
    }

    func testReopenNeverShowsTheDashboardUnderTheOpenOverlay() {
        XCTAssertFalse(ReopenPolicy().showsDashboard(now: Date(), typedSummonVisible: true))
    }
}
