import XCTest
@testable import Orion

/// 2026-11-02 23:56: "What's the weather like tomorrow" was paused by the next barge-in, its answer arrived and was held,
/// and the turn after that threw the held answer away (`pausedReplacementText = nil`) and sent itself as "the rest of"
/// the weather question. The weather was never answered. A new turn while one is in flight is now either the same
/// request (merged) or a different one (both answered, the first one first). Nothing is dropped.
final class TurnRelationTests: XCTestCase {

    func testLoggedSequenceIsTwoDifferentQuestions() {
        XCTAssertEqual(TurnRelation.between(previous: "What's the weather like tomorrow", next: "Orion, what time is"), .separate)
    }

    func testCorrectionsMerge() {
        XCTAssertEqual(TurnRelation.between(previous: "move gym to 6", next: "actually make it 7"), .merge)
        XCTAssertEqual(TurnRelation.between(previous: "remind me at 9 to call mum", next: "no wait 9:30"), .merge)
        XCTAssertEqual(TurnRelation.between(previous: "add eggs to my list", next: "i mean oat milk"), .merge)
    }

    func testContinuationsMerge() {
        XCTAssertEqual(TurnRelation.between(previous: "after class i want to", next: "hit the gym for like an hour"), .merge)
        XCTAssertEqual(TurnRelation.between(previous: "add eggs to my list", next: "and milk"), .merge)
        XCTAssertEqual(TurnRelation.between(previous: "whats the weather tomorrow", next: "and saturday"), .merge)
    }

    func testSameIntentMerges() {
        XCTAssertEqual(TurnRelation.between(previous: "What time is", next: "Orion, what time is it"), .merge)
        XCTAssertEqual(TurnRelation.between(previous: "whats the weather tomorrow", next: "whats the weather like tomorrow morning"), .merge)
    }

    func testDifferentQuestionsStaySeparate() {
        XCTAssertEqual(TurnRelation.between(previous: "whats on my calendar tmrw", next: "turn the lights off"), .separate)
        XCTAssertEqual(TurnRelation.between(previous: "he fix himself", next: "What's the weather like tomorrow"), .separate)
        XCTAssertEqual(TurnRelation.between(previous: "how did i sleep", next: "set a timer for 20 min"), .separate)
    }

    func testAnEmptyPreviousIsNotAMerge() {
        XCTAssertEqual(TurnRelation.between(previous: "", next: "what time is it"), .separate)
    }

    // MARK: Answer order

    func testSecondAnswerWaitsForTheFirst() {
        let order = AnswerOrder().waiting(later: 7, on: 5)
        XCTAssertTrue(order.mustWait(7))
        XCTAssertFalse(order.mustWait(5))
        let (released, after) = order.landed(5)
        XCTAssertEqual(released, [7])
        XCTAssertFalse(after.mustWait(7))
    }

    func testChainsReleaseInOrder() {
        let order = AnswerOrder().waiting(later: 6, on: 5).waiting(later: 7, on: 6)
        let (first, mid) = order.landed(5)
        XCTAssertEqual(first, [6])
        XCTAssertTrue(mid.mustWait(7))
        let (second, end) = mid.landed(6)
        XCTAssertEqual(second, [7])
        XCTAssertEqual(end, AnswerOrder())
    }

    func testGivingUpOnTheFirstReleasesTheSecond() {
        let order = AnswerOrder().waiting(later: 7, on: 5)
        let (released, after) = order.gaveUp(on: 5)
        XCTAssertEqual(released, [7])
        XCTAssertEqual(after, AnswerOrder())
    }

    // MARK: What a new turn does with the one in flight

    func testPlanForASeparateQuestionWithTheAnswerInHand() {
        let plan = InFlightTurnPlan.make(previous: "What's the weather like tomorrow", next: "Orion, what time is it",
                                         seedWasRoom: false, heldAnswer: "Tomorrow: 12°, light rain after 3.")
        XCTAssertEqual(plan, .separate(landNow: "Tomorrow: 12°, light rain after 3.", waitForPrevious: false))
    }

    func testPlanForASeparateQuestionStillRunning() {
        let plan = InFlightTurnPlan.make(previous: "What's the weather like tomorrow", next: "Orion, what time is it",
                                         seedWasRoom: false, heldAnswer: nil)
        XCTAssertEqual(plan, .separate(landNow: nil, waitForPrevious: true))
    }

    func testPlanForTheSameRequestMerges() {
        let plan = InFlightTurnPlan.make(previous: "move gym to 6", next: "actually make it 7", seedWasRoom: false, heldAnswer: nil)
        XCTAssertEqual(plan, .merge)
    }

    func testPlanWhenThePauseWasRoomSpeechNeverMerges() {
        let plan = InFlightTurnPlan.make(previous: "move gym to 6", next: "actually make it 7", seedWasRoom: true, heldAnswer: nil)
        XCTAssertEqual(plan, .separate(landNow: nil, waitForPrevious: false))
    }
}
