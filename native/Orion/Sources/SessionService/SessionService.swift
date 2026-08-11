//
//  The single writer.
//
//  Every change to session state and history goes through here. Voice, the
//  dashboard, the Console and scripts are all CLIENTS — they send typed commands
//  and get typed answers back. Nothing else writes the files, and in particular
//  no script starts its own engine when the app is not running: it fails loudly
//  instead. Two writers is the bug this whole shape exists to prevent, and this
//  project has already paid for it once in `health-log.json`.
//
//  What the service actually does, in order, forever:
//
//    1. On launch: load, record that the process started, reconcile.
//    2. On a timer: heartbeat, reconcile, dispatch effects, acknowledge them.
//    3. On a command: reduce, persist, reconcile, dispatch.
//
//  Reconciliation is pure and idempotent, so step 2 and step 3 are the same code
//  and running either one twice changes nothing.
//
//  ENFORCEMENT DOES NOT RUN WHILE THE APP IS TERMINATED. Stated plainly here
//  because it is the honest limit of this design: the session survives being
//  quit — the state file and the derivation see to that — but nothing watches
//  what Nick is doing while nothing is running. Gate 5's sensing has the same
//  limit, and the UI has to say so rather than implying continuous cover.
//

import Foundation
import SessionDomain

// MARK: - Effect delivery

/// Whatever actually speaks, plays and notifies. Kept as a protocol so the
/// service can be tested without any of it existing.
///
/// Every method reports whether it SUCCEEDED, and the service only acknowledges
/// an effect that did. An effect that failed stays pending and is retried on the
/// next pass, which is the whole reason acknowledgement is separate from
/// emission.
public protocol SessionEffectHandler: AnyObject {
    func announce(_ announcement: Announcement) -> Bool
    func startClip(_ clip: ClipAssignment, phaseIndex: Int) -> Bool
    func stopClip() -> Bool
    func askAboutAbsence(seconds: TimeInterval, phaseIndex: Int) -> Bool
    func reportClockAnomaly(seconds: TimeInterval) -> Bool

    /// Make the audio match the session's state.
    ///
    /// Declarative and idempotent rather than a pair of paused/resumed events,
    /// so it can be called on every pass without tracking transitions. Pausing
    /// something already paused is a no-op; the alternative is remembering the
    /// last status somewhere and getting it wrong after a restart.
    func setAudioPaused(_ paused: Bool)
}

/// A handler that does nothing and says it worked. The default until Gate 6
/// wires real speech, so the domain can be driven end to end before anything
/// makes a sound.
public final class NullEffectHandler: SessionEffectHandler {
    public init() {}
    public func announce(_ announcement: Announcement) -> Bool { true }
    public func startClip(_ clip: ClipAssignment, phaseIndex: Int) -> Bool { true }
    public func stopClip() -> Bool { true }
    public func askAboutAbsence(seconds: TimeInterval, phaseIndex: Int) -> Bool { true }
    public func reportClockAnomaly(seconds: TimeInterval) -> Bool { true }
    public func setAudioPaused(_ paused: Bool) {}
}

// MARK: - What a caller gets back

public struct SessionSnapshot: Equatable, Sendable {
    public let session: SessionState?
    public let reconciliation: Reconciliation?

    /// Non-nil when the state file could not be read. Carried rather than
    /// swallowed so callers can show "unreadable" instead of "nothing running".
    public let failure: SessionStoreError?

    public var isRunning: Bool {
        guard let reconciliation else { return false }
        return !reconciliation.isOver && reconciliation.status != .notStarted
    }

    public static let none = SessionSnapshot(session: nil, reconciliation: nil, failure: nil)
}

public struct CommandOutcome: Equatable, Sendable {
    public let accepted: Bool
    public let rejection: CommandRejection?
    public let snapshot: SessionSnapshot

    /// A retry that arrived after the original landed. Success, from the
    /// caller's point of view.
    public var wasDuplicate: Bool { rejection?.isAlreadyApplied ?? false }
}

// MARK: - The service

public final class SessionService {

    public let store: SessionStore
    public let history: SessionHistory

    private let clocks: Clocks
    private let dayKeys: DayKeyProvider
    private weak var effects: SessionEffectHandler?
    private let fallbackEffects = NullEffectHandler()

    /// Serialises everything. The store's file lock defends against another
    /// PROCESS; this defends against this one, where a timer tick and a command
    /// from the socket genuinely do arrive concurrently.
    private let queue = DispatchQueue(label: "com.nickmadaio.orion.session")

