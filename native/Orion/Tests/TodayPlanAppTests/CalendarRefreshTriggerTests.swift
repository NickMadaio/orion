import XCTest
@testable import Orion

final class CalendarRefreshTriggerTests: XCTestCase {
    private let storeChanged = Notification.Name("test.store.changed")
    private let turnFinished = Notification.Name("test.turn.finished")

    private func make(center: NotificationCenter, delay: TimeInterval = 0.2, maxWait: TimeInterval = 3,
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
        let trigger = make(center: center, delay: 0.3) { _ in count += 1; fired.fulfill() }
        for _ in 0..<10 { center.post(name: storeChanged, object: nil) }
        wait(for: [fired], timeout: 2)
        let settle = expectation(description: "settled")
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) { settle.fulfill() }
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
        let trigger = make(center: center, delay: 0.5, maxWait: 1.0) { _ in fired.fulfill() }
        // A signal every 0.1s would postpone a plain 0.5s debounce forever.
        let timer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { _ in
            center.post(name: self.storeChanged, object: nil)
        }
        wait(for: [fired], timeout: 4)
        timer.invalidate()
        withExtendedLifetime(trigger) {}
    }

    func testNothingFiresWithoutASignal() {
        let center = NotificationCenter()
        var count = 0
        let trigger = make(center: center, delay: 0.1) { _ in count += 1 }
        let settle = expectation(description: "settled")
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) { settle.fulfill() }
        wait(for: [settle], timeout: 2)
        XCTAssertEqual(count, 0)
        withExtendedLifetime(trigger) {}
    }

    func testDeallocatedTriggerNeverFiresAndIsReleased() {
        let center = NotificationCenter()
        var count = 0
        weak var weakTrigger: CalendarRefreshTrigger?
        autoreleasepool {
            let trigger = make(center: center, delay: 0.3) { _ in count += 1 }
            weakTrigger = trigger
            center.post(name: storeChanged, object: nil)
            let queued = expectation(description: "request queued")
            DispatchQueue.main.async { queued.fulfill() }
            wait(for: [queued], timeout: 2)
        }
        XCTAssertNil(weakTrigger, "the trigger must not be kept alive by its own pending work")
        let settle = expectation(description: "settled")
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) { settle.fulfill() }
        wait(for: [settle], timeout: 3)
        XCTAssertEqual(count, 0)
    }
}
