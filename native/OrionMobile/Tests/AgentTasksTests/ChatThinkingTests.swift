import XCTest
@testable import MobileCore
final class ChatThinkingTests: XCTestCase {
    func testThinkingComesOnlyFromCurrentAssistantTurnAndSelectedSession() throws {
        let home = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: home) }
        let base = home.appendingPathComponent(".openclaw/agents/main/sessions")
        try FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
        let file = base.appendingPathComponent("a.jsonl"), now = Date()
        let iso = ISO8601DateFormatter()
        let rows: [[String: Any]] = [
            ["timestamp": iso.string(from: now.addingTimeInterval(-60)), "message": ["role": "assistant", "content": [["type": "thinking", "thinking": "Old thought"]]]],
            ["timestamp": iso.string(from: now), "message": ["role": "user", "content": [["type": "thinking", "thinking": "Untrusted thought"]]]],
            ["timestamp": iso.string(from: now), "message": ["role": "assistant", "content": [["type": "thinking", "thinking": "Checking today's calendar"], ["type": "text", "text": "Answer"]]]]
        ]
        let text = try rows.map { String(decoding: try JSONSerialization.data(withJSONObject: $0), as: UTF8.self) }.joined(separator: "\n")
        try Data(text.utf8).write(to: file)
        let index = ["agent:main:selected": ["sessionFile": file.path]]
        try JSONSerialization.data(withJSONObject: index).write(to: base.appendingPathComponent("sessions.json"))
        XCTAssertEqual(ChatThinking.read(home: home, session: "selected", since: now.addingTimeInterval(-1)), "Checking today's calendar")
        XCTAssertEqual(ChatThinking.read(home: home, session: "SELECTED", since: now.addingTimeInterval(-1)), "Checking today's calendar")
        XCTAssertNil(ChatThinking.read(home: home, session: "other", since: now.addingTimeInterval(-1)))
    }
    func testEarlyAndUsageAreBoundedAndOldScreenPayloadStillDecodes() throws {
        XCTAssertNoThrow(try LinkLog.checkin(action: "early-home").validated())
        XCTAssertThrowsError(try LinkLog.checkin(action: "early-arbitrary").validated())
        let old = LinkLog.screen(at: "2030-10-03T09:00:00Z", locked: false, until: nil, why: nil, graceUntil: nil)
        XCTAssertEqual(try LinkLog.decode(old.encoded()), old)
        XCTAssertThrowsError(try LinkLog.screen(at: "2030-10-03T09:00:00Z", locked: false, until: nil, why: nil, graceUntil: nil, usedMinutes: ["private-app-name": 10]).validated())
    }
}
