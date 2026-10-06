//
//  The only thing that turns a command into a new state.
//
//  Pure, total, and deterministic: same state plus same command plus same clock
//  reading gives the same result, always. It never throws — a command that does
//  not apply comes back as a typed rejection, because the caller has to be able
//  to tell "you already did that" from "that is not possible now", and the first
//  of those is success.
//
//  Idempotency is checked FIRST, before anything else, including before the
//  checks that would reject the command. A retry of `finishEarly` on a finished
//  session must come back as `alreadyApplied`, not as `sessionFinished` — the
//  caller did succeed, they just did not hear about it the first time.
//

import Foundation

// MARK: - Result

public struct ReduceResult: Equatable, Sendable {
    public let state: SessionState?
    public let rejection: CommandRejection?

    public var applied: Bool { rejection == nil }

    /// True when the command did not change anything but the caller should
    /// treat it as success — a retry that arrived after the first one landed.
    public var wasDuplicate: Bool { rejection?.isAlreadyApplied ?? false }

    static func ok(_ state: SessionState?) -> ReduceResult {
        ReduceResult(state: state, rejection: nil)
    }

    static func no(_ rejection: CommandRejection, keeping state: SessionState?) -> ReduceResult {
        ReduceResult(state: state, rejection: rejection)
    }
}

// MARK: - Reducer

public enum SessionReducer {

    /// How far the wall clock has to move, against the monotonic clock, before
    /// it is treated as having been changed rather than having drifted.
    ///
    /// Two minutes: far more than NTP ever corrects in one step during a
    /// session, far less than a time-zone change or a user dragging the date.
    public static let clockAnomalyThreshold: TimeInterval = 120

    public static func reduce(_ state: SessionState?,
                              _ command: Command,
                              clocks: Clocks,
                              dayKeys: DayKeyProvider = CutoffDayKeys()) -> ReduceResult {

        let stamp = ClockStamp(clocks: clocks)

        // Idempotency first, always. See the header.
        if let state, state.events.contains(request: command.requestID) {
            return .no(.alreadyApplied(command.requestID), keeping: state)
        }
        if let state, case .acknowledgeEffect(let effect) = command.kind,
           state.hasAcknowledged(effect) {
            return .no(.alreadyApplied(command.requestID), keeping: state)
        }

        switch command.kind {

        case .start(let plan):
            if let state, !state.isFinished {
                return .no(.sessionAlreadyRunning(state.id), keeping: state)
            }
            if let invalid = validate(plan) {
                return .no(.invalidPlan(invalid), keeping: state)
            }

            // The day is fixed at start and never recomputed. A session that
            // runs across the 4 am boundary belongs to the day it began in;
            // recomputing would move a running session between days.
            let fresh = SessionState(
                id: plan.sessionID,
                dayKey: dayKeys.key(at: stamp.wall),
                plan: plan,
                events: [LifecycleEvent(id: command.requestID.raw, stamp: stamp, kind: .started)]
            )
            return .ok(fresh)

        case .acknowledgeEffect(let effect):
            guard let state else { return .no(.noSession, keeping: nil) }
            return .ok(state.acknowledging(effect))

        case .pause:
            return append(.paused, to: state, command: command, stamp: stamp,
                          requiring: { status in
                              guard case .running = status else {
                                  return "Nothing is running to pause."
                              }
                              return nil
                          })

        case .resume:
            return append(.resumed, to: state, command: command, stamp: stamp,
                          requiring: { status in
                              guard status == .paused else { return "The session is not paused." }
                              return nil
                          })

        case .noteIdle:
            return append(.idleBegan, to: state, command: command, stamp: stamp,
                          requiring: { _ in nil })

        case .noteReturned:
            return append(.idleEnded, to: state, command: command, stamp: stamp,
                          requiring: { _ in nil })

        case .skipRest:
            return shortenRest(state, command: command, stamp: stamp, remaining: 0)

        case .shortenRest(let remaining):
            return shortenRest(state, command: command, stamp: stamp, remaining: remaining)

        case .finishEarly:
            return finish(state, reason: .early, command: command, stamp: stamp)

        case .abandon:
            return finish(state, reason: .abandoned, command: command, stamp: stamp)
        }
    }

    /// The service calls this on launch, before anything else, so the gap since
    /// the last event is recorded as downtime rather than counted as focus.
    public static func noteProcessStart(_ state: SessionState?,
                                        requestID: RequestID,
                                        clocks: Clocks) -> ReduceResult {
        guard let state else { return .ok(nil) }
        guard !state.isFinished else { return .ok(state) }
        if state.events.contains(request: requestID) {
            return .no(.alreadyApplied(requestID), keeping: state)
        }
        let stamp = ClockStamp(clocks: clocks)
        return .ok(state.appending(
            LifecycleEvent(id: requestID.raw, stamp: stamp, kind: .processStarted)
        ))
    }

    /// The service's liveness watermark, written on a timer while a session
    /// runs. Bounds how much of a crash gap has to be written off as downtime:
    /// at most one heartbeat interval, instead of everything since the last
    /// thing Nick happened to do.
    public static func noteHeartbeat(_ state: SessionState?,
                                     clocks: Clocks) -> ReduceResult {
        guard let state, !state.isFinished else { return .ok(state) }
        let stamp = ClockStamp(clocks: clocks)
        // Derived from the stamp rather than random, so replaying a heartbeat
        // is a no-op rather than a new event.
        let eventID = "alive-\(Int(stamp.wall.timeIntervalSince1970))"
        return .ok(state.heartbeating(eventID: eventID, stamp: stamp))
    }

