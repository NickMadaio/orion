import XCTest
@testable import MouseKit

/// w18 gameready: the two ways to open the mouse popup without chat share one set of words and one URL.
final class MouseSetupEntryTests: XCTestCase {
    func testWordsAndURL() {
        XCTAssertEqual(MouseSetupEntry.menuTitle, "Open mouse setup")
        XCTAssertEqual(MouseSetupEntry.pillTitle, "Set up buttons")
        XCTAssertEqual(MouseSetupEntry.url.absoluteString, "orion://mouse-setup")
    }

    func testTypeToOrionAction() {
        XCTAssertTrue(MouseAction.orionCommands.contains("type"))
        XCTAssertEqual(MouseActionLabel.label(.orion("type")), "Type to ORION")
        XCTAssertEqual(MouseSetupEntry.typeURL.absoluteString, "orion://type")
        XCTAssertEqual(MouseSetupEntry.typeMenuTitle, "Type to ORION  ⌃⌥Space")
    }
}
