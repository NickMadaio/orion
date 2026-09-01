import Foundation

// PHASE 38 — letting health touch the plan, and only in one direction.
//
// Half of this phase already shipped, on 2026-09-01, as a side effect of Phase
// 33: `PlanningSignal` in the Mac app is exactly "give planner only derived
// states", and the firewall test proves numerically that no raw measurement
// crosses. That half is not rebuilt here. What was missing is the other half —
// the manifest's "initially allow health to generate RECOMMENDATIONS only",
// with its example:
//
//     You slept below baseline. Would you like me to move the optional
//     high-focus block later?
//
// and its three prohibitions: never automatically skip class, never cancel
// required commitments, never make medical decisions.
//
// ## Why those prohibitions are types rather than rules
//
// "Never cancel a required commitment" written as an `if` in whichever function
// happens to do the cancelling is a rule that holds until someone adds a second
// function. So:
//
//   · A `Commitment` declares whether it is `.required` or `.flexible`, and
//     `Recommendation.init` REFUSES to be built against a required one. There
//     is no code path that produces "skip your 9am lecture", because the type
//     will not hold it.
//   · The only actions a recommendation can propose are `.moveLater`,
//     `.shorten` and `.protect`. There is no `.cancel` case. A prohibition
//     implemented as an absent enum member cannot be forgotten.
//   · Every recommendation carries a QUESTION and has no "apply" on it. It is a
//     proposal; something else, with a person in it, decides.
//
// ## "Always permit user override"
//
// Implemented as `Recommendation.declined`, which is a first-class outcome
// rather than the absence of acceptance. That distinction matters for Phase 39:
// a suggestion Nick said no to must not be re-offered tomorrow as though it had
// never been made, and "no answer" and "no" are different states.

// MARK: - What the day is made of

/// One thing on the day. The vocabulary Phase 39 builds its plan from.
public struct Commitment: Sendable, Equatable, Identifiable {

    /// Whether the plan may be rearranged around it.
    public enum Kind: String, Sendable, CaseIterable {
        /// Class, exam, appointment, anything with someone else in it. ORION
        /// may never propose moving or dropping one of these.
        case required
        /// A focus block, a workout, a chore. Movable.
        case flexible
    }

    public let id: String
    public let title: String
    public let kind: Kind
    /// Minutes from the start of the day. Kept as an offset rather than an
    /// instant so a plan does not silently acquire a timezone — Phase 40's
    /// lesson, applied where it is cheap to apply.
    public let startMinute: Int
    public let durationMinutes: Int
    /// Whether this is the kind of work that wants a good day behind it.
    public let demanding: Bool

    public init?(
        id: String, title: String, kind: Kind,
        startMinute: Int, durationMinutes: Int, demanding: Bool = false
    ) {
        guard !id.trimmingCharacters(in: .whitespaces).isEmpty else { return nil }
        guard !title.trimmingCharacters(in: .whitespaces).isEmpty else { return nil }
        guard (0..<1440).contains(startMinute), durationMinutes > 0 else { return nil }
        self.id = id
        self.title = title
        self.kind = kind
        self.startMinute = startMinute
        self.durationMinutes = durationMinutes
        self.demanding = demanding
    }
}

// MARK: - A recommendation

/// What ORION may propose doing about the day, given how the body is.
///
/// There is deliberately no `cancel` and no `skip`. The manifest forbids both,
/// and an absent enum member is a prohibition nobody can forget to check.
public enum PlanningAction: String, Sendable, CaseIterable {
    /// "Move the optional high-focus block later." The manifest's own example.
    case moveLater = "move_later"
    /// Keep it, make it shorter.
    case shorten
    /// Leave a gap alone rather than filling it.
    case protectRest = "protect_rest"

    public var verb: String {
        switch self {
        case .moveLater: return "move"
        case .shorten: return "shorten"
        case .protectRest: return "keep clear"
        }
    }
}

