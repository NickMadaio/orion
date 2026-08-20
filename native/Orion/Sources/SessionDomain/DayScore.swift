//
//  A number for the day, and the reasons it must be allowed to refuse.
//
//  Policy v2. Three things changed and each one came from the same complaint:
//  the grid was mostly grey.
//
//  1. WHOOP CARRIES THE DAY WHEN NOTHING ELSE DOES. v1 asked for half the day's
//     weight before it would produce a number, and health was only 40% of it —
//     so a day with a perfect night's sleep and no focus session scored NOTHING.
//     That is backwards: the watch is the one input that arrives every day
//     whether or not Nick sat down at the desk. The floor is now low enough that
//     any single GROUP can speak for the day, and only the scraps (a bottle of
//     water, a calorie count) are refused.
//
//  2. TASKS COUNT. Things ticked off in Reminders were on the calendar as facts
//     and absent from the score, which made the score a worse summary of the day
//     than the row of checkmarks above it.
//
//  3. THE NUMBER IS OUT OF TEN. A percentage invites reading it as a grade out
//     of a hundred possible points, most of which are unavailable on any given
//     day. Out of ten with one decimal reads as a rating, which is what it is.
//
//  What did NOT change is the part that matters most:
//
//  MISSING IS NOT ZERO. A day with no health data is not a day with terrible
//  health. Scoring it as zero would tell Nick he had a bad day because a watch
//  did not sync, which is worse than saying nothing — he would act on it. An
//  unavailable component is EXCLUDED and its weight redistributed; if too little
//  is left, the score refuses to exist.
//
//  THE COMPONENTS ARE VISIBLE. A single number nobody can decompose is an
//  opinion wearing a score's clothes. Every component reports its own value, its
//  weight, and whether it counted.
//
//  THE VERSION IS PERSISTED. Weights will change. If a stored score carries no
//  version then changing them silently rewrites history — a day that was green
//  last month becomes amber with no edit anywhere.
//

import Foundation

// MARK: - Components

public enum ScoreComponent: String, Codable, Sendable, CaseIterable {
    /// Minutes of focus actually served against what was planned.
    case focusServed
    /// Whether the blocks that were started were finished.
    case focusCompletion
    /// Reminders ticked off, against what was left overdue.
    case tasks
    /// Whoop recovery.
    case recovery
    /// Whoop sleep performance.
    case sleep
    /// Whoop strain, against what today's recovery actually supports.
    case exertion
    /// Hydration and supplements — the parts Nick logs by hand.
    case selfCare
    /// Calories against the goal.
    case nutrition

    /// Which third of the day this speaks for. The group is what makes the
    /// coverage floor meaningful: one whole group present is enough to score.
    public var group: ScoreGroup {
        switch self {
        case .focusServed, .focusCompletion, .tasks: return .work
        case .recovery, .sleep, .exertion: return .body
        case .selfCare, .nutrition: return .care
        }
    }

    public var label: String {
        switch self {
        case .focusServed: return "focus served"
        case .focusCompletion: return "blocks finished"
        case .tasks: return "tasks"
        case .recovery: return "recovery"
        case .sleep: return "sleep"
        case .exertion: return "strain"
        case .selfCare: return "hydration and supplements"
        case .nutrition: return "nutrition"
        }
    }
}

public enum ScoreGroup: String, Codable, Sendable, CaseIterable {
    /// What got done: focus sessions and tasks.
    case work
    /// What the watch measured: recovery, sleep, strain.
    case body
    /// What Nick logged by hand: water, supplements, food.
    case care

    public var label: String {
        switch self {
        case .work: return "work"
        case .body: return "body"
        case .care: return "care"
        }
    }
}

/// One input, or the honest absence of one.
public struct ScoreInput: Equatable, Sendable {
    public let component: ScoreComponent
    /// 0...1, or nil when the data is not there. Nil is not zero.
    public let value: Double?
    /// Why it is missing, for the UI. Nil when it is present.
    public let unavailable: String?

    public init(_ component: ScoreComponent, value: Double?, unavailable: String? = nil) {
        self.component = component
        self.value = value.map { min(1, max(0, $0)) }
        self.unavailable = unavailable
    }

