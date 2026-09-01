import Foundation

// Personal baselines, computed locally from local samples.
//
// The manifest's hardest instruction here is "do not fabricate precision", and
// it is easy to satisfy in prose because every statistical function in every
// language hands back a Double with sixteen digits. Three ways it gets broken,
// and what stops each:
//
//   - a baseline from too few nights          -> below the floor there is none
//   - digits the data does not support        -> the value is quantised
//   - a number that outlives its uncertainty  -> confidence and freshness are
//                                                fields, not metadata beside it
//
// There is deliberately no population table. "Do not compare users against
// generic population scores when personal baselines are more useful" is usually
// implemented as a fallback, which then gets used every time the personal
// baseline is missing -- exactly when the comparison is least useful and most
// likely to be believed. A missing baseline is nil. That is AGENTS.md's
// "missing health data is not zero", one level up: a missing baseline is not
// the average person's baseline.

/// The six the manifest names.
public enum BaselineKind: String, CaseIterable, Sendable {
    case sleepDuration = "sleep_duration"
    case sleepConsistency = "sleep_consistency"
    case restingHeartRate = "resting_heart_rate"
    case heartRateVariability = "heart_rate_variability"
    case activity
    case trainingLoad = "training_load"
}

/// How much a baseline is worth relying on.
///
/// A category, not a decimal. `confidence: 0.8137` is precision about
/// uncertainty, which is the same fabrication one level up -- and Phase 32 asks
/// for categories and ranges over meaningless decimal scores for exactly this
/// reason.
public enum BaselineConfidence: String, Sendable, Comparable, CaseIterable {
    case low
    case moderate
    case high

    private var rank: Int {
        switch self {
        case .low: return 0
        case .moderate: return 1
        case .high: return 2
        }
    }

    public static func < (lhs: BaselineConfidence, rhs: BaselineConfidence) -> Bool {
        lhs.rank < rhs.rank
    }
}

public enum BaselineRules {
    /// Fewer than a week of observations is not a personal baseline. Below this
    /// the answer is nil rather than a low-confidence number: a confident wrong
    /// number is worse than an absent one because it looks earned.
    public static let sampleFloor = 7

    /// What it takes to be more than provisional.
    public static let moderateSamples = 10
    public static let highSamples = 21

    /// Past this, the newest contributing sample is old enough that the
    /// baseline describes a person who may no longer exist. Confidence is
    /// capped, never silently kept.
    public static let staleAfter: TimeInterval = 7 * 24 * 3600
    public static let veryStaleAfter: TimeInterval = 21 * 24 * 3600

    /// Training load windows, in days.
    public static let acuteWindowDays = 7
    public static let chronicWindowDays = 28
}

/// One computed baseline. Value, spread, and the two things that say how much
/// the value means -- on the same type, so a caller cannot read one without
/// being handed the others.
public struct Baseline: Sendable, Equatable {
    public let kind: BaselineKind
    /// Quantised. See `BaselineEngine.quantise`.
    public let value: Double
    /// Median absolute deviation. **Not quantised.**
    ///
    /// The value is rounded for a person to read; the spread is what decides
    /// whether a night was unusual, and rounding it to the same coarse step
    /// collapses real variability to zero. A person sleeping 466-494 minutes
    /// has a spread of 14; quantised at low confidence it reported 0, the
    /// consumer's `max(spread, 1)` floor turned that into one minute, and a
    /// fifteen-minute difference became "well below baseline". That fabricates
    /// CERTAINTY, which is the same sin as fabricating precision pointed the
    /// other way. `reportedSpread` is the rounded one, for display only.
    public let spread: Double
    public let sampleCount: Int
    public let confidence: BaselineConfidence
    /// Age of the NEWEST contributing sample, not the age of the calculation.
    /// A baseline recomputed this morning from data that stopped arriving three
    /// weeks ago is three weeks old, and a watch that stopped syncing otherwise
    /// produces a baseline that looks current forever.
    public let freshness: TimeInterval
    public let unit: String

    public var isStale: Bool { freshness >= BaselineRules.staleAfter }

