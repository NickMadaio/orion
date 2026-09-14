import XCTest
import EventKit
import MobileCore
import SessionService
@testable import Orion

final class TodayPlanSourceRaceTests: XCTestCase {
    final class CalendarSource: TodayPlanCalendarSource {
        var access: AppleRemindersSync.Access = .granted
        var authorization: EKAuthorizationStatus = .fullAccess
        var canReadForPlanning: Bool { access.isGranted && TodayPlanReadAuthorization.permitsRead(authorization) }
        var pending: [([AgendaEvent], String?) -> Void] = []
        func fetch(interval: DateInterval, completion: @escaping ([AgendaEvent], String?) -> Void) {
            pending.append(completion)
        }
        func complete(_ index: Int = 0, error: String? = nil) {
            let callback = pending.remove(at: index)
            callback([], error)
        }
    }
    final class RemindersSource: TodayPlanRemindersSource {
        var access: AppleRemindersSync.Access = .granted
        var authorization: EKAuthorizationStatus = .fullAccess
        var canReadForPlanning: Bool { access.isGranted && TodayPlanReadAuthorization.permitsRead(authorization) }
        var tasks = [SyncedTask(id: "task", title: "Original task", isComplete: false, dueDate: nil, hasAlarm: false)]
        var lastSyncedAt: Date? = Date()
        var lastError: String?
    }
    func model() throws -> TodayPlanModel {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: dir) }
        let model = TodayPlanModel(store: TodayPlanStore(url: dir.appendingPathComponent("plan.json")))
        model.load(); settle { model.loaded }
        return model
    }
    func settle(_ condition: () -> Bool) {
        let end = Date().addingTimeInterval(3)
        while !condition() && Date() < end { RunLoop.main.run(until: Date().addingTimeInterval(0.01)) }
        XCTAssertTrue(condition())
    }
    func seed(_ model: TodayPlanModel, calendar: CalendarSource, reminders: RemindersSource) {
        model.refresh(agenda: calendar, reminders: reminders); calendar.complete()
        model.preview(.plan); model.accept(); settle { !model.isSaving }
        XCTAssertEqual(model.document.revision, 1)
        model.preview(.replan)
        XCTAssertNotNil(model.proposal)
    }

    func testPermissionLossDuringCalendarFetchCannotRestoreUsableSources() throws {
        for calendarRevoked in [true, false] {
            let model = try model(), calendar = CalendarSource(), reminders = RemindersSource()
            seed(model, calendar: calendar, reminders: reminders)
            let saved = model.document
            model.refresh(agenda: calendar, reminders: reminders)
            if calendarRevoked { calendar.access = .denied("Revoked") }
            else { reminders.access = .denied("Revoked") }
            calendar.complete()
            XCTAssertNil(model.inputs, "A late result must recheck current permission")
            XCTAssertNil(model.proposal)
            model.accept()
            settle { !model.isSaving }
            XCTAssertEqual(model.document, saved, "Source loss must preserve accepted history")
        }
    }

    func testRemindersFailureDuringFetchCannotPublishEarlierTasksAsChecked() throws {
        let model = try model(), calendar = CalendarSource(), reminders = RemindersSource()
        seed(model, calendar: calendar, reminders: reminders)
        model.refresh(agenda: calendar, reminders: reminders)
        reminders.lastError = "Reminders did not return a snapshot"
        calendar.complete()
        XCTAssertNil(model.inputs)
        XCTAssertNil(model.proposal)
        XCTAssertEqual(model.document.revision, 1)
    }

    func testChangedReminderSnapshotDuringFetchRequiresNewRead() throws {
        let model = try model(), calendar = CalendarSource(), reminders = RemindersSource()
        model.refresh(agenda: calendar, reminders: reminders)
        reminders.tasks[0].title = "Updated task"
        reminders.lastSyncedAt = Date()
        calendar.complete()
        XCTAssertNil(model.inputs, "Do not publish the captured older task snapshot")
        model.refresh(agenda: calendar, reminders: reminders); calendar.complete()
        XCTAssertEqual(model.inputs?.tasks.first?.title, "Updated task")
        XCTAssertTrue(model.inputs?.isFresh(at: Date()) == true)
    }

    func testSupersededCallbackCannotEraseRecoveredReading() throws {
        let model = try model(), calendar = CalendarSource(), reminders = RemindersSource()
        model.refresh(agenda: calendar, reminders: reminders)
        reminders.tasks[0].title = "Recovered task"
        reminders.lastSyncedAt = Date()
        model.refresh(agenda: calendar, reminders: reminders)
        calendar.complete(1)
        let recovered = model.inputs
        calendar.complete(error: "Old request failed")
        XCTAssertEqual(model.inputs, recovered)
        XCTAssertEqual(model.inputs?.tasks.first?.title, "Recovered task")
    }

    func testFailureRefusesPreviewAndSuccessfulRefreshRecoversWithoutRestart() throws {
        let model = try model(), calendar = CalendarSource(), reminders = RemindersSource()
        seed(model, calendar: calendar, reminders: reminders)
        let saved = model.document
        model.refresh(agenda: calendar, reminders: reminders)
        calendar.complete(error: "Calendar read failed")
        model.preview(.replan)
        XCTAssertNil(model.proposal)
        XCTAssertEqual(model.document, saved)
        model.refresh(agenda: calendar, reminders: reminders); calendar.complete()
        model.preview(.replan); model.accept(); settle { !model.isSaving }
        XCTAssertEqual(model.document.revision, saved.revision + 1)
    }

    func testAcceptRechecksLiveSourcesBeforeViewRefreshCallback() throws {
        for change in 0..<4 {
            let model = try model(), calendar = CalendarSource(), reminders = RemindersSource()
            seed(model, calendar: calendar, reminders: reminders)
            let saved = model.document
            switch change {
            case 0: calendar.access = .denied("Revoked")
            case 1: reminders.access = .denied("Revoked")
            case 2: reminders.lastError = "Read failed"
            default: reminders.tasks[0].isComplete = true
            }
            // Deliberately do not call refresh: SwiftUI's observer may run later.
            XCTAssertFalse(model.hasUsableSources(at: Date()))
            model.accept(); settle { !model.isSaving }
            XCTAssertEqual(model.document, saved)
            model.preview(.replan)
            XCTAssertNil(model.proposal)
        }
    }

    func testSystemPermissionLossRejectsCachedGrantAndLaterRecovers() throws {
        for status: EKAuthorizationStatus in [.notDetermined, .restricted, .denied, .writeOnly] {
            for calendarRevoked in [true, false] {
                let model = try model(), calendar = CalendarSource(), reminders = RemindersSource()
                seed(model, calendar: calendar, reminders: reminders)
                let saved = model.document
                if calendarRevoked { calendar.authorization = status }
                else { reminders.authorization = status }
                XCTAssertTrue(calendar.access.isGranted && reminders.access.isGranted, "Cached grants remain unchanged")
                XCTAssertFalse(model.hasUsableSources(at: Date()))
                model.accept(); settle { !model.isSaving }
                XCTAssertEqual(model.document, saved)
                calendar.authorization = .fullAccess; reminders.authorization = .fullAccess
                model.refresh(agenda: calendar, reminders: reminders); calendar.complete()
                model.preview(.replan)
                XCTAssertNotNil(model.proposal)
            }
        }
    }
}
