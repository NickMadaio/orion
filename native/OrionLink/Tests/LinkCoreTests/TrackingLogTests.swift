import XCTest
import MobileCore
@testable import LinkCore

final class TrackingLogTests: XCTestCase {
    private var dir: URL!
    private var file: URL { dir.appendingPathComponent("health-log.json") }
    /// 2026-09-28 14:00 local.
    private var now: Date {
        Calendar.current.date(from: DateComponents(year: 2026, month: 9, day: 28, hour: 14))!
    }

    override func setUpWithError() throws {
        dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let seed: [String: Any] = [
            "schema": "orion.health.v3", "updatedAt": "",
            "supplements": [["id": "S1", "name": "Magnesium", "dose": "200mg", "timeOfDay": "evening"]],
            "supplementLog": [String: Any](), "workouts": [["id": "W1", "day": "2026-09-27", "exercises": []]],
            "days": ["2026-09-28": ["waterBottles": 2, "calories": 0, "supplementIDs": [], "recovery": 84, "updatedAt": ""]],
            "futureField": ["kept": true],
        ]
        try JSONSerialization.data(withJSONObject: seed).write(to: file)
    }
    override func tearDownWithError() throws { try? FileManager.default.removeItem(at: dir) }

    private func json() throws -> [String: Any] {
        try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: file)) as? [String: Any])
    }

    func testTheDayTurnsAtFourInTheMorningNotMidnight() {
        let late = Calendar.current.date(from: DateComponents(year: 2026, month: 9, day: 29, hour: 2))!
        let early = Calendar.current.date(from: DateComponents(year: 2026, month: 9, day: 29, hour: 5))!
        XCTAssertEqual(TrackingLog.dayKey(at: late), "2026-09-28")
        XCTAssertEqual(TrackingLog.dayKey(at: early), "2026-09-29")
    }

    func testWaterAddsToTodayAndKeepsWearableFacts() throws {
        let log = TrackingLog(file: file)
        XCTAssertEqual(try log.apply(.water(delta: 1), now: now), "Water: 3 of 9 bottles.")
        let day = try XCTUnwrap((try json()["days"] as? [String: Any])?["2026-09-28"] as? [String: Any])
        XCTAssertEqual(day["waterBottles"] as? Int, 3)
        XCTAssertEqual(day["recovery"] as? Int, 84, "WHOOP numbers are untouched")
        XCTAssertEqual(log.today(now: now)?.waterBottles, 3)
        _ = try log.apply(.water(delta: -3), now: now)
        XCTAssertEqual(log.today(now: now)?.waterBottles, 0, "never below zero")
    }

    func testAMealIsLoggedWithEveryFieldTheAppDecodesAndCanBeRemoved() throws {
        let log = TrackingLog(file: file)
        _ = try log.apply(.meal(title: "Chicken bowl", meal: "Lunch", calories: 650, protein: 45, carbohydrates: 60, fat: 20), now: now)
        let meals = try XCTUnwrap((try json()["nutritionLog"] as? [String: Any])?["2026-09-28"] as? [[String: Any]])
        XCTAssertEqual(meals.count, 1)
        for key in ["id", "title", "meal", "calories", "protein", "carbohydrates", "fat", "fiber", "notes", "loggedAt"] {
            XCTAssertNotNil(meals[0][key], "the app's NutritionEntry needs \(key)")
        }
        let today = try XCTUnwrap(log.today(now: now))
        XCTAssertEqual(today.calories, 650)
        XCTAssertEqual(today.protein, 45)
        XCTAssertEqual(today.recentFoods.first?.title, "Chicken bowl")
        _ = try log.apply(.removeMeal(id: try XCTUnwrap(meals[0]["id"] as? String)), now: now)
        XCTAssertEqual(log.today(now: now)?.calories, 0)
        XCTAssertThrowsError(try log.apply(.removeMeal(id: "missing"), now: now))
    }

    func testSupplementsTickAndUntickOnlyKnownOnes() throws {
        let log = TrackingLog(file: file)
        XCTAssertEqual(try log.apply(.supplement(id: "S1", taken: true), now: now), "Magnesium taken.")
        XCTAssertEqual(log.today(now: now)?.supplements.first?.taken, true)
        XCTAssertEqual((try json()["supplementLog"] as? [String: Any])?["2026-09-28"] as? [String], ["S1"])
        _ = try log.apply(.supplement(id: "S1", taken: false), now: now)
        XCTAssertEqual(log.today(now: now)?.supplements.first?.taken, false)
        XCTAssertThrowsError(try log.apply(.supplement(id: "S9", taken: true), now: now))
    }

    func testUnknownKeysSurviveAndANewDayIsComplete() throws {
        let tomorrow = now.addingTimeInterval(86_400)
        _ = try TrackingLog(file: file).apply(.water(delta: 1), now: tomorrow)
        let object = try json()
        XCTAssertEqual((object["futureField"] as? [String: Any])?["kept"] as? Bool, true)
        XCTAssertEqual((object["workouts"] as? [Any])?.count, 1)
        let day = try XCTUnwrap((object["days"] as? [String: Any])?["2026-09-29"] as? [String: Any])
        for key in ["waterBottles", "calories", "supplementIDs", "updatedAt"] { XCTAssertNotNil(day[key], key) }
    }

    func testSleepEventsAreKeptAsHistory() throws {
        let log = TrackingLog(file: file)
        XCTAssertEqual(try log.apply(.sleep(event: "bed", at: "2026-09-29T00:40:00Z"), now: now), "Logged: going to bed.")
        _ = try log.apply(.sleep(event: "up", at: "2026-09-29T08:10:00Z"), now: now)
        // The wake signals for the morning briefing (2026-10-08).
        _ = try log.apply(.sleep(event: "unplugged", at: "2026-09-29T08:11:00Z"), now: now)
        _ = try log.apply(.sleep(event: "used", at: "2026-09-29T08:14:00Z"), now: now)
        let history = try XCTUnwrap(try json()["sleepLog"] as? [[String: Any]])
        XCTAssertEqual(history.map { $0["event"] as? String }, ["bed", "up", "unplugged", "used"])
        XCTAssertEqual((try json()["futureField"] as? [String: Any])?["kept"] as? Bool, true)
        XCTAssertThrowsError(try log.apply(.sleep(event: "nap", at: "2026-09-29T08:10:00Z"), now: now))
        XCTAssertThrowsError(try log.apply(.sleep(event: "bed", at: "last night"), now: now))
    }

    func testPhoneSignalsAreCoarseHistory() throws {
        let log = TrackingLog(file: file)
        _ = try log.apply(.signal(at: "2026-09-29T02:40:00Z", motion: "still", charging: false, latitude: 51.512345, longitude: -0.071234), now: now)
        let sample = try XCTUnwrap((try json()["phoneSignals"] as? [[String: Any]])?.first)
        XCTAssertEqual(sample["latitude"] as? Double, 51.512, "rounded to about 100 m")
        XCTAssertEqual(sample["motion"] as? String, "still")
        XCTAssertThrowsError(try log.apply(.signal(at: "2026-09-29T02:40:00Z", motion: "teleporting", charging: false, latitude: nil, longitude: nil), now: now))
    }

    func testARepeatedPhoneSampleIsStoredOnce() throws {
        let log = TrackingLog(file: file)
        for _ in 0..<2 { _ = try log.apply(.signal(at: "2026-10-20T08:21:26Z", motion: "unknown", charging: false, latitude: 51.528, longitude: -0.087), now: now) }
        _ = try log.apply(.signal(at: "2026-10-20T09:06:00Z", motion: "unknown", charging: false, latitude: 51.528, longitude: -0.087), now: now)
        XCTAssertEqual((try json()["phoneSignals"] as? [[String: Any]])?.count, 2)
    }

    func testOutOfRangeEntriesAreRefusedNotClamped() {
        let log = TrackingLog(file: file)
        XCTAssertThrowsError(try log.apply(.water(delta: 40), now: now))
        XCTAssertThrowsError(try log.apply(.meal(title: "x", meal: "Lunch", calories: 90_000, protein: 0, carbohydrates: 0, fat: 0), now: now))
        XCTAssertThrowsError(try log.apply(.meal(title: "  ", meal: "Lunch", calories: 10, protein: 0, carbohydrates: 0, fat: 0), now: now))
    }

    func testAHeldLockIsWaitedForAndAFreshOneIsNotBroken() throws {
        let lock = file.path + ".lock"
        FileManager.default.createFile(atPath: lock, contents: nil)
        DispatchQueue.global().asyncAfter(deadline: .now() + 0.3) { unlink(lock) }
        XCTAssertNoThrow(try TrackingLog(file: file).apply(.water(delta: 1), now: now), "waits for the other writer")
        XCTAssertFalse(FileManager.default.fileExists(atPath: lock), "released after writing")
    }
    /// W18 wake: the phone's alarm receipt is kept where `orion-sleepplan alarms` reads it, replacing the last one, and nothing else moves.
    func testThePhonesAlarmReceiptReplacesTheLastOneAndKeepsOtherFields() throws {
        let log = TrackingLog(file: file)
        _ = try log.apply(.alarms(at: "2026-11-02T20:01:00Z", fires: ["2026-11-03T06:45:00.000Z"], state: "Set for 6:45 AM"), now: now)
        _ = try log.apply(.alarms(at: "2026-11-02T20:05:00Z", fires: ["2026-11-03T07:05:00.000Z", "2026-11-04T07:00:00.000Z"], state: "Set for 7:05 AM (+1 more)"), now: now)
        let held = try XCTUnwrap(try json()["phoneAlarms"] as? [String: Any])
        XCTAssertEqual(held["fires"] as? [String], ["2026-11-03T07:05:00.000Z", "2026-11-04T07:00:00.000Z"])
        XCTAssertEqual(held["state"] as? String, "Set for 7:05 AM (+1 more)")
        XCTAssertEqual((try json()["futureField"] as? [String: Any])?["kept"] as? Bool, true)
        XCTAssertNil(try json()["nutritionLog"].flatMap { ($0 as? [String: Any])?["2026-11-02"] }, "an alarm receipt is not a meal day")
    }

    /// W19: a phone pickup or "I need an app" during focus is history ORION nudges on, kept in order and capped, and is not a meal day.
    func testFocusReportsFromThePhoneAreKeptInOrderAndCapped() throws {
        let log = TrackingLog(file: file)
        _ = try log.apply(.focus(action: "pickup", at: "2026-11-04T14:01:00Z", session: "s-abc"), now: now)
        _ = try log.apply(.focus(action: "need-app", at: "2026-11-04T14:02:00Z", session: nil), now: now)
        let events = try XCTUnwrap(try json()["phoneFocusEvents"] as? [[String: Any]])
        XCTAssertEqual(events.map { $0["action"] as? String }, ["pickup", "need-app"])
        XCTAssertEqual(events.first?["session"] as? String, "s-abc")
        XCTAssertNil(events.last?["session"])
        XCTAssertEqual((try json()["futureField"] as? [String: Any])?["kept"] as? Bool, true)
        XCTAssertNil(try json()["nutritionLog"].flatMap { ($0 as? [String: Any])?["2026-11-02"] })
        for minute in 0..<(TrackingLog.focusEventLimit + 5) {
            _ = try log.apply(.focus(action: "pickup", at: "2026-11-04T15:\(String(format: "%02d", minute % 60)):00Z", session: nil), now: now)
        }
        XCTAssertEqual((try json()["phoneFocusEvents"] as? [[String: Any]])?.count, TrackingLog.focusEventLimit)
    }

    /// 2026-10-01: ORION told Nick nothing was locked; it could not see the phone.
    func testTheScreenLockStateIsKeptWhereOrionReadsIt() throws {
        let log = TrackingLog(file: file)
        _ = try log.apply(.screen(at: "2026-10-01T00:02:00Z", locked: true, until: "2026-10-01T06:15:00Z", why: "night", graceUntil: nil), now: now)
        let state = try XCTUnwrap(try json()["phoneScreen"] as? [String: Any])
        XCTAssertEqual(state["locked"] as? Bool, true)
        XCTAssertEqual(state["why"] as? String, "night")
        XCTAssertEqual((try json()["screenLog"] as? [[String: Any]])?.count, 1)
        XCTAssertEqual((try json()["futureField"] as? [String: Any])?["kept"] as? Bool, true)
    }

    func testANonsenseScreenStateIsRefused() {
        XCTAssertThrowsError(try LinkLog.screen(at: "yesterday", locked: true, until: nil, why: nil, graceUntil: nil).validated())
        XCTAssertThrowsError(try LinkLog.screen(at: "2026-10-01T00:02:00Z", locked: true, until: nil, why: "boredom", graceUntil: nil).validated())
    }
    // MARK: - The water goal (2026-11-04)

    private func goals() throws -> [String: Any] { (try json()["nutritionGoals"] as? [String: Any]) ?? [:] }

    func testTheGoalDefaultsToNineAndTheSnapshotAndReplyUseTheSetting() throws {
        let log = TrackingLog(file: file)
        XCTAssertEqual(log.today(now: now)?.waterGoal, 9)
        XCTAssertEqual(try log.apply(.waterGoal(bottles: 12), now: now), "Water goal: 12 bottles a day. You're at 2.")
        XCTAssertEqual(log.today(now: now)?.waterGoal, 12)
        XCTAssertEqual(try log.apply(.water(delta: 1), now: now), "Water: 3 of 12 bottles.")
    }

    func testTheGoalRoundTripsThroughTheFileKeepsOtherGoalsAndWritesAWholeGoalsObject() throws {
        let log = TrackingLog(file: file)
        _ = try log.apply(.waterGoal(bottles: 7), now: now)
        let stored = try goals()
        XCTAssertEqual(stored["water"] as? Int, 7)
        for key in ["calories", "protein", "carbohydrates", "fat", "fiber"] {
            XCTAssertNotNil(stored[key], "the app's NutritionGoals needs \(key) or it cannot read the whole file")
        }
        XCTAssertEqual(log.waterGoal(), 7)
        XCTAssertEqual((try json()["futureField"] as? [String: Any])?["kept"] as? Bool, true)
        // A calorie goal the app saved earlier survives a water change.
        var object = try json(); object["nutritionGoals"] = ["calories": 2600, "protein": 180, "carbohydrates": 250, "fat": 70, "fiber": 30, "water": 7]
        try JSONSerialization.data(withJSONObject: object).write(to: file)
        _ = try log.apply(.waterGoal(bottles: 8), now: now)
        XCTAssertEqual(try goals()["calories"] as? Int, 2600)
        XCTAssertEqual(log.today(now: now)?.calorieGoal, 2600)
        XCTAssertEqual(log.today(now: now)?.proteinGoal, 180)
    }

    func testAnOutOfRangeStoredGoalIsClampedAndABadOneIsTheDefault() throws {
        var object = try json()
        object["nutritionGoals"] = ["water": 400]
        try JSONSerialization.data(withJSONObject: object).write(to: file)
        XCTAssertEqual(TrackingLog(file: file).today(now: now)?.waterGoal, 30)
        object["nutritionGoals"] = ["water": 0]
        try JSONSerialization.data(withJSONObject: object).write(to: file)
        XCTAssertEqual(TrackingLog(file: file).today(now: now)?.waterGoal, 1)
        object["nutritionGoals"] = ["water": "many"]
        try JSONSerialization.data(withJSONObject: object).write(to: file)
        XCTAssertEqual(TrackingLog(file: file).today(now: now)?.waterGoal, 9)
    }

    func testChangingTheGoalDoesNotTouchTodaysMealsOrWater() throws {
        let log = TrackingLog(file: file)
        _ = try log.apply(.meal(title: "Bowl", meal: "Lunch", calories: 500, protein: 30, carbohydrates: 40, fat: 10), now: now)
        _ = try log.apply(.waterGoal(bottles: 10), now: now)
        let today = try XCTUnwrap(log.today(now: now))
        XCTAssertEqual(today.calories, 500)
        XCTAssertEqual(today.meals.count, 1)
        XCTAssertEqual(today.waterBottles, 2)
    }

    func testTheGoalChangeWorksWithNoFileYet() throws {
        let fresh = TrackingLog(file: dir.appendingPathComponent("new.json"))
        _ = try fresh.apply(.waterGoal(bottles: 11), now: now)
        XCTAssertEqual(fresh.waterGoal(), 11)
    }

}

