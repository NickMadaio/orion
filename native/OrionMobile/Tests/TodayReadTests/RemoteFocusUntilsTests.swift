import XCTest
@testable import MobileCore

/// Unblocking a group from the Mac must not lift the night or threshold lock the phone set on it.
final class RemoteFocusUntilsTests: XCTestCase {
    func testAGroupTheMacStopsListingLeavesOnlyItsOwnHold() {
        let previous = ["feeds": 2_000.0, "games": 2_000.0]
        let next = RemoteFocusUntils.reconcile(previous: previous, plan: [.init(name: "games", until: 2_500)], now: 1_000)
        XCTAssertEqual(next, ["games": 2_500])
        // The phone's own night lock on feeds lives in a different store and is still held.
        XCTAssertTrue(RemoteFocusUntils.isHeld(local: 3_000, remote: next["feeds"] ?? 0, now: 1_000))
        XCTAssertFalse(RemoteFocusUntils.isHeld(local: 0, remote: next["feeds"] ?? 0, now: 1_000))
    }

    func testExpiredOrEndlessEntriesKeepNoHold() {
        let next = RemoteFocusUntils.reconcile(previous: [:], plan: [.init(name: "feeds", until: 500), .init(name: "video")], now: 1_000)
        XCTAssertTrue(next.isEmpty)
    }
}
