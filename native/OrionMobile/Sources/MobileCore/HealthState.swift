import Foundation

// Derived health states: what the numbers mean, said in words a person can act on.
//
// Two rules carry this file and both are about what a type is ALLOWED to say.
//
// "Do not represent these states as diagnoses" is a rule about words, and words
// are the one thing a type can hold exactly. The state values are closed enums
// containing no clinical term, and `ClinicalVocabulary` is checked against every
// member and every reason string. A state that cannot spell a diagnosis cannot
// deliver one.
//
// "Prefer categories and ranges over meaningless decimal scores" is why there is
// no number here at all. A "recovery score of 73" implies a precision four
// nights of sleep cannot support, and people act on it.

/// Words a health state may never contain.
///
/// Not a filter on user input -- a check on ORION's OWN vocabulary, run over the
/// enum cases and the reason strings it produces. The failure this prevents is
/// not somebody typing "insomnia"; it is ORION deciding to.
public enum ClinicalVocabulary {
    public static let forbidden: [String] = [
        "insomnia", "apnea", "apnoea", "depress", "anxiety", "disorder",
        "syndrome", "deficien", "diagnos", "symptom", "pathol", "chronic",
        "overtrain", "arrhythm", "hypertens", "diabet", "illness", "disease",
        "prescrib", "medicat", "treatment", "therapy", "clinical",
    ]

    /// Whether `text` contains a clinical term, case-insensitively.
    public static func contaminates(_ text: String) -> Bool {
        let lowered = text.lowercased()
        return forbidden.contains { lowered.contains($0) }
    }
}

public enum SleepState: String, CaseIterable, Sendable {
    case unknown
    case wellBelowBaseline = "well_below_baseline"
    case belowBaseline = "below_baseline"
    case atBaseline = "at_baseline"
    case aboveBaseline = "above_baseline"
}

public enum PhysicalRecovery: String, CaseIterable, Sendable {
    case unknown
    case limited
    case moderate
    case good
}

public enum PhysicalLoad: String, CaseIterable, Sendable {
    case unknown
    case light
    case steady
    case heavy
}

public enum EnergyState: String, CaseIterable, Sendable {
    case unknown
    case low
    case moderate
    case high
}

public enum StressTrend: String, CaseIterable, Sendable {
    case unknown
    case easing
    case steady
    case building
}

/// One derived state, and the four things the manifest says must always survive.
///
/// Required, not optional. "Always preserve reason, baseline, confidence and
/// freshness" implemented as four optional fields is four fields that are nil
/// the first time somebody is in a hurry -- and a state that cannot answer "why
/// do you say that?" is one a person cannot argue with.
public struct HealthStateReading<Value: RawRepresentable & Sendable>: Sendable
where Value.RawValue == String {
    public let value: Value
    /// A sentence about OBSERVATIONS. Never about a cause and never about a
    /// condition: "you slept an hour below your baseline, three nights running".
    public let reason: String
    /// The baseline this came from, not a copy of its numbers. Phase 31 already
    /// put value, spread, samples, confidence and freshness on one type; copying
    /// two of them here is how they come to disagree.
    public let baseline: Baseline?
    public let confidence: BaselineConfidence
    public let freshness: TimeInterval

    public init?(
        value: Value, reason: String, baseline: Baseline?,
        confidence: BaselineConfidence, freshness: TimeInterval
    ) {
        let trimmed = reason.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        guard !ClinicalVocabulary.contaminates(trimmed) else { return nil }
        guard !ClinicalVocabulary.contaminates(value.rawValue) else { return nil }
        guard freshness >= 0 else { return nil }
        self.value = value
        self.reason = trimmed
        self.baseline = baseline
        self.confidence = confidence
        self.freshness = freshness
    }
}

/// The whole picture at one moment.
public struct HealthState: Sendable {
    public let sleep: HealthStateReading<SleepState>
    public let physicalRecovery: HealthStateReading<PhysicalRecovery>
    public let physicalLoad: HealthStateReading<PhysicalLoad>
    public let energy: HealthStateReading<EnergyState>
    public let stressTrend: HealthStateReading<StressTrend>
    /// The WEAKEST confidence among the inputs, never an average. A state built
    /// from one solid baseline and one provisional one is provisional: averaging
    /// lets the good input hide the bad one, and the person acts on the average.
    public let dataConfidence: BaselineConfidence
}

