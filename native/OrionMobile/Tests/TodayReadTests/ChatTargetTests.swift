import XCTest
@testable import MobileCore

final class ChatTargetTests: XCTestCase {
    private let t = Date(timeIntervalSince1970: 1_800_000_000)

    func testTheOpenChatWins() {
        XCTAssertEqual(ChatTarget.resolve(current: "open", recent: [("old", t)]), "open")
    }

    func testHomeContinuesTheMostRecentChat() {
        let recent: [(id: String?, at: Date)] = [("a", t), ("b", t.addingTimeInterval(60)), (nil, t.addingTimeInterval(120))]
        XCTAssertEqual(ChatTarget.resolve(current: nil, recent: recent), "b", "a message with no conversation does not count")
        XCTAssertEqual(ChatTarget.resolve(current: "", recent: recent), "b")
    }

    func testNoChatYetCreatesOne() {
        XCTAssertEqual(ChatTarget.resolve(current: nil, recent: [], make: { "fresh" }), "fresh")
        XCTAssertEqual(ChatTarget.resolve(current: nil, recent: [(nil, t)], make: { "fresh" }), "fresh")
    }
}
