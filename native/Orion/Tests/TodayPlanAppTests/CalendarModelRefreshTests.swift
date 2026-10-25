import XCTest
import SessionService
@testable import Orion

/// The calendar model's refresh path, against a stand-in for EventKit.
@MainActor
final class CalendarModelRefreshTests: XCTestCase {
    private final class FetchStub {
        var windows: [DateInterval] = []
        var completions: [([AgendaEvent], String?) -> Void] = []
        func fetch(_ interval: DateInterval, _ completion: @escaping ([AgendaEvent], String?) -> Void) {
            windows.append(interval)
            completions.append(completion)
        }
        /// Answers fetch `index`, tagging the result so a test can tell whose it is.
        func complete(_ index: Int, tag: String) { completions[index]([], tag) }
    }

    private func make(_ stub: FetchStub, center: NotificationCenter = NotificationCenter()) -> CalendarModel {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".jsonl")
        let model = CalendarModel(agenda: AppleCalendarSync(), reminders: AppleRemindersSync(),
                                  history: SessionHistory(url: url), health: HealthLog(),
                                  fetch: stub.fetch, notificationCenter: center, refreshDelay: 0.1)
        // The init's own first fetch.
        stub.complete(0, tag: "initial")
        return model
    }

    func testRefreshInPlaceKeepsTheDateAndSelectionAndNeverShowsLoading() {
        let stub = FetchStub()
        let model = make(stub)
        let day = Calendar.current.date(byAdding: .day, value: 3, to: Date())!
        model.showDay(day)
        stub.complete(stub.completions.count - 1, tag: "shown")
        let focus = model.focusDate, selected = model.selectedDay

        model.refreshInPlace()
        XCTAssertFalse(model.isLoading, "a silent refresh must not raise the loading state")
        stub.complete(stub.completions.count - 1, tag: "refreshed")

        XCTAssertEqual(model.focusDate, focus)
        XCTAssertEqual(model.selectedDay, selected)
        XCTAssertFalse(model.isLoading)
        XCTAssertTrue(model.disclosures.contains("refreshed"))
    }

    func testARefreshFinishingAfterNavigationIsDropped() {
        let stub = FetchStub()
        let model = make(stub)
        model.refreshInPlace()
        let oldRefresh = stub.completions.count - 1
        // Navigate far enough that the padded window changes.
        model.step(6)
        let newFetch = stub.completions.count - 1
        XCTAssertGreaterThan(newFetch, oldRefresh, "navigating out of the window starts its own fetch")
        XCTAssertNotEqual(stub.windows[oldRefresh], stub.windows[newFetch])

        stub.complete(oldRefresh, tag: "stale")
        XCTAssertFalse(model.disclosures.contains("stale"), "the old window must never be published")
        stub.complete(newFetch, tag: "current")
        XCTAssertTrue(model.disclosures.contains("current"))
        XCTAssertFalse(model.isLoading)
    }

    func testNavigatingInsideTheCacheWhileARefreshIsRunningFetchesAgain() {
        let stub = FetchStub()
        let model = make(stub)
        model.refreshInPlace()
        let before = stub.completions.count
        model.step(1)   // inside the padded window, which would normally be a pure redraw
        XCTAssertEqual(stub.completions.count, before + 1,
                       "the superseded refresh must not leave the cache stale")
        stub.complete(before - 1, tag: "stale")
        XCTAssertFalse(model.disclosures.contains("stale"))
    }

    func testAFinishedTurnTriggersARefetch() {
        let stub = FetchStub()
        let center = NotificationCenter()
        let model = make(stub, center: center)
        let before = stub.completions.count
        center.post(name: .orionTurnFinished, object: nil)
        let refetched = expectation(description: "refetched")
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) { refetched.fulfill() }
        wait(for: [refetched], timeout: 3)
        XCTAssertEqual(stub.completions.count, before + 1)
        withExtendedLifetime(model) {}
    }
}