public enum HealthStateEngine {
    /// How far from baseline counts as a departure, in multiples of the
    /// baseline's own spread. Deliberately relative: a person whose sleep varies
    /// by two hours has not had an unusual night at ninety minutes off, and a
    /// person whose sleep varies by fifteen minutes has.
    public static let departure = 1.0
    public static let largeDeparture = 2.0

    public static func weakest(_ levels: [BaselineConfidence?]) -> BaselineConfidence {
        let present = levels.compactMap { $0 }
        guard !present.isEmpty else { return .low }
        return present.min() ?? .low
    }

    private static func unknown<Value: RawRepresentable & Sendable>(
        _ value: Value, _ missing: String
    ) -> HealthStateReading<Value> where Value.RawValue == String {
        // A state produced by having no data must not look like a state produced
        // by measurement. `moderate` from nothing and `moderate` from a month of
        // readings are indistinguishable, and only one should change a plan.
        HealthStateReading(
            value: value,
            reason: "no reading: \(missing)",
            baseline: nil,
            confidence: .low,
            freshness: 0
        )!
    }

    /// The fallback when a reading could not be constructed at all.
    ///
    /// It used to say "the reason did not pass its own vocabulary check", which
    /// was true for one of the four things that can fail and a lie about the
    /// other three -- a negative freshness silently turned a real
    /// `wellBelowBaseline` into `unknown` and blamed the word list. A wrong
    /// explanation is worse than a vague one, because somebody acts on it.
    private static func unreadable<Value: RawRepresentable & Sendable>(
        _ value: Value
    ) -> HealthStateReading<Value> where Value.RawValue == String {
        unknown(value, "the inputs could not be read")
    }

    /// Whether a raw measurement is a number at all.
    ///
    /// Only `BaselineEngine.baseline` filtered non-finite values; the `latest*`
    /// readings and the last sleep sample came straight in, and three separate
    /// `Int(Double)` conversions here trap on NaN or infinity. An independent
    /// review crashed all three.
    private static func usable(_ value: Double?) -> Double? {
        guard let value, value.isFinite else { return nil }
        return value
    }

    public static func sleepState(
        last: HealthSample?, baseline: Baseline?
    ) -> HealthStateReading<SleepState> {
        guard let baseline, let last, let measured = usable(last.value) else {
            return unknown(SleepState.unknown, "no sleep baseline yet")
        }
        // `comparisonSpread`, not `max(spread, 1)`. The spread is no longer
        // quantised -- rounding it collapsed real variability to zero and made
        // a fifteen-minute difference "well below baseline" -- and one minute
        // was never the right floor for a quantity measured in bpm or steps.
        let spread = baseline.comparisonSpread
        let difference = measured - baseline.value
        let departures = difference / spread
        let value: SleepState
        if departures <= -largeDeparture { value = .wellBelowBaseline }
        else if departures <= -departure { value = .belowBaseline }
        else if departures >= departure { value = .aboveBaseline }
        else { value = .atBaseline }
        let minutes = Int(abs(difference).rounded())
        let direction = difference < 0 ? "below" : "above"
        let reason = value == .atBaseline
            ? "in line with your usual \(Int(baseline.value)) minutes"
            : "\(minutes) minutes \(direction) your usual \(Int(baseline.value))"
        return HealthStateReading(
            value: value, reason: reason, baseline: baseline,
            confidence: baseline.confidence, freshness: baseline.freshness
        ) ?? unreadable(SleepState.unknown)
    }

