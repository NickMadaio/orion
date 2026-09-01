import Foundation

// PHASE 36 — associations between what Nick did and how he slept.
//
// The manifest is unusually specific here, and it is specific about LANGUAGE:
// "never claim causation from simple observational correlations", followed by
// the exact wording to use — associated with, correlated with, tends to
// coincide with, insufficient data.
//
// That is a gift, because a closed list of permitted phrasings can be a type.
// `AssociationPhrase` is the ONLY way a finding describes itself, so there is no
// path by which this file can emit "caffeine after 5 ruins your sleep". It
// cannot spell it.
//
// Three further rules, all of them about not fooling the reader:
//
// · **Sample sizes are not optional and are never hidden.** "Associated with"
//   over four nights and over forty nights are different claims, and a finding
//   that does not carry `withCount`/`withoutCount` lets a reader assume the
//   second when it was the first.
//
// · **Below `minimumPerGroup` there is no finding at all**, only
//   `.insufficientData`. Not a weak finding, not a hedged one — the effect size
//   is not even computed, because a computed number invites being quoted.
//
// · **A difference smaller than the day-to-day spread is not an association.**
//   This is Phase 31's lesson pointed at a new target: a real spread of fourteen
//   minutes quantised to zero turned an ordinary night into a crisis. Here, a
//   two-point recovery difference against a spread of twelve is noise, and
//   reporting it as "correlated with" fabricates certainty.
//
// What this deliberately does NOT do is inferential statistics. There is no
// p-value, no confidence interval, no significance test. With forty
// observations of one person, a p-value would be a decoration that makes a
// weak claim look strong — and the manifest's own vocabulary ("possible
// associations") is the honest altitude.

// MARK: - Words this file may not use

/// Causal language, checked against ORION's own output.
///
/// The sibling of `ClinicalVocabulary` and it works the same way: a check on
/// what ORION says, never a filter on what Nick writes. His journal note may
/// say "coffee wrecks my sleep"; a finding may not.
public enum CausalVocabulary {
    public static let forbidden: [String] = [
        "cause", "causes", "caused", "causing", "because", "due to",
        "leads to", "led to", "results in", "resulting in", "makes you",
        "made you", "ruins", "ruined", "improves", "improved", "worsens",
        "worsened", "effect of", "impact of", "responsible for", "thanks to",
        "so you should", "proves", "proven", "shows that",
    ]

    public static func contaminates(_ text: String) -> Bool {
        let lowered = text.lowercased()
        return forbidden.contains { lowered.contains($0) }
    }
}

/// The only ways a finding may describe itself. Straight from the manifest.
public enum AssociationPhrase: String, CaseIterable, Sendable {
    case associatedWith = "associated with"
    case correlatedWith = "correlated with"
    case tendsToCoincideWith = "tends to coincide with"
    case insufficientData = "insufficient data"

    /// Whether this phrase asserts anything at all.
    public var isFinding: Bool { self != .insufficientData }
}

// MARK: - What is being compared against what

/// The measured thing a behaviour is compared against.
///
/// Deliberately only two. The manifest says "analyze journal entries against
/// sleep and recovery" and stops there; adding strain or HRV would be building
/// past the requirement into territory nobody has specified.
public enum CorrelationOutcome: String, CaseIterable, Sendable {
    case sleepPerformance = "sleep_performance"
    case recovery

    public var label: String {
        switch self {
        case .sleepPerformance: return "sleep"
        case .recovery: return "recovery"
        }
    }
}

/// One day, reduced to what a correlation needs.
public struct CorrelationDay: Sendable, Equatable {
    public let dayKey: String
    public let behaviours: Set<JournalEventType>
    public let sleepPerformance: Double?
    public let recovery: Double?

    public init(dayKey: String, behaviours: Set<JournalEventType>,
                sleepPerformance: Double? = nil, recovery: Double? = nil) {
        self.dayKey = dayKey
        self.behaviours = behaviours
        self.sleepPerformance = sleepPerformance
        self.recovery = recovery
    }

