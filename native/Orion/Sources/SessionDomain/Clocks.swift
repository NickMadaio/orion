//
//  Two clocks, deliberately.
//
//  A focus session has to answer two different questions, and one clock cannot
//  answer both honestly.
//
//  "What phase should be running right now, given that the app was closed for a
//  while?" is a question about the calendar. It survives quit, restart and
//  sleep, so it has to be persisted, so it has to be wall-clock time.
//
//  "How many minutes of focus has Nick actually served?" is a question about
//  elapsed duration. Wall clock is the wrong instrument for it: NTP steps it,
//  DST moves it, and the user can drag it anywhere in System Settings. Serving
//  fifty minutes and then being told the session ended twenty minutes ago
//  because the clock jumped is not an edge case Orion gets to shrug at — it is
//  the thing the whole feature is for.
//
//  So: wall time for persistence and reconciliation, monotonic time for
//  measuring how long something has been running. Where a value crosses a
//  process boundary it is wall time; where it accumulates in memory it is
//  monotonic.
//
//  Both are protocols because every test in Gate 2 injects them. There is no
//  `Date()` and no `mach_absolute_time` anywhere in the domain — a domain that
//  reads the real clock cannot be tested against DST, sleep, or a user dragging
//  the date, which is exactly the list of cases that have to work.
//

import Foundation

// MARK: - Wall clock

/// Calendar time. Persisted, compared across process lifetimes, and never
/// trusted to measure a duration.
public protocol WallClock: Sendable {
    var now: Date { get }
}

/// The system calendar clock.
public struct SystemWallClock: WallClock {
    public init() {}
    public var now: Date { Date() }
}

// MARK: - Monotonic clock

/// Elapsed time since an arbitrary origin, which only ever moves forward.
///
/// The origin is meaningless; only differences are. Crucially this keeps
/// counting while the machine sleeps on macOS, which is the behaviour the
/// session engine wants — a lid closed for an hour is an hour that passed, and
/// the domain decides what that means rather than being lied to about it.
public protocol MonotonicClock: Sendable {
    var uptime: TimeInterval { get }
}

/// Backed by `ProcessInfo.systemUptime`, which is `mach_absolute_time` scaled to
/// seconds. Chosen over `DispatchTime.now()` only because it reads as what it is.
public struct SystemMonotonicClock: MonotonicClock {
    public init() {}
    public var uptime: TimeInterval { ProcessInfo.processInfo.systemUptime }
}

// MARK: - The pair

/// Both clocks, passed as one value so no call site can accidentally take only
/// the convenient one.
public struct Clocks: Sendable {
    public let wall: any WallClock
    public let monotonic: any MonotonicClock

    public init(wall: any WallClock, monotonic: any MonotonicClock) {
        self.wall = wall
        self.monotonic = monotonic
    }

    public static var system: Clocks {
        Clocks(wall: SystemWallClock(), monotonic: SystemMonotonicClock())
    }
}

// MARK: - Test doubles

/// A wall clock the tests move by hand, including backwards.
///
/// Backwards matters. DST, an NTP correction and a user editing the date all
/// move wall time in a direction durations are not allowed to follow, and the
/// reducer has to be provably unbothered by it.
public final class StubWallClock: WallClock, @unchecked Sendable {
    private let lock = NSLock()
    private var current: Date

    public init(_ start: Date) { current = start }

    public var now: Date {
        lock.lock(); defer { lock.unlock() }
        return current
    }

    public func advance(_ interval: TimeInterval) {
        lock.lock(); defer { lock.unlock() }
        current = current.addingTimeInterval(interval)
    }

    /// Jump anywhere, forwards or back. Named `set` rather than `advance` so a
    /// test that moves time backwards has to say so out loud.
    public func set(_ date: Date) {
        lock.lock(); defer { lock.unlock() }
        current = date
    }
}

/// A monotonic clock the tests move by hand. It refuses to go backwards,
/// because the real one cannot, and a test that could would be testing a
/// situation that never happens.
public final class StubMonotonicClock: MonotonicClock, @unchecked Sendable {
    private let lock = NSLock()
    private var current: TimeInterval

    public init(_ start: TimeInterval = 0) { current = start }

    public var uptime: TimeInterval {
        lock.lock(); defer { lock.unlock() }
        return current
    }

    /// Negative intervals are a programming error in the test, not a scenario.
    public func advance(_ interval: TimeInterval) {
        precondition(interval >= 0, "a monotonic clock cannot move backwards")
        lock.lock(); defer { lock.unlock() }
        current += interval
    }
}
