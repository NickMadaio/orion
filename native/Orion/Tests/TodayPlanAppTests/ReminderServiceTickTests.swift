import XCTest
import Foundation
@testable import Orion

/// The app is the reminder clock's alarm, not its brain: it only has to notice that something is due and run
/// `orion-reminders tick` (w19-reminders). These are the rules for noticing.
final class ReminderServiceTickTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_800_000_000)

    private func reminder(due: TimeInterval, fired: Double? = nil, repeats: Bool = false, inflight: Double? = nil,
                          place: String? = nil, open: Double? = nil, nudged: Bool? = nil) -> StoredReminder {
        StoredReminder(id: "a1", kind: "alarm", label: "call mom", dueAt: (now.timeIntervalSince1970 + due) * 1000,
                       createdAt: (now.timeIntervalSince1970 - 3600) * 1000, firedAt: fired,
                       repeatRule: repeats ? RepeatRule(days: [0, 1, 2, 3, 4, 5, 6], time: "17:00") : nil,
                       place: place, open: open, nudged: nudged, inflight: inflight)
    }

    func testNothingDueMeansNoTick() {
        XCTAssertFalse(ReminderService.needsTick([reminder(due: 60)], now: now))
        XCTAssertFalse(ReminderService.needsTick([], now: now))
    }

    func testADueReminderTicksImmediatelyEvenWhenHoursLate() {
        XCTAssertTrue(ReminderService.needsTick([reminder(due: 0)], now: now))
        XCTAssertTrue(ReminderService.needsTick([reminder(due: -7200)], now: now), "a Mac that slept through it still ticks: the script says it as missed")
    }

    func testAFiredOneOffDoesNotTickAgainButARecurringOneDoesWhenDue() {
        let ms = now.timeIntervalSince1970 * 1000
        XCTAssertFalse(ReminderService.needsTick([reminder(due: -10, fired: ms)], now: now))
        XCTAssertTrue(ReminderService.needsTick([reminder(due: -10, fired: ms - 86_400_000, repeats: true)], now: now))
    }

    func testAClaimedReminderIsLeftToTheTickThatClaimedIt() {
        XCTAssertFalse(ReminderService.needsTick([reminder(due: -5, inflight: now.timeIntervalSince1970 * 1000 - 5_000)], now: now))
        XCTAssertTrue(ReminderService.needsTick([reminder(due: -5, inflight: now.timeIntervalSince1970 * 1000 - 120_000)], now: now), "a claim older than a minute is dead")
    }

    func testPlaceAndUnansweredRemindersTickSlowlyNotEverySecond() {
        let slow = [reminder(due: 3600, place: "home")]
        XCTAssertTrue(ReminderService.wantsSlowTick(slow, now: now))
        XCTAssertFalse(ReminderService.needsTick(slow, now: now))
        let ms = now.timeIntervalSince1970 * 1000
        XCTAssertTrue(ReminderService.wantsSlowTick([reminder(due: -1800, fired: ms - 1_800_000, open: ms - 1_800_000, nudged: false)], now: now))
        XCTAssertFalse(ReminderService.wantsSlowTick([reminder(due: 3600)], now: now))
    }

    func testTheStoreStillDecodesOldAndNewEntries() throws {
        let json = """
        [{"id":"a1","kind":"alarm","label":"x","dueAt":1,"createdAt":0},
         {"id":"a2","kind":"alarm","label":"y","dueAt":2,"createdAt":0,"repeat":{"days":[1],"time":"09:00"},"important":true,"place":"home","firedAt":5,"open":5,"nudged":false,"armed":true,"attempts":1}]
        """.data(using: .utf8)!
        let list = try JSONDecoder().decode([StoredReminder].self, from: json)
        XCTAssertEqual(list.count, 2)
        XCTAssertNil(list[0].repeatRule)
        XCTAssertEqual(list[1].repeatRule?.time, "09:00")
        XCTAssertEqual(list[1].place, "home")
    }
}
