//
//  Where the session actually is, worked out from first principles every time.
//
//  `reconcile(now:)` is a pure function of (plan, event log, now). It stores
//  nothing, caches nothing and is safe to call as often as anyone likes. Given
//  the same inputs it always produces the same answer, which is what makes the
//  adversarial cases — DST, a dragged clock, a crash mid-phase, a lid closed
//  for three hours — testable as data rather than as timing.
//
//  The method is a walk over segments. Two consecutive events bound a segment;
//  so do the last event and `now`. Each segment knows how long it lasted, how
//  that was measured, and whether it counts. Then the segments are poured into
//  the plan's phases in order, filling each one until it is full and spilling
//  the remainder into the next.
//
//  The policies that live here, all four fixed by the plan:
//
//    • Window close is a no-op. There is no event for it, so it cannot affect
//      anything. Closing the dashboard is not leaving the session.
//    • App termination does not count as focus. The gap before a
//      `processStarted` event is downtime, full stop.
//    • A long gap prompts rather than counting. The domain never decides what
//      an absence was; it asks.
//    • A break ending while Nick is away enters `waitingForReturn` and STAYS
//      waiting. It does not roll into a focus block behind his back.
//

import Foundation

// MARK: - Status

public enum SessionStatus: Equatable, Sendable {
    case notStarted
    case running(PhaseKind)
    case paused

    /// A rest phase finished while nobody was here. Holding at the start of the
    /// next focus block until he comes back.
    case waitingForReturn(afterRestIndex: Int)

    /// Every phase has been served but nothing has archived it yet. The service
    /// turns this into a `finish` command, so the event log stays the record.
    case readyToComplete

    case finished(FinishReason)

    public var isOver: Bool {
        if case .finished = self { return true }
        return false
    }

    /// Something a person can read.
    ///
    /// Exists because the default enum description leaks the module and the
    /// case payload — "running(SessionDomain.PhaseKind.focus)" went into the app
    /// log for a while and told nobody anything.
    public var label: String {
        switch self {
        case .notStarted: return "not started"
        case .running(let kind): return kind.isFocus ? "focus" : "break"
        case .paused: return "paused"
        case .waitingForReturn: return "waiting for him to come back"
        case .readyToComplete: return "finishing"
        case .finished(let reason): return "finished (\(reason.rawValue))"
        }
    }
}

// MARK: - The answer

public struct Reconciliation: Equatable, Sendable {
    public let status: SessionStatus

    /// The phase in effect. Clamped to the last phase once everything is served.
    public let phaseIndex: Int
    public let phase: PhaseDefinition?

    public let servedInPhase: TimeInterval
    public let remainingInPhase: TimeInterval

    public let servedFocus: TimeInterval
    public let servedRest: TimeInterval

    /// Time that deliberately did not count: downtime, absences, paused stretches
    /// and time spent waiting for him to come back.
    public let uncounted: TimeInterval

    public let completedFocusBlocks: Int
    public let totalFocusBlocks: Int

    /// True when any counted stretch had to be measured on the wall clock, or
    /// the clock moved. Makes an estimate legible as an estimate.
    public let approximate: Bool

    /// Already filtered against the acknowledgement set. Carrying these out is
    /// the service's job; producing them is this function's.
    public let effects: [Effect]

    public var isOver: Bool { status.isOver }
}

// MARK: - Segments

private struct Segment {
    let duration: TimeInterval
    let source: Elapsed.Source

    /// Nick pressed pause. Deliberate, so it never prompts.
    let paused: Bool

    /// The app was not running. Not deliberate, so a long one does prompt.
    let downtime: Bool

    let idle: Bool

    /// Where the segment ended, used to name absence effects stably.
    let endWall: Date

    var counts: Bool { !paused && !downtime }
}

// MARK: - Reconciliation

public enum SessionReconciler {

    /// A gap this long, in time that was not counted, is worth asking about
    /// rather than absorbing silently.
    public static let longAbsenceThreshold: TimeInterval = 10 * 60

