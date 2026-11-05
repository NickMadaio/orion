import XCTest
import MobileCore
@testable import LinkCore

/// w20 phonelink (tube audit 2026-11-04): duplicates, stale commands, and progress lines for the phone.
final class PhoneCommandFlowTests: XCTestCase {
    private let t0 = Date(timeIntervalSince1970: 1_800_000_000)

    // MARK: identical message, same device, within about two minutes

    func testAnIdenticalChatWithinTwoMinutesCollapsesIntoTheFirstRun() {
        let first = CommandDedupe().starting(id: "a", text: "push everything back", conversation: "c1", sentAt: t0)
            .finishing(id: "a", ok: true, reply: "Not done: gym didn't fit.", thinking: nil)
        let verdict = first.verdict(id: "b", text: "push everything back", conversation: "c1", sentAt: t0.addingTimeInterval(64))
        guard case .collapse(let entry) = verdict else { return XCTFail("expected a collapse, got \(verdict)") }
        XCTAssertEqual(entry.id, "a")
        XCTAssertEqual(entry.outcome, .finished(ok: true, reply: "Not done: gym didn't fit.", thinking: nil))
    }

    func testCaseSpacingAndSpellingOfSpacesDoNotMakeItADifferentMessage() {
        let d = CommandDedupe().starting(id: "a", text: "Drop  everything.\n", conversation: nil, sentAt: t0)
        XCTAssertNotEqual(d.verdict(id: "b", text: " drop everything. ", conversation: nil, sentAt: t0.addingTimeInterval(5)), .run)
    }

    func testAfterTwoMinutesAnIdenticalMessageIsAFreshAsk() {
        let d = CommandDedupe().starting(id: "a", text: "gym at 10", conversation: nil, sentAt: t0).finishing(id: "a", ok: true, reply: "x", thinking: nil)
        XCTAssertEqual(d.verdict(id: "b", text: "gym at 10", conversation: nil, sentAt: t0.addingTimeInterval(CommandDedupe.window + 1)), .run)
    }

    func testADifferentConversationOrTextRunsNormally() {
        let d = CommandDedupe().starting(id: "a", text: "gym at 10", conversation: "c1", sentAt: t0)
        XCTAssertEqual(d.verdict(id: "b", text: "gym at 10", conversation: "c2", sentAt: t0.addingTimeInterval(5)), .run)
        XCTAssertEqual(d.verdict(id: "b", text: "gym at 11", conversation: "c1", sentAt: t0.addingTimeInterval(5)), .run)
    }

    func testARefusedFirstRunIsRetriedForRealNotCollapsed() {
        let d = CommandDedupe().starting(id: "a", text: "unlock", conversation: nil, sentAt: t0).finishing(id: "a", ok: false, reply: "Orion is locked.", thinking: nil)
        XCTAssertEqual(d.verdict(id: "b", text: "unlock", conversation: nil, sentAt: t0.addingTimeInterval(20)), .run)
    }

    func testTheSameIdIsNeverItsOwnDuplicate() {
        let d = CommandDedupe().starting(id: "a", text: "hi", conversation: nil, sentAt: t0)
        XCTAssertEqual(d.verdict(id: "a", text: "hi", conversation: nil, sentAt: t0), .run)
    }

    func testTheLedgerIsBoundedAndImmutable() {
        var d = CommandDedupe()
        let before = d
        for i in 0..<200 { d = d.starting(id: "i\(i)", text: "m\(i)", conversation: nil, sentAt: t0.addingTimeInterval(Double(i))) }
        XCTAssertEqual(before.entries.count, 0)
        XCTAssertLessThanOrEqual(d.entries.count, CommandDedupe.capacity)
    }

    // MARK: old commands

    func testAChatMessageAlwaysRunsHoweverLateItArrived() {
        XCTAssertEqual(StaleCommand.decide(kind: .chat, age: 13 * 60), .run)
        XCTAssertEqual(StaleCommand.decide(kind: .chat, age: 5 * 3600), .run)
    }

    func testATimeBoundCommandIsAskedAboutNotRefused() {
        XCTAssertEqual(StaleCommand.decide(kind: .control, age: 9 * 60), .run)
        guard case .ask(let question) = StaleCommand.decide(kind: .control, age: 13 * 60 + 20) else { return XCTFail("expected ask") }
        XCTAssertTrue(question.contains("13 min ago"), question)
        XCTAssertTrue(question.lowercased().contains("still want it"), question)
        guard case .ask(let hours) = StaleCommand.decide(kind: .control, age: 2 * 3600 + 600) else { return XCTFail("expected ask") }
        XCTAssertTrue(hours.contains("2 h ago"), hours)
    }

