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

    func testTheSessionTabHasNoScrollViewOfItsOwn() throws {
        let text = code(try source("SessionTab.swift"))

        XCTAssertFalse(text.contains("ScrollView"),
                       "the dashboard already scrolls; a second one on the same axis "
                       + "silently stops scrolling")
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
}