    public static func reconcile(_ state: SessionState, now: ClockStamp) -> Reconciliation {
        let plan = state.plan
        let totalFocusBlocks = plan.phases.filter(\.kind.isFocus).count

        guard let startEvent = state.events.first(where: { $0.kind == .started }) else {
            return Reconciliation(
                status: .notStarted, phaseIndex: 0, phase: plan.phase(at: 0),
                servedInPhase: 0, remainingInPhase: plan.phase(at: 0)?.plannedDuration ?? 0,
                servedFocus: 0, servedRest: 0, uncounted: 0,
                completedFocusBlocks: 0, totalFocusBlocks: totalFocusBlocks,
                approximate: false, effects: []
            )
        }

        let segments = buildSegments(state: state, from: startEvent, now: now)
        let overrides = restOverrides(in: state.events)

        var walk = Walk(plan: plan, overrides: overrides)
        for segment in segments { walk.consume(segment) }

        // A recorded terminal event always wins over anything derived. The
        // session ended when Nick said it ended, not when the arithmetic ran out.
        let recordedFinish = state.events.finish

        let status: SessionStatus = {
            if let recordedFinish { return .finished(recordedFinish.reason) }
            if walk.everythingServed { return .readyToComplete }
            if walk.waitingForReturn { return .waitingForReturn(afterRestIndex: walk.heldAfterRest) }
            if walk.paused { return .paused }
            return .running(plan.phase(at: walk.phaseIndex)?.kind ?? .focus)
        }()

        let index = min(walk.phaseIndex, plan.lastIndex)
        let phase = plan.phase(at: index)
        let effectiveTotal = phase.map { walk.effectiveDuration(of: $0) } ?? 0

        let approximate = walk.usedWallClock
            || state.events.contains { if case .clockAnomaly = $0.kind { return true }; return false }

        let effects = buildEffects(
            state: state, status: status, walk: walk,
            phaseIndex: index, startedAt: startEvent.at, now: now,
            approximate: approximate, totalFocusBlocks: totalFocusBlocks
        )

        return Reconciliation(
            status: status,
            phaseIndex: index,
            phase: phase,
            servedInPhase: walk.servedInPhase,
            remainingInPhase: max(0, effectiveTotal - walk.servedInPhase),
            servedFocus: walk.servedFocus,
            servedRest: walk.servedRest,
            uncounted: walk.uncounted,
            completedFocusBlocks: walk.completedFocusBlocks,
            totalFocusBlocks: totalFocusBlocks,
            approximate: approximate,
            effects: effects.filter { !state.hasAcknowledged($0.id) }
        )
    }

    // MARK: Building segments

    private static func buildSegments(state: SessionState,
                                      from startEvent: LifecycleEvent,
                                      now: ClockStamp) -> [Segment] {
        var segments: [Segment] = []
        var paused = false
        var idle = false
        var previous = startEvent.stamp

        // Events strictly after the start event, in order.
        guard let startIndex = state.events.firstIndex(where: { $0.id == startEvent.id }) else {
            return []
        }
        let rest = Array(state.events[(startIndex + 1)...])

        for event in rest {
            let elapsed = event.stamp.elapsed(since: previous)

            // The gap BEFORE a processStarted event is time the app was not
            // running. It is measured, reported, and not counted.
            let isDowntime = event.kind == .processStarted

            segments.append(Segment(
                duration: elapsed.seconds,
                source: elapsed.source,
                paused: paused,
                downtime: isDowntime,
                idle: idle,
                endWall: event.stamp.wall
            ))

            switch event.kind {
            case .paused:   paused = true
            case .resumed:  paused = false
            case .idleBegan: idle = true
            case .idleEnded: idle = false
            case .finished:
                // Nothing after the terminal event counts.
                return segments
            default: break
            }

            previous = event.stamp
        }

        let tail = now.elapsed(since: previous)
        segments.append(Segment(
            duration: tail.seconds,
            source: tail.source,
            paused: paused,
            downtime: false,
            idle: idle,
            endWall: now.wall
        ))

        return segments
    }

