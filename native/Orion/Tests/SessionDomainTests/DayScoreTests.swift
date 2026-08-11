//
//  Scoring, and mostly refusing to.
//
//  The cases that matter are the missing ones. A watch that has not synced must
//  never look like a bad night.
//

import XCTest
@testable import SessionDomain

final class DayScoreTests: XCTestCase {

    private func record(planned: Double = 9000, served: Double = 9000,
                        blocks: Int = 3, done: Int = 3) -> HistoryRecord {
        HistoryRecord(
            sessionID: "S1", dayKey: "2026-03-02", task: "t",
            startedAt: Date(timeIntervalSince1970: 1_772_452_800),
            endedAt: Date(timeIntervalSince1970: 1_772_462_800),
            reason: .completed,
            plannedFocusSeconds: planned, servedFocusSeconds: served,
            plannedRestSeconds: 1200, servedRestSeconds: 1200,
            completedFocusBlocks: done, totalFocusBlocks: blocks,
            uncountedSeconds: 0, approximate: false
        )
    }

    private func full(focus: Double = 1, completion: Double = 1,
                      recovery: Double? = 0.8, sleep: Double? = 0.8,
                      care: Double? = 0.8) -> [ScoreInput] {
        [
            ScoreInput(.focusServed, value: focus),
            ScoreInput(.focusCompletion, value: completion),
            ScoreInput(.recovery, value: recovery, unavailable: recovery == nil ? "Whoop has not synced" : nil),
            ScoreInput(.sleep, value: sleep, unavailable: sleep == nil ? "Whoop has not synced" : nil),
            ScoreInput(.selfCare, value: care, unavailable: care == nil ? "nothing logged" : nil)
        ]
    }

    // MARK: The split

    func testAPerfectDayScoresOneHundred() {
        let score = DayScoring.score(dayKey: "2026-03-02",
                                     inputs: full(focus: 1, completion: 1,
                                                  recovery: 1, sleep: 1, care: 1))
        XCTAssertEqual(score.value ?? 0, 1, accuracy: 0.0001)
        XCTAssertEqual(score.displayValue, "100")
    }

    func testFocusIsSixtyPercentAndHealthIsForty() {
        // Perfect focus, zero health.
        let focusOnly = DayScoring.score(dayKey: "d", inputs: full(focus: 1, completion: 1,
                                                                  recovery: 0, sleep: 0, care: 0))
        XCTAssertEqual(focusOnly.value ?? 0, 0.60, accuracy: 0.0001)

        // Zero focus, perfect health.
        let healthOnly = DayScoring.score(dayKey: "d", inputs: full(focus: 0, completion: 0,
                                                                    recovery: 1, sleep: 1, care: 1))
        XCTAssertEqual(healthOnly.value ?? 0, 0.40, accuracy: 0.0001)
    }

    // MARK: Missing is not zero

    /// The rule the whole file exists for.
    func testAMissingComponentIsExcludedRatherThanScoredAsZero() {
        let withHealth = DayScoring.score(dayKey: "d", inputs: full(recovery: 1, sleep: 1, care: 1))
        let withoutHealth = DayScoring.score(dayKey: "d",
                                             inputs: full(recovery: nil, sleep: nil, care: nil))

        XCTAssertEqual(withHealth.value ?? 0, 1, accuracy: 0.0001)
        XCTAssertEqual(withoutHealth.value ?? 0, 1, accuracy: 0.0001,
                       "a watch that did not sync is not a bad night")
    }

    func testAMissingComponentIsNotTheSameAsAZeroOne() {
        let missing = DayScoring.score(dayKey: "d", inputs: full(recovery: nil))
        let zero = DayScoring.score(dayKey: "d", inputs: full(recovery: 0))

        XCTAssertGreaterThan(missing.value ?? 0, zero.value ?? 0)
    }