    public static func physicalRecovery(
        restingHeartRate: Baseline?, latestRestingHeartRate: Double?,
        variability: Baseline?, latestVariability: Double?
    ) -> HealthStateReading<PhysicalRecovery> {
        guard let restingHeartRate, let latestResting = usable(latestRestingHeartRate) else {
            return unknown(PhysicalRecovery.unknown, "no resting heart rate baseline yet")
        }
        let spread = restingHeartRate.comparisonSpread
        let elevated = (latestResting - restingHeartRate.value) / spread
        var value: PhysicalRecovery = elevated >= largeDeparture ? .limited
            : elevated >= departure ? .moderate : .good
        var parts = ["resting heart rate \(Int(latestResting)) against your usual \(Int(restingHeartRate.value))"]

        if let variability, let latestHrv = usable(latestVariability) {
            let hrvSpread = variability.comparisonSpread
            let suppressed = (variability.value - latestHrv) / hrvSpread
            if suppressed >= departure, value == .good { value = .moderate }
            if suppressed >= largeDeparture { value = .limited }
            parts.append("variability \(Int(latestHrv)) against your usual \(Int(variability.value))")
        }
        return HealthStateReading(
            value: value, reason: parts.joined(separator: ", "),
            baseline: restingHeartRate,
            confidence: weakest([restingHeartRate.confidence, variability?.confidence]),
            freshness: max(restingHeartRate.freshness, variability?.freshness ?? 0)
        ) ?? unreadable(PhysicalRecovery.unknown)
    }

    public static func physicalLoad(_ load: TrainingLoad?) -> HealthStateReading<PhysicalLoad> {
        guard let load, let ratio = usable(load.ratio) else {
            return unknown(PhysicalLoad.unknown, "not enough training history for a load ratio")
        }
        let value: PhysicalLoad = ratio >= 1.3 ? .heavy : ratio <= 0.8 ? .light : .steady
        return HealthStateReading(
            value: value,
            reason: "this week's training is \(Int((ratio * 100).rounded()))% of your usual week",
            baseline: nil, confidence: load.confidence, freshness: load.freshness
        ) ?? unreadable(PhysicalLoad.unknown)
    }

    public static func energyState(
        sleep: HealthStateReading<SleepState>, recovery: HealthStateReading<PhysicalRecovery>
    ) -> HealthStateReading<EnergyState> {
        guard sleep.value != .unknown || recovery.value != .unknown else {
            return unknown(EnergyState.unknown, "neither sleep nor recovery is known")
        }
        let poorSleep = sleep.value == .wellBelowBaseline || sleep.value == .belowBaseline
        let value: EnergyState
        if sleep.value == .wellBelowBaseline && recovery.value == .limited { value = .low }
        else if poorSleep || recovery.value == .limited { value = .moderate }
        else if sleep.value == .unknown || recovery.value == .unknown { value = .moderate }
        else { value = .high }
        return HealthStateReading(
            value: value,
            reason: "from sleep (\(sleep.value.rawValue)) and recovery (\(recovery.value.rawValue))",
            baseline: sleep.baseline,
            confidence: weakest([sleep.confidence, recovery.confidence]),
            freshness: max(sleep.freshness, recovery.freshness)
        ) ?? unreadable(EnergyState.unknown)
    }

    /// A trend needs two windows. One window is a reading, not a direction.
    public static func stressTrend(
        recent: Baseline?, earlier: Baseline?
    ) -> HealthStateReading<StressTrend> {
        guard let recent, let earlier else {
            return unknown(StressTrend.unknown, "not enough history to compare two periods")
        }
        let spread = earlier.comparisonSpread
        let change = (earlier.value - recent.value) / spread
        let value: StressTrend = change >= departure ? .building
            : change <= -departure ? .easing : .steady
        return HealthStateReading(
            value: value,
            reason: "comparing the last stretch against the one before it",
            baseline: recent,
            confidence: weakest([recent.confidence, earlier.confidence]),
            freshness: max(recent.freshness, earlier.freshness)
        ) ?? unreadable(StressTrend.unknown)
    }

    public static func assemble(
        sleep: HealthStateReading<SleepState>,
        recovery: HealthStateReading<PhysicalRecovery>,
        load: HealthStateReading<PhysicalLoad>,
        energy: HealthStateReading<EnergyState>,
        stress: HealthStateReading<StressTrend>
    ) -> HealthState {
        HealthState(
            sleep: sleep, physicalRecovery: recovery, physicalLoad: load,
            energy: energy, stressTrend: stress,
            dataConfidence: weakest([
                sleep.confidence, recovery.confidence, load.confidence,
                energy.confidence, stress.confidence,
            ])
        )
    }
}