    func value(for outcome: CorrelationOutcome) -> Double? {
        switch outcome {
        case .sleepPerformance: return sleepPerformance
        case .recovery: return recovery
        }
    }
}

// MARK: - A finding

/// One possible association, with everything a reader needs to discount it.
public struct Association: Sendable, Equatable {

    public let behaviour: JournalEventType
    public let outcome: CorrelationOutcome
    public let phrase: AssociationPhrase

    /// Days the behaviour was recorded, and days it was not. Both, always.
    public let withCount: Int
    public let withoutCount: Int

    /// Mean outcome on days with the behaviour minus mean without. Nil when
    /// the phrase is `.insufficientData` — an effect that is not reportable is
    /// not computed, because a number in a field gets quoted.
    public let difference: Double?

    /// The spread the difference was judged against, so "small" is defined
    /// relative to this person rather than to an absolute.
    public let spread: Double?

    public let confidence: BaselineConfidence

    public init?(
        behaviour: JournalEventType, outcome: CorrelationOutcome,
        phrase: AssociationPhrase, withCount: Int, withoutCount: Int,
        difference: Double?, spread: Double?, confidence: BaselineConfidence
    ) {
        guard withCount >= 0, withoutCount >= 0 else { return nil }
        // The invariant that keeps the type honest in both directions.
        if phrase == .insufficientData && difference != nil { return nil }
        if phrase.isFinding && difference == nil { return nil }
        if let difference, !difference.isFinite { return nil }
        if let spread, !spread.isFinite || spread < 0 { return nil }
        self.behaviour = behaviour
        self.outcome = outcome
        self.phrase = phrase
        self.withCount = withCount
        self.withoutCount = withoutCount
        self.difference = difference
        self.spread = spread
        self.confidence = confidence
    }

    /// The sentence a person reads.
    ///
    /// Built from `phrase.rawValue` rather than from a free string, and checked
    /// against `CausalVocabulary` before it is returned. Returns nil rather
    /// than a sanitised version: a sentence that had to be cleaned is a
    /// sentence whose author meant something else.
    public var sentence: String? {
        let text: String
        switch phrase {
        case .insufficientData:
            text = "Not enough days yet to say anything about \(behaviour.rawValue) "
                + "and \(outcome.label) — \(withCount) with, \(withoutCount) without."
        default:
            guard let difference else { return nil }
            let direction = difference > 0 ? "higher" : "lower"
            text = "\(behaviour.rawValue.capitalized) is \(phrase.rawValue) \(direction) "
                + "\(outcome.label), on \(withCount) days with and \(withoutCount) without. "
                + "This is an observation, not an explanation."
        }
        return CausalVocabulary.contaminates(text) ? nil : text
    }
}

// MARK: - The engine

public enum CorrelationEngine {

    /// Days needed on BOTH sides before anything is said.
    ///
    /// Five rather than Phase 31's seven, because this compares two groups
    /// rather than describing one: seven days with AND seven without needs a
    /// fortnight of a behaviour Nick may only do twice a week. Five each is
    /// still a fortnight of data and it is where "insufficient" stops being the
    /// only honest answer. It is a deliberately conservative floor and it is a
    /// constant so it can be argued with.
    public static let minimumPerGroup = 5

    /// Sample count on the smaller side at which a finding stops being tentative.
    public static let solidPerGroup = 12

    /// How large a difference must be, in multiples of the day-to-day spread,
    /// before it is an association rather than noise.
    ///
    /// Relative for the same reason `HealthStateEngine.departure` is: a person
    /// whose recovery swings twenty points has not had an unusual day at five
    /// off, and a person whose recovery moves by three has.
    public static let noticeable = 0.5
    public static let strong = 1.0

    /// Every association worth looking at, for one outcome.
    ///
    /// Returns a row for EVERY behaviour observed at all, including the ones
    /// with too little data — those come back as `.insufficientData`. Omitting
    /// them would make the screen look like the behaviours it can talk about
    /// are the only ones that happened.
    public static func associations(
        days: [CorrelationDay], outcome: CorrelationOutcome
    ) -> [Association] {
        let usable = days.filter { $0.value(for: outcome) != nil }
        let behaviours = Set(usable.flatMap(\.behaviours))
            // `.note` is the escape hatch, not a behaviour. Correlating "things
            // Orion could not classify" against sleep would be meaningless and
            // would look authoritative.
            .subtracting([.note])

        return behaviours.sorted { $0.rawValue < $1.rawValue }.compactMap { behaviour in
            association(days: usable, behaviour: behaviour, outcome: outcome)
        }
    }

