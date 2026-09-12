import Foundation
import MobileCore

/*
 The health privacy boundary. Manifest Phase 33.

 The rule, in the manifest's own words: "Do not expose raw HealthKit values to
 unrelated ORION subsystems. Convert raw health measurements into minimal
 derived planning signals. Do not give planner raw HRV, heart rate, or other
 unnecessary measurements."

 Until this type existed the app did the opposite. `HealthSummary.prompt()`
 emitted "- HRV 116ms" and "- Resting heart rate 54" straight into a model
 prompt, and `MorningBrief` put recovery, sleep score and an HRV delta into the
 same prompt as the calendar and the task list, then asked the model to "tie the
 recovery to what is actually on his calendar today". That is Phase 38
 (health-aware planning) shipped before Phase 33's firewall existed, fed by
 exactly the measurements the firewall exists to withhold.

 What crosses this boundary is a CATEGORY and a REASON. What does not cross is
 any number a person could read as a measurement.

 Three things worth knowing about the design:

 • The vocabulary is MobileCore's, by type rather than by copied string. Phase 32
   already built SleepState, PhysicalRecovery, EnergyState and StressTrend, and a
   second set of enums whose members are also called `moderate` would drift.

 • `cognitiveCapacity` is a projection of `EnergyState`, not a seventh member of
   it. The manifest names it; Phase 32 shipped `energy_state`; they are the same
   quantity at two altitudes — what the health domain measures, versus what the
   planner is told. Adding a member would reopen a closed phase.

 • The reason string is NOT `HealthStateReading.reason`. That one embeds raw
   values — "resting heart rate 54 against your usual 52" — because it was
   written for a person reading the Health tab. Forwarding it would leak through
   the reason field after the numbers had been stripped from everywhere else.
   This is the easiest hole in the whole boundary to miss.

 Deliberately NOT here: deltas. "HRV +8 versus the 7-day average" is a raw
 measurement in disguise — it is the difference of two of them, and across two
 days of prompts it reconstructs both.

 What the Health TAB shows is untouched. Nick reading his own numbers on his own
 machine is not an unrelated subsystem; only the model-facing path narrows.
*/

/// How sure the reading is, and how recent — the two things a raw integer
/// cannot carry and the reason the brief gets better rather than worse.
enum SignalFreshness: String, CaseIterable {
    case unknown
    case current
    case today
    case stale
    case veryStale = "very_stale"

    var phrase: String {
        switch self {
        case .unknown: return "source age unknown"
        case .current: return "up to six hours old"
        case .today: return "between six hours and a day old"
        case .stale: return "between one and two days old"
        case .veryStale: return "several days old"
        }
    }
}

/// Everything the planner and the narrator are allowed to know about health.
struct PlanningSignal: Equatable {
    var sleep: SleepState = .unknown
    var physicalRecovery: PhysicalRecovery = .unknown
    var physicalLoad: PhysicalLoad = .unknown
    var cognitiveCapacity: EnergyState = .unknown
    var stressTrend: StressTrend = .unknown
    var confidence: BaselineConfidence = .low
    var freshness: SignalFreshness = .unknown

    /// A sentence with no numbers in it. Built here rather than forwarded from
    /// MobileCore, for the reason in the header.
    var plannerReason: String = "no health readings yet"

    var hasAnything: Bool {
        sleep != .unknown || physicalRecovery != .unknown || cognitiveCapacity != .unknown
    }

    /// What the manifest calls `cognitive_capacity`, in the manifest's words.
    /// A total switch, so adding an EnergyState member is a compile error here
    /// rather than a silent fallthrough.
    var cognitiveCapacityWord: String {
        switch cognitiveCapacity {
        case .low: return "reduced"
        case .moderate: return "typical"
        case .high: return "elevated"
        case .unknown: return "unknown"
        }
    }

    var sleepWord: String {
        switch sleep {
        case .wellBelowBaseline: return "well below his usual"
        case .belowBaseline: return "below his usual"
        case .atBaseline: return "about his usual"
        case .aboveBaseline: return "above his usual"
        case .unknown: return "unknown"
        }
    }

    var recoveryWord: String {
        switch physicalRecovery {
        case .limited: return "limited"
        case .moderate: return "moderate"
        case .good: return "good"
        case .unknown: return "unknown"
        }
    }

    /// The lines a prompt may contain. No caller assembles health prose except
    /// through here, which is what makes the boundary checkable.
    func promptLines() -> [String] {
        guard hasAnything else { return [] }
        var lines: [String] = []
        if sleep != .unknown { lines.append("- Sleep: \(sleepWord).") }
        if physicalRecovery != .unknown { lines.append("- Physical recovery: \(recoveryWord).") }
        if cognitiveCapacity != .unknown {
            lines.append("- Cognitive capacity: \(cognitiveCapacityWord).")
        }
        if stressTrend != .unknown { lines.append("- Strain trend: \(stressTrend.rawValue).") }
        lines.append("- Reading confidence: \(confidence.rawValue), \(freshness.phrase).")
        if !plannerReason.isEmpty { lines.append("- \(plannerReason)") }
        return lines
    }
}