final class PlanLinkTests: XCTestCase {
    private var home: URL!
    override func setUpWithError() throws {
        home = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: home.appendingPathComponent(".openclaw/orion-controlled"), withIntermediateDirectories: true)
    }
    override func tearDownWithError() throws { try? FileManager.default.removeItem(at: home) }

    func testARequestRoundTripsAndExpires() throws {
        let url = PlanRequestFile.url(home: home)
        let at = Date()
        try PlanRequestFile.write(.init(id: "r1", action: "plan", state: .waiting, message: nil, at: at), to: url)
        XCTAssertEqual(PlanRequestFile.pending(at: at, url: url)?.id, "r1")
        XCTAssertNil(PlanRequestFile.pending(at: at.addingTimeInterval(11 * 60), url: url), "stale")
        try PlanRequestFile.write(.init(id: "r1", action: "plan", state: .done, message: "Planned", at: at), to: url)
        XCTAssertNil(PlanRequestFile.pending(at: at, url: url), "done is not pending")
        XCTAssertEqual(SnapshotReader(home: home).planRequest(now: at)?.message, "Planned")
        try PlanRequestFile.write(.init(id: "r2", action: "delete everything", state: .waiting, message: nil, at: at), to: url)
        XCTAssertNil(PlanRequestFile.pending(at: at, url: url), "unknown actions are never pending")
    }

    func testOnlyTodaysSavedPlanIsPublished() throws {
        let now = Date()
        let day = Calendar.current.startOfDay(for: now)
        let plan = try TodayPlanScheduler.propose(
            now: day.addingTimeInterval(9 * 3600), timeZone: TimeZone.current.identifier, preferences: TodayPlanPreferences(),
            tasks: [TodayPlanTask(id: "t1", title: "Write", minutes: 30, priority: 0)], commitments: [],
            reason: "test", sourceFingerprint: "f")
        struct Document: Encodable { let revision: Int; let current: TodayPlan? }
        let url = home.appendingPathComponent(".openclaw/orion-controlled/today-plan.json")
        try JSONEncoder().encode(Document(revision: 3, current: plan)).write(to: url)
        let reader = SnapshotReader(home: home)
        XCTAssertEqual(reader.plan(now: now)?.blocks.first { $0.kind == .task }?.title, "Write")
        XCTAssertNil(reader.plan(now: now.addingTimeInterval(2 * 86_400)))
    }
}

