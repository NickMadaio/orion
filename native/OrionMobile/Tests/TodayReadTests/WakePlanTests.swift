import XCTest
@testable import MobileCore

/// W10-E: the per-weekday sleep plan reaches the phone in the snapshot and becomes one alarm per upcoming day.
final class WakePlanTests: XCTestCase {
    private var cal: Calendar = { var c = Calendar(identifier: .gregorian); c.timeZone = TimeZone(identifier: "America/New_York")!; return c }()
    private func at(_ y: Int, _ m: Int, _ d: Int, _ h: Int, _ min: Int) -> Date {
        cal.date(from: DateComponents(year: y, month: m, day: d, hour: h, minute: min))!
    }
    private var now: Date { at(2026, 11, 2, 21, 0) }
    private let mac = LinkSnapshot.Mac(name: "m", battery: 1, charging: false, diskFreeGB: 1, uptimeHours: 1, runningApps: [], locked: false)

    private func plan(source: String = "nick") -> WakePlan {
        WakePlan(source: source, generatedAt: "2026-11-02T20:00:00.123Z",
                 alarms: [.init(date: "2026-11-03", at: "07:15", reason: "CS2100 at 09:00", byNick: true),
                          .init(date: "2026-11-04", at: "08:30", iso: "2026-11-04T13:30:00.000Z", byNick: true),
                          .init(date: "2026-11-01", at: "07:00", byNick: true),
                          .init(date: "2026-11-05", at: "09:00", reason: "usual"),
                          .init(date: "2026-11-06", at: "08:15", reason: "commitment", byNick: false)],
                 bedtimes: [.init(date: "2026-11-02", sleepBy: "23:15", nudgeAt: "22:45"),
                            .init(date: "2026-11-03", sleepBy: "00:30", nudgeAt: "00:00")])
    }

    func testOlderSnapshotsWithoutAPlanStillDecode() throws {
        let snap = LinkSnapshot(generatedAt: now, mac: mac)
        var json = try XCTUnwrap(JSONSerialization.jsonObject(with: LinkSnapshot.encode(snap)) as? [String: Any])
        json.removeValue(forKey: "wakePlan")
        let decoded = try LinkSnapshot.decode(JSONSerialization.data(withJSONObject: json))
        XCTAssertNil(decoded.wakePlan)
    }

    func testAPlanRoundTripsThroughTheSnapshotWithFractionalGeneratedAt() throws {
        let snap = LinkSnapshot(generatedAt: now, mac: mac, wakePlan: plan())
        XCTAssertEqual(try LinkSnapshot.decode(LinkSnapshot.encode(snap)).wakePlan, plan())
    }

    func testOneAlarmPerUpcomingDayAndPastOnesDropped() {
        let wanted = AlarmPlanner.wanted(tonight: nil, wakeRequest: nil, plan: plan(), now: now, calendar: cal)
        XCTAssertEqual(wanted.count, 2)
        XCTAssertEqual(wanted[0].fireAt, at(2026, 11, 3, 7, 15))
        XCTAssertEqual(wanted[0].reason, "CS2100 at 09:00")
        XCTAssertEqual(wanted[1].fireAt, WakePlan.parseISO("2026-11-04T13:30:00.000Z"))   // iso wins over HH:MM
    }

    func testADefaultPlanNeverSchedulesAnything() {
        XCTAssertTrue(AlarmPlanner.wanted(tonight: nil, wakeRequest: nil, plan: plan(source: "default"), now: now, calendar: cal).isEmpty)
        XCTAssertNil(plan(source: "default").bedtime(nightOf: "2026-11-02", calendar: cal))
    }

    func testWakeRequestWinsForItsDateAndTonightsWakeKeepsItsOwnDay() {
        let request = at(2026, 11, 3, 6, 0)
        let wanted = AlarmPlanner.wanted(tonight: at(2026, 11, 3, 7, 40), wakeRequest: request, plan: plan(), now: now, calendar: cal)
        XCTAssertEqual(wanted.map(\.fireAt), [request, WakePlan.parseISO("2026-11-04T13:30:00.000Z")!])
    }

    func testTonightsDefaultWakeNeedsANickPlanOrARequestAndHorizonIsCapped() {
        let tonight = at(2026, 11, 3, 8, 0)
        XCTAssertTrue(AlarmPlanner.wanted(tonight: tonight, wakeRequest: nil, plan: nil, now: now, calendar: cal).isEmpty)
        XCTAssertTrue(AlarmPlanner.wanted(tonight: tonight, wakeRequest: nil, plan: plan(source: "default"), now: now, calendar: cal).isEmpty)
        XCTAssertEqual(AlarmPlanner.wanted(tonight: tonight, wakeRequest: tonight, plan: nil, now: now, calendar: cal).map(\.fireAt), [tonight])
        XCTAssertEqual(AlarmPlanner.wanted(tonight: tonight, wakeRequest: nil, plan: WakePlan(source: "nick"), now: now, calendar: cal).map(\.fireAt), [tonight])
        let far = WakePlan(source: "nick", alarms: [.init(date: "2026-12-25", at: "07:00", byNick: true)])
        XCTAssertTrue(AlarmPlanner.wanted(tonight: nil, wakeRequest: nil, plan: far, now: now, calendar: cal).isEmpty)
    }

    func testBedtimeAndNudgeUseTheEveningTheNightBeginsOn() throws {
        let tonight = try XCTUnwrap(plan().bedtime(nightOf: "2026-11-02", calendar: cal))
        XCTAssertEqual(tonight.sleepBy, at(2026, 11, 2, 23, 15))
        XCTAssertEqual(tonight.nudgeAt, at(2026, 11, 2, 22, 45))
        let late = try XCTUnwrap(plan().bedtime(nightOf: "2026-11-03", calendar: cal))
        XCTAssertEqual(late.sleepBy, at(2026, 11, 4, 0, 30))   // after midnight lands on the next calendar day
        XCTAssertEqual(late.nudgeAt, at(2026, 11, 4, 0, 0))
        XCTAssertNil(plan().bedtime(nightOf: "2026-11-09", calendar: cal))
    }
}
