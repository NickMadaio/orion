import XCTest
@testable import Orion

/// Phase 52: the in-app answers to "ORION wants to run a command".
final class ApprovalsOverlayTests: XCTestCase {
    private func directory() throws -> URL {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: url) }
        return url
    }

    private func ticket(_ id: String, action: String = "terminal_run", session: String? = "chat-1", expires: Date) -> Data {
        let formatter = ISO8601DateFormatter(); formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        var object: [String: Any] = ["id": id, "action": action, "summary": "terminal_run — command: ls", "context": "list",
                                     "expiresAt": formatter.string(from: expires), "canonicalHash": "x", "nonce": "y"]
        if let session { object["sessionKey"] = session }
        return try! JSONSerialization.data(withJSONObject: object)
    }

    func testOnlyUnexpiredUngrantedRequestsAreWaiting() throws {
        let tickets = try directory(), grants = try directory()
        try ticket("A-AAAA", expires: Date().addingTimeInterval(600)).write(to: tickets.appendingPathComponent("A-AAAA.json"))
        try ticket("A-BBBB", expires: Date().addingTimeInterval(-60)).write(to: tickets.appendingPathComponent("A-BBBB.json"))
        try ticket("A-CCCC", expires: Date().addingTimeInterval(600)).write(to: tickets.appendingPathComponent("A-CCCC.json"))
        try Data("{}".utf8).write(to: grants.appendingPathComponent("A-CCCC.json"))
        XCTAssertEqual(ApprovalsStore.pending(tickets: tickets, grants: grants).map(\.id), ["A-AAAA"])
    }

    func testAllowForThisChatIsOfferedOnlyWhereThePluginHonoursIt() throws {
        let decode = { (data: Data) in try JSONDecoder().decode(PendingApproval.self, from: data) }
        XCTAssertTrue(try decode(ticket("A-AAAA", expires: Date())).chatGrantable)
        XCTAssertFalse(try decode(ticket("A-AAAA", action: "messages_send", expires: Date())).chatGrantable)
        XCTAssertFalse(try decode(ticket("A-AAAA", session: nil, expires: Date())).chatGrantable)
    }

    func testEachAnswerIsTheArgvOrionApproveExpects() {
        XCTAssertEqual(ApprovalsStore.arguments(.once, id: "A-7F3K"), ["A-7F3K"])
        XCTAssertEqual(ApprovalsStore.arguments(.chat, id: "A-7F3K"), ["A-7F3K", "--chat"])
        XCTAssertEqual(ApprovalsStore.arguments(.deny, id: "A-7F3K"), ["deny", "A-7F3K"])
    }

    func testStopWritesTheCancelMarkAndNeverAPath() throws {
        let cancel = try directory()
        try ApprovalsStore.stop("orion-0123456789abcdef", directory: cancel)
        XCTAssertTrue(FileManager.default.fileExists(atPath: cancel.appendingPathComponent("orion-0123456789abcdef").path))
        XCTAssertThrowsError(try ApprovalsStore.stop("../../etc/passwd", directory: cancel))
    }
}