final class MemoryNoteTests: XCTestCase {
    func testNotesLandUnderTheirOwnHeadingOnce() throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: dir) }
        let at = Calendar.current.date(from: DateComponents(year: 2026, month: 9, day: 29, hour: 14, minute: 2))!
        let note = MemoryNote(directory: dir)
        let file = try note.append("Idea: vlog about the first month in London", at: at)
        try note.append("Idea: vlog about the first month in London", at: at)
        try note.append("Offline — Nick: what's tomorrow?\nORION (phone): Seminar at 09:00", at: at)
        let text = try String(contentsOf: file, encoding: .utf8)
        XCTAssertEqual(text.components(separatedBy: "## From the iPhone").count, 2)
        XCTAssertEqual(text.components(separatedBy: "vlog about").count, 2, "the same note is written once")
        XCTAssertTrue(text.contains("- 14:02 — [iphone] Offline — Nick: what's tomorrow? / ORION (phone): Seminar at 09:00"))
    }

}

/// Water from the phone's widgets, lock screen, Control Center and Siri arrives
/// with an event id; a repeat of the same id must not add a second bottle.
final class TrackingLogEventIDTests: XCTestCase {
    private var dir: URL!
    private var file: URL { dir.appendingPathComponent("health-log.json") }
    private var now: Date { Calendar.current.date(from: DateComponents(year: 2026, month: 11, day: 2, hour: 14))! }

