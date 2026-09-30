import XCTest
import MobileCore
@testable import LinkCore

final class SnapshotReaderTests: XCTestCase {
    private var home: URL!
    private let now = Date(timeIntervalSince1970: 1_790_000_000)
    private func iso(_ date: Date) -> String {
        let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]; return f.string(from: date)
    }
    private func write(_ path: String, _ object: Any) throws {
        let url = home.appendingPathComponent(path)
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try JSONSerialization.data(withJSONObject: object).write(to: url)
    }
    override func setUpWithError() throws {
        home = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: home, withIntermediateDirectories: true)
    }
    override func tearDownWithError() throws { try? FileManager.default.removeItem(at: home) }

    private func project(_ id: String, status: String = "running", beatAge: TimeInterval? = 5, active: Bool = true) throws {
        let base = ".openclaw/orion-controlled/project-agent/projects/\(id)/"
        try write(base + "project.json", ["version": 1, "id": id, "name": "Project \(id)", "taskCount": 3])
        var tasks: [[String: Any]] = [
            ["id": "a", "title": "Done one", "weight": 1, "status": "accepted", "stage": "accepted"],
            ["id": "b", "title": "In flight", "weight": 1, "status": "running", "stage": "implement",
             "subtask": ["label": "— write tests", "index": 2, "total": 5]],
            ["id": "c", "title": "Later", "weight": 2, "status": "queued", "stage": "queued"]]
        if !active { tasks[1]["status"] = "queued" }
        try write(base + "state.json", ["status": status, "activeTask": active ? "b" : NSNull(), "tasks": tasks,
                                        "escalations": [], "finalReview": false])
        if let beatAge {
            try write(base + "heartbeat.json", ["at": iso(now.addingTimeInterval(-beatAge)), "phase": "loop", "role": "worker",
                                                "model": "qwen3.6:27b", "roleSince": iso(now.addingTimeInterval(-600))])
        }
    }

    func testALiveRunReportsItsTaskStepAndWeightedProgress() throws {
        try project("p1")
        let run = try XCTUnwrap(SnapshotReader(home: home).runs(now: now).first)
        XCTAssertEqual(run.status, .working)
        XCTAssertTrue(run.live)
        XCTAssertEqual(run.activeTask, "In flight")
        XCTAssertEqual(run.step, "2/5 · write tests")
        XCTAssertEqual(run.accepted, 1); XCTAssertEqual(run.total, 3)
        XCTAssertEqual(run.percent, 25, "1 of 4 weight")
        XCTAssertEqual(run.minutesOnTask, 10)
        XCTAssertEqual(run.model, "qwen3.6:27b")
    }

    func testAStaleHeartbeatIsNotLiveAndLiveRunsComeFirst() throws {
        try project("old", beatAge: 600)
        try project("new", beatAge: 3)
        let runs = SnapshotReader(home: home).runs(now: now)
        XCTAssertEqual(runs.first?.id, "new")
        XCTAssertEqual(runs.last?.status, .stopped)
        XCTAssertFalse(runs.last?.live ?? true)
    }

    func testOnlyWaitingUnexpiredApprovalsAreListed() throws {
        let gate = ".openclaw/orion-gate/approvals/"
        try write(gate + "tickets/A-AAAA.json", ["id": "A-AAAA", "action": "terminal_run", "summary": "terminal_run — command: ls",
                                                 "context": "list", "expiresAt": iso(now.addingTimeInterval(300))])
        try write(gate + "tickets/A-BBBB.json", ["id": "A-BBBB", "action": "file_delete", "summary": "x", "context": "y",
                                                 "expiresAt": iso(now.addingTimeInterval(-1))])
        try write(gate + "tickets/A-CCCC.json", ["id": "A-CCCC", "action": "file_delete", "summary": "x", "context": "y",
                                                 "expiresAt": iso(now.addingTimeInterval(300))])
        try write(gate + "grants/A-CCCC.json", ["id": "A-CCCC"])
        XCTAssertEqual(SnapshotReader(home: home).approvals(now: now).map(\.id), ["A-AAAA"])
    }

    func testRunningActionsTheFeedAndTheLockAreRead() throws {
        try write(".openclaw/orion-controlled/actions/running/orion-0011223344556677.json",
                  ["taskId": "orion-0011223344556677", "goal": "list files", "actions": ["terminal_run"],
                   "startedAt": iso(now), "commands": ["ls ~/Projects"]])
        try write(".openclaw/orion-controlled/attention-today.json",
                  ["version": 1, "generatedAt": iso(now), "interrupt": [["id": "c1", "title": "Seminar starts in 10 min", "source": "calendar", "reason": "score"]],
                   "today": [], "outages": [], "note": NSNull()])
        try write(".openclaw/orion-controlled/lock.json", ["locked": true])
        let reader = SnapshotReader(home: home)
        XCTAssertEqual(reader.running().first?.title, "ls ~/Projects")
        XCTAssertEqual(reader.attention()?.interrupt.first?.title, "Seminar starts in 10 min")
        XCTAssertTrue(reader.locked())
    }

    func testHealthCarriesDayLevelNumbersOnly() throws {
        try write(".openclaw/orion-controlled/health-log.json", ["days": [
            "2026-09-27": ["recovery": 70, "hrv": 120, "restingHeartRate": 50, "sleepHours": 7.1, "strain": 12.4, "calories": 0],
            "2026-09-28": ["recovery": 84, "hrv": 156, "sleepHours": 7.5, "sleepPerformance": 72, "strain": 18.1],
            "2026-09-26": ["calories": 0, "waterBottles": 2]]])
        let days = SnapshotReader(home: home).health()
        XCTAssertEqual(days.map(\.date), ["2026-09-27", "2026-09-28"], "a day with no health numbers is left out")
        XCTAssertEqual(days.last?.recovery, 84)
        XCTAssertEqual(days.last?.sleepHours, 7.5)
        XCTAssertNil(days.first?.sleepPerformance)
    }

    func testMissingFilesMeanEmptyNotInvented() {
        let reader = SnapshotReader(home: home)
        XCTAssertEqual(reader.runs(now: now), [])
        XCTAssertEqual(reader.approvals(now: now), [])
        XCTAssertEqual(reader.running(), [])
        XCTAssertNil(reader.attention())
        XCTAssertFalse(reader.locked())
        XCTAssertEqual(reader.health(), [])
        XCTAssertNil(reader.screenGrant(now: now))
    }

    func testAScreenGrantIsSentOnlyWhileItRuns() throws {
        let until = now.addingTimeInterval(20 * 60)
        try write(".openclaw/orion-controlled/screen-grant.json",
                  ["id": "g1", "until": ISO8601DateFormatter().string(from: until), "because": "asked nicely"])
        let reader = SnapshotReader(home: home)
        XCTAssertEqual(reader.screenGrant(now: now)?.id, "g1")
        XCTAssertNil(reader.screenGrant(now: until.addingTimeInterval(1)))
    }
}

