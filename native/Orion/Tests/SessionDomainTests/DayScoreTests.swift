//
//  Scoring, and knowing when to refuse.
//
//  Two failure modes, pulling against each other, and both are covered here.
//  A watch that has not synced must never look like a bad night — that is what
//  most of these tests are about. But v1 leaned so far that way it refused to
//  score any day Nick did not run a focus session on, and the calendar was grey
//  for it. The Whoop-only cases below are the ones that guard the fix.
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

    /// Every component present, so a test can knock out exactly one.
    private func full(focus: Double? = 1, completion: Double? = 1, tasks: Double? = 1,
                      recovery: Double? = 0.8, sleep: Double? = 0.8, exertion: Double? = 0.8,
                      care: Double? = 0.8, nutrition: Double? = 0.8) -> [ScoreInput] {
        [
            ScoreInput(.focusServed, value: focus, unavailable: focus == nil ? "no session" : nil),
            ScoreInput(.focusCompletion, value: completion, unavailable: completion == nil ? "no session" : nil),
            ScoreInput(.tasks, value: tasks, unavailable: tasks == nil ? "nothing due" : nil),
            ScoreInput(.recovery, value: recovery, unavailable: recovery == nil ? "Whoop has not synced" : nil),
            ScoreInput(.sleep, value: sleep, unavailable: sleep == nil ? "Whoop has not synced" : nil),
            ScoreInput(.exertion, value: exertion, unavailable: exertion == nil ? "no strain recorded" : nil),
            ScoreInput(.selfCare, value: care, unavailable: care == nil ? "nothing logged" : nil),
            ScoreInput(.nutrition, value: nutrition, unavailable: nutrition == nil ? "nothing logged" : nil)
        ]
    }

    /// Only the watch — the shape of most of Nick's days.
    private func whoopOnly(recovery: Double = 0.7, sleep: Double = 0.9,
                           exertion: Double = 1) -> [ScoreInput] {
        full(focus: nil, completion: nil, tasks: nil,
             recovery: recovery, sleep: sleep, exertion: exertion,
             care: nil, nutrition: nil)
    }

    // MARK: Out of ten

    func testAPerfectDayIsATen() {
        let score = DayScoring.score(dayKey: "2026-03-02",
                                     inputs: full(focus: 1, completion: 1, tasks: 1,
                                                  recovery: 1, sleep: 1, exertion: 1,
                                                  care: 1, nutrition: 1))
        XCTAssertEqual(score.outOfTen ?? 0, 10, accuracy: 0.0001)
        XCTAssertEqual(score.displayValue, "10.0")
    }

    func testTheNumberCarriesOneDecimal() {
        let score = DayScoring.score(dayKey: "d", inputs: whoopOnly(recovery: 0.71, sleep: 0.8,
                                                                   exertion: 0.5))
        XCTAssertEqual(score.displayValue.split(separator: ".").last?.count, 1)
        XCTAssertNotEqual(score.displayValue, "—")
    }

    func testTheSplitIsWorkBodyCare() {
        let workOnly = DayScoring.score(dayKey: "d", inputs: full(focus: 1, completion: 1, tasks: 1,
                                                                  recovery: 0, sleep: 0, exertion: 0,
                                                                  care: 0, nutrition: 0))
        XCTAssertEqual(workOnly.value ?? 0, 0.45, accuracy: 0.0001)

        let bodyOnly = DayScoring.score(dayKey: "d", inputs: full(focus: 0, completion: 0, tasks: 0,
                                                                  recovery: 1, sleep: 1, exertion: 1,
                                                                  care: 0, nutrition: 0))
        XCTAssertEqual(bodyOnly.value ?? 0, 0.40, accuracy: 0.0001)

        let careOnly = DayScoring.score(dayKey: "d", inputs: full(focus: 0, completion: 0, tasks: 0,
                                                                  recovery: 0, sleep: 0, exertion: 0,
                                                                  care: 1, nutrition: 1))
        XCTAssertEqual(careOnly.value ?? 0, 0.15, accuracy: 0.0001)
    }

    // MARK: The grey-calendar fix

    /// The bug this version exists for: Whoop syncs every day whether or not
    /// Nick sits down at the desk, so a day known only through the watch has to
    /// produce a number.
    func testADayKnownOnlyThroughWhoopStillScores() {
        let score = DayScoring.score(dayKey: "d", inputs: whoopOnly())

        XCTAssertNotNil(score.value, "the watch alone has to be able to colour a day")
        XCTAssertNil(score.insufficient)
        XCTAssertEqual(score.contributingGroups, [.body])
    }

    func testAWhoopOnlyDayIsScoredOnItsOwnMeritsNotDraggedDownByTheMissingRest() {
        let good = DayScoring.score(dayKey: "d", inputs: whoopOnly(recovery: 0.95, sleep: 0.95,
                                                                   exertion: 1))
        let bad = DayScoring.score(dayKey: "d", inputs: whoopOnly(recovery: 0.2, sleep: 0.3,
                                                                  exertion: 0.4))

        XCTAssertGreaterThan(good.outOfTen ?? 0, 9)
        XCTAssertLessThan(bad.outOfTen ?? 10, 4)
    }

    /// It scores, but it says so.
    func testAThinDayIsMarkedProvisional() {
        XCTAssertTrue(DayScoring.score(dayKey: "d", inputs: whoopOnly()).isProvisional)
        XCTAssertFalse(DayScoring.score(dayKey: "d", inputs: full()).isProvisional)
    }

    func testADayKnownOnlyThroughTasksStillScores() {
        let inputs = full(focus: nil, completion: nil, tasks: 0.8,
                          recovery: nil, sleep: nil, exertion: nil,
                          care: nil, nutrition: nil)
        XCTAssertNotNil(DayScoring.score(dayKey: "d", inputs: inputs).value)
    }

    /// The floor still exists. A bottle of water cannot speak for a day.
    func testAScrapOfSelfCareIsStillRefused() {
        let inputs = full(focus: nil, completion: nil, tasks: nil,
                          recovery: nil, sleep: nil, exertion: nil,
                          care: 1, nutrition: nil)
        let score = DayScoring.score(dayKey: "d", inputs: inputs)

        XCTAssertNil(score.value)
        XCTAssertEqual(score.displayValue, "—", "never a zero, and never a made-up number")
        XCTAssertNotNil(score.insufficient)
        XCTAssertTrue(score.insufficient!.contains("Whoop"), score.insufficient!)
    }

    func testAnEmptyDayRefuses() {
        let score = DayScoring.score(dayKey: "d", inputs: [])
        XCTAssertNil(score.value)
        XCTAssertEqual(score.coverage, 0, accuracy: 0.0001)
    }

    // MARK: Missing is not zero

    /// The rule the whole file exists for.
    func testAMissingComponentIsExcludedRatherThanScoredAsZero() {
        let withHealth = DayScoring.score(dayKey: "d", inputs: full(recovery: 1, sleep: 1,
                                                                    exertion: 1, care: 1,
                                                                    nutrition: 1))
        let withoutHealth = DayScoring.score(dayKey: "d",
                                             inputs: full(recovery: nil, sleep: nil, exertion: nil,
                                                          care: nil, nutrition: nil))

        XCTAssertEqual(withHealth.value ?? 0, 1, accuracy: 0.0001)
        XCTAssertEqual(withoutHealth.value ?? 0, 1, accuracy: 0.0001,
                       "a watch that did not sync is not a bad night")
    }

    func testAMissingComponentIsNotTheSameAsAZeroOne() {
        let missing = DayScoring.score(dayKey: "d", inputs: full(recovery: nil))
        let zero = DayScoring.score(dayKey: "d", inputs: full(recovery: 0))

        XCTAssertGreaterThan(missing.value ?? 0, zero.value ?? 0)
    }

    func testADayWithNoSessionIsNotADayThatFailedAtFocus() {
        let inputs = DayScoring.focusInputs(records: [])

        XCTAssertTrue(inputs.allSatisfy { !$0.counted })
        XCTAssertEqual(inputs.first?.unavailable, "no focus session today")
    }

    /// Callers pass what they have; the rest fills itself in as absent rather
    /// than quietly weighing nothing.
    func testComponentsTheCallerOmittedAreTreatedAsUnavailable() {
        let score = DayScoring.score(dayKey: "d", inputs: [ScoreInput(.recovery, value: 1),
                                                           ScoreInput(.sleep, value: 1)])
        XCTAssertEqual(score.parts.count, ScoreComponent.allCases.count)
        XCTAssertNotNil(score.parts.first { $0.component == .tasks }?.unavailable)
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
        let old = ScorePolicy(version: 1, workShare: 0.6, bodyShare: 0.3, careShare: 0.1)
        let new = ScorePolicy(version: 2, workShare: 0.3, bodyShare: 0.6, careShare: 0.1)

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

    // MARK: Tasks

    func testClearingEverythingDueBeatsLeavingItOverdue() {
        let cleared = DayScoring.tasksInput(completed: 3, overdue: 0)
        let slipping = DayScoring.tasksInput(completed: 1, overdue: 3)

        XCTAssertGreaterThan(cleared.value ?? 0, slipping.value ?? 1)
    }

    func testMoreTicksScoreHigherThanOne() {
        XCTAssertGreaterThan(DayScoring.tasksInput(completed: 4, overdue: 0).value ?? 0,
                             DayScoring.tasksInput(completed: 1, overdue: 0).value ?? 1)
        XCTAssertEqual(DayScoring.tasksInput(completed: 4, overdue: 0).value ?? 0,
                       1, accuracy: 0.0001)
    }

    func testADayWithNothingDueAndNothingDoneIsNotAZero() {
        let input = DayScoring.tasksInput(completed: 0, overdue: 0)
        XCTAssertFalse(input.counted)
        XCTAssertNotNil(input.unavailable)
    }

    func testOverdueWithNothingDoneIsARealZero() {
        XCTAssertEqual(DayScoring.tasksInput(completed: 0, overdue: 2).value ?? 1,
                       0, accuracy: 0.0001)
    }

    // MARK: Whoop mapping

    func testRecoveryAndSleepArePercentages() {
        XCTAssertEqual(DayScoring.recoveryInput(percent: 71).value ?? 0, 0.71, accuracy: 0.0001)
        XCTAssertEqual(DayScoring.sleepInput(percent: 40).value ?? 0, 0.40, accuracy: 0.0001)
        XCTAssertFalse(DayScoring.recoveryInput(percent: nil).counted)
    }

    func testStrainInsideTheBandIsFullMarks() {
        XCTAssertEqual(DayScoring.exertionInput(strain: 12, bandLow: 10, bandHigh: 14).value ?? 0,
                       1, accuracy: 0.0001)
    }

    func testUnderTheBandEarnsPartialCreditThatRisesWithEffort() {
        let still = DayScoring.exertionInput(strain: 0, bandLow: 10, bandHigh: 14).value ?? 0
        let walk = DayScoring.exertionInput(strain: 5, bandLow: 10, bandHigh: 14).value ?? 0

        XCTAssertEqual(still, 0.35, accuracy: 0.0001)
        XCTAssertGreaterThan(walk, still, "a walk is not nothing")
        XCTAssertLessThan(walk, 1)
    }

    func testOverTheBandFallsOffGentlyRatherThanFailing() {
        let over = DayScoring.exertionInput(strain: 18, bandLow: 6, bandHigh: 10).value ?? 0
        XCTAssertLessThan(over, 1)
        XCTAssertGreaterThanOrEqual(over, 0.55, "the day was worked — it is not a failure")
    }

    func testNoStrainIsUnavailableNotZero() {
        XCTAssertFalse(DayScoring.exertionInput(strain: nil, bandLow: 10, bandHigh: 14).counted)
    }

    // MARK: Hand-logged care

    func testSelfCareCountsOnlyWhatWasActuallyLogged() {
        let untouched = DayScoring.selfCareInput(bottles: 0, bottleGoal: 9,
                                                 supplementsTaken: 0, supplementsPlanned: 4)
        XCTAssertFalse(untouched.counted, "a day he did not open the app is not a day he failed")

        let water = DayScoring.selfCareInput(bottles: 9, bottleGoal: 9,
                                             supplementsTaken: 0, supplementsPlanned: 4)
        XCTAssertEqual(water.value ?? 0, 1, accuracy: 0.0001)

        let both = DayScoring.selfCareInput(bottles: 9, bottleGoal: 9,
                                            supplementsTaken: 2, supplementsPlanned: 4)
        XCTAssertEqual(both.value ?? 0, 0.75, accuracy: 0.0001)
    }

    func testNutritionIsPenalisedInBothDirections() {
        XCTAssertEqual(DayScoring.nutritionInput(calories: 2200, goal: 2200).value ?? 0,
                       1, accuracy: 0.0001)
        XCTAssertEqual(DayScoring.nutritionInput(calories: 1100, goal: 2200).value ?? 0,
                       DayScoring.nutritionInput(calories: 3300, goal: 2200).value ?? 1,
                       accuracy: 0.0001)
        XCTAssertFalse(DayScoring.nutritionInput(calories: 0, goal: 2200).counted)
    }
}
