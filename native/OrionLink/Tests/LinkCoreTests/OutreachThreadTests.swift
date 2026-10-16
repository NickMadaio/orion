import XCTest
import MobileCore
@testable import LinkCore

/// 2026-10-16: a class nudge was only a notification; Nick could not answer it. Every proactive
/// push is now a message in the phone thread, under its id, and a reply carries `replyTo` back.
final class OutreachThreadTests: XCTestCase {
    private var dir: URL!
    private let at = Date(timeIntervalSince1970: 1_790_000_000)

    override func setUpWithError() throws {
        dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        addTeardownBlock { try? FileManager.default.removeItem(at: self.dir) }
    }

    private let nudge: [String: Any] = ["id": "reach-1792159999647-f27a32", "kind": "reminder", "push": true, "urgent": true,
        "text": "ECON1115 starts in 17 min. Up now - you can still make most of it."]

    func testAPushedOutreachBecomesAMessageInTheThreadWithItsId() throws {
        let entry = try XCTUnwrap(OutreachThread.entry(from: nudge))
        XCTAssertEqual(entry.conversationID, LinkSchema.threadID)
        XCTAssertEqual(entry.level, 2)
        let store = try ChatStore(directory: dir)
        XCTAssertTrue(OutreachArchive.append(entry, at: at, to: store))
        let thread = try store.load(LinkSchema.threadID)
        let message = try XCTUnwrap(thread.messages.first)
        XCTAssertEqual(message.id, "reach-1792159999647-f27a32-orion")
        XCTAssertEqual(message.role, .orion)
        XCTAssertEqual(message.text, nudge["text"] as? String)
        // Delivered twice (a retry after a failed save) is still one message.
        OutreachArchive.append(entry, at: at, to: store)
        XCTAssertEqual(try store.load(LinkSchema.threadID).messages.count, 1)
    }

    func testQuestionsGetTheTextReplyCategoryAndTheRestKeepTheButtons() throws {
        var ask = nudge; ask["kind"] = "question"; ask["urgent"] = false
        XCTAssertEqual(OutreachThread.entry(from: ask)?.category, OutreachThread.askCategory)
        XCTAssertEqual(OutreachThread.entry(from: ask)?.level, 1)
        XCTAssertEqual(OutreachThread.entry(from: nudge)?.category, OutreachThread.checkinCategory)
        var sensitive = nudge; sensitive["urgent"] = false; sensitive["timeSensitive"] = true
        XCTAssertEqual(OutreachThread.entry(from: sensitive)?.level, 2)
        XCTAssertNil(OutreachThread.entry(from: ["id": "x", "text": ""]))
    }

    func testACheckinAlertIsAMessageToo() throws {
        let entry = try XCTUnwrap(OutreachThread.entry(fromCheckin: ["id": "c7", "text": "How's resume going?", "level": 2]))
        XCTAssertEqual(entry.conversationID, LinkSchema.threadID)
        XCTAssertTrue(entry.push)
        XCTAssertEqual(entry.level, 2)
    }

    func testAReplyInTheThreadCarriesReplyToIntoOrionRemote() throws {
        let entry = try XCTUnwrap(OutreachThread.entry(from: nudge))
        let thread = [OutreachThread.Line(id: entry.id, sentAt: at, fromORION: true)]
        let replyTo = OutreachThread.replyTarget(thread: thread, now: at.addingTimeInterval(120))
        XCTAssertEqual(replyTo, entry.id)
        let runner = CommandRunner(node: URL(fileURLWithPath: "/n"), remote: URL(fileURLWithPath: "/r"), timeout: 5)
        let args = runner.arguments(text: "on my way", id: "c1", sentAt: at, chat: true, replyTo: replyTo)
        let flag = try XCTUnwrap(args.firstIndex(of: "--reply-to"))
        XCTAssertEqual(args[flag + 1], entry.id)
        XCTAssertLessThan(flag, try XCTUnwrap(args.firstIndex(of: "--")), "before the text terminator")
    }

    func testAnUnsafeOrMissingReplyToIsDropped() {
        let runner = CommandRunner(node: URL(fileURLWithPath: "/n"), remote: URL(fileURLWithPath: "/r"), timeout: 5)
        XCTAssertFalse(runner.arguments(text: "hi", id: "c1", sentAt: at, chat: true).contains("--reply-to"))
        XCTAssertFalse(runner.arguments(text: "hi", id: "c1", sentAt: at, chat: true, replyTo: "x; rm -rf").contains("--reply-to"))
    }
}