    public static func association(
        days: [CorrelationDay], behaviour: JournalEventType, outcome: CorrelationOutcome
    ) -> Association? {
        let withValues = days.filter { $0.behaviours.contains(behaviour) }
            .compactMap { $0.value(for: outcome) }
        let withoutValues = days.filter { !$0.behaviours.contains(behaviour) }
            .compactMap { $0.value(for: outcome) }

        let smaller = min(withValues.count, withoutValues.count)

        guard smaller >= minimumPerGroup else {
            return Association(
                behaviour: behaviour, outcome: outcome, phrase: .insufficientData,
                withCount: withValues.count, withoutCount: withoutValues.count,
                difference: nil, spread: nil, confidence: .low)
        }

        let withMean = mean(withValues)
        let withoutMean = mean(withoutValues)
        let difference = withMean - withoutMean
        // Spread over ALL usable days rather than within one group: the
        // question is whether the difference is large for THIS PERSON, and the
        // pooled set is the closest thing here to their ordinary variation.
        //
        // Stated as the judgement it is, because an earlier version of this
        // comment claimed a group's own spread "would make every difference
        // look large" and that does not survive checking. MAD is resistant by
        // construction: pooling a tight fourteen-day group with a wide one
        // yields a spread of about 0.5-1.5, not a larger one, because half the
        // observations sit in the dense cluster. No fixture separated the two
        // rules at these thresholds. Pooling is defensible and conservative in
        // the bimodal case that matters; it is not proven better, and the gate
        // record says so.
        let spread = deviation(withValues + withoutValues)

        let confidence: BaselineConfidence = smaller >= solidPerGroup ? .high : .moderate

        // A difference that does not clear the noise floor is reported as
        // insufficient rather than as a weak finding. "Correlated with, but
        // barely" is a sentence people repeat without the second half.
        guard spread > 0, abs(difference) >= noticeable * spread else {
            return Association(
                behaviour: behaviour, outcome: outcome, phrase: .insufficientData,
                withCount: withValues.count, withoutCount: withoutValues.count,
                difference: nil, spread: nil, confidence: confidence)
        }

        // The three finding phrases are not synonyms used at random; they are
        // ordered by how much is being claimed, and the strength of the
        // observation picks one.
        let magnitude = abs(difference) / spread
        let phrase: AssociationPhrase
        if magnitude >= strong && confidence == .high {
            phrase = .correlatedWith
        } else if magnitude >= strong {
            phrase = .associatedWith
        } else {
            phrase = .tendsToCoincideWith
        }

        return Association(
            behaviour: behaviour, outcome: outcome, phrase: phrase,
            withCount: withValues.count, withoutCount: withoutValues.count,
            difference: difference, spread: spread, confidence: confidence)
    }

    // MARK: Arithmetic

    public static func mean(_ values: [Double]) -> Double {
        guard !values.isEmpty else { return 0 }
        return values.reduce(0, +) / Double(values.count)
    }

    /// Median absolute deviation, matching `BaselineEngine`'s choice.
    ///
    /// Not the standard deviation: one catastrophic night should not widen the
    /// spread enough to hide everything else, and Phase 31 already settled this
    /// argument for the baselines these findings sit beside.
    public static func deviation(_ values: [Double]) -> Double {
        guard values.count > 1 else { return 0 }
        let centre = median(values)
        return median(values.map { abs($0 - centre) })
    }

    public static func median(_ values: [Double]) -> Double {
        guard !values.isEmpty else { return 0 }
        let sorted = values.sorted()
        let middle = sorted.count / 2
        return sorted.count % 2 == 0
            ? (sorted[middle - 1] + sorted[middle]) / 2
            : sorted[middle]
    }
}
