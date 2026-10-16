import XCTest
@testable import MobileCore

/// 2026-10-16 audit #12: an urgent outreach push must reach the phone as time-sensitive.
final class NotificationUrgencyTests: XCTestCase {
    func testUrgentOutreachIsTimeSensitiveButOrdinaryOutreachIsNot() {
        XCTAssertTrue(NotificationUrgency.isTimeSensitive(kind: "orion", level: 2))
        XCTAssertFalse(NotificationUrgency.isTimeSensitive(kind: "orion", level: 1))
        XCTAssertFalse(NotificationUrgency.isTimeSensitive(kind: "orion", level: 0))
    }

    func testTheExistingRulesAreKept() {
        XCTAssertTrue(NotificationUrgency.isTimeSensitive(kind: "checkin", level: 2))
        XCTAssertFalse(NotificationUrgency.isTimeSensitive(kind: "checkin", level: 1))
        XCTAssertTrue(NotificationUrgency.isTimeSensitive(kind: "approval", level: 0))
        XCTAssertFalse(NotificationUrgency.isTimeSensitive(kind: nil, level: 3))
    }
}