    public var counted: Bool { value != nil }
}

// MARK: - The policy

/// Versioned on purpose. See rule 3 in the header.
public struct ScorePolicy: Codable, Equatable, Sendable {
    public static let currentVersion = 2

    public let version: Int

    /// The split. Work still leads, but health is no longer a minority partner
    /// that cannot carry a day on its own.
    public let workShare: Double
    public let bodyShare: Double
    public let careShare: Double

    /// How much of the total weight has to be present before a number is
    /// allowed to exist at all.
    ///
    /// Deliberately low — lower than any one full group — so that a day known
    /// only through the watch, or only through the task list, still gets a
    /// number. What it still refuses is a day known only by a bottle of water:
    /// 9% of the day's weight cannot honestly speak for the other 91%.
    public let minimumCoverage: Double

    /// Below this, the number exists but is drawn as provisional. Not a
    /// refusal — a caveat, and the UI is expected to show it.
    public let confidentCoverage: Double

    public init(version: Int = ScorePolicy.currentVersion,
                workShare: Double = 0.45, bodyShare: Double = 0.40, careShare: Double = 0.15,
                minimumCoverage: Double = 0.15, confidentCoverage: Double = 0.5) {
        self.version = version
        self.workShare = workShare
        self.bodyShare = bodyShare
        self.careShare = careShare
        self.minimumCoverage = minimumCoverage
        self.confidentCoverage = confidentCoverage
    }

    public static let current = ScorePolicy()

    public func share(of group: ScoreGroup) -> Double {
        switch group {
        case .work: return workShare
        case .body: return bodyShare
        case .care: return careShare
        }
    }

    /// Weight within the whole day.
    public func weight(of component: ScoreComponent) -> Double {
        switch component {
        // Serving the time you planned is the larger half of focus; finishing
        // the blocks is the smaller one, because a session cut short for a good
        // reason is not the same failure as never starting.
        case .focusServed:     return workShare * 0.40
        case .focusCompletion: return workShare * 0.20
        case .tasks:           return workShare * 0.40
        case .recovery:        return bodyShare * 0.425
        case .sleep:           return bodyShare * 0.375
        case .exertion:        return bodyShare * 0.20
        case .selfCare:        return careShare * 0.60
        case .nutrition:       return careShare * 0.40
        }
    }
}

// MARK: - The result

public struct DayScore: Equatable, Sendable {
    public struct Part: Equatable, Sendable {
        public let component: ScoreComponent
        public let value: Double?
        public let weight: Double
        /// The weight it actually carried after redistribution. Zero when absent.
        public let effectiveWeight: Double
        public let unavailable: String?

        /// This component's own mark out of ten, for the breakdown list.
        public var outOfTen: Double? { value.map { ($0 * 100).rounded() / 10 } }
    }

    public let dayKey: String
    public let policyVersion: Int

    /// 0...1, or nil when there was not enough to say.
    public let value: Double?

    /// Why there is no number. Nil when there is one.
    public let insufficient: String?

    public let parts: [Part]

    /// How much of the day's weight was actually present.
    public let coverage: Double

    /// True when the number stands on a minority of the day's inputs. It is
    /// still shown — just marked, so a 9.0 built from sleep alone does not look
    /// like a 9.0 built from the whole day.
    public let isProvisional: Bool

    public var hasValue: Bool { value != nil }

    /// The rating, 0...10, rounded to one decimal.
    public var outOfTen: Double? {
        value.map { ($0 * 100).rounded() / 10 }
    }

    /// What to show in a day cell. Never "0", never invented.
    public var displayValue: String {
        guard let outOfTen else { return "—" }
        return String(format: "%.1f", outOfTen)
    }

    /// Which groups actually contributed, for the "scored from sleep only" line.
    public var contributingGroups: [ScoreGroup] {
        ScoreGroup.allCases.filter { group in
            parts.contains { $0.component.group == group && $0.value != nil }
        }
    }
}

// MARK: - Scoring

public enum DayScoring {

