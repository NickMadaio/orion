import Foundation
import MobileCore

/*
 PHASE 34 — the seven health sections, built from what this Mac actually holds.

 `HealthSections.swift` in MobileCore says what a section is ALLOWED to contain;
 this says what today's sections DO contain. The split matters: the rules are
 shared with the phone and provable without any data, while the wiring to
 `HealthLog` and `WhoopClient` is the Mac's business and changes when they do.

 Three things worth knowing before editing:

 • **This is the tab, not the planner.** Phase 33's firewall narrows the
   MODEL-facing path and says so explicitly — "Nick reading his own numbers on
   his own machine is not an unrelated subsystem". So these sections may name
   figures, within `SectionNarrative.figureBudget`, and `PlanningSignal` still
   may not. Do not "fix" the apparent inconsistency by stripping numbers here;
   that would make the Health tab useless to answer a question it exists for.

 • **An absent input produces an observation and nothing else.** Every builder
   below falls through to a `happened`-only narrative when the reading is
   missing, rather than omitting the section. A section that vanishes when the
   strap did not sync looks identical to a section that has nothing to say, and
   `DayScore` already records what scoring a missing input as zero costs.

 • **History is not a personal comparison.** These sections report available
   readings and local entries. Generic score thresholds and sample counts do
   not establish someone's usual sleep, energy or capacity, so these builders
   do not turn them into personalised advice.
*/

struct HealthSectionsModel {

    /// Everything the seven sections are built from, gathered in one value so a
    /// test can construct the whole input rather than a stand-in for it.
    struct Inputs {
        var recovery: Int?
        var sleepPerformance: Int?
        var sleepHours: Double?
        var hrv: Int?
        var restingHeartRate: Int?
        var strain: Double?
        var calories: Int
        var calorieTarget: Int
        var waterBottles: Int
        var waterTarget: Int
        /// Count only days containing the corresponding WHOOP measurement.
        var recoverySampleCount: Int
        var sleepSampleCount: Int
        var strainSampleCount: Int
        var readingAgeHours: Double?
        /// Most recent first, at most a fortnight — the Trends section's series.
        var recentSleepHours: [Double]
        var recentRecovery: [Double]
        var journalEntryCount: Int

        init(
            recovery: Int? = nil, sleepPerformance: Int? = nil, sleepHours: Double? = nil,
            hrv: Int? = nil, restingHeartRate: Int? = nil, strain: Double? = nil,
            calories: Int = 0, calorieTarget: Int = 2_200,
            waterBottles: Int = 0, waterTarget: Int = 9,
            recoverySampleCount: Int = 0, sleepSampleCount: Int = 0,
            strainSampleCount: Int = 0, readingAgeHours: Double? = nil,
            recentSleepHours: [Double] = [], recentRecovery: [Double] = [],
            journalEntryCount: Int = 0
        ) {
            self.recovery = recovery
            self.sleepPerformance = sleepPerformance
            self.sleepHours = sleepHours
            self.hrv = hrv
            self.restingHeartRate = restingHeartRate
            self.strain = strain
            self.calories = calories
            self.calorieTarget = calorieTarget
            self.waterBottles = waterBottles
            self.waterTarget = waterTarget
            self.recoverySampleCount = recoverySampleCount
            self.sleepSampleCount = sleepSampleCount
            self.strainSampleCount = strainSampleCount
            self.readingAgeHours = readingAgeHours
            self.recentSleepHours = recentSleepHours
            self.recentRecovery = recentRecovery
            self.journalEntryCount = journalEntryCount
        }
    }

    let inputs: Inputs

    private func confidence(samples: Int) -> BaselineConfidence {
        guard let age = inputs.readingAgeHours, age.isFinite, age >= 0, age <= 24 else {
            return .low
        }
        return seriesConfidence(count: samples)
    }

    /// Age of the oldest available WHOOP component, not the last network sync.
    var readingStatus: String {
        guard let age = inputs.readingAgeHours, age.isFinite, age >= 0 else {
            return "Reading age unknown"
        }
        if age <= 24 { return "Available readings are at most a day old" }
        return "Older readings — not a current-day assessment"
    }

