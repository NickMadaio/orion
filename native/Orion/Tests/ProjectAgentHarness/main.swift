import AppKit
import SwiftUI

/*
 Does the project agent panel actually lay out, and does its reasoning channel
 have a viewport?

 The second question is the one with history. DashboardView wraps every tab in a
 vertical ScrollView; the panel adds its own for the live reasoning trace and for
 each instruction document. Nested on the same axis, an inner ScrollView is
 proposed an UNBOUNDED height, sizes itself to its whole content, and a scroll
 view whose frame equals its content has nothing to scroll -- the wheel falls
 through and the entire page moves instead. That is exactly the defect Nick
 reported for the day timeline, and run-layout-test.sh exists because of it.

 The trace can be 6000 characters. Unbounded, that is thousands of points of
 panel. So this measures rather than looks: lay the real panel out in a real
 NSHostingView inside a real ScrollView, with a long trace, and check the
 channel stayed inside its cap.

 It needs a GUI login session but never shows a window, takes no screenshot and
 needs no screen-recording rights -- which is what makes it usable at all, since
 Orion is an LSUIElement agent neither the screenshot API nor the automation
 allowlist can see.
*/

private struct HeightKey: PreferenceKey {
    static var defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
        value = max(value, nextValue())
    }
}

@MainActor
func measure<V: View>(_ size: CGSize, @ViewBuilder _ view: () -> V) -> CGFloat {
    var measured: CGFloat = 0
    let root = view()
        .onPreferenceChange(HeightKey.self) { measured = $0 }
        .frame(width: size.width, height: size.height, alignment: .top)

    let hosting = NSHostingView(rootView: AnyView(root))
    hosting.frame = CGRect(origin: .zero, size: size)
    // SwiftUI will not run a full layout pass for a hosting view with no window.
    // It is never ordered front: nothing appears and nothing steals focus.
    let window = NSWindow(contentRect: CGRect(origin: .zero, size: size),
                          styleMask: [.borderless], backing: .buffered, defer: false)
    window.contentView = hosting
    hosting.layoutSubtreeIfNeeded()
    for _ in 0..<12 {
        RunLoop.main.run(until: Date().addingTimeInterval(0.02))
        hosting.layoutSubtreeIfNeeded()
    }
    window.contentView = nil
    return measured
}

private extension View {
    func reportHeight() -> some View {
        background(GeometryReader { geometry in
            Color.clear.preference(key: HeightKey.self, value: geometry.size.height)
        })
    }
}

// MARK: - Fixtures

func run(escalated: Bool) -> ProjectAgentStatus {
    var payload: [String: Any] = [
        "version": 3, "revision": 12, "runId": "harness", "status": escalated ? "escalated" : "running",
        "activeTask": escalated ? (NSNull() as Any) : ("second" as Any),
        "tasks": [
            ["id": "first", "title": "Add the durable contract", "weight": 3,
             "status": "accepted", "stage": "accepted", "attempts": 1, "origin": "plan",
             "commit": String(repeating: "a", count: 40)],
            ["id": "second", "title": "Wire the reviewer gate", "weight": 2,
             "status": escalated ? "blocked" : "running", "stage": escalated ? "queued" : "implement",
             "attempts": 2, "origin": "plan",
             "blocker": escalated ? ("review_blocked" as Any) : (NSNull() as Any)],
            ["id": "second-fix1-1", "title": "Handle the empty case", "weight": 1,
             "status": "queued", "stage": "queued", "attempts": 0, "origin": "review_correction"],
        ],
        "events": [], "steering": [["id": "s1", "text": "Preserve the public interface", "applied": false]],
        "repairs": [["id": "r1", "at": "2026-09-21T02:00:00.000Z", "taskId": "second",
                     "model": "gemma4:31b", "files": ["a.mjs"], "summary": "fixed the interface"]],
        "finalReview": false,
    ]
    payload["escalations"] = escalated ? [[
        "id": "e1", "at": "2026-09-21T02:40:00.000Z", "kind": "architecture",
        "reason": "two defensible designs and the contract picks neither",
        "taskId": "second", "question": "Which shape do you want?",
        "recommendAstra": true, "notified": true, "resolvedAt": NSNull(),
    ]] : []
    let data = try! JSONSerialization.data(withJSONObject: payload)
    return try! ProjectAgentStatus.decode(data)
}

