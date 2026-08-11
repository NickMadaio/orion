//
//  When to say something, how hard, and when to stop.
//
//  Pure. It takes an observation and the history of what has already been said,
//  and returns what to do next. No sensors, no speech, no timers — which is
//  what makes "does it stop nagging after six" a test rather than a thing you
//  find out by living with it for an hour.
//
//  THE HONEST CLAIM, and the UI must say this rather than implying more:
//  Orion detects switching to a DISALLOWED APP, and extended INACTIVITY.
//  It cannot see drift inside an allowed app — reading forums in the browser
//  you approved, or scrolling in the IDE, is invisible to it, and no amount of
//  camera or frontmost-app sensing changes that. Claiming otherwise would be
//  the more damaging lie, because it is the kind of drift that actually happens.
//
//  Two levels only. Gentle and Firm. Anything harsher was deferred to Gate 10
//  behind its own permission, and nothing here quits an app or takes a screen.
//

import Foundation

// MARK: - Levels

public enum EnforcementLevel: String, Codable, Sendable, CaseIterable {
    /// Say something once when he drifts, then leave him alone.
    case gentle
    /// Keep escalating, up to the cap.
    case firm

    public var escalates: Bool { self == .firm }
}

// MARK: - What the sensors saw

public struct Observation: Equatable, Sendable {
    /// Bundle identifier of whatever is frontmost, or nil when nothing could be
    /// read — which is a real state and not the same as "he is on task".
    public let frontmostBundleID: String?
    public let frontmostName: String?

    /// How long since the last keyboard or mouse event.
    public let idleFor: TimeInterval

    /// The screen is locked or asleep. Not drift: he is plainly not at the desk,
    /// and shouting at a locked screen helps nobody.
    public let screenLocked: Bool

    public init(frontmostBundleID: String?, frontmostName: String?,
                idleFor: TimeInterval, screenLocked: Bool) {
        self.frontmostBundleID = frontmostBundleID
        self.frontmostName = frontmostName
        self.idleFor = idleFor
        self.screenLocked = screenLocked
    }
}

// MARK: - The allowlist

/// Which apps count as working, for this session.
///
/// The model may PROPOSE one; it never silently authorizes it. Preflight shows
/// the inferred list and Nick confirms it, which is why `confirmed` exists as a
/// field rather than being assumed — an unconfirmed allowlist enforces nothing.
public struct Allowlist: Codable, Equatable, Sendable {
    public let bundleIDs: Set<String>
    public let confirmed: Bool

    /// Apps that are never a distraction, whatever the session says.
    ///
    /// Orion has to stay reachable, and locking somebody out of Finder or their
    /// password manager is not enforcement, it is just cruelty. Matches
    /// `scripts/orion-focus`, which learned this first.
    public static let alwaysAllowed: Set<String> = [
        "com.nickmadaio.orion.app",
        "com.apple.finder",
        "com.apple.loginwindow",
        "com.1password.1password",
        "com.apple.systempreferences",
        "com.apple.SecurityAgent"
    ]

    public init(bundleIDs: Set<String>, confirmed: Bool = false) {
        self.bundleIDs = bundleIDs
        self.confirmed = confirmed
    }

    public func confirming() -> Allowlist {
        Allowlist(bundleIDs: bundleIDs, confirmed: true)
    }

    public func allows(_ bundleID: String?) -> Bool {
        // Unreadable frontmost app is NOT a violation. Failing closed here would
        // mean nagging him because a permission check glitched.
        guard let bundleID else { return true }
        if Self.alwaysAllowed.contains(bundleID) { return true }
        return bundleIDs.contains(bundleID)
    }
}

// MARK: - What enforcement decides to do

public enum EnforcementAction: Equatable, Sendable {
    /// Nothing to say.
    case none

    /// Say something. `escalation` counts from 1.
    case nudge(reason: DriftReason, escalation: Int)

    /// The cap has been reached. Say so ONCE, then never again this session.
    case disengage(reason: DriftReason)
}

public enum DriftReason: Equatable, Sendable {
    case wrongApp(name: String)
    case inactive(seconds: TimeInterval)
}

// MARK: - The policy

public struct EnforcementPolicy: Equatable, Sendable {
    public let level: EnforcementLevel

    /// How long he has to be idle before it counts as being away.
    public let idleThreshold: TimeInterval

    /// How long a disallowed app has to be frontmost before it counts. A glance
    /// at Messages is not drift; five minutes in it is.
    public let wrongAppGrace: TimeInterval

    /// Minimum gap between two things said.
    public let nudgeInterval: TimeInterval

    /// After this many escalations with no return, stop talking.
    ///
    /// Six, from the plan. The number matters less than the fact that there IS
    /// one: an assistant that keeps shouting at an empty room is worse than one
    /// that gives up, and it is the behaviour that makes people turn the whole
    /// feature off.
    public let disengageAfter: Int