    public static func score(dayKey: String,
                             inputs: [ScoreInput],
                             policy: ScorePolicy = .current) -> DayScore {

        // A component supplied twice would silently double its weight. Last one
        // wins, and every component the policy knows about is represented, so
        // callers can pass only what they have.
        var supplied: [ScoreComponent: ScoreInput] = [:]
        for input in inputs { supplied[input.component] = input }
        let resolved = ScoreComponent.allCases.map { component in
            supplied[component] ?? ScoreInput(component, value: nil,
                                              unavailable: "\(component.label) was not recorded")
        }

        let totalWeight = ScoreComponent.allCases.reduce(0.0) { $0 + policy.weight(of: $1) }
        let presentWeight = resolved.filter(\.counted)
            .reduce(0.0) { $0 + policy.weight(of: $1.component) }
        let coverage = totalWeight > 0 ? presentWeight / totalWeight : 0

        // Redistribution: the surviving components share the whole of the
        // available weight between them, in their original proportions. That is
        // what makes a missing component EXCLUDED rather than counted as zero.
        let parts = resolved.map { input -> DayScore.Part in
            let weight = policy.weight(of: input.component)
            return DayScore.Part(
                component: input.component,
                value: input.value,
                weight: weight,
                effectiveWeight: input.counted && presentWeight > 0 ? weight / presentWeight : 0,
                unavailable: input.unavailable
            )
        }

        guard coverage >= policy.minimumCoverage, presentWeight > 0 else {
            return DayScore(
                dayKey: dayKey, policyVersion: policy.version, value: nil,
                insufficient: explain(missing: resolved.filter { !$0.counted }, coverage: coverage),
                parts: parts, coverage: coverage, isProvisional: true
            )
        }

        let total = parts.reduce(0.0) { running, part in
            guard let value = part.value else { return running }
            return running + value * part.effectiveWeight
        }

        return DayScore(
            dayKey: dayKey, policyVersion: policy.version,
            value: min(1, max(0, total)), insufficient: nil,
            parts: parts, coverage: coverage,
            isProvisional: coverage < policy.confidentCoverage
        )
    }

    private static func explain(missing: [ScoreInput], coverage: Double) -> String {
        let names = missing.compactMap { $0.unavailable ?? $0.component.label }
        guard !names.isEmpty else { return "Not enough recorded to score this day." }
        return "Not enough recorded to score this day — missing \(names.joined(separator: ", "))."
    }

    // MARK: Building inputs
    //
    // Every raw measurement becomes a 0...1 here rather than at the call site,
    // so the mapping is one testable place instead of five inline expressions
    // in a view model. The rule each one follows is the same: nothing logged is
    // UNAVAILABLE, and only a real measurement is allowed to be a zero.

    /// Focus inputs from the day's history records.
    ///
    /// No sessions at all is UNAVAILABLE, not zero. A day Nick spent in meetings
    /// is not a day he failed at focus, and scoring it as such would make the
    /// number something to resent rather than read.
    public static func focusInputs(records: [HistoryRecord]) -> [ScoreInput] {
        guard !records.isEmpty else {
            return [
                ScoreInput(.focusServed, value: nil, unavailable: "no focus session today"),
                ScoreInput(.focusCompletion, value: nil, unavailable: "no focus session today")
            ]
        }

        let planned = records.reduce(0.0) { $0 + $1.plannedFocusSeconds }
        let served = records.reduce(0.0) { $0 + $1.servedFocusSeconds }
        let blocks = records.reduce(0) { $0 + $1.totalFocusBlocks }
        let done = records.reduce(0) { $0 + $1.completedFocusBlocks }

        return [
            ScoreInput(.focusServed, value: planned > 0 ? served / planned : nil,
                       unavailable: planned > 0 ? nil : "the session had no planned focus"),
            ScoreInput(.focusCompletion, value: blocks > 0 ? Double(done) / Double(blocks) : nil,
                       unavailable: blocks > 0 ? nil : "the session had no blocks")
        ]
    }