    func provenanceDetail(for section: HealthSection) -> String {
        switch section {
        case .energy, .journal:
            return "Local entries only. These do not establish a personal baseline or support an interpretation."
        case .trends:
            return "History coverage describes the available series, not a comparison with your personal baseline."
        default:
            return readingStatus + ". Age uses the oldest available WHOOP record; syncing does not make an old reading current. History coverage alone is not a personal baseline."
        }
    }

    // MARK: - The seven

    /// Every section, in the manifest's order. Always seven — see the note about
    /// a section that vanishes.
    func sections() -> [HealthSectionContent] {
        HealthSection.allCases.compactMap { section in
            narrative(for: section).map { HealthSectionContent(section: section, narrative: $0) }
        }
    }

    func narrative(for section: HealthSection) -> SectionNarrative? {
        switch section {
        case .today: return today()
        case .sleep: return sleep()
        case .recovery: return recovery()
        case .activity: return activity()
        case .energy: return energy()
        case .trends: return trends()
        case .journal: return journal()
        }
    }

    // MARK: Builders

    private func observation(_ text: String, sources: [HealthSource],
                             confidence: BaselineConfidence = .low) -> SectionNarrative? {
        SectionNarrative(happened: text, sources: sources, confidence: confidence)
    }

    private func today() -> SectionNarrative? {
        let available = [inputs.recovery != nil ? "recovery" : nil,
                         inputs.sleepHours != nil || inputs.sleepPerformance != nil ? "sleep" : nil,
                         inputs.strain != nil ? "strain" : nil].compactMap { $0 }
        guard !available.isEmpty else {
            return observation("WHOOP readings are unavailable. This does not establish what happened today.",
                               sources: [.whoop])
        }
        let sampleCounts = [inputs.recovery != nil ? inputs.recoverySampleCount : nil,
                            inputs.sleepHours != nil || inputs.sleepPerformance != nil ? inputs.sleepSampleCount : nil,
                            inputs.strain != nil ? inputs.strainSampleCount : nil].compactMap { $0 }
        return observation("Available WHOOP readings cover " + available.joined(separator: ", ") + ".",
                           sources: [.whoop], confidence: confidence(samples: sampleCounts.min() ?? 0))
    }

    private func sleep() -> SectionNarrative? {
        var facts: [String] = []
        if let hours = inputs.sleepHours {
            facts.append("WHOOP reports \(Self.hours(hours)) in bed in the available sleep record.")
        }
        if let performance = inputs.sleepPerformance {
            facts.append("Reported sleep performance is \(performance)%.")
        }
        guard !facts.isEmpty else {
            return observation("A sleep reading is unavailable; this does not mean you did not sleep.",
                               sources: [.whoop])
        }
        return observation(facts.joined(separator: " "), sources: [.whoop],
                           confidence: confidence(samples: inputs.sleepSampleCount))
    }

    private func recovery() -> SectionNarrative? {
        guard let recovery = inputs.recovery else {
            return observation("Recovery has not come in; a reading may still be awaiting sync or scoring.",
                               sources: [.whoop])
        }
        return observation("The available WHOOP recovery reading is \(recovery)%.",
                           sources: [.whoop], confidence: confidence(samples: inputs.recoverySampleCount))
    }

    private func activity() -> SectionNarrative? {
        guard let strain = inputs.strain else {
            return observation("A WHOOP strain reading is unavailable. This does not establish whether you worked out.",
                               sources: [.whoop])
        }
        return observation("The available WHOOP strain reading is \(Self.oneDecimal(strain)).",
                           sources: [.whoop], confidence: confidence(samples: inputs.strainSampleCount))
    }

    private func energy() -> SectionNarrative? {
        let fuelled = inputs.calories > 0
        let watered = inputs.waterBottles > 0
        let happened: String
        if fuelled && watered {
            happened = "You have logged \(inputs.calories) calories and \(inputs.waterBottles) bottles."
        } else if fuelled {
            happened = "You have logged \(inputs.calories) calories; no water is logged yet."
        } else if watered {
            happened = "You have logged \(inputs.waterBottles) bottles; no food is logged yet."
        } else {
            happened = "Nothing has been logged for food or water yet today."
        }
        return observation(happened, sources: [.manual])
    }

