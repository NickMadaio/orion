//
//  What actually happened, in the order it happened, and never edited.
//
//  The event log is the session's only mutable part, and it only ever grows.
//  Everything anyone wants to know — which phase is running, how much has been
//  served, whether a break was cut short, whether Nick was here — is DERIVED
//  from this list by `reconcile(now:)` rather than stored alongside it.
//
//  That is the plan's third correction, and it is worth restating why an
//  absolute `phaseEndsAt` is not enough. Pause moves the end. Resume moves it
//  again. A shortened break moves it. An idle hold moves it. Sleep moves it, or
//  does not, depending on how long. A user dragging the system clock moves it
//  by an amount that is not real. Storing a computed boundary means every one
//  of those has to remember to rewrite it correctly, and the first one that
//  forgets produces a session that is silently wrong. Deriving means there is
//  exactly one place the arithmetic lives.
//
//  Each event carries BOTH clocks. Wall time is what survives a restart and is
//  what a stored boundary means. Monotonic time is what actually measures a
//  duration — but it is meaningless across a reboot, so it is optional and
//  stamped with the boot it belongs to.
//

import Foundation

// MARK: - The clock stamp

/// Both readings, taken together, plus enough to know whether the monotonic one
/// is still comparable.
public struct ClockStamp: Codable, Equatable, Sendable {
    public let wall: Date

    /// `ProcessInfo.systemUptime` at the moment of the event. Nil for events
    /// reconstructed from an older schema.
    public let uptime: TimeInterval?

    /// Wall time minus uptime — an estimate of when the machine booted.
    ///
    /// This is how two events tell whether they can be compared monotonically.
    /// Two stamps from the same boot agree on it to within the drift of the
    /// wall clock; across a reboot it jumps. Without it, a monotonic reading
    /// from before a restart would be subtracted from one after, which yields a
    /// number that is not any duration at all.
    public let bootEpoch: Date?

    public init(wall: Date, uptime: TimeInterval?) {
        self.wall = wall
        self.uptime = uptime
        self.bootEpoch = uptime.map { wall.addingTimeInterval(-$0) }
    }

    public init(clocks: Clocks) {
        self.init(wall: clocks.wall.now, uptime: clocks.monotonic.uptime)
    }

    /// Tolerance for "the same boot". Generous because the wall clock genuinely
    /// drifts and is genuinely corrected by NTP while a session runs; a session
    /// is not long enough for legitimate drift to approach a minute, and a real
    /// reboot moves this by far more.
    public static let sameBootTolerance: TimeInterval = 60

    public func sharesBoot(with other: ClockStamp) -> Bool {
        guard let mine = bootEpoch, let theirs = other.bootEpoch else { return false }
        return abs(mine.timeIntervalSince(theirs)) < Self.sameBootTolerance
    }

    /// Elapsed time between two stamps, measured the most trustworthy way
    /// available.
    ///
    /// Monotonic whenever both stamps have one and it did not go backwards.
    /// Note this deliberately does NOT gate on `sharesBoot`: dragging the wall
    /// clock moves `bootEpoch` even though the monotonic reading is still
    /// perfectly good, so gating on it would throw away the one measurement
    /// that is immune to the very thing being defended against.
    ///
    /// Uptime going backwards means the machine rebooted, and then wall time is
    /// the only shared reference there is. A reboot in which the new uptime
    /// happens to exceed the old one is not a problem worth more machinery: the
    /// service writes `processStarted` on every launch, so that stretch is
    /// downtime and does not count towards anything regardless of how it was
    /// measured.
    ///
    /// Never negative. A wall clock that moved backwards yields zero elapsed
    /// rather than negative served time.
    public func elapsed(since earlier: ClockStamp) -> Elapsed {
        if let mine = uptime, let theirs = earlier.uptime, mine >= theirs {
            return Elapsed(seconds: mine - theirs, source: .monotonic)
        }
        let walled = wall.timeIntervalSince(earlier.wall)
        return Elapsed(seconds: max(0, walled), source: walled < 0 ? .wallWentBackwards : .wall)
    }
}

/// A duration and how much it can be trusted.
public struct Elapsed: Equatable, Sendable {
    public let seconds: TimeInterval
    public let source: Source

