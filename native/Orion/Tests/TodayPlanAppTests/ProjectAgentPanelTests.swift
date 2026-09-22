import XCTest
@testable import Orion

/// The panel's job is to be truthful about an unattended run at 08:00. These
/// cover the three ways it could lie: a thinking indicator that is on when
/// nothing is running, a settings readout that implies the agent is enabled
/// when it is not, and progress that came from somewhere other than the plan.
final class ProjectAgentPanelTests: XCTestCase {
    private func activity(_ fields: [String: Any]) throws -> ProjectAgentActivity {
        var payload: [String: Any] = [
            "at": "2026-09-21T12:00:00.000Z", "role": "idle", "model": NSNull(), "phase": "idle",
            "taskId": NSNull(), "thinking": false, "streaming": false,
            "thinkingChars": 0, "outputChars": 0, "startedAt": NSNull(),
            "trace": "", "output": "", "note": NSNull(),
        ]
        for (key, value) in fields { payload[key] = value }
        return try JSONDecoder().decode(ProjectAgentActivity.self,
                                        from: JSONSerialization.data(withJSONObject: payload))
    }

    func testIdleIsNeverReportedAsThinking() throws {
        let idle = try activity([:])
        XCTAssertTrue(idle.isIdle)
        XCTAssertFalse(idle.thinking)

        // Streaming with no thinking tokens yet is "writing", not "thinking" —
        // the distinction is the whole point of reading streamed deltas.
        let writing = try activity(["role": "worker", "model": "qwen3.6:27b", "streaming": true, "outputChars": 40])
        XCTAssertFalse(writing.isIdle)
        XCTAssertTrue(writing.headline.contains("writing"))

        let thinking = try activity(["role": "reviewer", "model": "gemma4:31b", "streaming": true,
                                     "thinking": true, "thinkingChars": 900])
        XCTAssertTrue(thinking.headline.contains("thinking"))
        XCTAssertTrue(thinking.headline.contains("GEMMA4:31B"))
    }

    func testHeadlineCarriesElapsedSecondsSoAStuckGenerationIsVisible() throws {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let started = formatter.string(from: Date().addingTimeInterval(-90))
        let running = try activity(["role": "worker", "model": "m", "streaming": true,
                                    "thinking": true, "startedAt": started])
        guard let elapsed = running.elapsed else { return XCTFail("elapsed should parse") }
        XCTAssertGreaterThan(elapsed, 80)
        XCTAssertTrue(running.headline.contains("s"), "the headline shows how long it has been going")

        // An unparseable timestamp must not read as "just started".
        let broken = try activity(["role": "worker", "streaming": true, "startedAt": "not a date"])
        XCTAssertNil(broken.elapsed)
    }

    func testAbsentSettingsMeanDisabledRatherThanUnknown() throws {
        // The normal state: no config file at all. The panel must say OFF, not
        // leave it ambiguous — this is the switch that decides whether a model
        // may change real code while nobody is watching.
        XCTAssertNil(ProjectAgentSettings.read(url: URL(fileURLWithPath: "/nonexistent/agentic-config.json")))

        let disabled = try JSONDecoder().decode(ProjectAgentSettings.self, from: Data("{}".utf8))
        XCTAssertFalse(disabled.isEnabled)
        XCTAssertEqual(disabled.summaryRows.first?.1, "DISABLED")

        let enabled = try JSONDecoder().decode(ProjectAgentSettings.self, from: Data("""
        {"enabled": true, "endpoint": "http://127.0.0.1:11434",
         "roles": {"worker": {"model": "qwen3.6:27b", "contextTokens": 65536, "approxResidentGiB": 21}},
         "limits": {"maxAttempts": 3, "repairAfterAttempts": 3}}
        """.utf8))
        XCTAssertTrue(enabled.isEnabled)
        XCTAssertEqual(enabled.summaryRows.first?.1, "ENABLED")
        XCTAssertTrue(enabled.summaryRows.contains { $0.1.contains("qwen3.6:27b") && $0.1.contains("64k ctx") })
    }

    /// The instruction documents are READ from the repository, never duplicated
    /// into the app. A second copy of a prompt is a second belief about how an
    /// unattended agent behaves.
    func testInstructionsComeFromTheRealPromptFiles() {
        let documents = ProjectAgentInstructions.load()
        XCTAssertEqual(documents.count, 3, "worker, reviewer and bounded repair")
        XCTAssertTrue(documents.contains { $0.id == "worker-system" && $0.body.contains("### DONE") })
        XCTAssertTrue(documents.contains { $0.id == "reviewer-system" && $0.body.contains("PASS_WITH_TASKS") })
        XCTAssertTrue(documents.contains { $0.id == "reviewer-repair" && $0.body.contains("minimum useful correction") })

        // A missing directory degrades to an empty list rather than crashing a
        // panel someone opened to find out why a run stopped.
        XCTAssertTrue(ProjectAgentInstructions.load(from: URL(fileURLWithPath: "/nonexistent")).isEmpty)
    }

    func testTheTwoClocksAnswerDifferentQuestions() throws {
        // Plan progress is accepted WEIGHT over total; task progress is the
        // recorded stage. A run mid-task must show movement on one and not the
        // other, which is why there are two.
        let data = try JSONSerialization.data(withJSONObject: [
            "version": 3, "revision": 9, "runId": "r", "status": "running", "activeTask": "b",
            "tasks": [
                ["id": "a", "title": "Done", "weight": 3, "status": "accepted", "stage": "accepted", "attempts": 1, "origin": "plan"],
                ["id": "b", "title": "In flight", "weight": 1, "status": "running", "stage": "implement", "attempts": 2, "origin": "plan"],
            ],
            "events": [], "steering": [], "repairs": [], "escalations": [], "finalReview": false,
        ])
        let run = try ProjectAgentStatus.decode(data)
        XCTAssertEqual(run.acceptedFraction, 0.75, accuracy: 0.001)
        XCTAssertEqual(run.active?.id, "b")
        XCTAssertEqual(run.active?.stage, .implement)
        XCTAssertEqual(run.acceptedCount, 1)
        // Nothing here consults a model for either number.
        XCTAssertTrue(run.progressLabel.hasPrefix("75%"))
    }
}
