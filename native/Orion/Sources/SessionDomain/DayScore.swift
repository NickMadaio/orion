//
//  A number for the day, and the reasons it must be allowed to refuse.
//
//  60 % focus, 40 % health. That split was decided; what was NOT decided, and
//  what this file is mostly about, is what happens when half the inputs are
//  missing — which is the normal case, not the edge case. Whoop does not sync
//  until mid-morning. Some days have no session at all.
//
//  Three rules, all from the plan's ninth correction:
//
//  1. MISSING IS NOT ZERO. A day with no health data is not a day with terrible
//     health. Scoring it as zero would tell Nick he had a bad day because a
//     watch did not sync, which is worse than saying nothing — he would act on
//     it. An unavailable component is EXCLUDED and its weight redistributed; if
//     too little is left, the score refuses to exist.
//
//  2. THE COMPONENTS ARE VISIBLE. A single number nobody can decompose is an
//     opinion wearing a score's clothes. Every component reports its own value,
//     its weight, and whether it counted.
//
//  3. THE VERSION IS PERSISTED. Weights will change. If a stored score carries
//     no version then changing them silently rewrites history — a day that was
//     green last month becomes amber with no edit anywhere. Storing the version
//     means old days keep the colours they were given and new days get the new
//     policy, which is the only honest way to change a scoring rule.
//

import Foundation

// MARK: - Components

public enum ScoreComponent: String, Codable, Sendable, CaseIterable {
    /// Minutes of focus actually served against what was planned.
    case focusServed
    /// Whether the blocks that were started were finished.
    case focusCompletion
    /// Whoop recovery.
    case recovery
    /// Whoop sleep performance.
    case sleep
    /// Hydration and supplements — the parts Nick logs by hand.
    case selfCare

    public var isHealth: Bool {
        switch self {
        case .focusServed, .focusCompletion: return false
        case .recovery, .sleep, .selfCare: return true
        }
    }

    public var label: String {
        switch self {
        case .focusServed: return "focus served"
        case .focusCompletion: return "blocks finished"
        case .recovery: return "recovery"
        case .sleep: return "sleep"
        case .selfCare: return "hydration and supplements"
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
    public static let currentVersion = 1

    public let version: Int

    /// The agreed split.
    public let focusShare: Double
    public let healthShare: Double

    /// How much of the total weight has to be present before a number is
    /// allowed to exist at all.
    ///
    /// Half. Below that the surviving components are being asked to speak for
    /// more of the day than they know about, and "insufficient data" is the
    /// true answer.
    public let minimumCoverage: Double

    public init(version: Int = ScorePolicy.currentVersion,
                focusShare: Double = 0.60, healthShare: Double = 0.40,
                minimumCoverage: Double = 0.5) {
        self.version = version
        self.focusShare = focusShare
        self.healthShare = healthShare
        self.minimumCoverage = minimumCoverage
    }

    public static let current = ScorePolicy()

    /// Weight within the whole day.
    public func weight(of component: ScoreComponent) -> Double {
        switch component {
        case .focusServed:     return focusShare * 0.7
        case .focusCompletion: return focusShare * 0.3
        case .recovery:        return healthShare * 0.4
        case .sleep:           return healthShare * 0.4
        case .selfCare:        return healthShare * 0.2
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

    public var hasValue: Bool { value != nil }

    /// What to show instead of a number. Never "0".
    public var displayValue: String {
        guard let value else { return "—" }
        return "\(Int((value * 100).rounded()))"
    }
}

// MARK: - Scoring

public enum DayScoring {

    public static func score(dayKey: String,
                             inputs: [ScoreInput],
                             policy: ScorePolicy = .current) -> DayScore {

        let present = inputs.filter(\.counted)
        let totalWeight = inputs.reduce(0.0) { $0 + policy.weight(of: $1.component) }
        let presentWeight = present.reduce(0.0) { $0 + policy.weight(of: $1.component) }
        let coverage = totalWeight > 0 ? presentWeight / totalWeight : 0

        // Redistribution: the surviving components share the whole of the
        // available weight between them, in their original proportions. That is
        // what makes a missing component EXCLUDED rather than counted as zero.
        let parts = inputs.map { input -> DayScore.Part in
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
                insufficient: explain(missing: inputs.filter { !$0.counted }, coverage: coverage),
                parts: parts, coverage: coverage
            )
        }

        let total = parts.reduce(0.0) { running, part in
            guard let value = part.value else { return running }
            return running + value * part.effectiveWeight
        }

        return DayScore(
            dayKey: dayKey, policyVersion: policy.version,
            value: min(1, max(0, total)), insufficient: nil,
            parts: parts, coverage: coverage
        )
    }

    private static func explain(missing: [ScoreInput], coverage: Double) -> String {
        let names = missing.compactMap { $0.unavailable ?? $0.component.label }
        guard !names.isEmpty else { return "Not enough recorded to score this day." }
        return "Not enough recorded to score this day — missing \(names.joined(separator: ", "))."
    }

    // MARK: Building inputs

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
}
