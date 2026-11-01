//
//  Review follow-ups to the 2026-11-01 wedge fix: the Focus switch has its own
//  queue and always undoes an attempt, a grandchild holding a pipe leaks
//  nothing, lines reach the screen in the order they were said, and the
//  socket reads main-thread state on main without waiting forever.
//

import XCTest
@testable import SessionService

final class AppWedgeFollowUpTests: XCTestCase {

    // MARK: Focus switch

    func testAnAttemptedOrTimedOutEnableCountsAsChanged() {
        XCTAssertTrue(SessionFocusSwitch.mayHaveChanged(.done))
        XCTAssertTrue(SessionFocusSwitch.mayHaveChanged(.failed("timed out and was stopped")))
        XCTAssertTrue(SessionFocusSwitch.mayHaveChanged(.denied("no consent")))
        XCTAssertFalse(SessionFocusSwitch.mayHaveChanged(.notConfigured("no Shortcut")),
                       "nothing ran, so there is nothing to undo")
    }

    func testAFailedEnableIsStillFollowedByOff() {
        var calls: [String] = []
        let lock = NSLock()
        let record: (String) -> Void = { lock.lock(); calls.append($0); lock.unlock() }
        let focus = SessionFocusSwitch(enable: { record("on"); return .failed("timed out") },
                                       disable: { record("off"); return .done })
        focus.enable(isLive: { true }, completion: { _ in })
        focus.disable()
        focus.sync()
        XCTAssertEqual(calls, ["on", "off"])
    }

    func testNothingToUndoWhenTheShortcutDidNotRun() {
        var calls: [String] = []
        let focus = SessionFocusSwitch(enable: { calls.append("on"); return .notConfigured("none") },
                                       disable: { calls.append("off"); return .done })
        focus.enable(isLive: { true }, completion: { _ in })
        focus.disable()
        focus.sync()
        XCTAssertEqual(calls, ["on"])
    }

    func testAnEnableQueuedForAnEndedSessionNeverRuns() {
        var calls: [String] = []
        let focus = SessionFocusSwitch(enable: { calls.append("on"); return .done },
                                       disable: { calls.append("off"); return .done })
        focus.enable(isLive: { false }, completion: { _ in })
        focus.disable()
        focus.sync()
        XCTAssertEqual(calls, [])
    }

    /// The switch must not wait behind other slow work, e.g. a 60 s model call.
    func testTheFocusSwitchDoesNotWaitBehindOtherWork() {
        let otherWork = DispatchQueue(label: "test.other-work")
        let release = DispatchSemaphore(value: 0)
        otherWork.async { _ = release.wait(timeout: .now() + 10) }

        let ran = expectation(description: "enable ran")
        let focus = SessionFocusSwitch(enable: { .done }, disable: { .done })
        focus.enable(isLive: { true }, completion: { _ in ran.fulfill() })
        wait(for: [ran], timeout: 2)
        release.signal()
    }

    // MARK: Pipes held by a grandchild

    private func openDescriptorCount() -> Int {
        (try? FileManager.default.contentsOfDirectory(atPath: "/dev/fd").count) ?? -1
    }

    func testAGrandchildHoldingThePipeLeaksNoDescriptor() throws {
        let directory = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("orion-grandchild-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let script = directory.appendingPathComponent("detach.sh")
        try "#!/bin/sh\necho started\nsleep 8 &\nexit 0\n"
            .write(to: script, atomically: true, encoding: .utf8)
        try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: script.path)

        let before = openDescriptorCount()
        let started = Date()
        let result = BoundedProcess.run(executable: script, arguments: [], timeout: 5)
        XCTAssertEqual(result.status, 0)
        XCTAssertFalse(result.timedOut)
        XCTAssertEqual(String(decoding: result.stdout, as: UTF8.self), "started\n")
        XCTAssertLessThan(Date().timeIntervalSince(started), 5, "returns after the grace period")
        XCTAssertEqual(openDescriptorCount(), before, "both read ends were closed")
    }

    // MARK: Main-thread hops

    /// A line said off main and then one said on main reach the screen in
    /// that order. Appending the on-main one directly would jump the queue.
    func testLinesPostedFromAnyThreadArriveInTheOrderTheyWereSaid() {
        var lines: [String] = []
        let posted = DispatchSemaphore(value: 0)
        DispatchQueue.global().async {
            MainThreadHop.post { lines.append("enforcement") }
            posted.signal()
        }
        posted.wait()
        MainThreadHop.post { lines.append("session") }
        let done = expectation(description: "drained")
        DispatchQueue.main.async { done.fulfill() }
        wait(for: [done], timeout: 2)
        XCTAssertEqual(lines, ["enforcement", "session"])
    }

    func testASnapshotFromAnotherThreadIsTakenOnMain() {
        let got = expectation(description: "snapshot")
        var onMain: Bool?
        DispatchQueue.global().async {
            onMain = MainThreadHop.snapshot(timeout: 2) { Thread.isMainThread }
            got.fulfill()
        }
        wait(for: [got], timeout: 3)
        XCTAssertEqual(onMain, true)
    }

    func testASnapshotGivesUpWhenMainIsBusy() {
        let got = expectation(description: "snapshot")
        var value: Int? = 0
        DispatchQueue.global().async {
            value = MainThreadHop.snapshot(timeout: 0.2) { 42 }
            got.fulfill()
        }
        Thread.sleep(forTimeInterval: 0.6) // main is busy, as in a wedge
        wait(for: [got], timeout: 2)
        XCTAssertNil(value)
    }

    func testASnapshotOnMainRunsInline() {
        XCTAssertEqual(MainThreadHop.snapshot(timeout: 0) { 7 }, 7)
    }
}