    override func setUpWithError() throws {
        dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    }
    override func tearDownWithError() throws { try? FileManager.default.removeItem(at: dir) }

    private func bottles() throws -> Int {
        let log = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: file)) as? [String: Any])
        let day = (log["days"] as? [String: Any])?["2026-11-02"] as? [String: Any]
        return (day?["waterBottles"] as? NSNumber)?.intValue ?? 0
    }

    func testTheSameWaterEventTwiceIsOneBottle() throws {
        let log = TrackingLog(file: file)
        XCTAssertEqual(try log.apply(.water(delta: 1), eventID: "w-1", now: now), "Water: 1 of 9 bottles.")
        XCTAssertEqual(try log.apply(.water(delta: 1), eventID: "w-1", now: now), "Already logged.")
        XCTAssertEqual(try bottles(), 1)
        try log.apply(.water(delta: 1), eventID: "w-2", now: now)
        XCTAssertEqual(try bottles(), 2)
    }

    func testEntriesWithoutAnIdStillAddUp() throws {
        let log = TrackingLog(file: file)
        try log.apply(.water(delta: 1), now: now)
        try log.apply(.water(delta: 1), now: now)
        XCTAssertEqual(try bottles(), 2)
    }

    func testTheRememberedIdsAreBounded() throws {
        let log = TrackingLog(file: file)
        for index in 0..<(TrackingLog.eventIDLimit + 3) { try log.apply(.water(delta: 1), eventID: "e\(index)", now: now) }
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: file)) as? [String: Any])
        XCTAssertEqual((object["phoneEventIDs"] as? [String])?.count, TrackingLog.eventIDLimit)
    }
}
