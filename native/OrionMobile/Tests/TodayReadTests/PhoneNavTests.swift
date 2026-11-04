import XCTest
@testable import MobileCore

/// The phone's five tabs: where a deep link or widget tap lands, and the ring maths behind Health.
final class PhoneNavTests: XCTestCase {
    private func route(_ text: String) -> PhoneRoute? { URL(string: text).flatMap(PhoneRoute.resolve) }

    func testWidgetLinksLandOnTheRightTab() {
        XCTAssertEqual(route("orion://show/health"), .tab(.health))
        XCTAssertEqual(route("orion://show/plan"), .tab(.plan))
        XCTAssertEqual(route("orion://show/calendar"), .tab(.plan))
        XCTAssertEqual(route("orion://show/tasks"), .tab(.lists))
        XCTAssertEqual(route("orion://show/projects"), .tab(.more))
        XCTAssertEqual(route("orion://show/control"), .tab(.more))
        XCTAssertEqual(route("orion://show/home"), .tab(.home))
        XCTAssertEqual(route("orion://show/today"), .tab(.home))
        XCTAssertEqual(route("orion://show/whatever"), .tab(.home))
    }

    func testChatListenAndWaterAreNotTabs() {
        XCTAssertEqual(route("orion://show/chat"), .chat)
        XCTAssertEqual(route("orion://show/orion"), .chat)
        XCTAssertEqual(route("orion://listen"), .chat)
        XCTAssertEqual(route("orion://water/add"), .addWater)
        XCTAssertNil(route("https://example.com/show/health"))
    }

    func testTabOrderAndNames() {
        XCTAssertEqual(PhoneTab.allCases.map(\.title), ["Home", "Plan", "Health", "Lists", "More"])
        XCTAssertEqual(PhoneTab(rawValue: "health"), .health)
    }

    func testLegacySectionNamesMapToTabs() {
        XCTAssertEqual(PhoneTab.forSection("today"), .home)
        XCTAssertEqual(PhoneTab.forSection("control"), .more)
        XCTAssertEqual(PhoneTab.forSection("health"), .health)
        XCTAssertEqual(PhoneTab.forSection("plan"), .plan)
        XCTAssertEqual(PhoneTab.forSection("todos"), .lists)
    }

    func testRingFractionSurvivesBadNumbers() {
        XCTAssertEqual(RingMath.fraction(50, of: 100), 0.5)
        XCTAssertEqual(RingMath.fraction(150, of: 100), 1)
        XCTAssertEqual(RingMath.fraction(-5, of: 100), 0)
        XCTAssertNil(RingMath.fraction(nil, of: 100))
        XCTAssertEqual(RingMath.fraction(5, of: 0), 0)          // no goal: empty, never a divide by zero
        XCTAssertEqual(RingMath.fraction(.nan, of: 100), 0)
        XCTAssertEqual(RingMath.fraction(.infinity, of: 100), 1)
        XCTAssertEqual(RingMath.fraction(5, of: .nan), 0)
        XCTAssertEqual(RingMath.fraction(5, of: -3), 0)
        XCTAssertEqual(RingMath.clamp(.nan), 0)
    }
}