    /// The spread as a person should see it. Never use this to compare.
    public var reportedSpread: Double {
        BaselineEngine.quantise(spread, to: BaselineEngine.step(for: kind, at: confidence))
    }

    /// The smallest difference worth calling a departure for this kind.
    ///
    /// A consumer needs a floor, because a spread of zero is a real answer for
    /// somebody perfectly regular and dividing by it is not. The floor is the
    /// kind's own finest quantisation step rather than a bare `1`: one bpm and
    /// one step are not comparable quantities, and `max(spread, 1)` silently
    /// treated them as if they were.
    public var comparisonSpread: Double {
        max(spread, BaselineEngine.step(for: kind, at: .high))
    }

    public init(
        kind: BaselineKind, value: Double, spread: Double, sampleCount: Int,
        confidence: BaselineConfidence, freshness: TimeInterval, unit: String
    ) {
        self.kind = kind
        self.value = value
        self.spread = spread
        self.sampleCount = sampleCount
        self.confidence = confidence
        self.freshness = freshness
        self.unit = unit
    }
}

/// Acute against chronic load, when both windows have enough to say.
public struct TrainingLoad: Sendable, Equatable {
    public let acute: Double
    public let chronic: Double
    /// Absent when chronic load is zero. Not 1.0, and not infinity: "no ratio"
    /// and "a ratio of one" mean opposite things, and a division that can
    /// produce a special value is a division that will.
    public let ratio: Double?
    public let acuteSamples: Int
    public let chronicSamples: Int
    public let confidence: BaselineConfidence
    public let freshness: TimeInterval

    public init(
        acute: Double, chronic: Double, ratio: Double?, acuteSamples: Int,
        chronicSamples: Int, confidence: BaselineConfidence, freshness: TimeInterval
    ) {
        self.acute = acute
        self.chronic = chronic
        self.ratio = ratio
        self.acuteSamples = acuteSamples
        self.chronicSamples = chronicSamples
        self.confidence = confidence
        self.freshness = freshness
    }
}

public enum BaselineEngine {
    // -- statistics ---------------------------------------------------------

    /// The middle value. Median rather than mean throughout: one two-hour night
    /// after a flight is not a fact about how somebody sleeps, and the mean
    /// moves with it while the median needs half the evidence to agree.
    public static func median(_ values: [Double]) -> Double? {
        guard !values.isEmpty else { return nil }
        let sorted = values.sorted()
        let middle = sorted.count / 2
        if sorted.count % 2 == 1 { return sorted[middle] }
        return (sorted[middle - 1] + sorted[middle]) / 2
    }

    /// The mean direction of times-of-day, in minutes past midnight.
    ///
    /// Times of day are angles, and averaging them as numbers puts the centre of
    /// 23:50 and 00:10 at midday. Summing unit vectors and taking the direction
    /// of the result gives midnight, which is the answer.
    ///
    /// When the vectors cancel -- somebody whose bedtimes are spread right
    /// around the clock -- the direction is arbitrary. That is not papered over:
    /// any anchor is as good as any other for a person with no habitual bedtime,
    /// and the deviation spread that comes out will correctly be enormous, which
    /// is the true answer.
    public static func circularAnchor(_ minutes: [Double]) -> Double {
        guard !minutes.isEmpty else { return 0 }
        var x = 0.0
        var y = 0.0
        for value in minutes {
            let angle = 2 * Double.pi * value / 1440
            x += cos(angle)
            y += sin(angle)
        }
        var direction = atan2(y, x)
        if direction < 0 { direction += 2 * Double.pi }
        return direction * 1440 / (2 * Double.pi)
    }

    /// Median absolute deviation -- spread, robust for the same reason.
    public static func medianAbsoluteDeviation(_ values: [Double]) -> Double? {
        guard let centre = median(values) else { return nil }
        return median(values.map { abs($0 - centre) })
    }

    // -- precision ----------------------------------------------------------

