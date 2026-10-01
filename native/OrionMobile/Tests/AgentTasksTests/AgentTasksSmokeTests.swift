import XCTest
@testable import MobileCore

/// Keeps the target non-empty; each agent task adds its own test file beside this one.
final class AgentTasksSmokeTests: XCTestCase {
    func testTargetBuilds() { XCTAssertTrue(true) }
}
