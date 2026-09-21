import XCTest
@testable import Orion

final class ProjectAgentStatusTests: XCTestCase {
    private func fixture(
        accepted: Bool = false,
        finalReview: Bool = false,
        weight: Double = 2,
        status: String = "paused",
        escalation: [String: Any]? = nil,
        extraTaskFields: [String: Any] = [:]
    ) throws -> Data {
        var payload: [String: Any] = [
            "version": 2, "revision": 4, "runId": "example", "status": status,
            "activeTask": "task",
            "tasks": [
                ["id": "task", "title": "First", "weight": weight, "status": "accepted", "stage": "accepted",
                 "attempts": 1, "origin": "plan"].merging(extraTaskFields) { _, override in override },
                ["id": "other", "title": "Second", "weight": 1,
                 "status": accepted ? "accepted" : "queued", "stage": accepted ? "accepted" : "queued",
                 "attempts": 0, "origin": "plan"],
            ],
            "events": [], "steering": [], "repairs": [], "finalReview": finalReview,
        ]
        payload["escalation"] = escalation as Any?
        if escalation == nil { payload.removeValue(forKey: "escalation") }
        return try JSONSerialization.data(withJSONObject: payload)
    }

    func testProgressOnlyCountsAcceptedWeightsAndRequiresFinalReview() throws {
        let partial = try ProjectAgentStatus.decode(fixture())
        XCTAssertEqual(partial.acceptedFraction, 2.0 / 3.0, accuracy: 0.0001)
        XCTAssertTrue(partial.progressLabel.hasPrefix("66%"))
        let pending = try ProjectAgentStatus.decode(fixture(accepted: true))
        XCTAssertTrue(pending.awaitingFinalReview)
        XCTAssertFalse(pending.progressLabel.contains("100%"))
        XCTAssertTrue(pending.progressLabel.contains("2/2"))
        let complete = try ProjectAgentStatus.decode(fixture(accepted: true, finalReview: true, status: "completed"))
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
        XCTAssertEqual(ProjectAgentControl.arguments(.resolve, revision: 9, text: "chose design B"),
                       ["resolve", "--revision", "9", "--note", "chose design B"])
    }

    /// A newer controller must not blank the panel on an app that has not caught
    /// up. "Unknown stage" is a far better morning than "state could not be read".
    func testUnknownEnumValuesDegradeRatherThanFailingTheWholeSnapshot() throws {
        let data = try fixture(extraTaskFields: ["stage": "some-future-stage"])
        let value = try ProjectAgentStatus.decode(data)
        XCTAssertEqual(value.tasks[0].stage, .unknown)
        XCTAssertEqual(value.tasks[0].status, .accepted, "known values still decode normally")
    }

    /// An escalated run with nothing to explain it is worse than an error.
    func testEscalationAndStatusMustAgree() throws {
        XCTAssertThrowsError(try ProjectAgentStatus.decode(fixture(status: "escalated")),
                             "escalated with no record must refuse")
        XCTAssertThrowsError(try ProjectAgentStatus.decode(fixture(status: "paused", escalation: [
            "id": "e1", "at": "2026-09-21T00:00:00.000Z", "kind": "architecture",
            "reason": "ambiguous", "taskId": "task", "question": "which?",
            "recommendAstra": true, "notified": false,
        ])), "an escalation record with a non-escalated status must refuse")

        let blocked = try ProjectAgentStatus.decode(fixture(status: "escalated", escalation: [
            "id": "e1", "at": "2026-09-21T00:00:00.000Z", "kind": "architecture",
            "reason": "two defensible designs", "taskId": "task", "question": "which shape?",
            "recommendAstra": true, "notified": false,
        ]))
        XCTAssertTrue(blocked.isBlocked)
        XCTAssertEqual(blocked.escalation?.kind, "architecture")
        XCTAssertTrue(blocked.escalation?.recommendAstra ?? false)
    }

    /// Tasks a review invented are marked, because progress that fell because
    /// the denominator grew needs a visible cause.
    func testReviewAuthoredTasksAreDistinguishedFromPlannedOnes() throws {
        let value = try ProjectAgentStatus.decode(fixture(extraTaskFields: ["origin": "review_correction"]))
        XCTAssertTrue(value.tasks[0].isCorrection)
        XCTAssertFalse(value.tasks[1].isCorrection)
        XCTAssertEqual(value.correctionCount, 1)
        XCTAssertTrue(value.progressLabel.contains("added by review"))
    }

    /// v1 snapshots are not decoded as if they were v2: the fields the UI needs
    /// do not exist there, and a partial read would show a confidently wrong run.
    func testVersionOneIsRefusedRatherThanPartiallyRead() throws {
        var payload = try JSONSerialization.jsonObject(with: fixture()) as! [String: Any]
        payload["version"] = 1
        XCTAssertThrowsError(try ProjectAgentStatus.decode(try JSONSerialization.data(withJSONObject: payload)))
    }

    func testHeartbeatSeparatesALiveSupervisorFromACrashedOne() throws {
        let now = ISO8601DateFormatter()
        now.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let fresh = ProjectAgentHeartbeat(at: now.string(from: Date()), phase: "running", pid: 1, iterations: 3)
        XCTAssertTrue(fresh.isLive)
        XCTAssertTrue(fresh.summary.contains("live"))

        let stale = ProjectAgentHeartbeat(at: now.string(from: Date().addingTimeInterval(-600)),
                                          phase: "running", pid: 1, iterations: 3)
        XCTAssertFalse(stale.isLive)
        XCTAssertTrue(stale.summary.contains("not running"))

        let unparseable = ProjectAgentHeartbeat(at: "not a date", phase: nil, pid: nil, iterations: nil)
        XCTAssertFalse(unparseable.isLive, "an unreadable timestamp must not read as live")
    }
}
