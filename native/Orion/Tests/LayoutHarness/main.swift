import AppKit
import SwiftUI

/*
 Does the day timeline actually have a scroll viewport?

 The bug Nick reported as "the task day-calendar view does not scroll correctly"
 is a nested-scroll-view defect, and it is measurable rather than merely visible.
 DashboardView wraps every tab in a vertical ScrollView. DayTimeline puts its own
 vertical ScrollView inside that. Nested on the same axis, the inner one is
 proposed an UNBOUNDED height, so it sizes itself to its entire 24-hour content.
 A scroll view whose frame equals its content has nothing to scroll: the wheel
 events fall through to the dashboard behind it and the whole page moves instead.

 So the test is a number, not a screenshot: lay the real DayTimeline out inside a
 real NSHostingView at a real window size, both ways, and measure the height it
 takes.

   unbounded  height == full content  -> no viewport, cannot scroll   (the bug)
   bounded    height == the column    -> viewport < content, scrolls  (the fix)

 This runs without a visible window and without screen-recording rights, which
 matters because Orion is an LSUIElement agent whose panel neither the
 screenshot API nor the automation allowlist can reach.
*/

// MARK: - Measurement

private struct HeightKey: PreferenceKey {
    static var defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
        value = max(value, nextValue())
    }
}

/// Lay `view` out at `size` and report the measured height it published.
@MainActor
func measure<V: View>(_ size: CGSize, @ViewBuilder _ view: () -> V) -> CGFloat {
    var measured: CGFloat = 0
    let root = view()
        .onPreferenceChange(HeightKey.self) { measured = $0 }
        .frame(width: size.width, height: size.height, alignment: .top)

    let hosting = NSHostingView(rootView: AnyView(root))
    hosting.frame = CGRect(origin: .zero, size: size)

    // A window, because SwiftUI will not run a full layout pass for a hosting
    // view that has no window. It is never ordered front — nothing appears on
    // Nick's screen and nothing steals his focus.
    let window = NSWindow(
        contentRect: CGRect(origin: .zero, size: size),
        styleMask: [.borderless],
        backing: .buffered,
        defer: false
    )
    window.contentView = hosting
    hosting.layoutSubtreeIfNeeded()

    // Preferences settle on the next runloop turns, not synchronously.
    for _ in 0..<12 {
        RunLoop.main.run(until: Date().addingTimeInterval(0.02))
        hosting.layoutSubtreeIfNeeded()
    }
    window.contentView = nil
    return measured
}

private extension View {
    /// Publish this view's laid-out height.
    func reportHeight() -> some View {
        background(
            GeometryReader { geometry in
                Color.clear.preference(key: HeightKey.self, value: geometry.size.height)
            }
        )
    }
}

// MARK: - Fixtures

let calendar = Calendar.current
let today = calendar.startOfDay(for: Date())

func event(_ title: String, hour: Int, minutes: Int) -> AgendaEvent {
    let start = calendar.date(bySettingHour: hour, minute: 0, second: 0, of: today) ?? today
    return AgendaEvent(
        id: "\(title)-\(hour)",
        title: title,
        start: start,
        end: start.addingTimeInterval(TimeInterval(minutes * 60)),
        isAllDay: false,
        calendarName: "Test",
        colorHex: "#4C8DFF"
    )
}

// A 2am event exists on purpose: the old 6am-to-11pm window CLAMPED anything
// earlier to the top of the grid, so a thing at 2am was drawn on the 6 AM row.
let events = [
    event("Night shift", hour: 2, minutes: 60),
    event("Standup", hour: 9, minutes: 30),
    event("Review", hour: 14, minutes: 90),
    event("Dinner", hour: 19, minutes: 60),
]

func timeline() -> some View {
    DayTimeline(date: today, events: events, onCreate: { _ in }, onSelect: { _ in })
}

// The real numbers from the app: DashboardView hands the tab the window height
// less its own padding, and TasksTab pins the schedule column to that.
let windowSize = CGSize(width: 1280, height: 800)
let columnWidth: CGFloat = 430
let availableHeight = windowSize.height - 86

