//
//  A rule the compiler cannot express.
//
//  DashboardView wraps every tab in a vertical ScrollView. A tab that adds its
//  own on the same axis is proposed an unbounded height, sizes itself to its
//  full content, and silently stops scrolling — the wheel goes to the page
//  behind it. It compiles perfectly and looks fine in a screenshot, which is
//  why it needs a test rather than a review.
//
//  `Tests/run-layout-test.sh` measures the real DayTimeline in a real
//  NSHostingView, which is the strongest form of this check. That harness needs
//  a GUI session; this one does not, so it runs on every `swift test` and
//  catches the mistake the moment a new tab is written.
//

import XCTest

final class LayoutRuleTests: XCTestCase {

    private func source(_ name: String) throws -> String {
        let root = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent()
        return try String(contentsOf: root.appendingPathComponent("Sources/Orion/\(name)"),
                          encoding: .utf8)
    }

    /// Only lines that are code — a comment explaining the rule must not trip it.
    private func code(_ text: String) -> String {
        text.split(separator: "\n", omittingEmptySubsequences: false)
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.hasPrefix("//") && !$0.hasPrefix("*") }
            .joined(separator: "\n")
    }

    func testTheSessionCardHasNoScrollViewOfItsOwn() throws {
        // Was SessionTab.swift until the tab became a card on Home. The rule
        // outlives the file it was written for, so it follows it.
        let text = code(try source("SessionCard.swift"))

        XCTAssertFalse(text.contains("ScrollView"),
                       "the dashboard already scrolls; a second one on the same axis "
                       + "silently stops scrolling")
    }

    func testTheCalendarViewsHaveNoScrollViewOfTheirOwn() throws {
        // Was CalendarTab.swift; the calendar is folded into Tasks now and the
        // grids live in CalendarViews. Tasks itself still contains the day
        // timeline's ScrollView, which is legitimate — it is given a definite
        // height, which is what the next test checks.
        let text = code(try source("CalendarViews.swift"))

        XCTAssertFalse(text.contains("ScrollView"),
                       "a month grid is a fixed number of rows and needs no scroll view; "
                       + "adding one on the dashboard's axis stops both of them scrolling")
    }

    /// The month grid must be given a definite row height rather than sizing to
    /// its content, or the page grows a scrollbar for something meant to fit.
    func testTheMonthGridUsesTheHeightItWasGiven() throws {
        let text = code(try source("CalendarViews.swift"))

        XCTAssertTrue(text.contains("height"),
                      "the grid has to divide a real height across its rows rather "
                      + "than sizing to its content")
    }

    /// The calendar is now a column inside Tasks, which already sits in the
    /// dashboard's ScrollView. Its one legitimate inner scroll view — the day
    /// timeline — must still be pinned to a real height.
    func testTheCalendarColumnIsPinnedToARealHeight() throws {
        let text = code(try source("TasksTab.swift"))

        XCTAssertTrue(text.contains("calendarColumn"))
        XCTAssertTrue(text.contains("height: max(360, availableHeight)"),
                      "the column needs a definite height or the timeline has no viewport")
    }

    /// The one tab that DOES contain a ScrollView has to be given a definite
    /// height, which is what turns it into a viewport instead of a tall picture
    /// of one.
    func testTasksTabStillPinsItsScrollingColumnToARealHeight() throws {
        let text = code(try source("TasksTab.swift"))

        XCTAssertTrue(text.contains("availableHeight"),
                      "the schedule column needs the real window height, or its "
                      + "inner ScrollView has no viewport")
    }

    func testTasksUsesTheFullWindowAndCalendarGetsTheRemainingColumn() throws {
        let tasks = code(try source("TasksTab.swift"))
        let dashboard = code(try source("DashboardView.swift"))

        XCTAssertTrue(tasks.contains("availableWidth"))
        XCTAssertTrue(tasks.contains("frame(width: splitWidths.left"))
        XCTAssertTrue(tasks.contains("frame(width: splitWidths.calendar"))
        XCTAssertGreaterThanOrEqual(tasks.components(separatedBy: "frame(maxWidth: .infinity, alignment: .topLeading)").count - 1, 3,
                                    "the visible panel contents must fill their assigned columns")
        XCTAssertTrue(tasks.contains("usableWidth * 0.43"),
                      "the task column should remain substantial on a wide display")
        XCTAssertFalse(tasks.contains("calendar.granularity == .month ? 760 : 470"),
                       "a fixed calendar width strands the right side of the window")
        XCTAssertTrue(dashboard.contains("else if selectedTab == .tasks"))
        XCTAssertTrue(dashboard.contains("availableWidth: max(0, proxy.size.width - 92)"),
                      "Tasks needs the measured usable width inside the dashboard ScrollView")
    }

    func testFocusClockInterpolatesBetweenDurableHeartbeats() throws {
        let text = code(try source("SessionTabModel.swift"))

        XCTAssertTrue(text.contains("@Published private(set) var clockNow"),
                      "the dashboard needs its own one-second invalidation between service heartbeats")
        XCTAssertTrue(text.contains("remainingInPhase ?? 0) - liveSnapshotDelta"),
                      "the visible countdown must advance between durable 30-second snapshots")
        XCTAssertTrue(text.contains("servedFocus ?? 0") && text.contains("+ liveSnapshotDelta"),
                      "visible elapsed focus must advance with the countdown")
    }

    func testAudioStatusIsConfirmedByThePlayerRatherThanThePlan() throws {
        let text = code(try source("SessionTabModel.swift"))

        XCTAssertTrue(text.contains("if mediaIsPlaying"))
        XCTAssertTrue(text.contains("Nothing is playing. Choose Apple Music or Binaural."))
        XCTAssertFalse(text.contains("Playing \\(clip.name), looping until the block ends."),
                       "a planned clip is not proof that an audio engine is producing sound")
    }

    func testDashboardStartOffersAudioAndRequestsAnAppAllowlist() throws {
        let model = code(try source("SessionTabModel.swift"))
        let surface = code(try source("FocusSessionHome.swift"))
        let home = code(try source("HomeTab.swift"))
        let dashboard = code(try source("DashboardView.swift"))

        XCTAssertTrue(model.contains("audioSource = .none"),
                      "a new process must begin from truthful silence, not a remembered source")
        XCTAssertTrue(model.contains("guardSetupRequest = GuardSetupRequest"),
                      "an unarmed focus block must produce one proactive app request")
        XCTAssertTrue(surface.contains("WHICH APPS CAN YOU USE?"))
        XCTAssertTrue(surface.contains("SessionAudioSource.playableCases"))
        XCTAssertTrue(model.contains("mode: .progressive"),
                      "dashboard sessions should propose Progressive Guard by default")
        XCTAssertTrue(surface.contains("guardStrengthBar"),
                      "the session surface should retain the continuous Focus Guard meter")
        XCTAssertTrue(model.contains("performMusic { $0.play() }"),
                      "choosing Apple Music should play deterministically, never toggle it off")
        XCTAssertTrue(model.contains("mediaArtworkPersistentID != persistentID"),
                      "Apple Music artwork should be fetched only when the song changes")
        XCTAssertTrue(surface.contains("Image(nsImage: artwork)"),
                      "Apple Music should render the current song cover, not Binaural artwork")
        XCTAssertFalse(home.contains("FocusSessionHome("),
                       "Home must not create a hidden second session sheet behind the dashboard overlay")
        XCTAssertEqual(dashboard.components(separatedBy: "FocusSessionHome(").count - 1, 1,
                       "one dashboard-owned session surface means one proactive app prompt")
        XCTAssertTrue(surface.contains("private var audioSourceMenu"))
        XCTAssertTrue(surface.contains(".lineLimit(2)"),
                      "the source selector belongs above the metadata so long song titles remain visible")
    }
}
