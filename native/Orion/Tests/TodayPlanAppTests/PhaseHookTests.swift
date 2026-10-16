import XCTest
@testable import Orion

final class PhaseHookTests: XCTestCase {
    private let t0 = Date(timeIntervalSince1970: 1_800_000_000)
    private func focus(_ i: Int = 0) -> SessionPhaseInfo { SessionPhaseInfo(state: "focus", phaseKind: "focus", phaseIndex: i, sessionID: "S1", task: "thesis", remaining: 600) }
    private func rest(_ i: Int = 1) -> SessionPhaseInfo { SessionPhaseInfo(state: "rest", phaseKind: "rest", phaseIndex: i, sessionID: "S1", task: "thesis", remaining: 120) }

    private func hook(ran: @escaping (PhaseCommand) -> Void, ok: Bool = true, installed: Set<String> = ["node", "/s/orion-awareness", "/s/orion-reach"]) -> PhaseHook {
        PhaseHook(run: { ran($0); return ok }, exists: { installed.contains($0) || $0.hasSuffix("/node") }, home: "/h", log: { _ in })
    }

    func testFocusToRestSpawnsOnceAndHeartbeatsSpawnNothing() {
        var ran: [PhaseCommand] = []
        let hook = PhaseHook(run: { ran.append($0); return true }, exists: { _ in true }, home: "/h", log: { _ in })
        hook.observe(focus(), now: t0, sync: true)                       // baseline, not a change
        hook.observe(focus(), now: t0.addingTimeInterval(30), sync: true) // heartbeat
        hook.observe(rest(), now: t0.addingTimeInterval(60), sync: true)
        hook.observe(rest(), now: t0.addingTimeInterval(90), sync: true) // heartbeat
        XCTAssertEqual(ran.count, 1)
        let args = ran[0].arguments
        XCTAssertTrue(args[0].hasSuffix("/orion-awareness"))
        XCTAssertEqual(Array(args[1...5]), ["phase", "--from", "focus", "--to", "rest"])
        XCTAssertEqual(args[6], "--session")
        let json = try! JSONSerialization.jsonObject(with: Data(args[7].utf8)) as! [String: Any]
        XCTAssertEqual(json["state"] as? String, "rest")
        XCTAssertEqual(json["source"] as? String, "phase-hook")
        XCTAssertEqual(json["sessionId"] as? String, "S1")
        XCTAssertNotNil(json["phaseEndsAt"])
    }

    func testEndAndPauseAreTransitionsToo() {
        var tracker = PhaseTracker()
        _ = tracker.observe(rest(), now: t0)
        XCTAssertEqual(tracker.observe(SessionPhaseInfo(state: "none"), now: t0.addingTimeInterval(5)), PhaseTransition(from: "rest", to: "none"))
        _ = tracker.observe(focus(), now: t0.addingTimeInterval(10))
        XCTAssertEqual(tracker.observe(SessionPhaseInfo(state: "paused", phaseKind: nil, phaseIndex: 0), now: t0.addingTimeInterval(20))?.to, "paused")
    }

    func testALongPauseFiresOnceFromTheHeartbeat() {
        var tracker = PhaseTracker()
        let paused = SessionPhaseInfo(state: "paused", phaseIndex: 0)
        _ = tracker.observe(focus(), now: t0)
        XCTAssertNotNil(tracker.observe(paused, now: t0.addingTimeInterval(10)))
        XCTAssertNil(tracker.observe(paused, now: t0.addingTimeInterval(100)))
        XCTAssertTrue(tracker.observe(paused, now: t0.addingTimeInterval(200))?.longPause == true)
        XCTAssertNil(tracker.observe(paused, now: t0.addingTimeInterval(260)))
    }

    func testMissingAwarenessCliFallsBackToTheDrain() {
        var ran: [PhaseCommand] = []
        let hook = hook(ran: { ran.append($0) }, installed: ["/h/.openclaw/orion-remote/scripts/orion-reach"])
        hook.observe(focus(), now: t0, sync: true)
        hook.observe(rest(), now: t0.addingTimeInterval(1), sync: true)
        XCTAssertEqual(ran.count, 1)
        XCTAssertEqual(Array(ran[0].arguments.dropFirst()), ["--drain-held", "--reason", "break"])
    }

    func testNothingInstalledSpawnsNothingAndDoesNotCrash() {
        var ran = 0
        let hook = PhaseHook(run: { _ in ran += 1; return true }, exists: { _ in false }, home: "/h", log: { _ in })
        hook.observe(focus(), now: t0, sync: true)
        hook.observe(rest(), now: t0.addingTimeInterval(1), sync: true)
        XCTAssertEqual(ran, 0)
    }

    func testFailedPhaseCommandTriesTheDrainButEnteringFocusDrainsNothing() {
        var ran: [PhaseCommand] = []
        let hook = PhaseHook(run: { ran.append($0); return ran.count > 1 }, exists: { _ in true }, home: "/h", log: { _ in })
        hook.observe(rest(), now: t0, sync: true)
        hook.observe(focus(2), now: t0.addingTimeInterval(1), sync: true)
        XCTAssertEqual(ran.count, 1, "rest to focus: phase only, no drain fallback")
    }
}

final class PhaseSessionFixtureTests: XCTestCase {
    /// tests/fixtures/phase-session.json is the contract-C3 payload; tests/awareness-cli.test.mjs feeds the same file to `orion-awareness phase`.
    func testTheHookSendsExactlyTheCheckedInSessionFixture() throws {
        let now = Date(timeIntervalSince1970: 1_800_000_000)   // 2027-01-15T08:00:00Z
        let info = SessionPhaseInfo(state: "focus", phaseKind: "focus", phaseIndex: 1, sessionID: "S1", task: "essay", remaining: 1200)
        let sent = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(PhaseCommands.sessionJSON(info, now: now).utf8)) as? NSDictionary)
        let path = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("tests/fixtures/phase-session.json")
        let fixture = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: path)) as? NSDictionary)
        XCTAssertEqual(sent, fixture)
    }
}

final class InboundTurnLogTests: XCTestCase {
    func testTheCommandCarriesTheReplyIdAndTheTextAndIsNilWhereTheScriptIsNotInstalled() {
        let all: (String) -> Bool = { _ in true }
        let command = InboundTurnLog.command(text: "was at the gym", replyTo: "reach-9", node: "/n/node", scriptsDir: "/s", exists: all)
        XCTAssertEqual(command, PhaseCommand(executable: "/n/node", arguments: ["/s/orion-inbound-turn", "--reply-to", "reach-9", "--text", "was at the gym"]))
        let plain = InboundTurnLog.command(text: "hi", replyTo: nil, node: "/n/node", scriptsDir: "/s", exists: all)
        XCTAssertEqual(plain?.arguments, ["/s/orion-inbound-turn", "--text", "hi"])
        XCTAssertNil(InboundTurnLog.command(text: "hi", replyTo: nil, node: "/n/node", scriptsDir: "/s", exists: { $0 != "/s/orion-inbound-turn" }))
        XCTAssertEqual(InboundTurnLog.command(text: String(repeating: "x", count: 500), replyTo: nil, node: "n", scriptsDir: "s", exists: all)?.arguments.last?.count, 200)
    }
}
