import XCTest
@testable import Orion

/// 2026-10-16 proactive-messaging audit: the idle reading (#3) and the
/// "you messaged him first" context (#5).
final class ProactiveAudit20261016Tests: XCTestCase {

    // MARK: Idle reading

    func testTheAuditedReadingOfElevenDaysIsInvalidWhenIdleIsReallyForty() {
        // 1,022,283 s with a machine that booted 1,021,037 s ago and an app launched an hour ago.
        XCTAssertNil(IdleReading.validated(raw: 1_022_283, sinceBoot: 1_021_037, sinceLaunch: 3_600))
    }

    func testARealReadingPassesThrough() {
        XCTAssertEqual(IdleReading.validated(raw: 40, sinceBoot: 1_000_000, sinceLaunch: 3_600), 40)
    }

    func testReadingLongerThanTheAppHasRunIsInvalid() {
        XCTAssertNil(IdleReading.validated(raw: 900, sinceBoot: 1_000_000, sinceLaunch: 120))
    }

    func testReadingLongerThanTimeSinceBootIsInvalid() {
        XCTAssertNil(IdleReading.validated(raw: 5_000, sinceBoot: 4_000, sinceLaunch: 10_000))
    }

    func testNegativeNaNAndAbsurdReadingsAreInvalid() {
        XCTAssertNil(IdleReading.validated(raw: -1, sinceBoot: 1_000_000, sinceLaunch: 10_000))
        XCTAssertNil(IdleReading.validated(raw: .nan, sinceBoot: 1_000_000, sinceLaunch: 10_000))
        XCTAssertNil(IdleReading.validated(raw: 2 * 86_400, sinceBoot: 9_000_000, sinceLaunch: 9_000_000))
    }

    func testTheSystemReadingIsPlausibleNow() {
        // The real source: with the wrong event type this was time since boot.
        let raw = IdleReading.systemIdleSeconds()
        XCTAssertLessThan(raw, ProcessInfo.processInfo.systemUptime)
    }

    func testLoginwindowAndTheLockScreenAreNeverTargets() {
        XCTAssertTrue(EnforcementGuard.isNeverATarget(name: "loginwindow", bundleID: nil))
        XCTAssertTrue(EnforcementGuard.isNeverATarget(name: "Anything", bundleID: "com.apple.loginwindow"))
        XCTAssertTrue(EnforcementGuard.isNeverATarget(name: "ScreenSaverEngine", bundleID: nil))
        XCTAssertFalse(EnforcementGuard.isNeverATarget(name: "Safari", bundleID: "com.apple.Safari"))
    }

    func testEnforcementNeedsConsentAValidIdleAndASafeApp() {
        XCTAssertTrue(EnforcementGuard.allowed(consent: true, idleValid: true, name: "Safari", bundleID: nil))
        XCTAssertFalse(EnforcementGuard.allowed(consent: false, idleValid: true, name: "Safari", bundleID: nil))
        XCTAssertFalse(EnforcementGuard.allowed(consent: true, idleValid: false, name: "Safari", bundleID: nil))
        XCTAssertFalse(EnforcementGuard.allowed(consent: true, idleValid: true, name: "loginwindow", bundleID: nil))
    }

    // MARK: Outreach context

    private let now = Date(timeIntervalSince1970: 1_800_000_000)
    private func row(_ id: String, _ text: String, minutesAgo: Double, channel: String = "phone") -> OutreachRow {
        OutreachRow(id: id, text: text, at: now.addingTimeInterval(-minutesAgo * 60), held: channel == "hold")
    }

    func testTheMostRecentRecentMessageIsAttachedWithAnHonestLabel() {
        let tracker = OutreachTracker()
        let prefix = tracker.prefix(rows: [row("a", "older", minutesAgo: 40), row("b", "Want me to put the oyster card there?", minutesAgo: 10)], now: now)
        XCTAssertTrue(prefix.contains("oyster card"))
        XCTAssertFalse(prefix.contains("older"))
        XCTAssertTrue(prefix.contains("MAY be his answer"))
        XCTAssertTrue(prefix.contains("10 min ago"))
    }

    func testAMessageOlderThanThirtyMinutesIsNotAttached() {
        let tracker = OutreachTracker()
        XCTAssertEqual(tracker.prefix(rows: [row("a", "6:54 PM question", minutesAgo: 226)], now: now), "")
        XCTAssertEqual(tracker.prefix(rows: [row("b", "bedtime", minutesAgo: 330)], now: now), "")
    }

    func testItIsAttachedOnlyOnce() {
        let tracker = OutreachTracker()
        let rows = [row("a", "free until 9?", minutesAgo: 5)]
        XCTAssertFalse(tracker.prefix(rows: rows, now: now).isEmpty)
        XCTAssertEqual(tracker.prefix(rows: rows, now: now.addingTimeInterval(30)), "")
        XCTAssertEqual(tracker.prefix(rows: rows, now: now.addingTimeInterval(120)), "")
    }

    func testAnotherTurnSinceItWasSentMeansItIsNoLongerTheQuestion() {
        let tracker = OutreachTracker()
        XCTAssertEqual(tracker.prefix(rows: [], now: now.addingTimeInterval(-120)), "")   // a turn 2 min ago
        XCTAssertEqual(tracker.prefix(rows: [row("a", "free until 9?", minutesAgo: 5)], now: now), "")
        // A message sent after that turn is fine.
        let later = now.addingTimeInterval(120)
        let newer = OutreachRow(id: "c", text: "newer", at: now.addingTimeInterval(60), held: false)
        XCTAssertFalse(tracker.prefix(rows: [newer], now: later).isEmpty)
    }

    func testHeldMessagesAndDuplicateRowsAreIgnored() {
        let tracker = OutreachTracker()
        XCTAssertEqual(tracker.prefix(rows: [row("h", "held", minutesAgo: 2, channel: "hold")], now: now), "")
        let dup = OutreachTracker()
        let text = dup.prefix(rows: [row("x", "once", minutesAgo: 3), row("x", "once", minutesAgo: 3)], now: now)
        XCTAssertEqual(text.components(separatedBy: "once").count - 1, 1)
    }

    func testParsingKeepsFractionalTimestampsAndSkipsGarbage() {
        let jsonl = """
        {"id":"r1","at":"2026-10-15T17:54:00.123Z","channel":"phone","text":"hi"}
        not json
        {"id":"r2","at":"2026-10-15T18:00:00Z","channel":"hold","text":"held"}
        """
        let rows = OutreachContext.parse(jsonl: jsonl)
        XCTAssertEqual(rows.count, 2)
        XCTAssertEqual(rows.first?.id, "r1")
        XCTAssertEqual(rows.last?.held, true)
    }
}
