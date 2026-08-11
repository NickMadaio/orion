//
//  Getting out, when the thing that would normally decide is not answering.
//
//  The deterministic policy comes FIRST and the model comes second. That
//  ordering is the whole design. A model may be asked whether a reason is good
//  — that is the interesting part of `orion-focus`, and it is worth keeping —
//  but it must never be the only route to safety, because it runs locally, it
//  can be slow, it can be down, and a person who cannot leave their own focus
//  session because Ollama stopped answering has been trapped by their assistant.
//
//  So there are two ways out, and the second cannot fail:
//
//    1. The plain escape. Always available, no conditions. Ends enforcement.
//       That is `Enforcement.release` and it is not in this file.
//
//    2. The fail-closed hatch, for the case where he is TRYING to negotiate and
//       nothing is answering. Three exit requests inside five minutes with the
//       model unreachable grants a bounded release, and the archive records
//       that it was granted this way rather than argued for.
//
//  The hatch exists because (1) is a blunt instrument he might not reach for
//  while he is still trying to do the right thing — asking, being ignored,
//  asking again. Three ignored requests is a system failure, and the system
//  should yield rather than make him fight it.
//

import Foundation

// MARK: - Requests to leave

public struct ExitRequest: Codable, Equatable, Sendable {
    public let at: Date
    public let reason: String
    /// True when the model was asked and did not answer, or could not be reached.
    public let modelUnreachable: Bool

    public init(at: Date, reason: String, modelUnreachable: Bool) {
        self.at = at
        self.reason = reason
        self.modelUnreachable = modelUnreachable
    }
}

// MARK: - The outcome

public enum ExitVerdict: Equatable, Sendable {
    /// The model considered it and said no. He stays, and can ask again.
    case refused(because: String)

    /// The model considered it and agreed.
    case granted(because: String)

    /// Nothing could be asked, and this is not yet the third try. Say so
    /// honestly — "I can't reach the model" is a different sentence from "no".
    case undecided(because: String)

    /// The fail-closed hatch. Bounded, and flagged in the archive.
    case releasedByFallback(after: Int, within: TimeInterval)

    public var allowsExit: Bool {
        switch self {
        case .granted, .releasedByFallback: return true
        case .refused, .undecided: return false
        }
    }

    /// Whether the archive should record that this was not a normal exit.
    public var isFallback: Bool {
        if case .releasedByFallback = self { return true }
        return false
    }
}

// MARK: - The policy

public enum ExitPolicy {

    /// How many ignored requests it takes.
    public static let attemptsBeforeRelease = 3

    /// The window they have to fall inside.
    public static let window: TimeInterval = 5 * 60

    /// Decide, given every request he has made this session.
    ///
    /// `modelVerdict` is nil when the model could not be reached at all. Note
    /// the ordering inside: the deterministic check runs BEFORE the model's
    /// answer is consulted, so a model that is answering slowly, wrongly, or
    /// adversarially cannot prevent the hatch from opening.
    public static func decide(requests: [ExitRequest],
                              modelVerdict: ModelVerdict?,
                              now: Date) -> ExitVerdict {

        // Deterministic first. Always.
        let recent = requests.filter {
            now.timeIntervalSince($0.at) <= window && $0.modelUnreachable
        }
        if recent.count >= attemptsBeforeRelease {
            return .releasedByFallback(after: recent.count, within: window)
        }

        guard let modelVerdict else {
            return .undecided(because: "I can't reach the model to talk about it. "
                            + "Ask twice more and I'll let you out anyway.")
        }

        return modelVerdict.agreed
            ? .granted(because: modelVerdict.reason)
            : .refused(because: modelVerdict.reason)
    }

    /// How many more ignored requests before the hatch opens. For telling him.
    public static func remainingAttempts(requests: [ExitRequest], now: Date) -> Int {
        let recent = requests.filter {
            now.timeIntervalSince($0.at) <= window && $0.modelUnreachable
        }
        return max(0, attemptsBeforeRelease - recent.count)
    }
}

/// What the model said, when it said anything.
public struct ModelVerdict: Equatable, Sendable {
    public let agreed: Bool
    public let reason: String

    public init(agreed: Bool, reason: String) {
        self.agreed = agreed
        self.reason = reason
    }
}
