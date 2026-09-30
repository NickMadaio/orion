import XCTest
import SwiftUI
@testable import Orion

/*
 The run console's promise is "you can tell your press worked". These pin the
 rules that decide when a request counts as DONE — the loop visibly doing it,
 not the flag being written — and the mood that colours the whole console.
*/
final class ProjectRunConsoleTests: XCTestCase {
    private func run(status: String = "running", active: Bool = true, pause: Bool = false, stop: Bool = false,
                     exterminate: Bool = false, alertMode: String? = nil, escalated: Bool = false) throws -> ProjectAgentStatus {
        var payload: [String: Any] = [
            "version": 3, "revision": 4, "runId": "r", "status": status,
            "activeTask": active ? "b" : NSNull(),
            "tasks": [
                ["id": "a", "title": "Readback", "weight": 1, "status": "accepted", "stage": "accepted", "attempts": 1, "origin": "plan"],
                ["id": "b", "title": "Transaction", "weight": 2, "status": active ? "running" : "queued",
                 "stage": active ? "implement" : "queued", "attempts": 1, "origin": "plan"],
                ["id": "c", "title": "Reconcile", "weight": 1, "status": "queued", "stage": "queued", "attempts": 0, "origin": "plan"],
            ],
            "events": [], "steering": [], "repairs": [], "finalReview": false,
            "pauseRequested": pause, "stopRequested": stop, "exterminateRequested": exterminate,
            "escalations": escalated ? [["id": "e", "at": "2026-09-25T10:00:00.000Z", "kind": "repeated_failure",
                                         "reason": "checks still fail", "taskId": NSNull(), "question": NSNull(),
                                         "recommendAstra": true, "notified": true, "resolvedAt": NSNull()]] : [],
        ]
        if let alertMode { payload["alertMode"] = alertMode }
        return try ProjectAgentStatus.decode(JSONSerialization.data(withJSONObject: payload))
    }

    func testARequestIsDoneOnlyWhenTheLoopHasVisiblyDoneIt() throws {
        let stopping = try run(stop: true)
        XCTAssertFalse(ProjectIntent.isDone(.stop, run: stopping, live: true),
                       "the flag is written at once; the loop has not stopped until its heartbeat does")
        XCTAssertTrue(ProjectIntent.isDone(.stop, run: stopping, live: false))
        XCTAssertFalse(ProjectIntent.isDone(.pause, run: try run(pause: true), live: true), "pausing is not paused")
        XCTAssertTrue(ProjectIntent.isDone(.pause, run: try run(status: "paused", active: false, pause: true), live: true))
        XCTAssertFalse(ProjectIntent.isDone(.start, run: nil, live: false))
        XCTAssertTrue(ProjectIntent.isDone(.start, run: nil, live: true))
        XCTAssertFalse(ProjectIntent.isDone(.resume, run: try run(stop: true), live: true))
        XCTAssertTrue(ProjectIntent.isDone(.resume, run: try run(), live: true))
        XCTAssertTrue(ProjectIntent.isDone(.exterminate, run: try run(exterminate: true), live: false))
    }

    func testTheMoodSaysWhoIsWorkingAndWhenItIsChanging() throws {
        let beat = { (role: String) in ProjectAgentHeartbeat(at: "", phase: "loop", pid: 1, iterations: 1, role: role) }
        XCTAssertEqual(ProjectMood.of(run: try run(), beat: beat("worker"), live: true, launching: false, pending: false), .working)
        XCTAssertEqual(ProjectMood.of(run: try run(), beat: beat("reviewer"), live: true, launching: false, pending: false), .reviewing)
        XCTAssertEqual(ProjectMood.of(run: try run(stop: true), beat: beat("worker"), live: true, launching: false, pending: false),
                       .transitioning, "a requested stop is visibly in motion")
        XCTAssertEqual(ProjectMood.of(run: nil, beat: nil, live: false, launching: false, pending: true), .transitioning)
        XCTAssertEqual(ProjectMood.of(run: try run(status: "escalated", active: false, escalated: true), beat: nil,
                                      live: false, launching: false, pending: false), .attention)
        XCTAssertEqual(ProjectMood.of(run: try run(active: false), beat: nil, live: false, launching: false, pending: false), .idle)
    }

