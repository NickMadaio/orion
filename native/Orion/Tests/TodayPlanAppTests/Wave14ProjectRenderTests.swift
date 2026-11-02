import AppKit
import SwiftUI
import XCTest
@testable import Orion

/// Wave 14: the project run settings and the Plan / Activity / Reviews panes, drawn from fixtures. ImageRenderer
/// leaves scroll views blank, so the inner content views are rendered directly.
@MainActor
final class Wave14ProjectRenderTests: XCTestCase {
    private func status() throws -> ProjectAgentStatus {
        let tasks: [[String: Any]] = [
            ["id": "t1", "title": "Collect the source notes", "weight": 1, "status": "accepted", "stage": "accepted", "attempts": 1, "origin": "plan"],
            ["id": "t2", "title": "Draft the outline", "weight": 2, "status": "running", "stage": "implement", "attempts": 1, "origin": "plan",
             "subtask": ["label": "— tightening section two", "index": 2, "total": 4]],
            ["id": "t3", "title": "Write the summary", "weight": 1, "status": "queued", "stage": "queued", "attempts": 0, "origin": "plan"],
        ]
        let reviews: [[String: Any]] = [
            ["id": "r1", "at": "2026-11-02T01:10:00Z", "taskId": "t1", "decision": "accept", "verdict": "PASS", "reviewer": "qwen-reviewer",
             "summary": "Notes cover every source and the citations resolve.", "failed": [], "correctionIds": []],
            ["id": "r2", "at": "2026-11-02T01:40:00Z", "taskId": "t2", "decision": "accept_with_tasks", "verdict": "PASS_WITH_TASKS", "reviewer": "qwen-reviewer",
             "summary": "Outline holds; two headings repeat the same claim.",
             "failed": [["criterion": "Headings must be distinct", "severity": "minor"]], "correctionIds": ["c1"]],
        ]
        let events: [[String: Any]] = [
            ["at": "2026-11-02T01:10:00Z", "kind": "accepted", "message": "Accepted: Collect the source notes"],
            ["at": "2026-11-02T01:12:00Z", "kind": "started", "message": "Started: Draft the outline"],
        ]
        let payload: [String: Any] = ["version": 3, "revision": 4, "runId": "x", "status": "running", "activeTask": "t2",
                                      "tasks": tasks, "events": events, "steering": [], "repairs": [], "finalReview": false,
                                      "reviews": reviews, "escalations": []]
        return try ProjectAgentStatus.decode(JSONSerialization.data(withJSONObject: payload))
    }

    private func frame<V: View>(_ name: String, _ view: V, height: CGFloat) throws {
        try UIRender.write(name, UIRender.onDesktop(view.padding(34), light: false, size: CGSize(width: 900, height: height)),
                           size: CGSize(width: 900, height: height))
    }

    func testRendersRunSettings() throws {
        struct Host: View {
            @State var rule = ProjectRunStopRule.atTime
            @State var at = Date().addingTimeInterval(3 * 3600)
            @State var options = ProjectLaunchOptions(preventSleep: true, keepDisplayOn: true, nudgeMinutes: 5)
            @State var nudge = 5
            @State var open = true
            var body: some View {
                VStack(alignment: .leading, spacing: 0) {
                    ProjectRunSettingsHeader(open: $open, summary: "until 8:00 PM · keeps Mac and display awake · nudge 5 min")
                    ProjectRunSettingsForm(stopRule: $rule, stopAt: $at, options: $options, nudgeInterval: $nudge,
                                           suggestion: ("CS2100 lecture", Date().addingTimeInterval(2 * 3600)),
                                           preflight: nil, problem: "Could not check power and lid state.", checking: false, enabled: false)
                }.frame(width: 640)
            }
        }
        try frame("w14-c-proj-settings", Host(), height: 620)
    }

    func testRendersPlanFlow() throws {
        let blocks = ProjectPlanBlock.parse("""
        # Brain learning

        Teach the loop to remember what it reviewed.

        ## Collect the source notes
        Gather every note into one folder and cite each.

        ## Draft the outline
        Three sections, one claim each. Keep headings distinct.

        ```orion-task
        scope: outline.md
        ```

        ## Write the summary
        One paragraph, plain words.
        """)
        try frame("w14-c-proj-plan", ProjectPlanFlowView(blocks: blocks, tasks: try status().tasks).frame(width: 640), height: 620)
    }

    func testPlanStepStates() throws {
        let blocks = ProjectPlanBlock.parse("## Collect the source notes\nx\n## Draft the outline\ny\n## Write the summary\nz\n## Unmatched")
        let steps = ProjectPlanStep.steps(from: blocks)
        let states = ProjectPlanStep.states(for: steps, tasks: try status().tasks)
        XCTAssertEqual(steps.map { states[$0.id] }, [.done, .doing, .next, .todo])
        XCTAssertEqual(ProjectPlanStep.states(for: steps, tasks: []).values.filter { $0 == .next }.count, 1)
    }

    func testLogLineParsing() {
        let lines = ProjectLogLine.parse("2026-11-02T01:10:00.123Z keep-awake held\nplain line")
        XCTAssertEqual(lines.count, 2)
        XCTAssertEqual(lines[0].message, "keep-awake held")
        XCTAssertFalse(lines[0].time.isEmpty)
        XCTAssertEqual(lines[1].time, "")
    }

    func testRendersActivityAndReviews() throws {
        let run = try status()
        let log = "2026-11-02T01:10:00.000Z accepted t1\n2026-11-02T01:12:00.000Z started t2\n2026-11-02T01:13:30.000Z worker: 412 tokens"
        try frame("w14-c-proj-activity", ProjectActivityView(activity: nil, run: run, runLog: log, live: true, openFullLog: {}).frame(width: 640), height: 640)
        try frame("w14-c-proj-reviews", ProjectAgentReviewNotes(run: run).frame(width: 640), height: 420)
    }
}