    func testYesRunsTheHeldCommandOnceAndOnlyWhileItIsFresh() {
        let held = StaleHold().holding(id: "h1", text: "unblock snap", at: t0)
        XCTAssertTrue(StaleHold.isYes("Yes please"))
        XCTAssertTrue(StaleHold.isYes("yeah do it"))
        XCTAssertFalse(StaleHold.isYes("yes but make the gym an hour and push sleep"), "a real message is not a bare yes")
        XCTAssertFalse(StaleHold.isYes("no"))
        let (command, rest) = held.confirming("yep", now: t0.addingTimeInterval(120))
        XCTAssertEqual(command?.text, "unblock snap")
        XCTAssertEqual(command?.id, "h1")
        XCTAssertNil(rest.held)
        XCTAssertNil(held.confirming("yep", now: t0.addingTimeInterval(StaleHold.lifetime + 1)).0)
        XCTAssertNil(held.confirming("not now", now: t0.addingTimeInterval(5)).0)
    }

    // MARK: progress lines

    private func progress(_ stages: [(String, String, String?)], say: String? = nil, done: Bool = false, started: Date) -> Data {
        let iso = ISO8601DateFormatter()
        var root: [String: Any] = ["v": 1, "startedAt": iso.string(from: started), "done": done,
                                   "stages": stages.map { ["stage": $0.0, "label": $0.1, "at": iso.string(from: started)].merging($0.2.map { ["detail": $0] } ?? [:]) { a, _ in a } }]
        if let say { root["say"] = say }
        return try! JSONSerialization.data(withJSONObject: root)
    }

    func testTheFrontDesksLineIsTheFirstThingThePhoneHears() {
        let data = progress([("understanding", "working out what you need", nil)], say: "Rebuilding your evening, one moment.", started: t0)
        XCTAssertEqual(PhoneProgress.line(from: data, notBefore: t0.addingTimeInterval(-1)), "Rebuilding your evening, one moment.")
    }

    func testALaterRealStageReplacesIt() {
        let data = progress([("understanding", "working out what you need", nil), ("reading-calendar", "checking your calendar", nil)], say: "On it.", started: t0)
        XCTAssertEqual(PhoneProgress.line(from: data, notBefore: t0), "Checking your calendar…")
        let write = progress([("understanding", "u", nil), ("changing-calendar", "making the change on your calendar", "Gym")], started: t0)
        XCTAssertEqual(PhoneProgress.line(from: write, notBefore: t0), "Making the change to Gym…")
    }

    func testAnEarlierTurnsFileOrAFinishedTurnGivesNothing() {
        let old = progress([("reading-calendar", "checking your calendar", nil)], say: "x", started: t0.addingTimeInterval(-600))
        XCTAssertNil(PhoneProgress.line(from: old, notBefore: t0))
        let done = progress([("thinking", "putting the answer together", nil)], done: true, started: t0)
        XCTAssertNil(PhoneProgress.line(from: done, notBefore: t0))
        XCTAssertNil(PhoneProgress.line(from: Data("nope".utf8), notBefore: t0))
    }

    func testTheFileNameMatchesThePluginsForAPhoneConversation() {
        XCTAssertEqual(PhoneProgress.fileName(session: "orion-chat-0C84E8E5-D163"), "agent_main_orion-chat-0c84e8e5-d163.json")
        XCTAssertEqual(PhoneProgress.fileName(session: "agent:main:orion-app-v2"), "agent_main_orion-app-v2.json")
    }
}

/// One phone conversation, one gateway session key.
final class PhoneSessionKeyTests: XCTestCase {
    func testTheSameConversationIsTheSameKeyWhateverTheCase() {
        XCTAssertEqual(CommandRunner.session(conversation: "0C84E8E5-D163"), CommandRunner.session(conversation: " 0c84e8e5-d163 "))
        XCTAssertEqual(CommandRunner.session(conversation: "0C84E8E5-D163"), "orion-chat-0c84e8e5-d163")
    }

    func testAChatWithNoConversationJoinsThePhoneThreadNotTheMacApp() {
        XCTAssertEqual(CommandRunner.session(conversation: nil), "orion-chat-phone-history")
        XCTAssertEqual(CommandRunner.session(conversation: ""), CommandRunner.session(conversation: LinkSchema.threadID))
        XCTAssertEqual(CommandRunner.session(conversation: nil, chat: false), "orion-app-v2", "button commands keep the app session")
    }
}