    func testAlertModeDecodesAndItsArgvNeedsNoRevision() throws {
        XCTAssertTrue(try run(alertMode: "away").isAway)
        XCTAssertFalse(try run().isAway, "runs from before alert modes read as asleep")
        XCTAssertEqual(ProjectAgentControl.alertArguments(away: true, projectID: "alpha"), ["alerts", "away", "--project", "alpha"])
        XCTAssertEqual(ProjectAgentControl.alertArguments(away: false, projectID: "alpha"), ["alerts", "quiet", "--project", "alpha"])
    }

    func testHeartbeatRoleAndElapsedTime() throws {
        let beat = try JSONDecoder().decode(ProjectAgentHeartbeat.self, from: Data(#"""
        {"at":"2026-09-25T10:00:00.000Z","phase":"loop","pid":4,"role":"reviewer","model":"qwen3.6:27b","roleSince":"2026-09-25T09:48:00.000Z"}
        """#.utf8))
        XCTAssertEqual(beat.role, "reviewer")
        let since = try XCTUnwrap(beat.since)
        XCTAssertEqual(ProjectWorkspace.elapsed(since: since, now: since.addingTimeInterval(12 * 60)), "12 min")
        XCTAssertEqual(ProjectWorkspace.elapsed(since: since, now: since.addingTimeInterval(95 * 60)), "1 h 35 min")
        XCTAssertEqual(ProjectWorkspace.elapsed(since: since, now: since.addingTimeInterval(20)), "just now")
    }

    /// Renders the console pieces to PNG when ORION_RENDER_DIR is set, for a
    /// person (or a reviewing model) to look at. Never runs in ordinary CI.
    @MainActor
    func testRenderConsolePieces() throws {
        guard let directory = ProcessInfo.processInfo.environment["ORION_RENDER_DIR"] else { throw XCTSkip("render only on request") }
        let sheet = ConsoleSheet(working: try run())
            .padding(30).frame(width: 760, alignment: .leading)
            .foregroundStyle(Color.white.opacity(0.92))
            .background(Color(red: 0.045, green: 0.05, blue: 0.068))
            .environment(\.colorScheme, .dark)
        let renderer = ImageRenderer(content: sheet)
        renderer.scale = 2
        let image = try XCTUnwrap(renderer.nsImage)
        let data = try XCTUnwrap(NSBitmapImageRep(data: try XCTUnwrap(image.tiffRepresentation))?
            .representation(using: .png, properties: [:]))
        try data.write(to: URL(fileURLWithPath: directory).appendingPathComponent("console-pieces.png"))
    }
}

private struct ConsoleSheet: View {
    let working: ProjectAgentStatus
    private let moods: [ProjectMood] = [.idle, .working, .reviewing, .transitioning, .attention, .complete]
    private func intent(_ kind: ProjectIntent.Kind, _ phase: ProjectIntent.Phase) -> ProjectIntent {
        ProjectIntent(kind: kind, phase: phase, at: Date())
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 26) {
            HStack(spacing: 28) {
                ForEach(moods, id: \.self) { mood in
                    VStack(spacing: 8) { ProjectPulseOrb(mood: mood); Text(String(describing: mood)).font(.system(size: 10)) }
                }
            }
            running
            stopped
            trails
            ProjectTaskStrip(run: working).frame(width: 520)
            ProjectAlertSwitch(away: false, busy: false) { _ in }
            ProjectAlertSwitch(away: true, busy: false) { _ in }
        }
    }
    private var running: some View {
        HStack(spacing: 10) {
            ConsoleButton(title: "Stop", symbol: "stop.fill", tint: OrionTheme.text, prominent: true) {}
            ConsoleButton(title: "Pause", symbol: "pause.fill", tint: OrionTheme.blue) {}
            ConsoleButton(title: "Exterminate…", symbol: "xmark.octagon", tint: OrionTheme.red) {}
        }
    }
    private var stopped: some View {
        HStack(spacing: 10) {
            ConsoleButton(title: "Continue", symbol: "play.fill", prominent: true) {}
            ConsoleButton(title: "Starting…", symbol: "play.fill", prominent: true, working: true) {}
            ConsoleButton(title: "Continue", symbol: "play.fill", prominent: true) {}.disabled(true)
        }
    }
    private var trails: some View {
        VStack(alignment: .leading, spacing: 14) {
            ProjectIntentTrail(intent: intent(.stop, .sending))
            ProjectIntentTrail(intent: intent(.stop, .recorded))
            ProjectIntentTrail(intent: intent(.stop, .done))
            ProjectIntentTrail(intent: intent(.pause, .failed("The run is already stopped.")))
        }
    }
}
