//
//  The focus screen's reading of what a work session allows, and the early-finish question the button asks.
//

import XCTest
@testable import SessionService

final class FocusWebTests: XCTestCase {
    private func data(_ json: String) -> Data { Data(json.utf8) }

    func testReadsAnActiveSession() throws {
        let state = try XCTUnwrap(FocusWebState.parse(data("""
        {"version":1,"active":true,"task":"Finish resume","allowedApps":["com.apple.Safari"],"allowedAppNames":["Pages","Safari"],
         "allowedDomains":["docs.google.com","github.com"],"overrides":["youtube.com"],"phase":"focus","phaseEnd":"2026-11-04T18:50:00.000Z"}
        """)))
        XCTAssertEqual(state.task, "Finish resume")
        XCTAssertEqual(state.appNames, ["Pages", "Safari"])
        XCTAssertEqual(state.overrides, ["youtube.com"])
        XCTAssertEqual(state.phase, "focus")
        XCTAssertEqual(state.phaseEnd, ISO8601DateFormatter().date(from: "2026-11-04T18:50:00Z"))
        XCTAssertEqual(state.summary, "PAGES · SAFARI · 3 SITES")
    }

    func testClearedMissingOrBrokenFilesAreNoSession() {
        XCTAssertNil(FocusWebState.parse(nil))
        XCTAssertNil(FocusWebState.parse(data("{nope")))
        XCTAssertNil(FocusWebState.parse(data(#"{"active":false,"task":"x"}"#)))
        XCTAssertNil(FocusWebState.parse(data(#"{"active":true}"#)))
    }

    func testSummaryWithOneSiteIsSingular() {
        let state = FocusWebState(task: "t", appNames: ["Safari"], domains: ["a.com"], overrides: [], phase: nil, phaseEnd: nil)
        XCTAssertEqual(state.summary, "SAFARI · 1 SITE")
    }

    func testTheEarlyQuestionIsWrittenForTheChatToHear() throws {
        let now = Date(timeIntervalSince1970: 1_700_000_000)
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: FocusEarlyPrompt.pendingJSON(task: "Finish resume", now: now)) as? [String: Any])
        XCTAssertEqual(json["kind"] as? String, "early")
        XCTAssertEqual(json["task"] as? String, "Finish resume")
        XCTAssertEqual(json["askNext"] as? Bool, true)
        XCTAssertEqual(json["at"] as? Int, 1_700_000_000_000)
        let bare = try XCTUnwrap(JSONSerialization.jsonObject(with: FocusEarlyPrompt.pendingJSON(task: "Focus", now: now)) as? [String: Any])
        XCTAssertNil(bare["task"])
        XCTAssertEqual(FocusEarlyPrompt.line(task: nil), "Nice. Start your break now, or move to your next task?")
    }
}