    /// Record that the wall clock moved by an amount that is not real elapsed
    /// time. Detected by the service comparing the two clocks between ticks;
    /// recorded here so the archive can say the numbers were adjusted.
    public static func noteClockAnomaly(_ state: SessionState?,
                                        seconds: TimeInterval,
                                        requestID: RequestID,
                                        clocks: Clocks) -> ReduceResult {
        guard let state, !state.isFinished else { return .ok(state) }
        guard abs(seconds) >= clockAnomalyThreshold else { return .ok(state) }
        if state.events.contains(request: requestID) {
            return .no(.alreadyApplied(requestID), keeping: state)
        }
        let stamp = ClockStamp(clocks: clocks)
        return .ok(state.appending(
            LifecycleEvent(id: requestID.raw, stamp: stamp, kind: .clockAnomaly(seconds: seconds))
        ))
    }

    // MARK: Helpers

    private static func append(_ kind: EventKind,
                               to state: SessionState?,
                               command: Command,
                               stamp: ClockStamp,
                               requiring check: (SessionStatus) -> String?) -> ReduceResult {
        guard let state else { return .no(.noSession, keeping: nil) }
        guard !state.isFinished else { return .no(.sessionFinished(state.id), keeping: state) }

        let now = SessionReconciler.reconcile(state, now: stamp)
        if let complaint = check(now.status) {
            return .no(.notApplicable(complaint), keeping: state)
        }

        return .ok(state.appending(
            LifecycleEvent(id: command.requestID.raw, stamp: stamp, kind: kind)
        ))
    }

    /// Shortening is expressed as a NEW TOTAL for the phase, computed here from
    /// how much has already been served. Storing the total rather than the
    /// remaining time means `reconcile` does not have to know when the command
    /// arrived in order to apply it — the arithmetic stays a pure function of
    /// the log.
    private static func shortenRest(_ state: SessionState?,
                                    command: Command,
                                    stamp: ClockStamp,
                                    remaining: TimeInterval) -> ReduceResult {
        guard let state else { return .no(.noSession, keeping: nil) }
        guard !state.isFinished else { return .no(.sessionFinished(state.id), keeping: state) }

        let now = SessionReconciler.reconcile(state, now: stamp)
        guard case .running(let kind) = now.status, kind == .rest else {
            return .no(.notApplicable("There is no break running to shorten."), keeping: state)
        }

        // Never longer than what is left: "shorten" that lengthens is how ending
        // a break turned two minutes into six (6 Oct 2026).
        let leave = max(0, remaining)
        guard leave < now.remainingInPhase else {
            return .no(.notApplicable("The break already has less than that left."), keeping: state)
        }
        let newTotal = now.servedInPhase + leave
        return .ok(state.appending(LifecycleEvent(
            id: command.requestID.raw,
            stamp: stamp,
            kind: .restShortened(index: now.phaseIndex, to: newTotal)
        )))
    }

    private static func finish(_ state: SessionState?,
                               reason: FinishReason,
                               command: Command,
                               stamp: ClockStamp) -> ReduceResult {
        guard let state else { return .no(.noSession, keeping: nil) }
        guard !state.isFinished else { return .no(.sessionFinished(state.id), keeping: state) }
        return .ok(state.appending(
            LifecycleEvent(id: command.requestID.raw, stamp: stamp, kind: .finished(reason))
        ))
    }

    /// Called by the service when `reconcile` reports `readyToComplete`, so the
    /// terminal event is written by the same single writer as everything else
    /// rather than being implied by arithmetic.
    public static func completeIfServed(_ state: SessionState?,
                                        requestID: RequestID,
                                        clocks: Clocks) -> ReduceResult {
        guard let state, !state.isFinished else { return .ok(state) }
        let stamp = ClockStamp(clocks: clocks)
        guard SessionReconciler.reconcile(state, now: stamp).status == .readyToComplete else {
            return .ok(state)
        }
        if state.events.contains(request: requestID) {
            return .no(.alreadyApplied(requestID), keeping: state)
        }
        return .ok(state.appending(
            LifecycleEvent(id: requestID.raw, stamp: stamp, kind: .finished(.completed))
        ))
    }

    /// Archive a session nobody is coming back to.
    ///
    /// The exact shape of `completeIfServed`, and for the same reason: the
    /// terminal event comes from the reducer so the log stays the single record
    /// of what happened, rather than the arithmetic quietly implying it. The
    /// reason is `.abandoned` because that is what it was -- walked away from --
    /// and `FinishReason.isSuccess` is false for it, so a stale session never
    /// counts as a completed one in the day score.
    public static func abandonIfStale(_ state: SessionState?,
                                      requestID: RequestID,
                                      clocks: Clocks) -> ReduceResult {
        guard let state, !state.isFinished else { return .ok(state) }
        let stamp = ClockStamp(clocks: clocks)
        guard SessionReconciler.reconcile(state, now: stamp).status == .readyToAbandon else {
            return .ok(state)
        }
        if state.events.contains(request: requestID) {
            return .no(.alreadyApplied(requestID), keeping: state)
        }
        return .ok(state.appending(
            LifecycleEvent(id: requestID.raw, stamp: stamp, kind: .finished(.abandoned))
        ))
    }

    private static func validate(_ plan: SessionPlan) -> String? {
        if plan.phases.isEmpty { return "it has no phases" }
        if !plan.phases.contains(where: \.kind.isFocus) { return "it has no focus block" }
        if plan.phases.contains(where: { $0.plannedDuration <= 0 }) {
            return "a phase has no duration"
        }
        for (position, phase) in plan.phases.enumerated() where phase.index != position {
            return "phase \(position) is indexed as \(phase.index)"
        }
        return nil
    }
}
