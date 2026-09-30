import XCTest
@testable import Orion

/// The run view's numbers: honest estimates from the controller's own state.
final class ProjectRunFocusTests: XCTestCase {
    private func task(_ id: String, _ status: String, _ stage: String, weight: Int = 1,
                      step: (Int, Int)? = nil) -> [String: Any] {
        var item: [String: Any] = ["id": id, "title": "Task \(id)", "weight": weight, "status": status,
                                   "stage": stage, "attempts": 1, "origin": "plan"]
        if let step { item["subtask"] = ["label": "— step", "index": step.0, "total": step.1] }
        return item
    }
    private func run(_ tasks: [[String: Any]], active: String? = nil, status: String = "running",
                     finalReview: Bool = false) throws -> ProjectAgentStatus {
        let payload: [String: Any] = ["version": 3, "revision": 1, "runId": "r", "status": status,
                                      "activeTask": active ?? NSNull(), "tasks": tasks, "events": [], "steering": [],
                                      "repairs": [], "finalReview": finalReview, "escalations": []]
        return try ProjectAgentStatus.decode(JSONSerialization.data(withJSONObject: payload))
    }

    func testATaskMovesForwardThroughItsDeclaredStepsAndStagesAndOnlyAcceptanceIsWhole() throws {
        let value = try run([task("a", "queued", "queued"), task("b", "running", "implement", step: (1, 4)),
                             task("c", "running", "implement", step: (3, 4)), task("d", "running", "review"),
                             task("e", "accepted", "accepted")], active: "c")
        let f = value.tasks.map(RunProgress.fraction)
        XCTAssertEqual(f[0], 0)
        XCTAssertEqual(f[1], 0.05, accuracy: 0.001, "step 1 of 4 has nothing behind it yet")
        XCTAssertEqual(f[2], 0.05 + 0.65 * 0.5, accuracy: 0.001)
        XCTAssertEqual(f[3], 0.90, accuracy: 0.001)
        XCTAssertEqual(f[4], 1)
        XCTAssertTrue(f.dropLast().allSatisfy { $0 < 1 }, "nothing reads as done before it is accepted")
    }

    func testOverallProgressIsWeightedAndNeverShowsCompleteBeforeTheFinalReview() throws {
        let partway = try run([task("a", "accepted", "accepted", weight: 3), task("b", "queued", "queued", weight: 1)])
        XCTAssertEqual(RunProgress.overall(partway), 0.75, accuracy: 0.001)
        let allAccepted = try run([task("a", "accepted", "accepted"), task("b", "accepted", "accepted")], status: "waiting_for_review")
        XCTAssertEqual(RunProgress.overall(allAccepted), 0.99, accuracy: 0.001)
        let done = try run([task("a", "accepted", "accepted")], status: "completed", finalReview: true)
        XCTAssertEqual(RunProgress.overall(done), 1)
    }

    func testPositionIsTheActiveTaskInPlanOrder() throws {
        let value = try run([task("a", "accepted", "accepted"), task("b", "queued", "queued"),
                             task("c", "running", "test")], active: "c")
        XCTAssertEqual(RunProgress.position(value), 3)
        XCTAssertNil(RunProgress.position(try run([task("a", "queued", "queued")])))
    }

    func testRepairShowsAsGoingBackToBuildOnTheRail() {
        XCTAssertEqual(RunProgress.railIndex(.repair), RunProgress.railIndex(.implement))
        XCTAssertEqual(RunProgress.railIndex(.queued), -1)
    }

    func testTheStreamTailKeepsOnlyTheLastLines() {
        let text = (1...30).map { "line \($0)" }.joined(separator: "\n")
        let tail = ProjectRunFocusView.tail(text, lines: 3)
        XCTAssertEqual(tail, "line 28\nline 29\nline 30")
    }
}