    /// The latest shortened total for each rest phase. Later commands win, which
    /// is what lets a break be shortened twice.
    private static func restOverrides(in events: [LifecycleEvent]) -> [Int: TimeInterval] {
        var overrides: [Int: TimeInterval] = [:]
        for event in events {
            if case .restShortened(let index, let total) = event.kind {
                overrides[index] = max(0, total)
            }
        }
        return overrides
    }

    // MARK: Effects

    private static func buildEffects(state: SessionState,
                                     status: SessionStatus,
                                     walk: Walk,
                                     phaseIndex: Int,
                                     startedAt: Date,
                                     now: ClockStamp,
                                     approximate: Bool,
                                     totalFocusBlocks: Int) -> [Effect] {
        var effects: [Effect] = []
        let session = state.id
        let plan = state.plan

        // Absences first: they are about the past and stay relevant whatever the
        // current status is.
        for absence in walk.absences where absence.seconds >= longAbsenceThreshold {
            effects.append(.askAboutAbsence(
                id: EffectID(session: session, phaseIndex: absence.phaseIndex,
                             kind: "\(EffectKindName.absence)@\(Int(absence.endWall.timeIntervalSince1970))"),
                seconds: absence.seconds,
                phaseIndex: absence.phaseIndex
            ))
        }

        for event in state.events {
            if case .clockAnomaly(let seconds) = event.kind {
                effects.append(.reportClockAnomaly(
                    id: EffectID(session: session, kind: "\(EffectKindName.clockAnomaly)@\(event.id)"),
                    seconds: seconds
                ))
            }
        }

        switch status {
        case .notStarted:
            break

        case .running(let kind):
            // Only ever the CURRENT phase. An announcement for a phase that has
            // already been overtaken — because the app was shut for an hour — is
            // stale, and re-emitting it would have Orion narrate a break that
            // finished while he was not running.
            guard let phase = plan.phase(at: phaseIndex) else { break }

            let announcement: Announcement = kind.isFocus
                ? .focusBeginning(
                    blockNumber: walk.focusBlockNumber(for: phaseIndex, in: plan),
                    ofBlocks: totalFocusBlocks,
                    minutes: Int((walk.effectiveDuration(of: phase) / 60).rounded()))
                : .restBeginning(minutes: Int((walk.effectiveDuration(of: phase) / 60).rounded()))

            effects.append(.announce(
                id: EffectID(session: session, phaseIndex: phaseIndex,
                             kind: EffectKindName.phaseAnnounce),
                announcement
            ))

            if let clip = phase.clip {
                effects.append(.startClip(
                    id: EffectID(session: session, phaseIndex: phaseIndex,
                                 kind: EffectKindName.phaseClip),
                    clip: clip, phaseIndex: phaseIndex
                ))
            } else {
                effects.append(.stopClip(
                    id: EffectID(session: session, phaseIndex: phaseIndex,
                                 kind: EffectKindName.clipStop)
                ))
            }

        case .paused:
            break

        case .waitingForReturn(let afterRestIndex):
            effects.append(.announce(
                id: EffectID(session: session, phaseIndex: afterRestIndex,
                             kind: EffectKindName.waitingForReturn),
                .waitingForReturn
            ))

        case .readyToComplete:
            effects.append(.announce(
                id: EffectID(session: session, kind: EffectKindName.finishAnnounce),
                .sessionComplete(focusMinutes: Int((walk.servedFocus / 60).rounded()))
            ))
            effects.append(.stopClip(
                id: EffectID(session: session, kind: EffectKindName.clipStop)
            ))

        case .finished(let reason):
            effects.append(.stopClip(
                id: EffectID(session: session, kind: EffectKindName.clipStop)
            ))
            if reason == .early {
                effects.append(.announce(
                    id: EffectID(session: session, kind: EffectKindName.finishAnnounce),
                    .sessionEndedEarly(focusMinutes: Int((walk.servedFocus / 60).rounded()))
                ))
            }

            // Exactly one history record per session, ever. The id has no phase
            // component precisely so a second one is impossible to name.
            let endedAt = state.events.finish?.event.at ?? now.wall
            effects.append(.appendHistory(
                id: EffectID(session: session, kind: EffectKindName.history),
                HistoryRecord(
                    sessionID: session.raw,
                    dayKey: state.dayKey,
                    task: plan.task,
                    startedAt: startedAt,
                    endedAt: endedAt,
                    reason: reason,
                    plannedFocusSeconds: plan.focusDuration,
                    servedFocusSeconds: walk.servedFocus,
                    plannedRestSeconds: plan.totalPlannedDuration - plan.focusDuration,
                    servedRestSeconds: walk.servedRest,
                    completedFocusBlocks: walk.completedFocusBlocks,
                    totalFocusBlocks: totalFocusBlocks,
                    uncountedSeconds: walk.uncounted,
                    approximate: approximate
                )
            ))
        }

        return effects
    }
}

