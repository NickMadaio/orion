import XCTest
import Foundation
import MobileCore
@testable import SessionService

final class TodayPlanTests: XCTestCase {
    let zone = "Europe/London"
    func date(_ hour: Int, _ minute: Int = 0, day: Int = 8, month: Int = 9) -> Date {
        var calendar = Calendar(identifier: .gregorian); calendar.timeZone = TimeZone(identifier: zone)!
        return calendar.date(from: DateComponents(year: 2026, month: month, day: day, hour: hour, minute: minute))!
    }
    func task(_ id: String, _ minutes: Int, priority: Int = 0, due: Date? = nil, done: Bool = false) -> TodayPlanTask {
        TodayPlanTask(id: id, title: id, minutes: minutes, priority: priority, due: due, completedInSource: done)
    }
    func event(_ id: String, _ start: Date, _ end: Date, allDay: Bool = false) -> TodayPlanCommitment {
        TodayPlanCommitment(id: id, title: id, start: start, end: end, allDay: allDay)
    }
    func plan(tasks: [TodayPlanTask] = [], events: [TodayPlanCommitment] = [], now: Date? = nil,
              preferences: TodayPlanPreferences = .init(), completed: Set<String> = [], pins: [TodayPlanPin] = []) throws -> TodayPlan {
        try TodayPlanScheduler.propose(now: now ?? date(8), timeZone: zone, preferences: preferences,
                                       tasks: tasks, commitments: events, completedIDs: completed, pins: pins,
                                       reason: "Test user request", sourceFingerprint: "fixture-sources")
    }
    func temporaryStore() throws -> TodayPlanStore {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: root) }
        return TodayPlanStore(url: root.appendingPathComponent("plan.json"))
    }

    func testPlacesTasksIntoActualGapsAndProtectsTransitions() throws {
        let fixed = event("lecture", date(9), date(10))
        let value = try plan(tasks: [task("long", 60), task("short", 30, priority: 1)], events: [fixed])
        let short = try XCTUnwrap(value.blocks.first { $0.sourceID == "short" })
        let long = try XCTUnwrap(value.blocks.first { $0.sourceID == "long" })
        XCTAssertEqual(short.start, date(8))
        XCTAssertEqual(long.start, date(10, 10))
        XCTAssertEqual(value.blocks.first { $0.sourceID == "lecture" }?.start, fixed.start)
        XCTAssertTrue(value.blocks.contains { $0.kind == .transition && $0.start == date(8, 50) && $0.end == date(9) })
        XCTAssertGreaterThanOrEqual(value.freeMinutes, 60)
    }
    func testFreeTimeIsReservedBeforeSelectingWork() throws {
        let value = try plan(tasks: [task("a", 720), task("b", 120)])
        XCTAssertEqual(value.blocks.filter { $0.kind == .task }.map(\.sourceID), ["a"])
        XCTAssertEqual(value.deferredIDs, ["b"])
        XCTAssertEqual(value.freeMinutes, 120)
    }
    func testOverlappingCommitmentsCountTheirUnionAndRemainUnchanged() throws {
        let events = [event("one", date(9), date(11)), event("two", date(10), date(12))]
        let value = try plan(tasks: [task("work", 30)], events: events)
        XCTAssertTrue(value.warnings.contains { $0.contains("one overlaps two") })
        XCTAssertEqual(value.blocks.filter { $0.kind == .commitment }.map(\.start), events.map(\.start))
        XCTAssertEqual(value.freeMinutes, 610) // 840 - union 180 - buffers 20 - work 30
    }
    func testNoWorkIsScheduledBeforeNowOrAfterSleep() throws {
        let value = try plan(tasks: [task("work", 60)], now: date(21, 30))
        XCTAssertTrue(value.blocks.allSatisfy { $0.start >= date(21, 30) && $0.end <= date(22) })
        XCTAssertEqual(value.deferredIDs, ["work"])
        XCTAssertEqual(value.freeMinutes, 30)
    }
    func testSleepFloorUsesActualDurationAcrossDST() throws {
        var preferences = TodayPlanPreferences(); preferences.sleepMinute = 1440; preferences.wakeMinute = 480
        // London loses an hour on March 29: midnight to 8 is seven real hours.
        XCTAssertThrowsError(try plan(now: date(8, day: 28, month: 3), preferences: preferences)) {
            XCTAssertEqual($0 as? TodayPlanError, .invalidPreferences)
        }
    }
    func testCivilDayBoundariesAcrossBothDSTChanges() throws {
        for (day, month, hoursToSleep) in [(29, 3, 21), (25, 10, 23)] {
            let value = try plan(tasks: [task("work", 30)], now: date(8, day: day, month: month))
            XCTAssertEqual(value.windowEnd.timeIntervalSince(value.day), Double(hoursToSleep * 3600))
            XCTAssertEqual(value.blocks.first { $0.kind == .task }?.start, date(8, day: day, month: month))
        }
    }
    func testHardCommitmentOutsideWakingHoursIsReported() throws {
        let fixed = event("late flight", date(23), date(23, 30))
        let value = try plan(events: [fixed])
        XCTAssertTrue(value.warnings.contains { $0.contains("protected off-hours") })
        XCTAssertEqual(value.blocks.first { $0.sourceID == fixed.id }?.end, fixed.end)
    }
    func testDeadlineThatCannotBeMetDefersTask() throws {
        let value = try plan(tasks: [task("due soon", 90, due: date(9))])
        XCTAssertEqual(value.deferredIDs, ["due soon"])
        XCTAssertFalse(value.blocks.contains { $0.kind == .task })
    }
    func testOverdueTaskGetsRecoveryWarningNotFalseOnTimeClaim() throws {
        let value = try plan(tasks: [task("overdue", 30, due: date(7))])
        XCTAssertTrue(value.blocks.contains { $0.sourceID == "overdue" })
        XCTAssertTrue(value.warnings.contains { $0.contains("recovery block") })
    }
    func testCompletionDoesNotRescheduleTaskAndCreatesRoom() throws {
        let tasks = [task("gym", 60), task("study", 60, priority: 1)]
        let original = try plan(tasks: tasks)
        let revised = try plan(tasks: tasks, now: date(8, 30), completed: ["gym"])
        XCTAssertFalse(revised.blocks.contains { $0.sourceID == "gym" })
        XCTAssertEqual(revised.blocks.first { $0.sourceID == "study" }?.start, date(8, 30))
        XCTAssertEqual(original.blocks.first { $0.sourceID == "study" }?.start, date(9))
    }
    func testCompletedSourceTasksAreExcludedByBothPlanners() throws {
        let value = try plan(tasks: [task("done", 30, done: true)])
        XCTAssertTrue(value.deferredIDs.isEmpty)
        XCTAssertFalse(value.blocks.contains { $0.kind == .task })
        let old = DayPlan.propose(commitments: [], tasks: [PlannedTask(id: "done", title: "done", estimateMinutes: 30, completed: true)!])
        XCTAssertTrue(old.scheduled.isEmpty)
    }
    func testAllDayContextDoesNotClaimTheEntireDayIsBusy() throws {
        let value = try plan(tasks: [task("work", 30)], events: [event("trip", date(0), date(0, day: 9), allDay: true)])
        XCTAssertTrue(value.blocks.contains { $0.kind == .task })
        XCTAssertTrue(value.warnings.contains { $0.contains("All-day entries") })
    }
    func testDuplicateIdentifiersAndInvalidDurationsFail() throws {
        XCTAssertThrowsError(try plan(tasks: [task("same", 30), task("same", 60)]))
        XCTAssertThrowsError(try plan(tasks: [task("invalid", -1)]))
        XCTAssertThrowsError(try plan(tasks: [task("huge", Int.max)]))
        XCTAssertThrowsError(try plan(events: [event("bad", date(9), date(8))]))
    }
    func testCurrentBlocksUseHalfOpenTimeIntervals() throws {
        var preferences = TodayPlanPreferences(); preferences.transitionMinutes = 0
        let value = try plan(tasks: [task("work", 60)], events: [event("lecture", date(9), date(10))], preferences: preferences)
        XCTAssertEqual(value.current(at: date(9))?.sourceID, "lecture")
        XCTAssertNotEqual(value.current(at: date(9))?.sourceID, "work")
    }
    func testAtomicRevisionSurvivesReopenAndUndo() throws {
        let store = try temporaryStore()
        let original = try plan(tasks: [task("a", 30)])
        let first = try store.accept(original, expectedRevision: 0, operationID: UUID())
        XCTAssertEqual(first.revision, 1)
        XCTAssertEqual(try TodayPlanStore(url: store.url).load().current, original)
        let changed = try plan(tasks: [task("a", 30)], completed: ["a"])
        _ = try store.accept(changed, expectedRevision: 1, operationID: UUID())
        let restored = try TodayPlanStore(url: store.url).undo(expectedRevision: 2, operationID: UUID())
        XCTAssertEqual(restored.current, original)
        XCTAssertEqual(restored.revision, 3)
        XCTAssertFalse(restored.hasUndo)
    }
    func testFirstPlanCanBeUndoneToEmpty() throws {
        let store = try temporaryStore()
        _ = try store.accept(plan(), expectedRevision: 0, operationID: UUID())
        XCTAssertNil(try store.undo(expectedRevision: 1, operationID: UUID()).current)
    }
    func testDuplicateOperationIsIdempotentIncludingAfterUndo() throws {
        let store = try temporaryStore(), id = UUID()
        let value = try plan(tasks: [task("a", 30)], completed: ["a", "old", "another"])
        _ = try store.accept(value, expectedRevision: 0, operationID: id)
        let decoded = try XCTUnwrap(store.load().current)
        XCTAssertEqual(try store.accept(decoded, expectedRevision: 0, operationID: id).revision, 1)
        _ = try store.undo(expectedRevision: 1, operationID: UUID())
        XCTAssertNil(try store.accept(decoded, expectedRevision: 0, operationID: id).current)
    }
    func testReplayIdentifierCannotAuthorizeDifferentContent() throws {
        let store = try temporaryStore(), id = UUID()
        _ = try store.accept(plan(), expectedRevision: 0, operationID: id)
        XCTAssertThrowsError(try store.accept(plan(tasks: [task("other", 30)]), expectedRevision: 0, operationID: id)) {
            XCTAssertEqual($0 as? TodayPlanError, .replayMismatch)
        }
    }
    func testStaleWriterCannotOverwriteAcceptedRevision() throws {
        let store = try temporaryStore()
        _ = try store.accept(plan(), expectedRevision: 0, operationID: UUID())
        XCTAssertThrowsError(try TodayPlanStore(url: store.url).accept(plan(tasks: [task("stale", 30)]), expectedRevision: 0, operationID: UUID())) {
            XCTAssertEqual($0 as? TodayPlanError, .revisionConflict)
        }
        XCTAssertEqual(try store.load().revision, 1)
    }
    func testCorruptFileIsPreservedAndCannotBecomeAnEmptyDay() throws {
        let store = try temporaryStore(), corrupt = Data("broken json".utf8)
        try corrupt.write(to: store.url)
        XCTAssertThrowsError(try store.load())
        XCTAssertThrowsError(try store.accept(plan(), expectedRevision: 0, operationID: UUID()))
        XCTAssertEqual(try Data(contentsOf: store.url), corrupt)
    }
    func testSavedFileIsOwnerOnlyAndContainsNoSeparateUndoTransaction() throws {
        let store = try temporaryStore()
        _ = try store.accept(plan(), expectedRevision: 0, operationID: UUID())
        let attributes = try FileManager.default.attributesOfItem(atPath: store.url.path)
        XCTAssertEqual((attributes[.posixPermissions] as? NSNumber)?.intValue, 0o600)
        let files = try FileManager.default.contentsOfDirectory(atPath: store.url.deletingLastPathComponent().path)
        XCTAssertEqual(Set(files), ["plan.json", "plan.json.lock"])
    }
    func testEqualPriorityTasksUseDeadlinesBeforeSourceIdentifiers() throws {
        let value = try plan(tasks: [task("a-later", 30, due: date(10)), task("b-urgent", 30, due: date(8, 30))])
        XCTAssertEqual(value.blocks.first { $0.kind == .task }?.sourceID, "b-urgent")
        XCTAssertTrue(value.deferredIDs.isEmpty)
    }
    func testRemainingFreeTimeExcludesElapsedBlocks() throws {
        let value = try plan()
        XCTAssertEqual(value.freeMinutes(after: date(20)), 120)
        XCTAssertEqual(value.freeMinutes(after: date(23)), 0)
    }
    func testTamperedSnapshotCannotEraseCommitmentsOrInventCapacity() throws {
        let original = try plan(tasks: [task("work", 30)], events: [event("lecture", date(9), date(10))])
        let encoded = try JSONEncoder().encode(original)
        for mutation in 0..<4 {
            var object = try XCTUnwrap(JSONSerialization.jsonObject(with: encoded) as? [String: Any])
            var blocks = try XCTUnwrap(object["blocks"] as? [[String: Any]])
            switch mutation {
            case 0: blocks.removeAll { $0["kind"] as? String == "commitment" }
            case 1: object["windowEnd"] = date(23).timeIntervalSinceReferenceDate
            case 2:
                let i = try XCTUnwrap(blocks.firstIndex { $0["kind"] as? String == "task" })
                blocks[i]["end"] = date(8, 1).timeIntervalSinceReferenceDate
            default: object["deferredIDs"] = ["invented"]
            }
            object["blocks"] = blocks
            let changed = try JSONDecoder().decode(TodayPlan.self, from: JSONSerialization.data(withJSONObject: object))
            XCTAssertThrowsError(try changed.validate(), "Mutation \(mutation) must be rejected")
        }
    }
    func testExtremeFiniteDatesFailWithoutIntegerTrap() throws {
        XCTAssertThrowsError(try plan(events: [event("bad", date(9), Date(timeIntervalSinceReferenceDate: 1e100))]))
    }

    func testNextCommitmentSkipsFlexibleAndFreeBlocks() throws {
        let value = try plan(tasks: [task("work", 30)], events: [event("lecture", date(9), date(10))])
        XCTAssertEqual(value.nextCommitment(at: date(7))?.sourceID, "lecture")
        XCTAssertNil(value.nextCommitment(at: date(11)))
    }

    func testPinnedSlotSurvivesReplanningWhileOtherTasksMove() throws {
        let pin = TodayPlanPin(taskID: "gym", start: date(12), end: date(13))
        let tasks = [task("gym", 60), task("study", 90)]
        for now in [date(8), date(10), date(12, 20)] {
            let value = try plan(tasks: tasks, now: now, pins: [pin])
            let block = try XCTUnwrap(value.blocks.first { $0.sourceID == "gym" })
            XCTAssertTrue(block.pinned); XCTAssertEqual(block.start, date(12)); XCTAssertEqual(block.end, date(13))
            XCTAssertGreaterThanOrEqual(value.freeMinutes, 60)
            XCTAssertTrue(value.blocks.filter { $0.kind == .task && !$0.pinned }.allSatisfy { $0.start >= now })
        }
    }
    func testMissedPinnedSlotRefusesSilentRescheduling() throws {
        XCTAssertThrowsError(try plan(tasks: [task("gym", 60)], now: date(14), pins: [TodayPlanPin(taskID: "gym", start: date(12), end: date(13))])) {
            XCTAssertEqual($0 as? TodayPlanError, .pinConflict("gym"))
        }
    }
    func testPinConflictsWithNewCalendarEventTransitionsAndOtherPins() throws {
        let pin = TodayPlanPin(taskID: "gym", start: date(12), end: date(13))
        for fixed in [event("conflict", date(12, 30), date(13, 30)), event("transition", date(13, 5), date(14))] {
            XCTAssertThrowsError(try plan(tasks: [task("gym", 60)], events: [fixed], pins: [pin]))
        }
        XCTAssertThrowsError(try plan(tasks: [task("gym", 60), task("study", 60)],
            pins: [pin, TodayPlanPin(taskID: "study", start: date(12, 30), end: date(13, 30))]))
    }
    func testPinCannotChangeItsDurationOrViolateSleepAndFreeTime() throws {
        XCTAssertThrowsError(try plan(tasks: [task("gym", 45)], pins: [TodayPlanPin(taskID: "gym", start: date(12), end: date(13))]))
        XCTAssertThrowsError(try plan(tasks: [task("gym", 60)], pins: [TodayPlanPin(taskID: "gym", start: date(21, 30), end: date(22, 30))]))
        var preferences = TodayPlanPreferences(); preferences.freeMinutes = 240
        XCTAssertThrowsError(try plan(tasks: [task("gym", 720)], preferences: preferences,
            pins: [TodayPlanPin(taskID: "gym", start: date(8), end: date(20))]))
    }
    func testPinsPersistAndUndoRestoresUnpinnedSnapshot() throws {
        let store = try temporaryStore(), tasks = [task("gym", 60)]
        let original = try plan(tasks: tasks)
        _ = try store.accept(original, expectedRevision: 0, operationID: UUID())
        let pinned = try plan(tasks: tasks, pins: [TodayPlanPin(taskID: "gym", start: date(8), end: date(9))])
        _ = try store.accept(pinned, expectedRevision: 1, operationID: UUID())
        XCTAssertEqual(try TodayPlanStore(url: store.url).load().current, pinned)
        XCTAssertEqual(try store.undo(expectedRevision: 2, operationID: UUID()).current, original)
    }
    func testOldSnapshotWithoutPinFieldStillLoads() throws {
        let original = try plan(tasks: [task("gym", 60)])
        let data = try JSONEncoder().encode(original)
        XCTAssertFalse(String(decoding: data, as: UTF8.self).contains("isPinned"))
        let decoded = try JSONDecoder().decode(TodayPlan.self, from: data)
        try decoded.validate()
        XCTAssertTrue(decoded.blocks.allSatisfy { !$0.pinned })
    }

}