    /// The step a value of this kind may be reported to, at this confidence.
    ///
    /// A resting heart rate baseline of 58.3719 from six readings claims a
    /// thousandth of a beat. The step widens as confidence falls, so a
    /// provisional baseline reads as provisional without a caveat attached.
    public static func step(for kind: BaselineKind, at confidence: BaselineConfidence) -> Double {
        switch kind {
        case .sleepDuration:               // minutes
            switch confidence { case .high: return 5; case .moderate: return 15; case .low: return 30 }
        case .sleepConsistency:            // minutes of variation
            switch confidence { case .high: return 5; case .moderate: return 15; case .low: return 30 }
        case .restingHeartRate:            // bpm
            switch confidence { case .high: return 1; case .moderate: return 2; case .low: return 5 }
        case .heartRateVariability:        // ms
            switch confidence { case .high: return 1; case .moderate: return 5; case .low: return 10 }
        case .activity:                    // steps
            switch confidence { case .high: return 100; case .moderate: return 500; case .low: return 1000 }
        case .trainingLoad:                // ratio
            switch confidence { case .high: return 0.05; case .moderate: return 0.1; case .low: return 0.25 }
        }
    }

    public static func quantise(_ value: Double, to step: Double) -> Double {
        guard step > 0 else { return value }
        return (value / step).rounded() * step
    }

    // -- confidence ---------------------------------------------------------

    /// From what there is, not from how good the answer feels.
    ///
    /// Freshness CAPS confidence rather than contributing to an average: a
    /// hundred readings that all stopped a month ago do not describe today,
    /// and averaging a large sample against poor freshness would let the sample
    /// size hide it.
    public static func confidence(sampleCount: Int, freshness: TimeInterval) -> BaselineConfidence {
        var level: BaselineConfidence
        if sampleCount >= BaselineRules.highSamples { level = .high }
        else if sampleCount >= BaselineRules.moderateSamples { level = .moderate }
        else { level = .low }

        if freshness >= BaselineRules.veryStaleAfter { level = .low }
        else if freshness >= BaselineRules.staleAfter { level = min(level, .moderate) }
        return level
    }

    // -- the baselines ------------------------------------------------------

    /// A baseline over whatever samples exist. **Missing days are simply absent.**
    ///
    /// They are not zeros. `AGENTS.md` records the consequence of the other
    /// choice: a score that counts a missing input as zero tells somebody they
    /// had a bad day because a watch did not sync. Here it would tell them their
    /// resting heart rate baseline is 30 because they wore nothing at weekends.
    public static func baseline(
        _ kind: BaselineKind,
        from samples: [HealthSample],
        unit: String,
        now: Date
    ) -> Baseline? {
        // `end <= now` as well as `isFinite`, matching `trainingLoad`. Without
        // it a baseline made entirely of future-dated samples reported
        // freshness 0.0 and `isStale == false` -- perfectly current data that
        // has not happened.
        let usable = samples.filter { $0.value.isFinite && $0.end <= now }
        guard usable.count >= BaselineRules.sampleFloor else { return nil }
        guard let newest = usable.map(\.end).max() else { return nil }
        let values = usable.map(\.value)
        guard let centre = median(values), let spread = medianAbsoluteDeviation(values) else {
            return nil
        }
        let freshness = max(now.timeIntervalSince(newest), 0)
        let level = confidence(sampleCount: usable.count, freshness: freshness)
        let precision = step(for: kind, at: level)
        return Baseline(
            kind: kind,
            value: quantise(centre, to: precision),
            spread: spread,
            sampleCount: usable.count,
            confidence: level,
            freshness: freshness,
            unit: unit
        )
    }

