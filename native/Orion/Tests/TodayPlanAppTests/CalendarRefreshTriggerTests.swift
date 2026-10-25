import XCTest
@testable import Orion

final class CalendarRefreshTriggerTests: XCTestCase {
    private let storeChanged = Notification.Name("test.store.changed")
    private let turnFinished = Notification.Name("test.turn.finished")

    private func make(center: NotificationCenter, delay: TimeInterval = 0.1, maxWait: TimeInterval = 3,
                      fire: @escaping (CalendarRefreshTrigger.Reason) -> Void) -> CalendarRefreshTrigger {
        CalendarRefreshTrigger(delay: delay, maxWait: maxWait, center: center,
                               storeChanged: storeChanged, turnFinished: turnFinished, fire: fire)
    }

    func testStoreChangeFiresOnceAfterTheQuietPeriod() {
        let center = NotificationCenter()
        let fired = expectation(description: "fired")
        var reasons: [CalendarRefreshTrigger.Reason] = []
        let trigger = make(center: center) { reasons.append($0); fired.fulfill() }
        center.post(name: storeChanged, object: nil)
        wait(for: [fired], timeout: 2)
        XCTAssertEqual(reasons, [.storeChanged])
        withExtendedLifetime(trigger) {}
    }

    func testABatchOfWritesIsOneRefresh() {
        let center = NotificationCenter()
        let fired = expectation(description: "fired")
        var count = 0
        let trigger = make(center: center, delay: 0.2) { _ in count += 1; fired.fulfill() }
        for _ in 0..<10 { center.post(name: storeChanged, object: nil) }
        wait(for: [fired], timeout: 2)
        let settle = expectation(description: "settled")
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { settle.fulfill() }
        wait(for: [settle], timeout: 2)
        XCTAssertEqual(count, 1)
        withExtendedLifetime(trigger) {}
    }

    func testFinishedTurnTriggersARefresh() {
        let center = NotificationCenter()
        let fired = expectation(description: "fired")
        var reasons: [CalendarRefreshTrigger.Reason] = []
        let trigger = make(center: center) { reasons.append($0); fired.fulfill() }
        center.post(name: turnFinished, object: nil)
        wait(for: [fired], timeout: 2)
        XCTAssertEqual(reasons, [.turnFinished])
        withExtendedLifetime(trigger) {}
    }

    func testSignalsKeepPostponingUntilMaxWaitThenFire() {
        let center = NotificationCenter()
        let fired = expectation(description: "fired before the stream stops")
        fired.assertForOverFulfill = false
        let trigger = make(center: center, delay: 0.3, maxWait: 0.5) { _ in fired.fulfill() }
        // A signal every 0.1s for 1.5s would postpone a plain debounce forever.
        let timer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { _ in
            center.post(name: self.storeChanged, object: nil)
        }
        wait(for: [fired], timeout: 1.2)
        timer.invalidate()
        withExtendedLifetime(trigger) {}
    }

    func testNothingFiresWithoutASignal() {
        let center = NotificationCenter()
        var count = 0
        let trigger = make(center: center, delay: 0.05) { _ in count += 1 }
        let settle = expectation(description: "settled")
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { settle.fulfill() }
        wait(for: [settle], timeout: 2)
        XCTAssertEqual(count, 0)
        withExtendedLifetime(trigger) {}
    }

    func testDeallocatedTriggerNeverFires() {
        let center = NotificationCenter()
        var count = 0
        var trigger: CalendarRefreshTrigger? = make(center: center, delay: 0.1) { _ in count += 1 }
        center.post(name: storeChanged, object: nil)
        DispatchQueue.main.async { trigger = nil }
        let settle = expectation(description: "settled")
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { settle.fulfill() }
        wait(for: [settle], timeout: 2)
        XCTAssertEqual(count, 0)
        XCTAssertNil(trigger)
    }
}