    func testTooLittleDataRefusesToScoreRatherThanGuessing() {
        let barely = [
            ScoreInput(.selfCare, value: 1),
            ScoreInput(.focusServed, value: nil, unavailable: "no focus session today"),
            ScoreInput(.focusCompletion, value: nil, unavailable: "no focus session today"),
            ScoreInput(.recovery, value: nil, unavailable: "Whoop has not synced"),
            ScoreInput(.sleep, value: nil, unavailable: "Whoop has not synced")
        ]

        let score = DayScoring.score(dayKey: "d", inputs: barely)

        XCTAssertNil(score.value)
        XCTAssertEqual(score.displayValue, "—", "never a zero, and never a made-up number")
        XCTAssertNotNil(score.insufficient)
        XCTAssertTrue(score.insufficient!.contains("Whoop"), score.insufficient!)
    }

    func testADayWithNoSessionIsNotADayThatFailedAtFocus() {
        let inputs = DayScoring.focusInputs(records: [])

        XCTAssertTrue(inputs.allSatisfy { !$0.counted })
        XCTAssertEqual(inputs.first?.unavailable, "no focus session today")
    }

    // MARK: Visible components

    func testEveryComponentReportsItselfIncludingTheMissingOnes() {
        let score = DayScoring.score(dayKey: "d", inputs: full(recovery: nil))

        XCTAssertEqual(score.parts.count, ScoreComponent.allCases.count)
        let recovery = score.parts.first { $0.component == .recovery }!
        XCTAssertNil(recovery.value)
        XCTAssertEqual(recovery.effectiveWeight, 0, "it carried none of the day")
        XCTAssertNotNil(recovery.unavailable, "and it says why")
    }

    func testCoverageIsReported() {
        let complete = DayScoring.score(dayKey: "d", inputs: full())
        XCTAssertEqual(complete.coverage, 1, accuracy: 0.0001)

        let partial = DayScoring.score(dayKey: "d", inputs: full(recovery: nil, sleep: nil))
        XCTAssertLessThan(partial.coverage, 1)
        XCTAssertGreaterThan(partial.coverage, 0)
    }

    // MARK: The version

    /// Changing weights must not silently repaint history.
    func testTheScoreCarriesThePolicyVersionThatProducedIt() {
        let old = ScorePolicy(version: 1, focusShare: 0.6, healthShare: 0.4)
        let new = ScorePolicy(version: 2, focusShare: 0.8, healthShare: 0.2)

        let a = DayScoring.score(dayKey: "d", inputs: full(), policy: old)
        let b = DayScoring.score(dayKey: "d", inputs: full(), policy: new)

        XCTAssertEqual(a.policyVersion, 1)
        XCTAssertEqual(b.policyVersion, 2)
        XCTAssertNotEqual(a.value, b.value, "different weights, different number — "
                          + "which is exactly why the version has to travel with it")
    }

    // MARK: From real records

    func testFocusInputsComeOutOfHistory() {
        let inputs = DayScoring.focusInputs(records: [record(planned: 9000, served: 4500,
                                                             blocks: 3, done: 1)])

        XCTAssertEqual(inputs.first { $0.component == .focusServed }?.value ?? 0,
                       0.5, accuracy: 0.0001)
        XCTAssertEqual(inputs.first { $0.component == .focusCompletion }?.value ?? 0,
                       1.0 / 3.0, accuracy: 0.0001)
    }

    func testTwoSessionsInADayAreAddedTogether() {
        let inputs = DayScoring.focusInputs(records: [
            record(planned: 3000, served: 3000, blocks: 1, done: 1),
            record(planned: 3000, served: 1500, blocks: 1, done: 0)
        ])

        XCTAssertEqual(inputs.first { $0.component == .focusServed }?.value ?? 0,
                       0.75, accuracy: 0.0001)
        XCTAssertEqual(inputs.first { $0.component == .focusCompletion }?.value ?? 0,
                       0.5, accuracy: 0.0001)
    }
}
