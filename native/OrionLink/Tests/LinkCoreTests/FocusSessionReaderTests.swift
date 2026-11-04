import XCTest
import MobileCore
@testable import LinkCore

/// What the Mac's session engine says about the running session, turned into the snapshot's focus state.
final class FocusSessionReaderTests: XCTestCase {
    private let now = ISO8601DateFormatter().date(from: "2026-11-04T14:00:00Z")!
    private func data(_ text: String) -> Data { Data(text.utf8) }
    private let running = #"{"ok":true,"status":"running","phase":"focus","phaseIndex":0,"blockNumber":1,"totalBlocks":3,"task":"Finish resume","servedSeconds":1080,"remainingSeconds":1920,"sessionId":"s-abc"}"#

    func testARunningFocusPhaseCarriesTaskPhaseEndBlockAndId() {
        let s = FocusSessionReader.parse(status: data(running), allowed: nil, previous: nil, now: now)
        XCTAssertEqual(s?.sessionId, "s-abc"); XCTAssertEqual(s?.task, "Finish resume")
        XCTAssertEqual(s?.phase, "focus"); XCTAssertEqual(s?.status, "running")
        XCTAssertEqual(s?.endsAt, now.addingTimeInterval(1_920))
        XCTAssertEqual(s?.phaseSeconds, 3_000)
        XCTAssertEqual(s?.block, 1); XCTAssertEqual(s?.blocks, 3)
    }

    func testARestPhaseIsABreak() {
        let rest = running.replacingOccurrences(of: #""phase":"focus""#, with: #""phase":"rest""#)
        XCTAssertEqual(FocusSessionReader.parse(status: data(rest), allowed: nil, previous: nil, now: now)?.phase, "break")
    }

    func testPausedKeepsWhatIsLeftAndTheEarlierPhase() {
        let paused = #"{"ok":true,"status":"paused","task":"Finish resume","servedSeconds":600,"remainingSeconds":1200,"sessionId":"s-abc"}"#
        let before = FocusSessionReader.parse(status: data(running), allowed: nil, previous: nil, now: now)
        let s = FocusSessionReader.parse(status: data(paused), allowed: nil, previous: before, now: now)
        XCTAssertEqual(s?.status, "paused"); XCTAssertNil(s?.endsAt); XCTAssertEqual(s?.remainingSeconds, 1_200)
        XCTAssertEqual(s?.phase, "focus")
    }

    func testNoSessionFinishedOrUnreadableIsNil() {
        for status in [#"{"ok":true,"status":"none"}"#, #"{"ok":true,"status":"finished","phase":"completed"}"#,
                       #"{"ok":true,"status":"waiting-for-return"}"#, #"{"ok":true,"status":"not-started"}"#, "not json", ""] {
            XCTAssertNil(FocusSessionReader.parse(status: data(status), allowed: nil, previous: nil, now: now), status)
        }
    }

    func testAnEndThatJittersByASecondIsNotRepublished() {
        let first = FocusSessionReader.parse(status: data(running), allowed: nil, previous: nil, now: now)
        let later = now.addingTimeInterval(10)
        let jitter = running.replacingOccurrences(of: "1920", with: "1909.4")   // the same end, a second early
        let again = FocusSessionReader.parse(status: data(jitter), allowed: nil, previous: first, now: later)
        XCTAssertEqual(again?.endsAt, first?.endsAt)
        let moved = running.replacingOccurrences(of: "1920", with: "1500")
        XCTAssertNotEqual(FocusSessionReader.parse(status: data(moved), allowed: nil, previous: first, now: later)?.endsAt, first?.endsAt)
    }

    func testAllowedGroupsComeFromTheAllowedAppsAndOnlyWhileFresh() {
        let activity = #"{"version":1,"at":"2026-11-04T13:59:50Z","focus":{"active":true,"task":"x","allowedApps":["com.apple.Safari","com.apple.dt.Xcode","net.whatsapp.WhatsApp"],"allowedDomains":["docs.google.com"]}}"#
        XCTAssertEqual(FocusSessionReader.allowedGroups(activity: data(activity), now: now), ["messaging", "browsers"])
        XCTAssertNil(FocusSessionReader.allowedGroups(activity: data(activity), now: now.addingTimeInterval(600)), "a stale file says nothing")
        XCTAssertNil(FocusSessionReader.allowedGroups(activity: data(#"{"version":1,"at":"2026-11-04T13:59:50Z","focus":null}"#), now: now))
        XCTAssertNil(FocusSessionReader.allowedGroups(activity: nil, now: now))
        XCTAssertEqual(FocusSessionReader.allowedGroups(activity: data(#"{"at":"2026-11-04T13:59:50Z","focus":{"active":true,"allowedApps":["com.apple.dt.Xcode"]}}"#), now: now), [])
    }

    func testTheSnapshotJSONCarriesTheKeysThePhoneReads() throws {
        var snapshot = LinkSnapshot(generatedAt: now, mac: .init(name: "Mac"))
        snapshot.focusSession = FocusSessionReader.parse(status: data(running), allowed: ["browsers"], previous: nil, now: now)
        let object = try JSONSerialization.jsonObject(with: LinkSnapshot.encode(snapshot)) as? [String: Any]
        let focus = object?["focusSession"] as? [String: Any]
        for key in ["sessionId", "task", "phase", "endsAt", "allowed", "status"] { XCTAssertNotNil(focus?[key], key) }
    }

    // MARK: acting on the phone's report

    func testAFocusActionOnlyRunsOnTheSessionItNamesAndWhileItIsFresh() {
        XCTAssertEqual(FocusSessionReader.wireOp(action: "finish", session: "s-abc", current: "s-abc", age: 5), "finish")
        XCTAssertEqual(FocusSessionReader.wireOp(action: "pause", session: nil, current: "s-abc", age: 5), "pause")
        XCTAssertEqual(FocusSessionReader.wireOp(action: "resume", session: "s-abc", current: "s-abc", age: 5), "resume")
        XCTAssertNil(FocusSessionReader.wireOp(action: "finish", session: "s-old", current: "s-abc", age: 5))
        XCTAssertNil(FocusSessionReader.wireOp(action: "finish", session: "s-abc", current: nil, age: 5))
        XCTAssertNil(FocusSessionReader.wireOp(action: "finish", session: "s-abc", current: "s-abc", age: 600), "a late tap never ends a later session")
        XCTAssertNil(FocusSessionReader.wireOp(action: "pickup", session: "s-abc", current: "s-abc", age: 1), "reports are recorded, not run")
    }

    func testTheCommandRequestIsOneLineOfJSONWithAnId() throws {
        let line = FocusSessionReader.request(op: "finish", id: "r-1")
        let object = try JSONSerialization.jsonObject(with: Data(line.utf8)) as? [String: String]
        XCTAssertEqual(object?["op"], "finish"); XCTAssertEqual(object?["requestId"], "r-1")
        XCTAssertFalse(line.contains("\n"))
    }
}
