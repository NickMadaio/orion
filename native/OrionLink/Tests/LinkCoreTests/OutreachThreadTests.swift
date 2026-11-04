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

    /// w19-reminders: a reminder he set carries Snooze and Done on its phone notification; nothing else does.
    func testAReminderOutreachGetsTheReminderCategory() throws {
        var row = nudge
        row["category"] = "orion.reminder"
        let entry = try XCTUnwrap(OutreachThread.entry(from: row))
        XCTAssertEqual(entry.category, OutreachThread.reminderCategory)
        XCTAssertEqual(OutreachThread.reminderCategory, "orion.reminder")
        XCTAssertEqual(try XCTUnwrap(OutreachThread.entry(from: nudge)).category, OutreachThread.checkinCategory, "an ordinary nudge keeps the check-in buttons")
        // A question is still a question, whatever else the row says.
        var ask = row
        ask["category"] = "orion.ask"
        XCTAssertEqual(try XCTUnwrap(OutreachThread.entry(from: ask)).category, OutreachThread.askCategory)
    }

    /// The words the notification buttons send into the chat, read by the plugin as a snooze and a done.
    func testTheReminderButtonsSendWordsTheReminderFlowReads() {
        XCTAssertEqual(OutreachThread.reminderSnoozeText, "snooze 10 min")
        XCTAssertEqual(OutreachThread.reminderDoneText, "done")
    }

    /// W16-d: a reply Nick typed into the Mac's proactive bubble, and ORION's answer, mirrored as one answered turn of his.
    func testABubbleExchangeIsHisTurnAnsweredNotANewOrionMessage() throws {
        let row: [String: Any] = ["id": "bubble-reach-1-1800000000", "text": "Okay — want it at 9:30 PM?", "said": "nah plans changed",
                                  "kind": "bubble-reply", "push": false, "urgent": false]
        let entry = try XCTUnwrap(OutreachThread.entry(from: row))
        XCTAssertEqual(entry.said, "nah plans changed")
        XCTAssertFalse(entry.push)
        XCTAssertEqual(entry.category, OutreachThread.checkinCategory, "never a question for the phone to answer")
        XCTAssertNil(OutreachThread.entry(from: nudge)?.said)
        let store = try ChatStore(directory: dir)
        XCTAssertTrue(OutreachArchive.append(entry, at: at, to: store))
        let messages = try store.load(LinkSchema.threadID).messages
        XCTAssertEqual(messages.map(\.role), [.user, .orion])
        XCTAssertEqual(messages.map(\.text), ["nah plans changed", "Okay — want it at 9:30 PM?"])
        OutreachArchive.append(entry, at: at, to: store)
        XCTAssertEqual(try store.load(LinkSchema.threadID).messages.count, 2, "a retry is still one exchange")
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

    /// The row `orion-reach --ask` writes (tests/inbound-turn.test.mjs pins its shape): a pushed question with askId and category.
    func testAnAskRowAsOrionReachWritesItIsAnAnswerableMessageInTheThread() throws {
        let row: [String: Any] = ["id": "reach-1792160000000-ab12cd", "text": "What have you been up to since 1? I'll log it.", "kind": "question",
            "push": true, "urgent": false, "timeSensitive": true, "askId": "ask-1", "category": "orion.ask",
            "ask": ["type": "blank", "askId": "ask-1"]]
        let entry = try XCTUnwrap(OutreachThread.entry(from: row))
        XCTAssertEqual(entry.category, OutreachThread.askCategory, "the phone shows a text-reply field")
        XCTAssertEqual(entry.level, 2, "timeSensitive shows time-sensitive")
        XCTAssertTrue(entry.push)
        let store = try ChatStore(directory: dir)
        XCTAssertTrue(OutreachArchive.append(entry, at: at, to: store))
        let message = try XCTUnwrap(try store.load(LinkSchema.threadID).messages.first)
        XCTAssertEqual(message.role, .orion)
        XCTAssertEqual(OutreachThread.replyTarget(thread: [OutreachThread.Line(id: entry.id, sentAt: at, fromORION: true)], now: at.addingTimeInterval(3000)), entry.id,
                       "his reply carries this id back; orion-inbound-turn matches it to the ask")
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