final class CommandRunnerTests: XCTestCase {
    func testTheCommandGoesThroughOrionRemoteAsThePhone() {
        let runner = CommandRunner(node: URL(fileURLWithPath: "/n"), remote: URL(fileURLWithPath: "/r/orion-remote"), timeout: 5)
        let args = runner.arguments(text: "agent stop p1", id: "REC-1", sentAt: Date(timeIntervalSince1970: 1_790_000_000))
        XCTAssertEqual(args, ["/r/orion-remote", "handle", "--from", "phone", "--id", "REC-1", "--at", "1790000000000",
                              "--mode", "command", "--", "agent stop p1"])
        let chat = runner.arguments(text: "No, I mean the task page", id: "REC-2", sentAt: Date(timeIntervalSince1970: 1_790_000_000), chat: true)
        XCTAssertEqual(Array(chat.suffix(4)), ["--mode", "chat", "--", "No, I mean the task page"], "chat is never parsed as a command")
        XCTAssertEqual(runner.environment(base: [:])["ORION_REMOTE_ALLOW"], "phone")
    }

    func testRepliesRefusalsAndSilentFailures() throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }
        func script(_ body: String) throws -> URL {
            let url = dir.appendingPathComponent(UUID().uuidString)
            try body.write(to: url, atomically: true, encoding: .utf8); return url
        }
        let sh = URL(fileURLWithPath: "/bin/sh")
        let ok = CommandRunner(node: sh, remote: try script("echo \"battery 80%\""), timeout: 5).run(text: "device", id: "1", sentAt: Date())
        XCTAssertEqual(ok, .init(ok: true, reply: "battery 80%"))
        let refused = CommandRunner(node: sh, remote: try script("echo \"Orion is locked.\"; exit 1"), timeout: 5).run(text: "x", id: "2", sentAt: Date())
        XCTAssertEqual(refused, .init(ok: false, reply: "Orion is locked."))
        let silent = CommandRunner(node: sh, remote: try script("exit 3"), timeout: 5).run(text: "x", id: "3", sentAt: Date())
        XCTAssertFalse(silent.ok)
        let slow = CommandRunner(node: sh, remote: try script("sleep 5"), timeout: 1).run(text: "x", id: "4", sentAt: Date())
        XCTAssertEqual(slow.reply, "ORION did not answer within 1 seconds.")
        let empty = CommandRunner(node: sh, remote: try script("echo hi"), timeout: 5).run(text: "   ", id: "5", sentAt: Date())
        XCTAssertFalse(empty.ok)
    }
}
