import XCTest
@testable import Orion

/// Wave 13: each tab's header subline states one true thing, built from its own data. These pin the wording and,
/// more importantly, that a missing reading is left out rather than shown as a dash or a zero.
final class Wave13TabHeadlineTests: XCTestCase {

    func testSummaryJoinsPartsAndDropsEmptyOnes() {
        XCTAssertEqual(PageSummary.line(["a", nil, "", "b"]), "a · b")
        XCTAssertEqual(PageSummary.line([nil]), "")
    }

    func testProjectsSayWhatIsRunningAndWhatNeedsReview() {
        XCTAssertEqual(ProjectHeadline.line(total: 9, running: 2, review: 1, needsYou: 0), "2 running · 1 needs review")
        XCTAssertEqual(ProjectHeadline.line(total: 9, running: 0, review: 0, needsYou: 1), "9 projects · 1 needs you")
        XCTAssertEqual(ProjectHeadline.line(total: 9, running: 0, review: 0, needsYou: 0), "9 projects · none running")
        XCTAssertEqual(ProjectHeadline.line(total: 1, running: 0, review: 3, needsYou: 0), "1 project · 3 need review")
        XCTAssertEqual(ProjectHeadline.line(total: 0, running: 0, review: 0, needsYou: 0), "no projects yet")
    }

    func testHealthLeavesOutWhatIsNotMeasured() {
        XCTAssertEqual(HealthHeadline.line(recovery: 57, sleepHours: 4.3, strain: 6.3), "recovery 57 · sleep 4.3h · strain 6.3")
        XCTAssertEqual(HealthHeadline.line(recovery: nil, sleepHours: 7.6, strain: nil), "sleep 7.6h")
        XCTAssertEqual(HealthHeadline.line(recovery: nil, sleepHours: nil, strain: nil), "no readings yet")
        XCTAssertEqual(HealthHeadline.line(recovery: nil, sleepHours: .nan, strain: nil), "no readings yet")
    }

    func testFinanceLeadsWithNetWorthAndTheMonth() {
        XCTAssertEqual(FinanceHeadline.line(netWorth: 8_174, spentThisMonth: 54.95, recurringMonthly: 17.99, currency: "USD", month: "November"),
                       "net $8,174 · $54.95 spent in November · $17.99/mo recurring")
        XCTAssertEqual(FinanceHeadline.line(netWorth: 100, spentThisMonth: 0, recurringMonthly: 0, currency: "USD", month: "November"),
                       "net $100 · nothing spent in November")
        XCTAssertEqual(FinanceHeadline.line(netWorth: nil, spentThisMonth: 0, recurringMonthly: 0, currency: "USD", month: "May"), "no accounts linked")
    }

    func testPlanCountsOpenOverdueAndTimeLeft() {
        XCTAssertEqual(PlanHeadline.line(open: 3, overdue: 1, total: 5, hoursLeft: 11), "3 open · 1 overdue · 11h awake left")
        XCTAssertEqual(PlanHeadline.line(open: 0, overdue: 0, total: 4, hoursLeft: 2), "all 4 done · 2h awake left")
        XCTAssertEqual(PlanHeadline.line(open: 0, overdue: 0, total: 0, hoursLeft: 0), "nothing on the list")
    }

    func testSettingsAndBrandAndKnowledge() {
        XCTAssertEqual(SettingsHeadline.line(granted: 8, permissions: 10, connected: 3), "8 of 10 permissions · 3 connected")
        XCTAssertEqual(SettingsHeadline.line(granted: 1, permissions: 10, connected: 1), "1 of 10 permissions · 1 connected")
        XCTAssertEqual(BrandHeadline.line(readable: 0, total: 3, live: 0), "0 of 3 readable · nothing live")
        XCTAssertEqual(BrandHeadline.line(readable: 2, total: 3, live: 1), "2 of 3 readable · 1 live")
        XCTAssertEqual(KnowledgeHeadline.line(nodes: 28, edges: 43), "28 things · 43 connections")
        XCTAssertEqual(KnowledgeHeadline.line(nodes: 1, edges: 1), "1 thing · 1 connection")
        XCTAssertEqual(KnowledgeHeadline.line(nodes: 0, edges: 0), "nothing learned yet")
    }
}