func activity(traceLength: Int) -> ProjectAgentActivity {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    let payload: [String: Any] = [
        "at": formatter.string(from: Date()), "role": "worker", "model": "qwen3.6:27b",
        "phase": "implement", "taskId": "second", "thinking": true, "streaming": true,
        "thinkingChars": traceLength, "outputChars": 0,
        "startedAt": formatter.string(from: Date().addingTimeInterval(-120)),
        "trace": String(repeating: "the model is reasoning about the contract. ", count: max(1, traceLength / 43)),
        "output": "", "note": NSNull(),
    ]
    return try! JSONDecoder().decode(ProjectAgentActivity.self,
                                     from: try! JSONSerialization.data(withJSONObject: payload))
}

@MainActor
func panel(_ status: ProjectAgentStatus, _ live: ProjectAgentActivity?) -> some View {
    // Inside a ScrollView, because that is how DashboardView hosts every tab and
    // it is the condition that creates the nested-scroll defect.
    ScrollView {
        ProjectAgentPanel(
            run: status, beat: nil, activity: live, settings: nil,
            steering: .constant(""), controlling: false, controlError: nil,
            onControl: { _ in }, onSettingsChanged: { _ in }
        )
        .reportHeight()
    }
}

// MARK: - Run

let size = CGSize(width: 820, height: 900)

MainActor.assumeIsolated {
    let app = NSApplication.shared
    app.setActivationPolicy(.prohibited)

    var failures: [String] = []

    print("== project agent panel ==")

    let short = measure(size) { panel(run(escalated: false), activity(traceLength: 120)) }
    if short > 0 {
        print("   ok   panel lays out (\(Int(short))pt with a short trace)")
    } else {
        print("   FAIL panel measured 0pt — it did not lay out at all")
        failures.append("panel did not lay out")
    }

    // A 6000-character trace is the channel's cap. If the inner ScrollView has
    // no viewport it grows by thousands of points and pushes the controls off
    // the bottom of the panel for the whole time a model is thinking.
    let long = measure(size) { panel(run(escalated: false), activity(traceLength: 6000)) }
    let growth = long - short
    if growth < 220 {
        print("   ok   reasoning channel is bounded (+\(Int(growth))pt for a 6000-char trace)")
    } else {
        print("   FAIL reasoning channel grew \(Int(growth))pt — no viewport, the trace pushes the panel open")
        failures.append("reasoning channel is unbounded inside the dashboard's ScrollView")
    }

    let blocked = measure(size) { panel(run(escalated: true), nil) }
    if blocked > short * 0.5 {
        print("   ok   escalated panel lays out (\(Int(blocked))pt, banner included)")
    } else {
        print("   FAIL escalated panel measured \(Int(blocked))pt")
        failures.append("escalated panel did not lay out")
    }

    // The panel must survive the states a real overnight run actually reaches:
    // no heartbeat, no activity file, no config. Each is the NORMAL state before
    // a first run, and a panel that crashes on them is a panel nobody can use to
    // find out why nothing started.
    let bare = measure(size) { panel(run(escalated: false), nil) }
    if bare > 0 {
        print("   ok   lays out with no heartbeat, no activity and no config (\(Int(bare))pt)")
    } else {
        print("   FAIL panel measured 0pt with absent optional state")
        failures.append("panel did not lay out with absent optional state")
    }

    print("")
    guard failures.isEmpty else {
        for failure in failures { print("FAIL: \(failure)") }
        exit(1)
    }
    print("PASS: the panel lays out in every state, and the reasoning channel keeps its viewport.")
    exit(0)
}