    private func trends() -> SectionNarrative? {
        let nights = min(inputs.recentSleepHours.count, HealthTrend.maximumPoints)
        guard nights > 0 else {
            return observation("There is not enough history yet to show a trend.", sources: [.whoop])
        }
        return observation("The available history includes \(nights) time-in-bed readings.",
                           sources: [.whoop], confidence: seriesConfidence(count: nights))
    }

    private func journal() -> SectionNarrative? {
        guard inputs.journalEntryCount > 0 else {
            return observation("Nothing written down today. You can add context here for later review.",
                               sources: [.manual])
        }
        return observation("You noted \(inputs.journalEntryCount) things today.", sources: [.manual])
    }

    private func seriesConfidence(count: Int) -> BaselineConfidence {
        PlanningSignal.derive(recovery: nil, sleepPerformance: nil, sleepHours: nil,
                              strain: nil, sampleCount: count,
                              readingAgeHours: nil).confidence
    }

    // MARK: Trend series

    /// The summarised series behind the Trends section.
    ///
    /// Truncated HERE rather than by whoever draws it, because the cap is a
    /// product rule and a caller that forgets it silently reintroduces the wall
    /// of points the manifest forbids.
    func trend(_ kind: BaselineKind) -> HealthTrend? {
        let series: [Double]
        switch kind {
        case .sleepDuration: series = inputs.recentSleepHours
        default: series = inputs.recentRecovery
        }
        guard !series.isEmpty else { return nil }
        let points = Array(series.prefix(HealthTrend.maximumPoints))
        let historyConfidence = seriesConfidence(count: points.count)
        return HealthTrend(kind: kind,
                           direction: Self.direction(points, mayInterpret: historyConfidence != .low),
                           points: points, span: points.count, confidence: historyConfidence)
    }

    /// Newest first, so the FIRST half is the recent one.
    ///
    /// Getting this backwards silently inverts every trend on the page, which is
    /// why the ordering is stated in the parameter's documentation and pinned by
    /// a test rather than left to the reader.
    static func direction(_ points: [Double], mayInterpret: Bool) -> HealthTrend.Direction {
        guard mayInterpret, points.count >= 4 else { return .unclear }
        let half = points.count / 2
        let recent = points.prefix(half).reduce(0, +) / Double(half)
        let earlier = points.suffix(points.count - half)
        let older = earlier.reduce(0, +) / Double(earlier.count)
        guard older != 0 else { return .unclear }
        let change = (recent - older) / abs(older)
        // Five percent, because a smaller move is noise at this sample size and
        // reporting it as a direction is the same fabricated certainty that
        // quantising a spread produced in Phase 31.
        if change > 0.05 { return .improving }
        if change < -0.05 { return .declining }
        return .steady
    }

    /// `WhoopWeek.points` is **oldest → newest**. Every series on this model is
    /// **newest first**. Converting between them is one word and inverting every
    /// trend on the page is the cost of getting it wrong, so it is a named
    /// function with a test rather than a `.reversed()` at a call site.
    static func newestFirst(_ oldestFirst: [Double]) -> [Double] {
        Array(oldestFirst.reversed())
    }

    // MARK: Formatting

    /// `6h20`, not `6.333333`. One figure to a reader.
    static func hours(_ value: Double) -> String {
        guard value.isFinite, value >= 0 else { return "an unread night" }
        let totalMinutes = (value * 60).rounded()
        guard totalMinutes.isFinite, totalMinutes < Double(Int.max) else { return "an unread night" }
        let whole = Int(totalMinutes) / 60
        let minutes = Int(totalMinutes) % 60
        return minutes == 0 ? "\(whole)h" : "\(whole)h\(String(format: "%02d", minutes))"
    }

    static func oneDecimal(_ value: Double) -> String {
        guard value.isFinite else { return "unread" }
        return String(format: "%.1f", value)
    }
}
