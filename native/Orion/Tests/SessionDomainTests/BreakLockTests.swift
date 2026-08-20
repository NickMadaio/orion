//
//  The lock, and the one door through it.
//
//  These tests are mostly about the door: a lock with a door that opens too
//  easily is a dismiss button, and a lock with a door that does not open at all
//  is a hazard.
//

import XCTest
@testable import SessionDomain

final class BreakLockTests: XCTestCase {

    private let start = Date(timeIntervalSince1970: 1_800_000_000)

    private func lock(_ length: BreakLength = .full) -> BreakLock {
        BreakLock(startedAt: start, length: length)
    }

    // MARK: Length

    func testTheDefaultBreakIsTenMinutesAndTheShortOneIsThree() {
        XCTAssertEqual(BreakLength.full.minutes, 10)
        XCTAssertEqual(BreakLength.short.minutes, 3)
    }

    func testTheShortBreakIsExactlyTheFloor() {
        XCTAssertEqual(BreakLength.short.seconds, BreakLock.floor,
                       "the shortest break that can be chosen IS the floor")
    }

    // MARK: Held

    func testItIsHeldForTheWholeLength() {
        let held = lock().state(at: start.addingTimeInterval(599))
        guard case .held(let remaining, _) = held else { return XCTFail("expected held, got \(held)") }
        XCTAssertEqual(remaining, 1, accuracy: 0.001)
    }

    func testItIsServedOnceTheTimeIsUp() {
        XCTAssertEqual(lock().state(at: start.addingTimeInterval(600)), .served)
        XCTAssertEqual(lock(.short).state(at: start.addingTimeInterval(180)), .served)
    }

    func testAShortBreakStillHoldsForItsWholeThreeMinutes() {
        guard case .held = lock(.short).state(at: start.addingTimeInterval(179)) else {
            return XCTFail("a chosen short break is still a locked break")
        }
    }

    // MARK: The door

    /// The emergency case. A lock with no exit at minute one is a hazard, not a
    /// discipline tool.
    func testTheVitalReasonRouteIsOfferedFromTheVeryFirstSecond() {
        guard case .held(_, let pleadable) = lock().state(at: start.addingTimeInterval(1)) else {
            return XCTFail("expected held")
        }
        XCTAssertTrue(pleadable)
    }

    func testAGrantedReleaseEndsTheBreakImmediately() {
        var subject = lock()
        let at = start.addingTimeInterval(60)

        XCTAssertTrue(subject.grantRelease(reason: "The dog is bleeding.", at: at))

        guard case .released(let release) = subject.state(at: at) else {
            return XCTFail("expected released")
        }
        XCTAssertEqual(release.reason, "The dog is bleeding.")
        XCTAssertEqual(release.served, 60, accuracy: 0.001)
    }

    /// Failing open on the one control that removes the lock would delete the
    /// feature without anyone noticing.
    func testAnEmptyReasonIsRefused() {
        var subject = lock()
        XCTAssertFalse(subject.grantRelease(reason: "   ", at: start))
        XCTAssertFalse(subject.grantRelease(reason: "", at: start))
        guard case .held = subject.state(at: start) else { return XCTFail("still held") }
    }

    func testAReleaseCannotBeGrantedTwice() {
        var subject = lock()
        XCTAssertTrue(subject.grantRelease(reason: "first", at: start))
        XCTAssertFalse(subject.grantRelease(reason: "second", at: start.addingTimeInterval(10)))
    }

    func testTheReasonIsKeptSoAWeekOfThemCanBeRead() {
        var subject = lock()
        _ = subject.grantRelease(reason: "  standup started early  ", at: start)
        XCTAssertEqual(subject.release?.reason, "standup started early", "trimmed, but kept")
    }

    // MARK: Progress

    func testProgressFillsAcrossTheBreakAndStopsAtOne() {
        let subject = lock()
        XCTAssertEqual(subject.progress(at: start), 0, accuracy: 0.001)
        XCTAssertEqual(subject.progress(at: start.addingTimeInterval(300)), 0.5, accuracy: 0.001)
        XCTAssertEqual(subject.progress(at: start.addingTimeInterval(9_999)), 1, accuracy: 0.001)
    }

    func testProgressFreezesAtTheMomentOfRelease() {
        var subject = lock()
        _ = subject.grantRelease(reason: "vital", at: start.addingTimeInterval(120))
        XCTAssertEqual(subject.progress(at: start.addingTimeInterval(500)), 0.2, accuracy: 0.001,
                       "he served two minutes of ten, and that is what it stays")
    }

    func testTimeBeforeTheBreakStartedIsNotNegativeProgress() {
        XCTAssertEqual(lock().progress(at: start.addingTimeInterval(-30)), 0, accuracy: 0.001)
    }
}