    /// The heartbeat runs on its own queue, NOT on the main run loop.
    ///
    /// It used to be a `Timer` on `RunLoop.main` in `.common`, copying the
    /// pattern `ReminderService` uses. That pattern is right for work that has
    /// to touch the UI and wrong for this: a heartbeat writes a file and
    /// dispatches effects, none of which needs the main thread, and depending
    /// on the main run loop means anything that blocks it — a modal sheet, a
    /// long layout pass, a launch context where the run loop is not pumping —
    /// silently stops the session's clock. That was not theoretical: a session
    /// verified end to end ran its full five minutes without a single heartbeat
    /// or phase announcement, because every main-run-loop timer in the process
    /// was dead while the socket on its own thread kept answering.
    ///
    /// A dispatch timer cannot be starved that way. Its own queue, separate
    /// from `queue`, so `tick()`'s `queue.sync` is not a deadlock.
    private let timerQueue = DispatchQueue(label: "com.nickmadaio.orion.session.timer")
    private var timer: DispatchSourceTimer?

    /// How often the liveness watermark is written.
    ///
    /// Required, not optional: the domain bounds what a crash costs to exactly
    /// one of these intervals, and without them every crash is charged the
    /// maximum — a crash at minute 49 of a 50-minute block would void the block.
    public static let heartbeatInterval: TimeInterval = 30

    /// Observers of state changes, for the UI. Called on the main thread.
    public var onChange: ((SessionSnapshot) -> Void)?

    public init(store: SessionStore = SessionStore(),
                history: SessionHistory = SessionHistory(),
                clocks: Clocks = .system,
                dayKeys: DayKeyProvider = CutoffDayKeys(),
                effects: SessionEffectHandler? = nil) {
        self.store = store
        self.history = history
        self.clocks = clocks
        self.dayKeys = dayKeys
        self.effects = effects
    }

    deinit { timer?.cancel() }

    // MARK: Lifecycle

    /// Call once, at launch, before anything else touches the session.
    ///
    /// Records `processStarted` so the gap since the last heartbeat is treated
    /// as downtime rather than counted as focus.
    @discardableResult
    public func start() -> SessionSnapshot {
        let snapshot = queue.sync { () -> SessionSnapshot in
            do {
                try store.mutate { document in
                    guard let session = document.session, !session.isFinished else { return nil }
                    let result = SessionReducer.noteProcessStart(
                        session,
                        requestID: RequestID("boot-\(Int(clocks.wall.now.timeIntervalSince1970))"),
                        clocks: clocks
                    )
                    guard result.applied, let next = result.state else { return nil }
                    return SessionDocument(session: next)
                }
            } catch {
                // A state file that cannot be read must not stop the app from
                // starting, and must not be overwritten either. Report and
                // leave it exactly where it is.
                return snapshotUnlocked()
            }
            return pumpUnlocked()
        }

        startTimer()
        publish(snapshot)
        return snapshot
    }

    public func stop() {
        timer?.cancel()
        timer = nil
    }

    private func startTimer() {
        timer?.cancel()
        let source = DispatchSource.makeTimerSource(queue: timerQueue)
        // Leeway because nothing here is deadline-sensitive: the derivation is
        // computed from timestamps, so a heartbeat arriving a second late costs
        // nothing and letting the system coalesce wakeups costs less battery.
        source.schedule(deadline: .now() + Self.heartbeatInterval,
                        repeating: Self.heartbeatInterval,
                        leeway: .seconds(2))
        source.setEventHandler { [weak self] in self?.tick() }
        source.resume()
        timer = source
    }

    /// One heartbeat plus one reconciliation. Safe to call as often as anyone
    /// likes; it is idempotent by construction.
    public func tick() {
        let snapshot = queue.sync { () -> SessionSnapshot in
            _ = try? store.mutate { document in
                guard let session = document.session, !session.isFinished else { return nil }
                let result = SessionReducer.noteHeartbeat(session, clocks: clocks)
                guard result.applied, let next = result.state else { return nil }
                return SessionDocument(session: next)
            }
            return pumpUnlocked()
        }
        publish(snapshot)
    }

    // MARK: Commands