// MARK: - The walk

/// Pours segments into phases. Kept as a struct with explicit state rather than
/// a fold, because every one of these fields is something a test asserts on and
/// they are easier to reason about named.
private struct Walk {
    let plan: SessionPlan
    let overrides: [Int: TimeInterval]

    var phaseIndex = 0
    var servedInPhase: TimeInterval = 0
    var servedFocus: TimeInterval = 0
    var servedRest: TimeInterval = 0
    var uncounted: TimeInterval = 0
    var completedFocusBlocks = 0
    var usedWallClock = false
    var paused = false
    var waitingForReturn = false
    var heldAfterRest = 0
    var everythingServed = false

    struct Absence { let seconds: TimeInterval; let phaseIndex: Int; let endWall: Date }
    var absences: [Absence] = []

    init(plan: SessionPlan, overrides: [Int: TimeInterval]) {
        self.plan = plan
        self.overrides = overrides
    }

    func effectiveDuration(of phase: PhaseDefinition) -> TimeInterval {
        overrides[phase.index] ?? phase.plannedDuration
    }

    func focusBlockNumber(for index: Int, in plan: SessionPlan) -> Int {
        plan.phases.prefix(through: min(index, plan.lastIndex))
            .filter(\.kind.isFocus).count
    }

    mutating func consume(_ segment: Segment) {
        // Coming back clears the hold. This is the only thing that does.
        if waitingForReturn && !segment.idle { waitingForReturn = false }

        guard !everythingServed else {
            uncounted += segment.duration
            return
        }

        paused = segment.paused

        if !segment.counts {
            uncounted += segment.duration
            // Only downtime prompts. A pause is a decision Nick made on purpose,
            // and asking him to account for time he deliberately stopped the
            // clock on would be nagging, not bookkeeping.
            if segment.downtime {
                absences.append(Absence(seconds: segment.duration,
                                        phaseIndex: min(phaseIndex, plan.lastIndex),
                                        endWall: segment.endWall))
            }
            return
        }

        if waitingForReturn {
            uncounted += segment.duration
            return
        }

        if segment.source != .monotonic { usedWallClock = true }

        var remaining = segment.duration
        while remaining > 0 {
            guard phaseIndex <= plan.lastIndex, let phase = plan.phase(at: phaseIndex) else {
                everythingServed = true
                uncounted += remaining
                return
            }

            let total = effectiveDuration(of: phase)
            let need = max(0, total - servedInPhase)

            if remaining < need {
                servedInPhase += remaining
                accumulate(phase.kind, remaining)
                remaining = 0
                continue
            }

            servedInPhase += need
            accumulate(phase.kind, need)
            remaining -= need

            if phase.kind.isFocus { completedFocusBlocks += 1 }

            // A break that ends while nobody is here does not roll into focus.
            if !phase.kind.isFocus && segment.idle {
                waitingForReturn = true
                heldAfterRest = phase.index
                phaseIndex += 1
                servedInPhase = 0
                uncounted += remaining
                return
            }

            phaseIndex += 1
            servedInPhase = 0

            if phaseIndex > plan.lastIndex {
                everythingServed = true
                uncounted += remaining
                return
            }
        }
    }

    private mutating func accumulate(_ kind: PhaseKind, _ seconds: TimeInterval) {
        if kind.isFocus { servedFocus += seconds } else { servedRest += seconds }
    }
}
