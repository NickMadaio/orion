import XCTest
import Foundation
@testable import Orion

final class BriefClockTests: XCTestCase {
    let zone = TimeZone(identifier: "Europe/London")!
    func date(_ day: Int, _ hour: Int, _ minute: Int = 0) -> Date {
        var calendar = Calendar(identifier: .gregorian); calendar.timeZone = zone
        return calendar.date(from: DateComponents(year: 2026, month: 9, day: day, hour: hour, minute: minute))!
    }
    func clock(_ day: Int, _ hour: Int, _ minute: Int = 0) -> BriefClock {
        BriefClock(now: date(day, hour, minute), timeZone: zone)
    }
    func event(_ day: Int) -> AgendaEvent {
        AgendaEvent(id: "event-\(day)", title: "Event \(day)", start: date(day, 9), end: date(day, 10),
                    isAllDay: false, calendarName: "Fixture", colorHex: nil)
    }
    func testEarlyHoursBriefUsesCivilFactsRatherThanActivityDay() {
        let civil = clock(10, 3, 21)
        let activity = LogicalDay(start: date(9, 4), fromWakeTime: false)
        let facts = BriefFacts(day: activity, clock: civil,
                               events: civil.eventsToday([event(9), event(10)]))
        XCTAssertEqual(facts.clock.dateKey, "2026-09-10")
        XCTAssertEqual(facts.events.map(\.id), ["event-10"])
        XCTAssertTrue(facts.clock.heading.contains("10"))
        XCTAssertEqual(facts.salutation, "Here's the day ahead")
        XCTAssertEqual(facts.clock.greeting, "Up late")
        XCTAssertEqual(facts.day.start, date(9, 4), "Activity bucketing is unchanged")
        XCTAssertTrue(facts.narrativeKey.contains("2026-09-10"))
    }
    func testMidnightAndFourAMAdvanceWithoutNewHealthData() {
        let activity = LogicalDay(start: date(9, 4), fromWakeTime: false)
        var facts = BriefFacts(day: activity, clock: clock(9, 23, 59))
        let previousKey = facts.narrativeKey
        facts.clock = clock(10, 0)
        XCTAssertEqual(facts.clock.dateKey, "2026-09-10")
        XCTAssertNotEqual(facts.narrativeKey, previousKey)
        XCTAssertEqual(facts.salutation, "Here's the day ahead")
        facts.clock = clock(10, 4)
        XCTAssertEqual(facts.clock.dateKey, "2026-09-10")
        XCTAssertEqual(facts.salutation, "Good morning")
        XCTAssertEqual(facts.day, activity, "Brief chronology must not depend on WHOOP republishing activity state")
    }
    func testDateOnlyReminderIsDueTodayRatherThanOverdueAtMidnight() {
        let context = clock(10, 3, 21)
        let tasks = [SyncedTask(id: "today", title: "Today", isComplete: false, dueDate: date(10, 0), hasAlarm: false),
                     SyncedTask(id: "yesterday", title: "Yesterday", isComplete: false, dueDate: date(9, 0), hasAlarm: false),
                     SyncedTask(id: "timed", title: "Timed", isComplete: false, dueDate: date(10, 2), dueHasTime: true, hasAlarm: false)]
        XCTAssertEqual(context.dueToday(tasks).map(\.id), ["today"])
        XCTAssertEqual(context.overdue(tasks).map(\.id), ["yesterday", "timed"])
    }
    func testNextEventAndRemainingMinutesUseTheObservationClock() {
        let context = clock(10, 9, 30)
        let facts = BriefFacts(day: LogicalDay(start: date(9, 4), fromWakeTime: false), clock: context,
                               events: context.eventsToday([event(9), event(10)]))
        XCTAssertEqual(facts.nextEvent?.id, "event-10")
        XCTAssertEqual(context.remainingMinutes(facts.events), 30)
        XCTAssertEqual(clock(10, 10).remainingMinutes(facts.events), 0)
    }
    func testTimeZoneChangeRefreshesEvenWhenCivilDateAndHourMatch() {
        let instant = date(10, 12)
        let london = BriefClock(now: instant, timeZone: zone)
        let paris = BriefClock(now: instant.addingTimeInterval(-3600), timeZone: TimeZone(identifier: "Europe/Paris")!)
        XCTAssertEqual(london.dateKey, paris.dateKey)
        XCTAssertEqual(london.hour, paris.hour)
        XCTAssertTrue(paris.needsSourceRefresh(after: london))
        XCTAssertFalse(london.needsSourceRefresh(after: clock(10, 11)))
    }

    func testCalendarRequiresWholeCivilDayCoverageAndFreshReadingInSameZone() {
        let context = clock(10, 12)
        let today = DateInterval(start: date(10, 0), end: date(11, 0))
        XCTAssertTrue(context.calendarReadingIsCurrent(readAt: context.now, interval: today, zone: zone))
        XCTAssertFalse(context.calendarReadingIsCurrent(readAt: nil, interval: today, zone: zone))
        XCTAssertFalse(context.calendarReadingIsCurrent(readAt: context.now.addingTimeInterval(-601), interval: today, zone: zone))
        XCTAssertFalse(context.calendarReadingIsCurrent(readAt: context.now, interval: nil, zone: zone))
        XCTAssertFalse(context.calendarReadingIsCurrent(readAt: context.now, interval: DateInterval(start: date(10, 1), end: date(11, 0)), zone: zone))
        XCTAssertFalse(context.calendarReadingIsCurrent(readAt: context.now, interval: DateInterval(start: date(9, 0), end: date(10, 0)), zone: zone))
        XCTAssertFalse(context.calendarReadingIsCurrent(readAt: context.now, interval: today, zone: TimeZone(identifier: "America/New_York")))
    }

    func testWithinHourTransitionRejectsOldNarrativeWithoutCallingModel() {
        let before = clock(10, 9, 14)
        let after = clock(10, 9, 16)
        let task = SyncedTask(id: "deadline", title: "Deadline", isComplete: false, dueDate: date(10, 9, 15), dueHasTime: true, hasAlarm: false)
        let activity = LogicalDay(start: date(10, 4), fromWakeTime: false)
        let oldFacts = BriefFacts(day: activity, clock: before, dueToday: before.dueToday([task]), overdue: before.overdue([task]))
        let newFacts = BriefFacts(day: activity, clock: after, dueToday: after.dueToday([task]), overdue: after.overdue([task]))
        XCTAssertEqual(before.hour, after.hour)
        XCTAssertNotEqual(oldFacts.narrativeKey, newFacts.narrativeKey)
        let cacheKey = "orion.narrative." + oldFacts.narrativeKey
        let priorValue = UserDefaults.standard.object(forKey: cacheKey)
        defer { if let priorValue { UserDefaults.standard.set(priorValue, forKey: cacheKey) } else { UserDefaults.standard.removeObject(forKey: cacheKey) } }
        UserDefaults.standard.set("The task is due soon.", forKey: cacheKey)
        let writer = NarrativeWriter()
        writer.load(key: oldFacts.narrativeKey) { XCTFail("Cache must avoid model work"); return nil }
        XCTAssertNotNil(writer.text(for: oldFacts.narrativeKey))
        XCTAssertNil(writer.text(for: newFacts.narrativeKey), "View must reject stale prose before its change callback")
        writer.load(key: newFacts.narrativeKey) { nil }
        XCTAssertNil(writer.text)
        XCTAssertFalse(writer.isWriting)
    }

}
