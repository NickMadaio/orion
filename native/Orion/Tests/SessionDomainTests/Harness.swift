//
//  A session you can drive by hand.
//
//  Everything in these tests happens on stub clocks, so a fifty-minute block
//  costs no time at all and a three-hour sleep is one line. That is the payoff
//  for keeping the domain pure: the adversarial cases — DST, a dragged clock, a
//  crash mid-phase — become data rather than something you have to wait for or
//  simulate with sleeps.
//
//  `advance` moves BOTH clocks together, which is what ordinary time passing
//  looks like. The cases where they diverge are deliberately awkward to write —
//  `dragWallClock` and `restart` — because divergence is never ordinary and a
//  test that causes it should say so plainly.
//

import Foundation
@testable import SessionDomain

final class Harness {
    let wall: StubWallClock
    let monotonic: StubMonotonicClock
    var clocks: Clocks { Clocks(wall: wall, monotonic: monotonic) }

    private(set) var state: SessionState?
    private(set) var lastRejection: CommandRejection?
    private var requestCounter = 0

    /// A fixed start so every fixture is reproducible: 2026-03-02 09:00 local.
    static let defaultStart = Date(timeIntervalSince1970: 1_772_452_800)

    init(start: Date = Harness.defaultStart, uptime: TimeInterval = 3600) {
        wall = StubWallClock(start)
        monotonic = StubMonotonicClock(uptime)
    }

    // MARK: Time

    /// How often the service writes its liveness watermark. Mirrored here so
    /// tests experience the same granularity the real thing will.
    static let heartbeatInterval: TimeInterval = 30

    /// Ordinary time passing: both clocks move by the same amount, and the
    /// service heartbeats along the way exactly as it would in production.
    ///
    /// Stepping rather than jumping matters. A test that jumps an hour with no
    /// heartbeat is testing a process that was hung for an hour, which is a
    /// different scenario from one that was working — and the difference is
    /// precisely what the watermark exists to record.
    func advance(minutes: Double) { advance(seconds: minutes * 60) }

    func advance(seconds: TimeInterval) {
        guard state != nil else {
            wall.advance(seconds)
            monotonic.advance(seconds)
            return
        }

        var left = seconds
        while left > 0 {
            let step = Swift.min(left, Self.heartbeatInterval)
            wall.advance(step)
            monotonic.advance(step)
            left -= step
            heartbeat()
        }
    }

    /// Time passing with the app NOT running. No heartbeats, because nothing is
    /// alive to write one.
    func advanceWhileDown(minutes: Double) { advanceWhileDown(seconds: minutes * 60) }

    func advanceWhileDown(seconds: TimeInterval) {
        wall.advance(seconds)
        monotonic.advance(seconds)
    }

    @discardableResult
    func heartbeat() -> ReduceResult {
        let result = SessionReducer.noteHeartbeat(state, clocks: clocks)
        if result.applied { state = result.state }
        return result
    }

    /// The user drags the system date, or NTP steps it, or DST lands. The wall
    /// clock moves and no real time passes.
    func dragWallClock(by seconds: TimeInterval) {
        wall.set(wall.now.addingTimeInterval(seconds))
    }

    /// The machine reboots: real time passes and the monotonic origin resets, so
    /// stamps from before are no longer comparable to stamps from after.
    func reboot(after seconds: TimeInterval) {
        wall.advance(seconds)
        monotonic.reset(to: 30)
    }

    // MARK: Commands

    @discardableResult
    func send(_ kind: CommandKind, origin: CommandOrigin = .dashboard,
              requestID: RequestID? = nil) -> ReduceResult {
        requestCounter += 1
        let request = requestID ?? RequestID("req-\(requestCounter)")
        let command = Command(requestID: request, origin: origin,
                              issuedAt: wall.now, kind: kind)
        let result = SessionReducer.reduce(state, command, clocks: clocks, dayKeys: dayKeys)
        if result.applied { state = result.state }
        lastRejection = result.rejection
        return result
    }

