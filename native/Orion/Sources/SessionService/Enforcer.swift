//
//  Enforcement, running.
//
//  Sensors in, policy decides, something gets said. The policy is pure and lives
//  in SessionDomain; this is the adapter that feeds it and acts on what it says.
//
//  Two properties are worth stating plainly because they are the ones a person
//  cares about:
//
//  THE ESCAPE ALWAYS WORKS. `release()` sets a flag and returns. It consults no
//  model, no gateway and no network, so there is no state of the world in which
//  Nick is stuck inside enforcement because something is down. It is reachable
//  from the command socket, which needs only the app to be running — and if the
//  app is not running, enforcement is not running either.
//
//  ENFORCEMENT IS OFF UNTIL HE CONFIRMS. `arm(_:)` is what turns it on, and it
//  takes an allowlist he has seen. The proposal is generated from what is
//  running; the authorization is his. The policy refuses an unconfirmed list, so
//  forgetting this step fails safe rather than enforcing against guesses.
//

import Foundation
import SessionDomain

public enum EnforcementIntervention: Equatable, Sendable {
    /// Bring the last confirmed work app forward. Nothing is hidden.
    case restore(bundleID: String)
    /// Hide the current disallowed app, then restore the last work app.
    case hide(bundleID: String, restoreBundleID: String?)
    /// Show the reversible Shield surface and restore work when it closes.
    case shield(reason: String, restoreBundleID: String?)
}

public final class Enforcer {

    private let hub: SensorHub
    private let clock: () -> Date
    private let speak: (String) -> Void
    private let log: (String) -> Void
    private let intervene: (EnforcementIntervention) -> Void

    private let queue = DispatchQueue(label: "com.nickmadaio.orion.enforcer")
    private var state = EnforcementState()
    private var lastAllowedBundleID: String?
    private var progressive = false

    public private(set) var allowlist = Allowlist(bundleIDs: [], confirmed: false)
    public private(set) var policy = EnforcementPolicy.gentle

    /// False until `arm(_:)` is called with a confirmed list.
    public var isArmed: Bool { queue.sync { allowlist.confirmed && !state.released } }

    public var isReleased: Bool { queue.sync { state.released } }

    /// Read-only count for the session dashboard. Rendering the guard must not
    /// be able to alter its enforcement state.
    public var escalationCount: Int { queue.sync { state.escalations } }

    /// Progressive is a presentation/orchestration mode over the four concrete
    /// domain levels. It begins with a spoken nudge, then earns stronger help
    /// only when the same drift continues.
    public var isProgressive: Bool { queue.sync { progressive } }

    public var effectiveLevel: EnforcementLevel {
        queue.sync {
            Self.effectiveLevel(progressive: progressive,
                                escalation: state.escalations,
                                fixed: policy.level)
        }
    }

    /// What cannot be read right now, or nil when everything can.
    public var sensorDisclosure: String? { hub.disclosure }
    public var hasDisengaged: Bool { queue.sync { state.disengaged } }

    public init(hub: SensorHub = SensorHub(),
                clock: @escaping () -> Date = { Date() },
                speak: @escaping (String) -> Void = { _ in },
                intervene: @escaping (EnforcementIntervention) -> Void = { _ in },
                log: @escaping (String) -> Void = { _ in }) {
        self.hub = hub
        self.clock = clock
        self.speak = speak
        self.intervene = intervene
        self.log = log
    }

    // MARK: Arming

    /// What Nick is shown before enforcement starts.
    ///
    /// A PROPOSAL — the currently running apps. Nothing is enforced against it
    /// until `arm` is called with it, which is the confirmation step. The model
    /// may suggest a list; it never authorizes one.
    public func preflight(forTask task: String) -> (allowlist: Allowlist, apps: [ProposedApp]) {
        SensorHub.proposeAllowlist(forTask: task)
    }

    /// Turn enforcement on against a list Nick has confirmed.
    public func arm(_ list: Allowlist, policy: EnforcementPolicy,
                    progressive: Bool = false) {
        queue.sync {
            self.allowlist = list.confirming()
            self.policy = policy
            self.progressive = progressive
            self.state = EnforcementState()
            self.lastAllowedBundleID = nil
        }
        let profile = progressive ? "progressive" : policy.level.rawValue
        log("[focus] enforcement armed (\(profile)) over "
            + "\(list.bundleIDs.count) allowed app(s)")
        if let disclosure = hub.disclosure { log("[focus] \(disclosure)") }
    }

