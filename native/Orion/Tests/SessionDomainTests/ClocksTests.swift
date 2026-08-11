//
//  The first tests in the pure-domain target.
//
//  Their real job in Gate 0 is to prove the target exists, builds, and runs
//  under `swift test`, so Gate 2 has somewhere to land. But they are not
//  placeholders: they pin down the one property the whole session engine rests
//  on, which is that wall time and elapsed time are different things and moving
//  one must not move the other.
//

import XCTest
@testable import SessionDomain

final class ClocksTests: XCTestCase {

    // MARK: Wall clock

    func testWallClockMovesForwardWhenAdvanced() {
        let start = Date(timeIntervalSince1970: 1_770_000_000)
        let clock = StubWallClock(start)

        clock.advance(50 * 60)

        XCTAssertEqual(clock.now, start.addingTimeInterval(3000))
    }

    /// The case the domain has to survive: a user drags the system date, or NTP
    /// steps it, or DST ends. Wall time is allowed to move backwards.
    func testWallClockCanMoveBackwards() {
        let start = Date(timeIntervalSince1970: 1_770_000_000)
        let clock = StubWallClock(start)

        clock.set(start.addingTimeInterval(-3600))

        XCTAssertEqual(clock.now, start.addingTimeInterval(-3600))
        XCTAssertLessThan(clock.now, start)
    }

    // MARK: Monotonic clock

    func testMonotonicClockAccumulates() {
        let clock = StubMonotonicClock()

        clock.advance(600)
        clock.advance(600)

        XCTAssertEqual(clock.uptime, 1200, accuracy: 0.0001)
    }

    /// The property that makes it the right instrument for served minutes:
    /// nothing that happens to the calendar can touch it.
    func testMovingWallClockBackwardsDoesNotMoveElapsedTime() {
        let start = Date(timeIntervalSince1970: 1_770_000_000)
        let wall = StubWallClock(start)
        let monotonic = StubMonotonicClock()
        let clocks = Clocks(wall: wall, monotonic: monotonic)

        let servedFrom = clocks.monotonic.uptime
        monotonic.advance(50 * 60)

        // Meanwhile the calendar goes backwards by an hour.
        wall.set(start.addingTimeInterval(-3600))

        let served = clocks.monotonic.uptime - servedFrom
        XCTAssertEqual(served, 3000, accuracy: 0.0001,
                       "fifty minutes were served; the calendar moving cannot unserve them")
        XCTAssertLessThan(clocks.wall.now, start,
                          "and the wall clock really did move backwards")
    }

    // MARK: The real implementations

    func testSystemMonotonicClockOnlyMovesForward() {
        let clock = SystemMonotonicClock()
        let first = clock.uptime
        let second = clock.uptime
        XCTAssertGreaterThanOrEqual(second, first)
    }

    func testSystemClocksPairUp() {
        let clocks = Clocks.system
        XCTAssertGreaterThan(clocks.monotonic.uptime, 0)
        XCTAssertGreaterThan(clocks.wall.now.timeIntervalSince1970, 1_700_000_000)
    }
}