    /// The app coming back up. Records the downtime marker the way the service
    /// will.
    @discardableResult
    func noteProcessStart(requestID: RequestID? = nil) -> ReduceResult {
        requestCounter += 1
        let request = requestID ?? RequestID("boot-\(requestCounter)")
        let result = SessionReducer.noteProcessStart(state, requestID: request, clocks: clocks)
        if result.applied { state = result.state }
        return result
    }

    @discardableResult
    func completeIfServed(requestID: RequestID? = nil) -> ReduceResult {
        requestCounter += 1
        let request = requestID ?? RequestID("done-\(requestCounter)")
        let result = SessionReducer.completeIfServed(state, requestID: request, clocks: clocks)
        if result.applied { state = result.state }
        return result
    }

    @discardableResult
    func noteClockAnomaly(seconds: TimeInterval) -> ReduceResult {
        requestCounter += 1
        let request = RequestID("anomaly-\(requestCounter)")
        let result = SessionReducer.noteClockAnomaly(state, seconds: seconds,
                                                     requestID: request, clocks: clocks)
        if result.applied { state = result.state }
        return result
    }

    /// Carry out every effect the way an obedient service would: acknowledge
    /// them all. Returns what was acknowledged so a test can assert on it.
    @discardableResult
    func drainEffects() -> [Effect] {
        let effects = now().effects
        for effect in effects {
            send(.acknowledgeEffect(effect.id))
        }
        return effects
    }

    // MARK: Reading

    func now() -> Reconciliation {
        guard let state else {
            fatalError("no session — call start() first")
        }
        return SessionReconciler.reconcile(state, now: ClockStamp(clocks: clocks))
    }

    var status: SessionStatus { now().status }

    // MARK: Fixtures

    /// Deliberately short so a full cycle is legible in a test: 2 minutes focus,
    /// 1 minute rest, 2 minutes focus. The same code path as 50/10/50/10/50.
    static func shortPlan(session: SessionID = SessionID("S1"),
                          clips: [ClipAssignment] = []) -> SessionPlan {
        SessionPlanBuilder.alternating(
            session: session, focusBlocks: 2,
            focus: 2 * 60, rest: 1 * 60,
            clips: clips, task: "write the thing"
        )
    }

    /// The real one.
    static func fullPlan(session: SessionID = SessionID("S1"),
                         clips: [ClipAssignment] = []) -> SessionPlan {
        SessionPlanBuilder.alternating(
            session: session, focusBlocks: 3,
            focus: 50 * 60, rest: 10 * 60,
            clips: clips, task: "write the thing"
        )
    }

    @discardableResult
    func start(_ plan: SessionPlan = Harness.shortPlan()) -> ReduceResult {
        send(.start(plan: plan))
    }

    /// A fixed day-key provider so a test never depends on the machine's time
    /// zone or on what day it is when the suite runs.
    let dayKeys: DayKeyProvider = CutoffDayKeys(cutoffHour: 4, calendar: {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "America/New_York")!
        return calendar
    }())
}

// MARK: - Reading effects in tests

extension Array where Element == Effect {
    func announcement() -> Announcement? {
        for effect in self {
            if case .announce(_, let announcement) = effect { return announcement }
        }
        return nil
    }

    var announcements: [Announcement] {
        compactMap { effect in
            if case .announce(_, let announcement) = effect { return announcement }
            return nil
        }
    }

    var historyRecords: [HistoryRecord] {
        compactMap { effect in
            if case .appendHistory(_, let record) = effect { return record }
            return nil
        }
    }

    var startedClips: [ClipAssignment] {
        compactMap { effect in
            if case .startClip(_, let clip, _) = effect { return clip }
            return nil
        }
    }

    var absences: [TimeInterval] {
        compactMap { effect in
            if case .askAboutAbsence(_, let seconds, _) = effect { return seconds }
            return nil
        }
    }
}