    /// The one entry point for changing anything.
    @discardableResult
    public func send(_ command: Command) -> CommandOutcome {
        let outcome = queue.sync { () -> CommandOutcome in
            var rejection: CommandRejection?

            do {
                try store.mutate { document in
                    let result = SessionReducer.reduce(document.session, command,
                                                       clocks: clocks, dayKeys: dayKeys)
                    rejection = result.rejection
                    guard result.applied else { return nil }
                    return SessionDocument(session: result.state)
                }
            } catch let error as SessionStoreError {
                return CommandOutcome(
                    accepted: false,
                    rejection: .notApplicable(error.message),
                    snapshot: SessionSnapshot(session: nil, reconciliation: nil, failure: error)
                )
            } catch {
                return CommandOutcome(
                    accepted: false,
                    rejection: .notApplicable(error.localizedDescription),
                    snapshot: snapshotUnlocked()
                )
            }

            let snapshot = pumpUnlocked()
            return CommandOutcome(accepted: rejection == nil, rejection: rejection,
                                  snapshot: snapshot)
        }
        publish(outcome.snapshot)
        return outcome
    }

    public func snapshot() -> SessionSnapshot {
        queue.sync { snapshotUnlocked() }
    }

    // MARK: The pump

    /// Reconcile, carry out whatever that produced, acknowledge what worked.
    ///
    /// Runs until it stops producing new work, because carrying out an effect
    /// can change the answer — completing a served session writes the terminal
    /// event, which produces the history effect. Bounded because a handler that
    /// always fails would otherwise spin.
    private func pumpUnlocked() -> SessionSnapshot {
        var snapshot = snapshotUnlocked()

        for _ in 0..<4 {
            guard let session = snapshot.session,
                  let reconciliation = snapshot.reconciliation else { return snapshot }

            // A session whose time is fully served gets its terminal event from
            // the reducer, so the log stays the single record of what happened
            // rather than the arithmetic implying it.
            if reconciliation.status == .readyToComplete {
                _ = try? store.mutate { document in
                    let result = SessionReducer.completeIfServed(
                        document.session,
                        requestID: RequestID("complete-\(session.id.raw)"),
                        clocks: clocks
                    )
                    guard result.applied, let next = result.state,
                          next != document.session else { return nil }
                    return SessionDocument(session: next)
                }
                snapshot = snapshotUnlocked()
                continue
            }

            let handler = effects ?? fallbackEffects

            // Audio follows the session's state on every pass, whether or not
            // there are effects to dispatch — a pause produces no effect, and
            // the clip still has to stop.
            handler.setAudioPaused(reconciliation.status == .paused
                                   || reconciliation.status.isOver)

            guard !reconciliation.effects.isEmpty else { return snapshot }
            var acknowledged: [EffectID] = []

            for effect in reconciliation.effects {
                let done: Bool
                switch effect {
                case .announce(_, let announcement):
                    done = handler.announce(announcement)
                case .startClip(_, let clip, let index):
                    done = handler.startClip(clip, phaseIndex: index)
                case .stopClip:
                    done = handler.stopClip()
                case .askAboutAbsence(_, let seconds, let index):
                    done = handler.askAboutAbsence(seconds: seconds, phaseIndex: index)
                case .reportClockAnomaly(_, let seconds):
                    done = handler.reportClockAnomaly(seconds: seconds)
                case .appendHistory(_, let record):
                    // The append is itself idempotent by session id, so a crash
                    // between writing the line and recording the acknowledgement
                    // cannot produce a second one.
                    done = (try? history.append(record)) != nil
                }
                if done { acknowledged.append(effect.id) }
            }

            guard !acknowledged.isEmpty else { return snapshot }

            _ = try? store.mutate { document in
                guard var next = document.session else { return nil }
                for effect in acknowledged { next = next.acknowledging(effect) }
                guard next != document.session else { return nil }
                return SessionDocument(session: next)
            }
            snapshot = snapshotUnlocked()
        }

        return snapshot
    }

    private func snapshotUnlocked() -> SessionSnapshot {
        let (document, failure) = store.loadForDisplay()
        guard let session = document.session else {
            return SessionSnapshot(session: nil, reconciliation: nil, failure: failure)
        }
        let reconciliation = SessionReconciler.reconcile(session,
                                                         now: ClockStamp(clocks: clocks))
        return SessionSnapshot(session: session, reconciliation: reconciliation, failure: failure)
    }

    private func publish(_ snapshot: SessionSnapshot) {
        guard let onChange else { return }
        if Thread.isMainThread {
            onChange(snapshot)
        } else {
            DispatchQueue.main.async { onChange(snapshot) }
        }
    }
}
