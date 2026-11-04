import XCTest
@testable import MobileCore

/// The focus state the Mac publishes and the phone's view of it: decode, the home state machine, and the shield plan.
final class PhoneFocusTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_800_000_000)
    private func session(phase: String = "focus", status: String = "running", ends: TimeInterval? = 1_920, total: Double? = 3_000,
                         allowed: [String]? = nil, task: String = "Finish resume") -> LinkSnapshot.FocusSession {
        .init(sessionId: "s-abc", task: task, phase: phase, status: status, endsAt: ends.map { now.addingTimeInterval($0) },
              phaseSeconds: total, remainingSeconds: nil, block: 1, blocks: 3, allowed: allowed)
    }

    // MARK: decode

    func testAFocusSessionRoundTripsThroughTheSnapshot() throws {
        var snapshot = LinkSnapshot(generatedAt: now, mac: .init(name: "Mac"))
        snapshot.focusSession = session(allowed: ["browsers"])
        let back = try LinkSnapshot.decode(LinkSnapshot.encode(snapshot))
        XCTAssertEqual(back.focusSession, snapshot.focusSession)
    }

    func testAnOldSnapshotWithoutFocusDecodesAndASessionWithOnlyTheBasicsDoes() throws {
        let old = try LinkSnapshot.decode(LinkSnapshot.encode(LinkSnapshot(generatedAt: now, mac: .init(name: "Mac"))))
        XCTAssertNil(old.focusSession)
        let json = #"{"sessionId":"s-1","task":"Essay","phase":"focus","status":"running"}"#
        let decoded = try JSONDecoder().decode(LinkSnapshot.FocusSession.self, from: Data(json.utf8))
        XCTAssertEqual(decoded.task, "Essay"); XCTAssertNil(decoded.endsAt); XCTAssertNil(decoded.allowed)
        // A session from a newer Mac with a key this phone has never heard of still decodes.
        let newer = #"{"sessionId":"s-1","task":"Essay","phase":"break","status":"running","mood":"calm"}"#
        XCTAssertNoThrow(try JSONDecoder().decode(LinkSnapshot.FocusSession.self, from: Data(newer.utf8)))
    }

    // MARK: the view state machine

    func testFocusFaceCountsTheBlockDownAndWritesTheKicker() {
        let face = PhoneFocus.face(session(), now: now)
        XCTAssertEqual(face.mode, .focus)
        XCTAssertEqual(face.kicker, "FOCUS · 32 MIN LEFT")
        XCTAssertEqual(face.title, "Finish resume")
        XCTAssertEqual(face.progress, 1 - 1_920 / 3_000, accuracy: 0.001)
        XCTAssertEqual(face.countdown, "32:00")
        XCTAssertEqual(face.blockLine, "Block 1 of 3")
    }

    func testBreakCountsTheBreakDown() {
        let face = PhoneFocus.face(session(phase: "break", ends: 290, total: 600), now: now)
        XCTAssertEqual(face.mode, .breakTime)
        XCTAssertEqual(face.kicker, "BREAK · 5 MIN LEFT")
        XCTAssertEqual(face.countdown, "4:50")
        XCTAssertEqual(face.progress, 1 - 290 / 600, accuracy: 0.001)
    }

    func testTheKickerSwitchesToSecondsInTheLastMinute() {
        XCTAssertEqual(PhoneFocus.face(session(ends: 45), now: now).kicker, "FOCUS · 45 SEC LEFT")
        XCTAssertEqual(PhoneFocus.face(session(ends: 60), now: now).kicker, "FOCUS · 1 MIN LEFT")
    }

    func testPausedKeepsTheTaskAndStopsTheClock() {
        var paused = session(status: "paused", ends: nil)
        paused.remainingSeconds = 1_200
        let face = PhoneFocus.face(paused, now: now)
        XCTAssertEqual(face.mode, .paused)
        XCTAssertEqual(face.kicker, "PAUSED · 20 MIN LEFT")
        XCTAssertEqual(face.countdown, "20:00")
    }

    func testNoSessionOrAnEndedOneIsIdle() {
        XCTAssertEqual(PhoneFocus.face(nil, now: now).mode, .idle)
        XCTAssertEqual(PhoneFocus.face(session(phase: "ended"), now: now).mode, .idle)
        XCTAssertEqual(PhoneFocus.face(session(status: "finished"), now: now).mode, .idle)
    }

    func testAPhaseThatOverranBadlyIsIdleButASlightOverrunWrapsUp() {
        XCTAssertEqual(PhoneFocus.face(session(ends: -30), now: now).mode, .focus)
        XCTAssertEqual(PhoneFocus.face(session(ends: -30), now: now).kicker, "FOCUS · WRAPPING UP")
        XCTAssertEqual(PhoneFocus.face(session(ends: -(PhoneFocus.overrun + 1)), now: now).mode, .idle)
    }

    func testARunningSessionWithoutAnEndIsStillShownButNeverHoldsAShield() {
        let open = session(ends: nil, total: nil)
        XCTAssertEqual(PhoneFocus.face(open, now: now).mode, .focus)
        XCTAssertEqual(PhoneFocus.face(open, now: now).kicker, "FOCUS")
        XCTAssertEqual(PhoneFocus.shield(open, picked: ["feeds"], now: now), .lift)
    }

    // MARK: shields

    func testFocusShieldsEveryPickedGroupExceptTheAllowedOnes() {
        let plan = PhoneFocus.shield(session(allowed: ["browsers"]), picked: ["feeds", "video", "browsers"], now: now)
        XCTAssertEqual(plan, .shield(lists: ["feeds", "video"], missing: ["messaging", "games"]))
    }

    func testBreaksPausesAndEndsLiftTheShield() {
        XCTAssertEqual(PhoneFocus.shield(session(phase: "break", ends: 300), picked: ["feeds"], now: now), .lift)
        XCTAssertEqual(PhoneFocus.shield(session(status: "paused", ends: nil), picked: ["feeds"], now: now), .lift)
        XCTAssertEqual(PhoneFocus.shield(session(ends: 0), picked: ["feeds"], now: now), .lift)
        XCTAssertEqual(PhoneFocus.shield(nil, picked: ["feeds"], now: now), .lift)
    }

    func testNoPickedGroupsAsksForPicksInsteadOfDoingNothing() {
        XCTAssertEqual(PhoneFocus.shield(session(), picked: [], now: now), .needPicks(lists: ["messaging", "feeds", "video", "games", "browsers"]))
        // Everything he picked is allowed this session: nothing to shield, and nothing to ask for.
        XCTAssertEqual(PhoneFocus.shield(session(allowed: ["feeds"]), picked: ["feeds"], now: now), .shield(lists: [], missing: ["messaging", "video", "games", "browsers"]))
    }

    func testUnknownGroupNamesAreIgnored() {
        XCTAssertEqual(PhoneFocus.shield(session(allowed: ["everything"]), picked: ["feeds", "banking"], now: now),
                       .shield(lists: ["feeds"], missing: ["messaging", "video", "games", "browsers"]))
    }

    // MARK: wording and Live Activity

    func testTheNudgeSpeaksInOrionsWords() {
        XCTAssertEqual(PhoneFocus.nudge(PhoneFocus.face(session(), now: now)), "Back to Finish resume — 32 min left.")
        XCTAssertEqual(PhoneFocus.nudge(PhoneFocus.face(session(ends: 45), now: now)), "Back to Finish resume — 45 sec left.")
        XCTAssertNil(PhoneFocus.nudge(PhoneFocus.face(session(phase: "break", ends: 300), now: now)))
    }

    func testLiveActivityFieldsFollowThePhase() {
        let focus = PhoneFocus.liveActivity(session(), now: now)
        XCTAssertEqual(focus?.mode, "focus"); XCTAssertEqual(focus?.title, "Finish resume")
        XCTAssertEqual(focus?.end, now.addingTimeInterval(1_920))
        XCTAssertEqual(focus?.start, now.addingTimeInterval(1_920 - 3_000))
        XCTAssertEqual(PhoneFocus.liveActivity(session(phase: "break", ends: 300, total: 600), now: now)?.mode, "break")
        XCTAssertNil(PhoneFocus.liveActivity(nil, now: now))
        XCTAssertNil(PhoneFocus.liveActivity(session(status: "paused", ends: nil), now: now))
    }

    // MARK: the phone's reports to the Mac

    func testFocusReportsValidateAndRoundTrip() throws {
        let at = ISO8601DateFormatter().string(from: now)
        for action in ["pickup", "need-app", "finish", "pause", "resume", "break"] {
            let text = try LinkLog.focus(action: action, at: at, session: "s-abc").encoded()
            XCTAssertEqual(try LinkLog.decode(text), .focus(action: action, at: at, session: "s-abc"))
        }
        XCTAssertThrowsError(try LinkLog.focus(action: "format-disk", at: at, session: nil).validated())
        XCTAssertThrowsError(try LinkLog.focus(action: "pickup", at: "later", session: nil).validated())
        XCTAssertThrowsError(try LinkLog.focus(action: "pickup", at: at, session: "a b/c").validated())
    }
}
