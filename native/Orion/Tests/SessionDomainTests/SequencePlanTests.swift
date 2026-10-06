import XCTest
@testable import SessionDomain

/// Arbitrary focus sequences and starting part-way (6 Oct 2026): "20 work,
/// 5 break, 40 work", a session that opens on a break, or only what was left.
final class SequencePlanTests: XCTestCase {
    private let session = SessionID("s-seq")

    func testASequenceKeepsTheOrderAndLengthsAsked() throws {
        let plan = try XCTUnwrap(SessionPlanBuilder.sequence(
            session: session, phases: [(.focus, 1200), (.rest, 300), (.focus, 2400)], task: "essay"))
        XCTAssertEqual(plan.phases.map(\.kind), [.focus, .rest, .focus])
        XCTAssertEqual(plan.phases.map(\.requestedDuration), [1200, 300, 2400])
        XCTAssertEqual(plan.phases.map(\.index), [0, 1, 2])
    }

    func testASessionCanOpenOnABreakAndThenFocus() throws {
        let plan = try XCTUnwrap(SessionPlanBuilder.sequence(
            session: session, phases: [(.rest, 60), (.focus, 120)], task: "after the break"))
        let harness = Harness()
        harness.start(plan)
        XCTAssertEqual(harness.status, .running(.rest))
        harness.advance(seconds: 61)
        XCTAssertEqual(harness.status, .running(.focus))
        XCTAssertEqual(harness.now().servedRest, 60, accuracy: 0.5)
    }

    func testTwoFocusPhasesInARowStaySeparate() throws {
        let plan = try XCTUnwrap(SessionPlanBuilder.sequence(
            session: session, phases: [(.focus, 600), (.focus, 900)], task: "x"))
        XCTAssertEqual(plan.phases.count, 2)
    }

    func testImpossibleSequencesAreRefused() {
        XCTAssertNil(SessionPlanBuilder.sequence(session: session, phases: [], task: "x"))
        XCTAssertNil(SessionPlanBuilder.sequence(session: session, phases: [(.rest, 300)], task: "x"),
                     "breaks alone are not a focus session")
        XCTAssertNil(SessionPlanBuilder.sequence(session: session, phases: [(.focus, 0)], task: "x"))
        XCTAssertNil(SessionPlanBuilder.sequence(session: session, phases: [(.focus, 5 * 3600)], task: "x"))
        XCTAssertNil(SessionPlanBuilder.sequence(
            session: session, phases: Array(repeating: (PhaseKind.focus, 60.0), count: 13), task: "x"))
    }
}