    /// Sleep consistency: how much bedtime moves, not how long sleep lasts.
    ///
    /// Two different questions that get collapsed constantly. Somebody sleeping
    /// a steady seven hours from 02:00 has excellent duration and poor
    /// consistency, and only one of those is a thing they can act on tonight.
    public static func sleepConsistency(
        from sleeps: [HealthSample], now: Date, calendar: Calendar = .current
    ) -> Baseline? {
        let sleeps = sleeps.filter { $0.end <= now }
        guard sleeps.count >= BaselineRules.sampleFloor else { return nil }
        // Minutes past midnight of each start, unwrapped around the day
        // boundary: 23:50 and 00:10 are twenty minutes apart, not 1,420.
        // A calendar that cannot answer is not midnight. `?? 0` turned
        // `Date.distantPast` into 00:00 for every sample and reported a perfect
        // zero minutes of variation from dates that mean nothing.
        var raw: [Double] = []
        for sample in sleeps {
            let components = calendar.dateComponents([.hour, .minute], from: sample.start)
            guard let hour = components.hour, let minute = components.minute else {
                return nil
            }
            raw.append(Double(hour * 60 + minute))
        }
        // The anchor has to be found on the CIRCLE, not on the number line.
        // A plain median of the raw minutes is wrong for precisely the case
        // this function exists to handle: bedtimes of 23:50 and 00:10 are
        // [1430, 10], whose median is 720 -- midday, the furthest possible
        // point from where the person actually sleeps. Every deviation is then
        // measured from the wrong centre and the answer is nonsense.
        //
        // So the anchor is the mean DIRECTION of the unit vectors. It is a mean
        // and that is fine here: it only decides which side of the clock each
        // value sits on. The spread itself is still a median absolute
        // deviation, so one late night cannot move it.
        let anchor = circularAnchor(raw)
        let unwrapped = raw.map { value -> Double in
            var difference = value - anchor
            if difference > 720 { difference -= 1440 }
            if difference < -720 { difference += 1440 }
            return difference
        }
        guard let spread = medianAbsoluteDeviation(unwrapped) else { return nil }
        guard let newest = sleeps.map(\.end).max() else { return nil }
        let freshness = max(now.timeIntervalSince(newest), 0)
        let level = confidence(sampleCount: sleeps.count, freshness: freshness)
        let precision = step(for: .sleepConsistency, at: level)
        return Baseline(
            kind: .sleepConsistency,
            // The value IS the spread here: consistency is a measure of
            // variation, so reporting a centre would be reporting a bedtime.
            value: quantise(spread, to: precision),
            spread: spread,
            sampleCount: sleeps.count,
            confidence: level,
            freshness: freshness,
            unit: "min"
        )
    }

    /// Acute against chronic load.
    public static func trainingLoad(
        from workouts: [HealthSample], now: Date
    ) -> TrainingLoad? {
        let acuteStart = now.addingTimeInterval(-Double(BaselineRules.acuteWindowDays) * 86400)
        let chronicStart = now.addingTimeInterval(-Double(BaselineRules.chronicWindowDays) * 86400)
        // `isFinite` AND non-negative, which `baseline()` has and this did not.
        // An infinite sample made acute and chronic both infinite, `chronic > 0`
        // passed, and the ratio was NaN -- which the consumer turned into
        // `Int(nan)` and a fatal error. A negative one made chronic tiny and
        // produced a ratio of 28,000. Training minutes below zero are not a
        // measurement of anything.
        let usable = workouts.filter { $0.value.isFinite && $0.value >= 0 }
        let acuteSamples = usable.filter { $0.end >= acuteStart && $0.end <= now }
        let chronicSamples = usable.filter { $0.end >= chronicStart && $0.end <= now }
        guard chronicSamples.count >= BaselineRules.sampleFloor else { return nil }

        let acute = acuteSamples.reduce(0.0) { $0 + $1.value }
        // Per-week average over the chronic window, so the two are comparable.
        let weeks = Double(BaselineRules.chronicWindowDays) / 7.0
        let chronic = chronicSamples.reduce(0.0) { $0 + $1.value } / weeks
        guard let newest = chronicSamples.map(\.end).max() else { return nil }
        let freshness = max(now.timeIntervalSince(newest), 0)
        let level = confidence(sampleCount: chronicSamples.count, freshness: freshness)
        let precision = step(for: .trainingLoad, at: level)
        return TrainingLoad(
            acute: acute,
            chronic: chronic,
            // Absent, not 1.0 and not infinity.
            // `chronic > 0` alone was not enough: the result must also be a
            // number somebody could act on.
            ratio: chronic > 0 && (acute / chronic).isFinite
                ? quantise(acute / chronic, to: precision) : nil,
            acuteSamples: acuteSamples.count,
            chronicSamples: chronicSamples.count,
            confidence: level,
            freshness: freshness
        )
    }
}