    public func disarm() {
        queue.sync {
            allowlist = Allowlist(bundleIDs: [], confirmed: false)
            progressive = false
            state = EnforcementState()
            lastAllowedBundleID = nil
        }
    }

    // MARK: The escape

    /// End enforcement for this session. Unconditional.
    ///
    /// Nothing can make this fail. That is the requirement, not a nicety: an
    /// assistant that can trap somebody because a local model stopped answering
    /// is worse than no assistant.
    public func release() {
        queue.sync { state = Enforcement.release(state) }
        log("[focus] enforcement released — Orion will not say anything more about drift")
        speak("Alright. I'll leave it.")
    }

    // MARK: The tick

    /// Called on the session's heartbeat. Observes, decides, speaks.
    public func evaluate(sessionIsFocusing: Bool) {
        let observation = hub.observe()
        let now = clock()

        if sessionIsFocusing,
           let bundleID = observation.frontmostBundleID,
           allowlist.allows(bundleID, direction: policy.direction),
           !Allowlist.alwaysAllowed.contains(bundleID) {
            queue.sync { lastAllowedBundleID = bundleID }
        }

        let action: EnforcementAction = queue.sync {
            let result = Enforcement.decide(
                observation: observation, allowlist: allowlist, policy: policy,
                state: state, now: now, sessionIsFocusing: sessionIsFocusing
            )
            state = result.state
            return result.action
        }

        switch action {
        case .none:
            break

        case .nudge(let reason, let escalation):
            let line = Self.line(for: reason, escalation: escalation, policy: policy)
            log("[focus] nudge \(escalation): \(line)")
            speak(line)
            applyIntervention(for: reason, observation: observation, escalation: escalation)

        case .disengage(let reason):
            let line = Self.disengageLine(for: reason)
            log("[focus] disengaging after \(policy.disengageAfter) escalations")
            speak(line)
        }
    }

    private func applyIntervention(for reason: DriftReason, observation: Observation,
                                   escalation: Int) {
        let restore = queue.sync { lastAllowedBundleID }
        let level = effectiveLevel
        switch level {
        case .gentle:
            break
        case .guided:
            guard escalation >= 2, let restore else { return }
            log("[focus] guided return to \(restore)")
            intervene(.restore(bundleID: restore))
        case .firm:
            guard escalation >= 2, case .wrongApp = reason,
                  let current = observation.frontmostBundleID,
                  !Allowlist.alwaysAllowed.contains(current) else { return }
            log("[focus] hiding disallowed app \(current)")
            intervene(.hide(bundleID: current, restoreBundleID: restore))
        case .shield:
            let line: String
            switch reason {
            case .wrongApp(let name): line = "\(name) can wait. Return to your focus block."
            case .inactive: line = "Your focus block is still running. Return when you're ready."
            }
            log("[focus] showing Shield")
            intervene(.shield(reason: line, restoreBundleID: restore))
        }
    }

    private static func effectiveLevel(progressive: Bool, escalation: Int,
                                       fixed: EnforcementLevel) -> EnforcementLevel {
        guard progressive else { return fixed }
        switch escalation {
        case ..<2: return .gentle
        case 2: return .guided
        case 3: return .firm
        default: return .shield
        }
    }

    // MARK: Words

    static func line(for reason: DriftReason, escalation: Int,
                     policy: EnforcementPolicy) -> String {
        switch reason {
        case .wrongApp(let name):
            switch escalation {
            case 1: return "You're in \(name)."
            case 2: return "Still \(name). The block's running."
            case 3: return "\(name) again. Come back to it."
            case 4: return "This is the fourth time. \(name) can wait."
            case 5: return "You're not working. Close \(name)."
            default: return "Last time — \(name). Come back or end the session."
            }
        case .inactive(let seconds):
            let minutes = max(1, Int(seconds / 60))
            switch escalation {
            case 1: return "Nothing for \(minutes) minutes. Still there?"
            case 2: return "Still nothing. The block's running without you."
            case 3: return "\(minutes) minutes idle. Come back or end it."
            default: return "You've been gone \(minutes) minutes."
            }
        }
    }

    /// Said once, and then silence.
    ///
    /// The wording matters: it tells him enforcement has stopped, so the quiet
    /// that follows reads as a decision rather than as Orion having crashed.
    static func disengageLine(for reason: DriftReason) -> String {
        "I've said it enough. I'll stop now — the session's still running if you want it."
    }
}