// MARK: - Run

MainActor.assumeIsolated {
    let app = NSApplication.shared
    app.setActivationPolicy(.prohibited)

    // How tall is the content? 24 hours at 52pt, plus the header and any all-day
    // row, which is what the timeline collapses to when nothing bounds it.
    let unbounded = measure(CGSize(width: columnWidth, height: availableHeight)) {
        // The dashboard's own ScrollView is the whole problem: it proposes an
        // unbounded height to everything inside it.
        ScrollView {
            timeline().reportHeight()
        }
    }

    let bounded = measure(CGSize(width: columnWidth, height: availableHeight)) {
        ScrollView {
            VStack(spacing: 0) {
                timeline().reportHeight()
            }
            // What TasksTab now does to the schedule column.
            .frame(height: availableHeight)
        }
    }

    let contentHeight = CGFloat(24) * 52 + 8

    print("")
    print("== day timeline scroll viewport ==")
    print(String(format: "   window            %.0f x %.0f", windowSize.width, windowSize.height))
    print(String(format: "   column available  %.0f", availableHeight))
    print(String(format: "   24h grid content  %.0f", contentHeight))
    print("   ------------------------------------------------")
    print(String(format: "   unbounded (before) timeline height %.0f", unbounded))
    print(String(format: "   bounded   (after)  timeline height %.0f", bounded))
    print("")

    var failures: [String] = []

    // Before: the timeline swells past the space it has, so its ScrollView frame
    // equals its content and there is nothing left to scroll within.
    if unbounded <= availableHeight + 1 {
        failures.append(
            "expected the unbounded timeline to exceed \(Int(availableHeight))pt "
            + "(it measured \(Int(unbounded))pt) — the bug did not reproduce, so this run proves nothing"
        )
    }

    // After: it fits the column exactly, which means the viewport is smaller
    // than the content and the wheel has somewhere to go.
    if abs(bounded - availableHeight) > 1 {
        failures.append(
            "expected the bounded timeline to be \(Int(availableHeight))pt, measured \(Int(bounded))pt"
        )
    }
    if bounded >= contentHeight {
        failures.append(
            "viewport \(Int(bounded))pt is not smaller than content \(Int(contentHeight))pt — it still cannot scroll"
        )
    }

    // The other half of the fix: WHERE it opens. A viewport that scrolls but
    // always opens at midnight is still the bug Nick reported.
    let bounds = 0...23
    let anchors: [(String, Int, Int)] = [
        ("2pm today opens at 1pm", DayTimeline.anchorHour(hourOfInterest: 14, fallback: 6, bounds: bounds), 13),
        ("9am first event opens at 8am", DayTimeline.anchorHour(hourOfInterest: 9, fallback: 6, bounds: bounds), 8),
        ("empty day falls back to waking", DayTimeline.anchorHour(hourOfInterest: nil, fallback: 6, bounds: bounds), 5),
        ("midnight clamps to 0, not -1", DayTimeline.anchorHour(hourOfInterest: 0, fallback: 6, bounds: bounds), 0),
        ("11pm stays in range", DayTimeline.anchorHour(hourOfInterest: 23, fallback: 6, bounds: bounds), 22),
    ]
    print("== opening position ==")
    for (name, got, want) in anchors {
        print("   \(got == want ? "ok  " : "FAIL") \(name): hour \(got)")
        if got != want { failures.append("\(name): expected hour \(want), got \(got)") }
    }
    print("")

    guard failures.isEmpty else {
        for failure in failures { print("FAIL: \(failure)") }
        exit(1)
    }

    print("PASS: viewport \(Int(bounded))pt < content \(Int(contentHeight))pt — \(Int(contentHeight - bounded))pt to scroll through.")
    print("      Unbounded it was \(Int(unbounded))pt, i.e. its own full height, with nothing to scroll.")
    exit(0)
}
