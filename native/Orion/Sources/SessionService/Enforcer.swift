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

public final class Enforcer {

    private let hub: SensorHub
    private let clock: () -> Date
    private let speak: (String) -> Void
    private let log: (String) -> Void

    private let queue = DispatchQueue(label: "com.nickmadaio.orion.enforcer")
    private var state = EnforcementState()

    public private(set) var allowlist = Allowlist(bundleIDs: [], confirmed: false)
    public private(set) var policy = EnforcementPolicy.gentle

    /// False until `arm(_:)` is called with a confirmed list.
    public var isArmed: Bool { queue.sync { allowlist.confirmed && !state.released } }

    public var isReleased: Bool { queue.sync { state.released } }

    /// What cannot be read right now, or nil when everything can.
    public var sensorDisclosure: String? { hub.disclosure }
    public var hasDisengaged: Bool { queue.sync { state.disengaged } }

    public init(hub: SensorHub = SensorHub(),
                clock: @escaping () -> Date = { Date() },
                speak: @escaping (String) -> Void = { _ in },
                log: @escaping (String) -> Void = { _ in }) {
        self.hub = hub
        self.clock = clock
        self.speak = speak
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
    public func arm(_ list: Allowlist, policy: EnforcementPolicy) {
        queue.sync {
            self.allowlist = list.confirming()
            self.policy = policy
            self.state = EnforcementState()
        }
        log("[focus] enforcement armed (\(policy.level.rawValue)) over "
            + "\(list.bundleIDs.count) allowed app(s)")
        if let disclosure = hub.disclosure { log("[focus] \(disclosure)") }
    }

    public func disarm() {
        queue.sync {
            allowlist = Allowlist(bundleIDs: [], confirmed: false)
            state = EnforcementState()
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

        case .disengage(let reason):
            let line = Self.disengageLine(for: reason)
            log("[focus] disengaging after \(policy.disengageAfter) escalations")
            speak(line)
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