// MARK: - The only place a raw measurement becomes a category

extension PlanningSignal {

    /// Derive the signal from the wearable readings.
    ///
    /// This function is the boundary. Raw values go in; nothing that could be
    /// read as a measurement comes out. Everything downstream — the prompt
    /// builders, the narrator — sees only the result.
    ///
    /// The thresholds are the ones the app already used for its own colour
    /// coding (67 / 34 for recovery), so the categories agree with what the tiles
    /// show rather than introducing a second opinion on the same number.
    ///
    /// A fuller version would run MobileCore's `BaselineEngine` over the 41 days
    /// of history in `health-log.json` and compare against a personal median
    /// rather than fixed cut-offs — that is what Phase 31 built it for, and it is
    /// the obvious next step. It is deliberately not done here: it changes what
    /// the categories MEAN, and doing that in the same change that moves the
    /// boundary would make a regression impossible to attribute.
    static func derive(
        recovery: Int?,
        sleepPerformance: Int?,
        sleepHours: Double?,
        strain: Double?,
        sampleCount: Int,
        readingAgeHours: Double?
    ) -> PlanningSignal {
        var signal = PlanningSignal()

        if let recovery {
            signal.physicalRecovery = recovery >= 67 ? .good : (recovery >= 34 ? .moderate : .limited)
            // Cognitive capacity tracks recovery here because recovery is the
            // only input available. When sleep consistency and respiratory rate
            // have a source, this should widen -- recorded rather than pretended.
            signal.cognitiveCapacity = recovery >= 67 ? .high : (recovery >= 34 ? .moderate : .low)
        }

        if let sleepPerformance {
            signal.sleep = sleepPerformance >= 85 ? .aboveBaseline
                : (sleepPerformance >= 70 ? .atBaseline
                   : (sleepPerformance >= 55 ? .belowBaseline : .wellBelowBaseline))
        } else if let sleepHours {
            // Hours alone is a weaker signal than the score, so it may only ever
            // reach `atBaseline` -- never "above". Claiming a good night from
            // duration alone is the kind of false confidence Phase 31 refuses.
            signal.sleep = sleepHours >= 7 ? .atBaseline
                : (sleepHours >= 6 ? .belowBaseline : .wellBelowBaseline)
        }

        if let strain {
            signal.physicalLoad = strain >= 14 ? .heavy : (strain >= 8 ? .steady : .light)
            signal.stressTrend = strain >= 14 ? .building : (strain >= 8 ? .steady : .easing)
        }

        // Phase 31's ladder: below seven observations there is no baseline worth
        // the name, and twenty-one is where it stops being provisional.
        signal.confidence = sampleCount >= 21 ? .high : (sampleCount >= 7 ? .moderate : .low)

        if let readingAgeHours, readingAgeHours.isFinite, readingAgeHours >= 0 {
            signal.freshness = readingAgeHours <= 6 ? .current
                : (readingAgeHours <= 24 ? .today
                   : (readingAgeHours <= 48 ? .stale : .veryStale))
        }

        signal.plannerReason = Self.reason(for: signal, hasAnyReading: recovery != nil || sleepPerformance != nil)
        return signal
    }

    /// A sentence about the reading, containing no numbers. Asserted numerically
    /// by the firewall test, so a future edit that reintroduces a value fails.
    private static func reason(for signal: PlanningSignal, hasAnyReading: Bool) -> String {
        guard hasAnyReading else { return "no health readings yet" }
        if signal.confidence == .low {
            return "not enough history yet to say what is usual for him"
        }
        switch (signal.sleep, signal.physicalRecovery) {
        case (.aboveBaseline, .good):
            return "slept longer than usual and recovered well"
        case (.wellBelowBaseline, _), (_, .limited):
            return "short on sleep or recovery, so today is one to protect"
        case (.atBaseline, .good), (.aboveBaseline, .moderate):
            return "sitting about where he usually does"
        default:
            return "a mixed reading rather than a clear one"
        }
    }
}

/// Where today's logged strain sits relative to the suggested band.
///
/// Three bits, not a number. The band itself is a pure function of recovery, so
/// re-deriving the position here keeps the raw strain figure out of scope at the
/// call site instead of leaving it one interpolation away.
enum StrainPosition: String, Equatable {
    case nothingLogged
    case under
    case inBand
    case over

    var line: String {
        switch self {
        case .nothingLogged: return "- No training logged yet today."
        case .under: return "- Training so far is below the band suggested for how he has recovered."
        case .inBand: return "- Training so far is inside the band suggested for how he has recovered."
        case .over: return "- Training so far is above the band suggested for how he has recovered."
        }
    }

    /// Derived from the reading and the band together, so neither escapes.
    static func of(strain: Double?, band: StrainTarget) -> StrainPosition {
        guard let strain else { return .nothingLogged }
        if strain < band.low { return .under }
        if strain > band.high { return .over }
        return .inBand
    }
}
