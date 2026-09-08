import XCTest
import AppKit
import SwiftUI
import MobileCore
import SessionDomain
import SessionService
@testable import Orion

final class TodayPlanAppTests: XCTestCase {
    func clock(_ hour: Int, _ minute: Int = 0) -> Date {
        Calendar.current.date(bySettingHour: hour, minute: minute, second: 0, of: Date())!
    }
    func fixture(now: Date, title: String = "Seminar", completed: Set<String> = [], deleted: Set<String> = []) throws -> TodayPlanInputs {
        let events = [AgendaEvent(id: "seminar", title: title, start: clock(9), end: clock(10), isAllDay: false, calendarName: "University", colorHex: nil)]
        let tasks = [SyncedTask(id: "gym", title: "Gym", isComplete: completed.contains("gym"), dueDate: nil, hasAlarm: false),
                     SyncedTask(id: "essay", title: "Essay outline", isComplete: completed.contains("essay"), dueDate: nil, hasAlarm: false)]
        return try TodayPlanInputs.make(events: events, tasks: tasks.filter { !deleted.contains($0.id) }, calendarReadAt: now, tasksReadAt: now, now: now, defaultMinutes: 30)
    }
    func store() throws -> TodayPlanStore {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: dir) }
        return TodayPlanStore(url: dir.appendingPathComponent("today-plan.json"))
    }
    func settle(_ condition: () -> Bool, file: StaticString = #filePath, line: UInt = #line) {
        let deadline = Date().addingTimeInterval(5)
        while !condition(), Date() < deadline { RunLoop.main.run(until: Date().addingTimeInterval(0.01)) }
        XCTAssertTrue(condition(), file: file, line: line)
    }
    func model() throws -> TodayPlanModel {
        let value = TodayPlanModel(store: try store()); value.load(); settle { value.loaded }; return value
    }
    func testActualModelPreviewAcceptFinishReopenAndUndo() throws {
        let storage = try store(), now = clock(8)
        let value = TodayPlanModel(store: storage); value.load(); settle { value.loaded }
        value.receive(try fixture(now: now)); value.setEstimate("gym", minutes: 45)
        value.preview(.plan, now: now)
        XCTAssertEqual(try storage.load().revision, 0, "Preview must not write")
        let preview = try XCTUnwrap(value.proposal)
        value.accept(now: now); settle { !value.isSaving }
        XCTAssertEqual(value.document.current, preview)
        value.preview(.finish("gym"), now: clock(8, 20)); value.accept(now: clock(8, 20))
        // The 20-minute-old snapshot must refuse this change.
        XCTAssertEqual(value.document.revision, 1)
        value.receive(try fixture(now: clock(8, 20)))
        value.preview(.finish("gym"), now: clock(8, 20)); value.accept(now: clock(8, 20)); settle { !value.isSaving }
        XCTAssertEqual(value.document.current?.completedIDs, ["gym"])
        let reopened = TodayPlanModel(store: storage); reopened.load(); settle { reopened.loaded }
        XCTAssertEqual(reopened.document.current, value.document.current)
        reopened.undo(); settle { !reopened.isSaving }
        XCTAssertEqual(reopened.document.current, preview)
        XCTAssertFalse(reopened.document.hasUndo)
    }
    func testChangedSourcesInvalidatePreviewAndAcceptedAdvice() throws {
        let value = try model(), now = clock(8)
        value.receive(try fixture(now: now)); value.preview(.plan, now: now)
        let plan = try XCTUnwrap(value.proposal)
        XCTAssertTrue(value.sourcesMatch(plan, at: now))
        value.receive(try fixture(now: now, title: "Changed seminar"))
        XCTAssertNil(value.proposal)
        XCTAssertFalse(value.sourcesMatch(plan, at: now))
        value.accept(now: now)
        XCTAssertEqual(value.document.revision, 0)
    }
    func testStalePreviewAndChangedPreferencesCannotBeAccepted() throws {
        let value = try model(), now = clock(8)
        value.receive(try fixture(now: now)); value.preview(.plan, now: now)
        value.accept(now: now.addingTimeInterval(61))
        XCTAssertEqual(value.document.revision, 0)
        value.preview(.plan, now: now); value.preferences.freeMinutes = 120; value.accept(now: now)
        XCTAssertEqual(value.document.revision, 0)
    }
    func testCompetingWriterReloadsWinningPlanAndAllowsNewPreview() throws {
        let storage = try store(), now = clock(8)
        let value = TodayPlanModel(store: storage); value.load(); settle { value.loaded }
        value.receive(try fixture(now: now)); value.preview(.plan, now: now)
        _ = try storage.accept(try XCTUnwrap(value.proposal), expectedRevision: 0, operationID: UUID())
        value.accept(now: now); settle { !value.isSaving }
        XCTAssertEqual(value.document.revision, 1); XCTAssertNil(value.proposal)
        XCTAssertNotNil(value.error)
        value.preview(.replan, now: now); value.accept(now: now); settle { !value.isSaving }
        XCTAssertEqual(value.document.revision, 2)
    }
    func testDateOnlyDeadlineIsEndOfCivilDayAndTimedDeadlineIsPreserved() throws {
        let now = clock(8), dateOnly = clock(0), timed = clock(16)
        let tasks = [SyncedTask(id: "date", title: "Due today", isComplete: false, dueDate: dateOnly, hasAlarm: false),
                     SyncedTask(id: "time", title: "Due at four", isComplete: false, dueDate: timed, dueHasTime: true, hasAlarm: false)]
        let input = try TodayPlanInputs.make(events: [], tasks: tasks, calendarReadAt: now, tasksReadAt: now, now: now, defaultMinutes: 30)
        XCTAssertEqual(input.tasks.first { $0.id == "date" }?.due, Calendar.current.date(byAdding: .day, value: 1, to: dateOnly)!.addingTimeInterval(-1))
        XCTAssertEqual(input.tasks.first { $0.id == "time" }?.due, timed)
        XCTAssertTrue(input.isFresh(at: now)); XCTAssertFalse(input.isFresh(at: now.addingTimeInterval(601)))
        XCTAssertFalse(input.isFresh(at: now.addingTimeInterval(-1)))
    }
    func testRecurringEventOccurrencesAndOtherDaysAreNotCollapsed() throws {
        let now = clock(8), tomorrow = Calendar.current.date(byAdding: .day, value: 1, to: now)!
        let events = [AgendaEvent(id: "repeats", title: "First", start: clock(9), end: clock(10), isAllDay: false, calendarName: "Calendar", colorHex: nil),
                      AgendaEvent(id: "repeats", title: "Second", start: clock(13), end: clock(14), isAllDay: false, calendarName: "Calendar", colorHex: nil),
                      AgendaEvent(id: "other-day", title: "Tomorrow", start: tomorrow, end: tomorrow.addingTimeInterval(3600), isAllDay: false, calendarName: "Calendar", colorHex: nil)]
        let input = try TodayPlanInputs.make(events: events, tasks: [], calendarReadAt: now, tasksReadAt: now, now: now, defaultMinutes: 30)
        XCTAssertEqual(input.commitments.count, 2)
        XCTAssertEqual(Set(input.commitments.map(\.id)).count, 2)
    }
    func testMoreTimeAndPublishedEstimateUseActualModel() throws {
        let value = try model(), now = clock(8)
        value.receive(try fixture(now: now)); value.setEstimate("gym", minutes: 40)
        XCTAssertEqual(value.estimate(for: "gym"), 40)
        value.preview(.plan, now: now); value.accept(now: now); settle { !value.isSaving }
        let block = try XCTUnwrap(value.document.current?.blocks.first { $0.sourceID == "gym" })
        value.preview(.moreTime("gym"), now: now)
        XCTAssertEqual(value.proposal?.tasks.first { $0.id == "gym" }?.minutes, Int(block.end.timeIntervalSince(max(now, block.start)) / 60) + 15)
        XCTAssertEqual(value.document.revision, 1, "The adjustment remains a preview")
    }
    func testRevisionSummaryIncludesNewlyScheduledWork() throws {
        let now = clock(8)
        let initial = try TodayPlanScheduler.propose(now: now, timeZone: TimeZone.current.identifier, preferences: .init(),
            tasks: [TodayPlanTask(id: "large", title: "Large task", minutes: 720, priority: 0),
                    TodayPlanTask(id: "deferred", title: "Newly available work", minutes: 120, priority: 1)],
            commitments: [], reason: "Initial plan", sourceFingerprint: "fixture")
        let revised = try TodayPlanScheduler.propose(now: now, timeZone: TimeZone.current.identifier, preferences: .init(),
            tasks: initial.tasks, commitments: [], completedIDs: ["large"], reason: "Finished early", sourceFingerprint: "fixture")
        let content = TodayPlanContent(plan: revised, previous: initial, now: now, isProposal: true,
                                      expanded: .constant(false), finish: { _ in }, moreTime: { _ in })
        XCTAssertTrue(content.changedTasks(from: initial).contains { $0.contains("Newly available work: newly scheduled") })
    }

    func testPinPreviewAcceptConflictReleaseAndUndoThroughActualModel() throws {
        let value = try model(), now = clock(8)
        value.receive(try fixture(now: now)); value.preview(.plan, now: now); value.accept(now: now); settle { !value.isSaving }
        value.preview(.pin("gym"), now: now)
        XCTAssertFalse(value.document.current!.blocks.contains(where: \.pinned))
        XCTAssertTrue(value.proposal!.blocks.contains(where: \.pinned))
        value.accept(now: now); settle { !value.isSaving }
        let pinned = try XCTUnwrap(value.document.current)
        let block = try XCTUnwrap(pinned.blocks.first { $0.sourceID == "gym" })
        let late = block.end.addingTimeInterval(60)
        value.receive(try fixture(now: late)); value.preview(.replan, now: late)
        XCTAssertNil(value.proposal); XCTAssertNotNil(value.error)
        XCTAssertEqual(value.document.current, pinned, "Conflict must preserve the accepted plan")
        value.preview(.unpinAll, now: late)
        XCTAssertFalse(value.proposal!.blocks.contains(where: \.pinned))
        value.accept(now: late); settle { !value.isSaving }
        value.undo(); settle { !value.isSaving }
        XCTAssertEqual(value.document.current, pinned)
    }
    func testFinishPinnedBlockReleasesOnlyItsPin() throws {
        let value = try model(), now = clock(8)
        value.receive(try fixture(now: now)); value.preview(.plan, now: now); value.accept(now: now); settle { !value.isSaving }
        value.preview(.pin("gym"), now: now); value.accept(now: now); settle { !value.isSaving }
        value.preview(.finish("gym"), now: now)
        XCTAssertTrue(value.proposal?.completedIDs.contains("gym") == true)
        XCTAssertFalse(value.proposal!.blocks.contains(where: \.pinned))
        XCTAssertTrue(value.document.current!.blocks.contains(where: \.pinned), "Finish remains a preview until accepted")
    }
    func testConfirmedSourceCompletionOrDeletionReleasesPinInPreviewAndUndoPreservesLocalHistory() throws {
        for deleted in [false, true] {
            let value = try model(), now = clock(8)
            value.receive(try fixture(now: now)); value.preview(.plan, now: now); value.accept(now: now); settle { !value.isSaving }
            value.preview(.pin("gym"), now: now); value.accept(now: now); settle { !value.isSaving }
            let pinned = try XCTUnwrap(value.document.current)
            value.receive(try fixture(now: now, completed: deleted ? [] : ["gym"], deleted: deleted ? ["gym"] : []))
            value.preview(.unpin("gym"), now: now)
            XCTAssertNotNil(value.proposal, "The visible Unpin action still reconciles a completed or deleted source")
            value.dismissProposal()
            value.preview(.replan, now: now)
            let proposal = try XCTUnwrap(value.proposal)
            XCTAssertFalse(proposal.blocks.contains { $0.sourceID == "gym" })
            let content = TodayPlanContent(plan: proposal, previous: pinned, now: now, isProposal: true,
                expanded: .constant(false), finish: { _ in }, moreTime: { _ in })
            XCTAssertTrue(content.changedTasks(from: pinned).contains { $0.contains(deleted ? "removed from Reminders" : "finished in Reminders") })
            XCTAssertEqual(value.document.current, pinned, "Source reconciliation remains a preview")
            value.accept(now: now); settle { !value.isSaving }
            value.undo(); settle { !value.isSaving }
            XCTAssertEqual(value.document.current, pinned)
            XCTAssertFalse(value.sourcesMatch(pinned, at: now), "Undo is local; it cannot undo external completion or deletion")
        }
    }
    func testIndividualUnpinKeepsOtherPinnedSlots() throws {
        let value = try model(), now = clock(8)
        value.receive(try fixture(now: now)); value.preview(.plan, now: now); value.accept(now: now); settle { !value.isSaving }
        for id in ["gym", "essay"] {
            value.preview(.pin(id), now: now); value.accept(now: now); settle { !value.isSaving }
        }
        let pinned = try XCTUnwrap(value.document.current)
        XCTAssertEqual(pinned.blocks.filter(\.pinned).count, 2)
        value.preview(.unpin("gym"), now: now)
        XCTAssertEqual(value.proposal?.blocks.filter(\.pinned).compactMap(\.sourceID), ["essay"])
        value.accept(now: now); settle { !value.isSaving }
        value.undo(); settle { !value.isSaving }
        XCTAssertEqual(value.document.current, pinned)
    }
    func testPinnedProductionContentRenders() throws {
        guard let destination = ProcessInfo.processInfo.environment["ORION_TODAY_RENDER_DIR"] else { return }
        _ = NSApplication.shared
        let now = clock(8)
        let inputs = try fixture(now: now)
        let plan = try TodayPlanScheduler.propose(now: now, timeZone: inputs.timeZone, preferences: .init(),
            tasks: inputs.tasks, commitments: inputs.commitments,
            pins: [TodayPlanPin(taskID: "gym", start: clock(12), end: clock(12, 30))],
            reason: "Gym is pinned at noon. Study fits around your seminar, with free time protected.", sourceFingerprint: inputs.fingerprint)
        let root = VStack(alignment: .leading, spacing: 20) {
            Text("Today · pinned plan").font(.system(size: 28, weight: .semibold, design: .rounded))
            Text("Production component · example calendar and tasks").font(.caption).foregroundStyle(OrionTheme.textSoft)
            TodayPlanContent(plan: plan, previous: nil, now: now, isProposal: false, expanded: .constant(true), finish: { _ in }, moreTime: { _ in })
        }.foregroundStyle(OrionTheme.text).padding(28).frame(width: 900)
            .background(OrionTheme.ink).environment(\.colorScheme, .dark)
        let view = NSHostingView(rootView: root)
        view.frame = CGRect(origin: .zero, size: view.fittingSize)
        let window = NSWindow(contentRect: view.frame, styleMask: [.borderless], backing: .buffered, defer: false)
        window.contentView = view; view.layoutSubtreeIfNeeded()
        for _ in 0..<6 { RunLoop.main.run(until: Date().addingTimeInterval(0.03)); view.layoutSubtreeIfNeeded() }
        let rep = try XCTUnwrap(view.bitmapImageRepForCachingDisplay(in: view.bounds))
        view.cacheDisplay(in: view.bounds, to: rep)
        try XCTUnwrap(rep.representation(using: .png, properties: [:])).write(to: URL(fileURLWithPath: destination).appendingPathComponent("orion-today-pinned-preview.png"))
    }
    func testProductionViewRenders() throws {
        guard let destination = ProcessInfo.processInfo.environment["ORION_TODAY_RENDER_DIR"] else { return }
        _ = NSApplication.shared
        let value = try model(), now = Date()
        value.receive(try fixture(now: now)); value.preview(.plan, now: now)
        XCTAssertNotNil(value.proposal)
        let root = TodayPlanView(model: value, refresh: {}).padding(28).frame(width: 900)
            .background(OrionTheme.ink).environment(\.colorScheme, .dark)
        let view = NSHostingView(rootView: root)
        let size = view.fittingSize; XCTAssertGreaterThan(size.height, 200)
        view.frame = CGRect(origin: .zero, size: size)
        let window = NSWindow(contentRect: view.frame, styleMask: [.borderless], backing: .buffered, defer: false)
        window.contentView = view; view.layoutSubtreeIfNeeded()
        for _ in 0..<6 { RunLoop.main.run(until: Date().addingTimeInterval(0.03)); view.layoutSubtreeIfNeeded() }
        let rep = try XCTUnwrap(view.bitmapImageRepForCachingDisplay(in: view.bounds))
        view.cacheDisplay(in: view.bounds, to: rep)
        try XCTUnwrap(rep.representation(using: .png, properties: [:])).write(to: URL(fileURLWithPath: destination).appendingPathComponent("orion-today-preview.png"))
    }
}