    public enum Source: String, Sendable {
        /// Measured monotonically. Immune to the calendar.
        case monotonic
        /// Measured on the wall clock, because the two stamps span a restart.
        case wall
        /// The wall clock moved backwards between the two stamps. Clamped to
        /// zero, and worth telling the user about rather than absorbing.
        case wallWentBackwards
    }

    public var isTrustworthy: Bool { source == .monotonic }
}

// MARK: - Events

public struct LifecycleEvent: Codable, Equatable, Sendable, Identifiable {
    /// For a command-driven event this IS the command's request ID, which is
    /// what makes duplicate detection a lookup rather than a heuristic.
    public let id: String
    public let stamp: ClockStamp
    public let kind: EventKind

    public init(id: String, stamp: ClockStamp, kind: EventKind) {
        self.id = id
        self.stamp = stamp
        self.kind = kind
    }

    public var at: Date { stamp.wall }
}

/// Only things that CANNOT be derived.
///
/// Deliberately short. Phase completion, "which phase is running", "how much is
/// served" and "we are waiting for him to come back" are all arithmetic over
/// this log plus the plan, so recording them would create a second copy of a
/// fact and a way for the two to disagree. What is here is the set of things no
/// amount of arithmetic can recover: what the user asked for, and when the app
/// was not running.
public enum EventKind: Codable, Equatable, Sendable {
    case started
    case paused
    case resumed

    /// A rest phase was cut short. `to` is the phase's new TOTAL duration, not
    /// its remaining time, so the derivation does not have to know when the
    /// command arrived in order to apply it. `skipRest` is this with the total
    /// set to whatever had been served at that moment.
    case restShortened(index: Int, to: TimeInterval)

    case idleBegan
    case idleEnded

    /// The app came up. The gap immediately before this event is time the app
    /// was NOT RUNNING, and by policy that does not count as focus.
    ///
    /// This has to be recorded because it cannot be inferred. `systemUptime` is
    /// shared by every process on the boot, so a crash and relaunch inside one
    /// boot is invisible to the clocks — only the service knows it just started.
    case processStarted

    /// The app was still alive at this moment. Written on a timer.
    ///
    /// Without it, the gap before a `processStarted` is entirely ambiguous: the
    /// domain knows when the app came back but not when it died, so the whole
    /// stretch would have to be treated as downtime. A crash at minute 49 of a
    /// 50-minute block would then void the whole block, which is not a
    /// defensible thing to do to somebody who did the work.
    ///
    /// This is the ONE event that is not strictly append-only: a heartbeat
    /// immediately following another heartbeat REPLACES it. That keeps the log
    /// bounded — one watermark per run stretch rather than one per minute — and
    /// it is safe precisely because a heartbeat carries no fact about the
    /// session, only about the process. Nothing is ever lost by overwriting one.
    case processAlive

    case finished(FinishReason)

    /// The wall clock moved in a way that cannot be real, and by how much.
    /// Recorded rather than silently absorbed, because a session whose numbers
    /// were adjusted should be able to say so.
    case clockAnomaly(seconds: TimeInterval)
}

public enum FinishReason: String, Codable, Sendable {
    /// Every phase served.
    case completed
    /// Nick said he was done. Archived as a success, by decision.
    case early
    /// Walked away and never came back, or explicitly gave up.
    case abandoned

    public var isSuccess: Bool { self == .completed || self == .early }
}

// MARK: - Reading the log

public extension Array where Element == LifecycleEvent {

    /// Whether a request has already been applied. The whole of idempotency.
    func contains(request: RequestID) -> Bool {
        contains { $0.id == request.raw }
    }

    var lastStamp: ClockStamp? { last?.stamp }

    func last(where matches: (EventKind) -> Bool) -> LifecycleEvent? {
        last { matches($0.kind) }
    }

    /// The terminal event, if the session has one.
    var finish: (event: LifecycleEvent, reason: FinishReason)? {
        for event in reversed() {
            if case .finished(let reason) = event.kind { return (event, reason) }
        }
        return nil
    }

    var isFinished: Bool { finish != nil }
}
