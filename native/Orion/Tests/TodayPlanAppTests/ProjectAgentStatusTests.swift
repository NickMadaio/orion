import XCTest
@testable import Orion

final class ProjectAgentStatusTests: XCTestCase {
    private func fixture(accepted: Bool = false, finalReview: Bool = false, weight: Double = 2) throws -> Data {
        try JSONSerialization.data(withJSONObject: [
            "version": 1, "revision": 4, "runId": "example", "status": "paused",
            "activeTask": "task", "tasks": [
                ["id": "task", "title": "First", "weight": weight, "status": "accepted", "stage": "accepted", "attempts": 1],
                ["id": "other", "title": "Second", "weight": 1, "status": accepted ? "accepted" : "queued", "stage": accepted ? "accepted" : "queued", "attempts": 0]],
            "events": [], "steering": [], "finalReview": finalReview
        ])
    }
    func testProgressOnlyCountsAcceptedWeightsAndRequiresFinalReview() throws {
        let partial = try ProjectAgentStatus.decode(fixture())
        XCTAssertEqual(partial.acceptedFraction, 2.0 / 3.0, accuracy: 0.0001)
        XCTAssertTrue(partial.progressLabel.hasPrefix("66%"))
        let pending = try ProjectAgentStatus.decode(fixture(accepted: true))
        XCTAssertTrue(pending.awaitingFinalReview)
        XCTAssertFalse(pending.progressLabel.contains("100%"))
        XCTAssertTrue(pending.progressLabel.contains("2/2"))
        let complete = try ProjectAgentStatus.decode(fixture(accepted: true, finalReview: true))
        XCTAssertTrue(complete.progressLabel.hasPrefix("100%"))
    }
    func testMissingAndCorruptStateAreDistinct() throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }
        let url = dir.appendingPathComponent("state.json")
        guard case .missing = ProjectAgentStatus.read(url: url) else { return XCTFail("Missing should be explicit") }
        try Data("bad json".utf8).write(to: url)
        guard case .unreadable = ProjectAgentStatus.read(url: url) else { return XCTFail("Corrupt should not mean missing") }
        XCTAssertThrowsError(try ProjectAgentStatus.decode(fixture(weight: -1)))
    }
    func testSteeringIsOneArgumentNotShellCode() {
        let instruction = "Don't deploy; $(touch /tmp/not-a-command)\nReview first"
        XCTAssertEqual(ProjectAgentControl.arguments(.steer, revision: 7, text: instruction),
                       ["steer", "--revision", "7", "--text", instruction])
        XCTAssertEqual(ProjectAgentControl.arguments(.pause, revision: 8), ["pause", "--revision", "8"])
    }
}
