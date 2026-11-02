import XCTest
import Foundation
@testable import Orion

final class WakeAlarmTests: XCTestCase {
    private var calendar: Calendar = {
        var c = Calendar(identifier: .gregorian); c.timeZone = TimeZone(identifier: "UTC")!; return c
    }()
    private let t0 = Date(timeIntervalSince1970: 1_800_000_000)

    private func entry(at: Date, date: String = "2027-01-15") -> WakeAlarmEntry { WakeAlarmEntry(date: date, fireAt: at, reason: "test") }

    private func rig(sandbox: Bool = false, handled: Set<String> = []) -> (WakeAlarmEngine, Clock) {
        let clock = Clock(t0)
        let engine = WakeAlarmEngine(clock: { clock.now }, isSandbox: { sandbox }, handled: handled)
        engine.load([entry(at: t0)])
        return (engine, clock)
    }

    final class Clock {
        var now: Date
        init(_ d: Date) { now = d }
        func advance(_ s: TimeInterval) { now = now.addingTimeInterval(s) }
    }

    // MARK: parsing

    func testPlanParsesIsoAndClockForms() {
        let plan = """
        {"generatedAt":"x","source":"nick","alarms":[{"date":"2027-01-15","at":"06:30","reason":"gym","byNick":true},
        {"date":"2027-01-16","at":"07:00","iso":"2027-01-16T07:05:00Z","reason":"iso wins","byNick":true},
        {"date":"bad","at":"06:00","byNick":true},{"date":"2027-01-17","at":"25:00","byNick":true},{"date":"2027-01-18","at":"09:00","reason":"usual"}],"bedtimes":[]}
        """
        let entries = WakeAlarmPlan.entries(plan: Data(plan.utf8), override: nil, calendar: calendar)
        XCTAssertEqual(entries.count, 2)
        XCTAssertEqual(entries[0].fireAt, calendar.date(from: DateComponents(year: 2027, month: 1, day: 15, hour: 6, minute: 30)))
        XCTAssertEqual(entries[1].fireAt, WakeAlarmPlan.parseISO("2027-01-16T07:05:00Z"))
    }

    func testOnlyAPlanNickSetRings() {
        for source in ["", "\"source\":\"default\","] {
            let plan = "{\(source)\"alarms\":[{\"date\":\"2027-01-15\",\"at\":\"09:00\",\"reason\":\"default wake\"}]}"
            XCTAssertTrue(WakeAlarmPlan.entries(plan: Data(plan.utf8), override: nil, calendar: calendar).isEmpty, source)
        }
    }

    func testMissingOrInvalidFilesGiveNoAlarms() {
        XCTAssertTrue(WakeAlarmPlan.entries(plan: nil, override: nil).isEmpty)
        XCTAssertTrue(WakeAlarmPlan.entries(plan: Data("not json".utf8), override: Data("[]".utf8)).isEmpty)
        XCTAssertTrue(WakeAlarmPlan.entries(plan: Data("{\"alarms\":5}".utf8), override: Data("{\"at\":\"nope\"}".utf8)).isEmpty)
    }

    func testOverrideWinsForItsDateOnly() {
        let plan = """
        {"source":"nick","alarms":[{"date":"2027-01-15","at":"06:30","reason":"plan","byNick":true},{"date":"2027-01-16","at":"06:30","reason":"plan","byNick":true}]}
        """
        let override = "{\"at\":\"2027-01-15T09:00:00.000Z\",\"setAt\":\"x\"}"
        let entries = WakeAlarmPlan.entries(plan: Data(plan.utf8), override: Data(override.utf8), calendar: calendar)
        XCTAssertEqual(entries.count, 2)
        XCTAssertEqual(entries[0].date, "2027-01-15")
        XCTAssertEqual(entries[0].fireAt, WakeAlarmPlan.parseISO("2027-01-15T09:00:00Z"))
        XCTAssertEqual(entries[1].reason, "plan")
    }

    // MARK: ringing

    func testQuietBeforeTheAlarm() {
        let (engine, clock) = rig(); clock.advance(-5)
        XCTAssertTrue(engine.tick().isEmpty)
    }

    func testFiresThenRepeatsEveryMinute() {
        let (engine, clock) = rig()
        XCTAssertEqual(engine.tick().map(\.name), ["fired"])
        clock.advance(30); XCTAssertTrue(engine.tick().isEmpty)
        clock.advance(30); XCTAssertEqual(engine.tick().map(\.name), ["ring"])
        clock.advance(60); XCTAssertEqual(engine.tick().map(\.name), ["ring"])
    }

    func testSnoozeSilencesNineMinutesAndIsLimitedToTwo() {
        let (engine, clock) = rig()
        _ = engine.tick()
        XCTAssertEqual(engine.snooze()?.name, "snoozed")
        clock.advance(8 * 60); XCTAssertTrue(engine.tick().isEmpty)
        clock.advance(61); XCTAssertEqual(engine.tick().map(\.name), ["ring"])
        XCTAssertEqual(engine.snooze()?.name, "snoozed")
        XCTAssertFalse(engine.canSnooze)
        clock.advance(9 * 60); XCTAssertEqual(engine.tick().map(\.name), ["ring"])
        XCTAssertNil(engine.snooze())
    }

    func testGivesUpTwentyMinutesAfterFiringAndDoesNotRefire() {
        let (engine, clock) = rig()
        _ = engine.tick()
        clock.advance(20 * 60)
        XCTAssertEqual(engine.tick().map(\.name), ["gave_up"])
        clock.advance(60); XCTAssertTrue(engine.tick().isEmpty)
        XCTAssertFalse(engine.isActive)
    }

    func testDismissStopsItForGood() {
        let (engine, clock) = rig()
        _ = engine.tick(); clock.advance(120)
        XCTAssertEqual(engine.dismiss()?.name, "dismissed")
        clock.advance(120); XCTAssertTrue(engine.tick().isEmpty)
        XCTAssertNil(engine.dismiss())
    }

    func testAlarmOlderThanTheWindowIsNotRung() {
        let (engine, clock) = rig(); clock.advance(21 * 60)
        XCTAssertTrue(engine.tick().isEmpty)
    }

    func testSandboxNeverRings() {
        let (engine, _) = rig(sandbox: true)
        XCTAssertTrue(engine.tick().isEmpty)
        XCTAssertFalse(engine.isActive)
    }

    func testHandledKeysSurviveARestart() {
        let key = entry(at: t0).key
        let (engine, _) = rig(handled: [key])
        XCTAssertTrue(engine.tick().isEmpty)
    }

    // MARK: log + dismissal seam

    func testLogLineCarriesTheKeyAndHandledKeysReadBack() throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        addTeardownBlock { try? FileManager.default.removeItem(at: dir) }
        let files = WakeAlarmFiles(directory: dir)
        let e = entry(at: t0)
        files.append(WakeAlarmFiles.logLine(.fired(e), at: t0))
        XCTAssertTrue(files.handledKeys().isEmpty)
        files.append(WakeAlarmFiles.logLine(.dismissed(e, snoozes: 1), at: t0.addingTimeInterval(240)))
        XCTAssertEqual(files.handledKeys(), [e.key])
        XCTAssertFalse(files.isSandbox())
    }

    func testButtonDismissalClearsOnceOnPress() {
        let button = ButtonDismissal()
        var cleared = 0
        button.begin { cleared += 1 }
        button.userAskedToDismiss(); button.userAskedToDismiss()
        XCTAssertEqual(cleared, 1)
    }
}
