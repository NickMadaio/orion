import AppKit
import OrionViews
import SwiftUI
import XCTest
@testable import Orion

/// w17 e-projlag (Nick: "the projects tab ... the plan section is kinda laggy"). The Plan flow used to rebuild its
/// steps, states and inline markdown inside `body` on every parent render, and the parent re-rendered every 2 s.
@MainActor
final class W17ProjectPlanLagTests: XCTestCase {
    private func markdown(headings: Int = 40) -> String {
        var out = "# Project plan\n\nIntro with **bold** and `code`.\n\n"
        for i in 0..<headings {
            out += "## Step \(i) build thing \(i)\n\nProse under step \(i) with *emphasis* and a [link](https://example.com).\n\nMore detail \(i).\n\n"
            if i % 10 == 0 { out += "```orion-task\nscope: a\n```\n\n" }
        }
        return out
    }

    private func tasks(_ firstStatus: String) throws -> [ProjectAgentStatus.WorkItem] {
        let items: [[String: Any]] = [
            ["id": "t1", "title": "Step 0 build thing 0", "weight": 1, "status": firstStatus, "stage": "queued", "attempts": 0, "origin": "plan"],
            ["id": "t2", "title": "Step 1 build thing 1", "weight": 1, "status": "queued", "stage": "queued", "attempts": 0, "origin": "plan"],
        ]
        let payload: [String: Any] = ["version": 3, "revision": 1, "runId": "x", "status": "running", "activeTask": "t1", "tasks": items,
                                      "events": [], "steering": [], "repairs": [], "finalReview": false, "reviews": [], "escalations": []]
        return try ProjectAgentStatus.decode(JSONSerialization.data(withJSONObject: payload)).tasks
    }

    func testSameInputIsNotRebuilt() throws {
        let cache = ProjectPlanFlowCache()
        let blocks = ProjectPlanBlock.parse(markdown())
        let running = try tasks("running")
        let first = cache.model(blocks: blocks, tasks: running)
        for _ in 0..<20 { _ = cache.model(blocks: ProjectPlanBlock.parse(markdown()), tasks: try tasks("running")) }
        XCTAssertEqual(cache.builds, 1, "20 renders of the same plan and task states must be lookups")
        XCTAssertEqual(first.steps.count, 40)
        XCTAssertEqual(first.states[first.steps[0].id], .doing)
        XCTAssertFalse(first.rich.isEmpty)
    }

    func testChangedTaskStateOrPlanRebuilds() throws {
        let cache = ProjectPlanFlowCache()
        let blocks = ProjectPlanBlock.parse(markdown())
        _ = cache.model(blocks: blocks, tasks: try tasks("running"))
        let done = cache.model(blocks: blocks, tasks: try tasks("accepted"))
        XCTAssertEqual(cache.builds, 2)
        XCTAssertEqual(done.states[done.steps[0].id], .done)
        _ = cache.model(blocks: ProjectPlanBlock.parse(markdown(headings: 41)), tasks: try tasks("accepted"))
        XCTAssertEqual(cache.builds, 3)
    }

    private final class Tick: ObservableObject { @Published var n = 0; @Published var running = "running" }
    private struct Parent: View {
        @ObservedObject var tick: Tick
        let blocks: [ProjectPlanBlock]
        let make: (String) -> [ProjectAgentStatus.WorkItem]
        static var parentBodies = 0
        var body: some View {
            let _ = { Self.parentBodies += 1 }()
            Text("\(tick.n)")   // something that changes on every refresh
            ProjectPlanFlowView(blocks: blocks, tasks: make(tick.running), cache: ProjectPlanFlowCache()).equatable()
        }
    }

    private func spin(_ s: Double = 0.3) { RunLoop.main.run(until: Date().addingTimeInterval(s)) }

    func testIdleRefreshDoesNotRerenderThePlan() throws {
        let tick = Tick()
        let blocks = ProjectPlanBlock.parse(markdown())
        let parent = Parent(tick: tick, blocks: blocks, make: { status in (try? self.tasks(status)) ?? [] })
        let win = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 700, height: 800), styleMask: [.titled], backing: .buffered, defer: false)
        win.isReleasedWhenClosed = false
        win.contentView = NSHostingView(rootView: parent)
        win.orderFrontRegardless(); spin()
        defer { win.contentView = nil; win.close() }
        tick.n = 100; spin()   // warm-up: SwiftUI settles the first re-render
        Parent.parentBodies = 0
        let before = ProjectPlanFlowView.bodyEvaluations
        for i in 1...6 { tick.n = i; spin(0.1) }
        XCTAssertGreaterThanOrEqual(Parent.parentBodies, 5, "control: the parent did re-render on each refresh")
        XCTAssertEqual(ProjectPlanFlowView.bodyEvaluations, before, "an unchanged plan must not re-evaluate its body")
        tick.running = "accepted"; spin()
        XCTAssertGreaterThan(ProjectPlanFlowView.bodyEvaluations, before, "control: a real task change does redraw")
    }

    func testBreathIsAnEasedRoundTrip() {
        XCTAssertEqual(ProjectPlanGlow.breath(at: 0), 0, accuracy: 1e-9)
        XCTAssertEqual(ProjectPlanGlow.breath(at: 1.8), 1, accuracy: 1e-9)
        XCTAssertEqual(ProjectPlanGlow.breath(at: 3.6), 0, accuracy: 1e-9)
    }
}