    public init(level: EnforcementLevel = .gentle,
                idleThreshold: TimeInterval = 5 * 60,
                wrongAppGrace: TimeInterval = 60,
                nudgeInterval: TimeInterval = 60,
                disengageAfter: Int = 6) {
        self.level = level
        self.idleThreshold = idleThreshold
        self.wrongAppGrace = wrongAppGrace
        self.nudgeInterval = nudgeInterval
        self.disengageAfter = disengageAfter
    }

    public static let gentle = EnforcementPolicy(level: .gentle)
    public static let firm = EnforcementPolicy(level: .firm)
}

// MARK: - The running state

/// Everything enforcement remembers between observations.
public struct EnforcementState: Equatable, Sendable {
    public var escalations = 0
    public var disengaged = false
    public var lastNudgeAt: Date?

    /// When the current drift began, so a grace period can be applied.
    public var driftingSince: Date?

    /// Set by the local escape. Nothing turns it back on for this session.
    public var released = false

    public init() {}
}

public enum Enforcement {

    /// Decide what to do, given what the sensors saw.
    ///
    /// Returns the action AND the new state, so the caller stores what it is
    /// given rather than mutating anything here.
    public static func decide(
        observation: Observation,
        allowlist: Allowlist,
        policy: EnforcementPolicy,
        state: EnforcementState,
        now: Date,
        sessionIsFocusing: Bool
    ) -> (action: EnforcementAction, state: EnforcementState) {
        var next = state

        // The unconditional escape. Checked FIRST, before anything else, and it
        // depends on nothing — not the model, not the gateway, not a network.
        // If this is set, enforcement is over.
        if next.released { return (.none, next) }

        // Enforcement only applies during focus. A break is not drift, and
        // neither is a session that has not started or has ended.
        guard sessionIsFocusing else {
            next.driftingSince = nil
            return (.none, next)
        }

        // An unconfirmed allowlist enforces nothing. The model proposes; Nick
        // authorizes. Without that step this is a list of guesses.
        guard allowlist.confirmed else {
            next.driftingSince = nil
            return (.none, next)
        }

        // A locked or sleeping screen is not drift. He is plainly not there, and
        // the session's own idle handling covers it.
        if observation.screenLocked {
            next.driftingSince = nil
            return (.none, next)
        }

        let reason: DriftReason
        switch drift(observation, allowlist: allowlist, policy: policy,
                     state: &next, now: now) {
        case .onTask:
            // Back on task. Reset the escalation ladder — but NOT `disengaged`,
            // which lasts the session once it has been announced.
            next.escalations = 0
            next.driftingSince = nil
            return (.none, next)

        case .withinGrace:
            // Drifting, but not for long enough to count yet. Say nothing AND
            // KEEP `driftingSince` — clearing it here restarts the grace clock
            // on every observation, so it never elapses and a wrong app is never
            // reported at all. That bug made every escalation test fail at once.
            return (.none, next)

        case .drifting(let found):
            reason = found
        }

        if next.disengaged { return (.none, next) }

        // Gentle says one thing and then stops. It does not climb.
        if !policy.level.escalates && next.escalations >= 1 {
            return (.none, next)
        }

        if let last = next.lastNudgeAt, now.timeIntervalSince(last) < policy.nudgeInterval {
            return (.none, next)
        }

        if next.escalations >= policy.disengageAfter {
            next.disengaged = true
            next.lastNudgeAt = now
            return (.disengage(reason: reason), next)
        }

        next.escalations += 1
        next.lastNudgeAt = now
        return (.nudge(reason: reason, escalation: next.escalations), next)
    }

    /// Three states, not two.
    ///
    /// "Not drifting" and "drifting but inside the grace window" look the same
    /// to a caller that only wants to know whether to speak, and they are not
    /// the same at all: one should reset the grace clock and the other must
    /// leave it running.
    private enum Drift {
        case onTask
        case withinGrace
        case drifting(DriftReason)
    }

    private static func drift(_ observation: Observation,
                              allowlist: Allowlist,
                              policy: EnforcementPolicy,
                              state: inout EnforcementState,
                              now: Date) -> Drift {
        let wrongApp = !allowlist.allows(observation.frontmostBundleID)
        let inactive = observation.idleFor >= policy.idleThreshold

        guard wrongApp || inactive else { return .onTask }

        // Idle has its own threshold and needs no further grace — the threshold
        // IS the grace. A wrong app gets a grace period on top, because looking
        // something up is not the same as abandoning the block.
        if inactive {
            return .drifting(.inactive(seconds: observation.idleFor))
        }

        let since = state.driftingSince ?? now
        state.driftingSince = since
        guard now.timeIntervalSince(since) >= policy.wrongAppGrace else { return .withinGrace }

        return .drifting(.wrongApp(name: observation.frontmostName
                                   ?? observation.frontmostBundleID
                                   ?? "something else"))
    }

    /// The local escape. Ends enforcement for this session, unconditionally.
    ///
    /// Depends on nothing that can be unavailable. That is the whole point: a
    /// user who cannot get out of enforcement because a local model is not
    /// answering is trapped by his own assistant, and no amount of good
    /// intention makes that acceptable.
    public static func release(_ state: EnforcementState) -> EnforcementState {
        var next = state
        next.released = true
        next.driftingSince = nil
        return next
    }
}