    /// Reminders: what was ticked off, against what was left sitting overdue.
    ///
    /// Two things, deliberately. A ratio alone says a day with one task due and
    /// one done was perfect, which is how a score stops meaning anything; a
    /// count alone punishes a quiet Sunday. So most of the mark is "did you
    /// clear what was actually on you", and the rest is credit for volume, with
    /// four ticks standing in for a full day of them.
    ///
    /// Only OVERDUE deadlines count against the day. Something due next Friday
    /// is not a failure today.
    public static func tasksInput(completed: Int, overdue: Int) -> ScoreInput {
        guard completed + overdue > 0 else {
            return ScoreInput(.tasks, value: nil, unavailable: "nothing was due or ticked off")
        }
        let cleared = Double(completed) / Double(completed + overdue)
        let volume = min(1, Double(completed) / 4)
        return ScoreInput(.tasks, value: cleared * 0.7 + volume * 0.3)
    }

    /// Whoop percentages, straight through. 0...100 → 0...1.
    public static func recoveryInput(percent: Int?) -> ScoreInput {
        ScoreInput(.recovery, value: percent.map { Double($0) / 100 },
                   unavailable: percent == nil ? "Whoop had no recovery for this day" : nil)
    }

    public static func sleepInput(percent: Int?) -> ScoreInput {
        ScoreInput(.sleep, value: percent.map { Double($0) / 100 },
                   unavailable: percent == nil ? "Whoop had no sleep score for this day" : nil)
    }

    /// Strain against the band today's recovery actually supports.
    ///
    /// Whoop's own model, and the reason this is not "more strain is better":
    /// recovery buys you strain. Inside the band is a ten. Under it earns
    /// partial credit that rises with effort — a walk is not nothing. Over it
    /// is NOT scored as a failure either, because the day was worked; it just
    /// stops being a ten, and it falls off gently rather than off a cliff.
    ///
    /// The band comes from the caller so the thresholds live in exactly one
    /// place (`StrainTarget`) instead of being copied into the domain.
    public static func exertionInput(strain: Double?, bandLow: Double, bandHigh: Double) -> ScoreInput {
        guard let strain else {
            return ScoreInput(.exertion, value: nil, unavailable: "no strain recorded")
        }
        guard bandLow > 0, bandHigh >= bandLow else {
            return ScoreInput(.exertion, value: nil, unavailable: "no strain band for this day")
        }
        if strain >= bandLow && strain <= bandHigh { return ScoreInput(.exertion, value: 1) }
        if strain < bandLow {
            return ScoreInput(.exertion, value: 0.35 + 0.65 * (strain / bandLow))
        }
        return ScoreInput(.exertion, value: max(0.55, 1 - (strain - bandHigh) / 8))
    }

    /// The hand-logged half of health: water and supplements.
    ///
    /// Only counts what is actually there. Nick does not go back and log water
    /// for last Tuesday, so an untouched past day must read as "not logged" —
    /// scoring it zero would drag every day he did not open the app down into
    /// the red and make the whole grid a lie.
    public static func selfCareInput(bottles: Int, bottleGoal: Int,
                                     supplementsTaken: Int, supplementsPlanned: Int) -> ScoreInput {
        var marks: [Double] = []
        if bottles > 0, bottleGoal > 0 {
            marks.append(min(1, Double(bottles) / Double(bottleGoal)))
        }
        if supplementsTaken > 0, supplementsPlanned > 0 {
            marks.append(min(1, Double(supplementsTaken) / Double(supplementsPlanned)))
        }
        guard !marks.isEmpty else {
            return ScoreInput(.selfCare, value: nil, unavailable: "no water or supplements logged")
        }
        return ScoreInput(.selfCare, value: marks.reduce(0, +) / Double(marks.count))
    }

    /// Calories against the goal, penalised in both directions.
    ///
    /// Symmetric on purpose: eating half the goal is as far from the target as
    /// eating half again as much, and a score that only punished overeating
    /// would quietly reward the worse of the two.
    public static func nutritionInput(calories: Int, goal: Int) -> ScoreInput {
        guard calories > 0, goal > 0 else {
            return ScoreInput(.nutrition, value: nil, unavailable: "nothing eaten was logged")
        }
        let miss = abs(Double(calories) - Double(goal)) / Double(goal)
        return ScoreInput(.nutrition, value: max(0, 1 - miss))
    }
}