/// How a person answered.
public enum RecommendationOutcome: String, Sendable, CaseIterable {
    /// Offered, nothing said yet.
    case open
    case accepted
    /// Said no. NOT the same as `.open` — a suggestion that was declined must
    /// not come back tomorrow as though it had never been made.
    case declined
}

public struct Recommendation: Sendable, Equatable, Identifiable {

    public let id: String
    public let action: PlanningAction
    /// The thing being proposed about. Always `.flexible`; the initialiser
    /// refuses anything else.
    public let commitment: Commitment
    /// Why, in derived-state terms. Never a measurement — this text is built
    /// from `PlanningSignal`-style categories, and Phase 33's firewall is what
    /// makes that possible.
    public let because: String
    public let outcome: RecommendationOutcome

    public init?(
        id: String, action: PlanningAction, commitment: Commitment,
        because: String, outcome: RecommendationOutcome = .open
    ) {
        guard !id.trimmingCharacters(in: .whitespaces).isEmpty else { return nil }
        // THE prohibition. A recommendation about a required commitment cannot
        // be constructed, so no caller can produce one by accident.
        guard commitment.kind == .flexible else { return nil }
        let reason = because.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !reason.isEmpty else { return nil }
        // No medical decisions, and no causal claims about the body either.
        guard !ClinicalVocabulary.contaminates(reason) else { return nil }
        guard !CausalVocabulary.contaminates(reason) else { return nil }
        self.id = id
        self.action = action
        self.commitment = commitment
        self.because = reason
        self.outcome = outcome
    }

    /// The question, which is the whole point. There is no `apply()`.
    public var question: String {
        "\(because) Would you like me to \(action.verb) \(commitment.title)?"
    }

    public func answered(_ outcome: RecommendationOutcome) -> Recommendation? {
        Recommendation(id: id, action: action, commitment: commitment,
                       because: because, outcome: outcome)
    }
}

// MARK: - The engine

public enum PlanningAdvisor {

    /// What to propose, given derived states and the day.
    ///
    /// Takes STATES, never numbers. That is Phase 33's boundary and this is a
    /// consumer of it: if this function took a recovery percentage, the firewall
    /// would have a hole in it shaped exactly like health-aware planning — which
    /// is precisely the hole Phase 38 opened before Phase 33 existed, and the
    /// reason the two were merged when it was found.
    ///
    /// Returns an empty array on a good day. A planner that always has an
    /// opinion is one that gets ignored on the day it matters.
    public static func recommendations(
        sleep: SleepState,
        recovery: PhysicalRecovery,
        energy: EnergyState,
        confidence: BaselineConfidence,
        commitments: [Commitment]
    ) -> [Recommendation] {
        // No advice from a guess. Same rule as Phase 34's sections: low
        // confidence may report, and may not tell you what to do.
        guard confidence != .low else { return [] }

        let strained = sleep == .wellBelowBaseline || sleep == .belowBaseline
            || recovery == .limited || energy == .low
        guard strained else { return [] }

        // Only flexible things are even considered. The required ones are not
        // filtered out later — they never enter.
        let movable = commitments.filter { $0.kind == .flexible }

        let reason = phrase(sleep: sleep, recovery: recovery, energy: energy)

        var out: [Recommendation] = []
        for commitment in movable where commitment.demanding {
            if let recommendation = Recommendation(
                id: "rec-\(commitment.id)", action: .moveLater,
                commitment: commitment, because: reason) {
                out.append(recommendation)
            }
        }
        // At most two. A list of five suggestions on a bad day is a list nobody
        // reads, and the day it matters most is the day he has least patience.
        return Array(out.prefix(2))
    }

    /// The observation a recommendation leads with.
    ///
    /// Assembled from categories, so it contains no measurement and cannot.
    static func phrase(
        sleep: SleepState, recovery: PhysicalRecovery, energy: EnergyState
    ) -> String {
        if sleep == .wellBelowBaseline { return "You slept well below your baseline." }
        if sleep == .belowBaseline { return "You slept below your baseline." }
        if recovery == .limited { return "Recovery came in limited today." }
        if energy == .low { return "Energy is reading low today." }
        return "Today is reading a little short."
    }
}
