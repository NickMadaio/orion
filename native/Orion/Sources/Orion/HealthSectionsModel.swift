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

 • **Interpretation is gated on confidence by the TYPE, not by these builders.**
   `SectionNarrative.init` returns nil if a `.low`-confidence narrative carries
   an inference, so a builder that gets carried away fails loudly at the seam
   rather than shipping a confident sentence about two nights of data. Every
   builder here therefore passes `likelyMeans` and `consider` optimistically and
   lets the type refuse them — which is why `fallback` exists.
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
        /// How many days of history exist. Phase 31's ladder decides confidence
        /// from this and nothing else.
        var sampleCount: Int
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
            sampleCount: Int = 0, readingAgeHours: Double? = nil,
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
            self.sampleCount = sampleCount
            self.readingAgeHours = readingAgeHours
            self.recentSleepHours = recentSleepHours
            self.recentRecovery = recentRecovery
            self.journalEntryCount = journalEntryCount
        }
    }

    let inputs: Inputs

    /// The derived states, from the same engine the planner uses. Reusing
    /// `PlanningSignal.derive` rather than re-deriving means the tab and the
    /// brief can never disagree about whether recovery was "good" — two
    /// thresholds for one word is how they drift.
    private var signal: PlanningSignal {
        PlanningSignal.derive(
            recovery: inputs.recovery,
            sleepPerformance: inputs.sleepPerformance,
            sleepHours: inputs.sleepHours,
            strain: inputs.strain,
            sampleCount: inputs.sampleCount,
            readingAgeHours: inputs.readingAgeHours
        )
    }

    private var confidence: BaselineConfidence { signal.confidence }

    /// Whether an inference is allowed at all right now.
    private var mayInterpret: Bool { confidence != .low }

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

    /// Build with inferences when allowed, and fall back to the observation
    /// alone when the type refuses them.
    ///
    /// The fallback is not defensive padding: it is the behaviour the manifest
    /// asks for. At low confidence a section still says what happened.
    private func build(
        _ happened: String, _ likelyMeans: String?, _ consider: String?,
        _ sources: [HealthSource]
    ) -> SectionNarrative? {
        if mayInterpret,
           let full = SectionNarrative(happened: happened, likelyMeans: likelyMeans,
                                       consider: consider, sources: sources,
                                       confidence: confidence) {
            return full
        }
        return SectionNarrative(happened: happened, sources: sources, confidence: confidence)
    }

    private func today() -> SectionNarrative? {
        guard signal.hasAnything else {
            return SectionNarrative(
                happened: "No readings have arrived yet today.",
                sources: [.derived], confidence: confidence)
        }
        let happened = "Recovery is \(signal.recoveryWord) and last night reads \(signal.sleepWord)."
        return build(
            happened,
            "That usually means \(signal.cognitiveCapacityWord) capacity for focused work today.",
            "Put the demanding block where your capacity actually is, rather than where the calendar put it.",
            [.whoop, .derived])
    }

    private func sleep() -> SectionNarrative? {
        guard let hours = inputs.sleepHours else {
            return SectionNarrative(
                happened: "No sleep was recorded for last night.",
                sources: [.whoop], confidence: confidence)
        }
        // One figure, deliberately. The score and the hours together with a
        // baseline would be three, which is the budget, and leaves nothing for
        // the sentence that follows.
        let happened = "You slept \(Self.hours(hours)), which reads as \(signal.sleepWord)."
        return build(
            happened,
            "Short nights show up in the afternoon more often than the morning.",
            "If tonight can start earlier, that is worth more than catching up at the weekend.",
            [.whoop])
    }

    private func recovery() -> SectionNarrative? {
        guard let recovery = inputs.recovery else {
            return SectionNarrative(
                happened: "Recovery has not come in — the strap may not have synced.",
                sources: [.whoop], confidence: confidence)
        }
        let happened = "Recovery came in at \(recovery)%, which is \(signal.recoveryWord)."
        return build(
            happened,
            "Recovery is a morning number: it describes the night you had, not how the day is going.",
            "Treat it as the band you are working inside today rather than a score to beat.",
            [.whoop])
    }

    private func activity() -> SectionNarrative? {
        guard let strain = inputs.strain else {
            return SectionNarrative(
                happened: "No workout or strain has been recorded today.",
                sources: [.whoop, .manual], confidence: confidence)
        }
        let word: String
        switch signal.physicalLoad {
        case .heavy: word = "a heavy day"
        case .steady: word = "a steady day"
        case .light: word = "a light day"
        case .unknown: word = "an unread day"
        }
        return build(
            "Strain is \(Self.oneDecimal(strain)) so far, which is \(word).",
            "Load and recovery move together across a week rather than within one day.",
            "If the rest of the day is meant to be easy, it is worth keeping it that way.",
            [.whoop])
    }

    private func energy() -> SectionNarrative? {
        let fuelled = inputs.calories > 0
        let watered = inputs.waterBottles > 0
        // Two figures at most, and only the ones the person entered themselves.
        let happened: String
        if fuelled && watered {
            happened = "You have logged \(inputs.calories) calories and \(inputs.waterBottles) bottles."
        } else if fuelled {
            happened = "You have logged \(inputs.calories) calories and no water yet."
        } else if watered {
            happened = "You have logged \(inputs.waterBottles) bottles and no food yet."
        } else {
            happened = "Nothing has been logged for food or water yet today."
        }
        return build(
            happened,
            "Energy through the afternoon tracks what went in during the morning.",
            "A glass of water is the cheapest thing on this page.",
            [.manual, .derived])
    }

    private func trends() -> SectionNarrative? {
        let nights = inputs.recentSleepHours.count
        guard nights > 0 else {
            return SectionNarrative(
                happened: "There is not enough history yet to show a trend.",
                sources: [.derived], confidence: confidence)
        }
        return build(
            "The last \(nights) nights are on record.",
            "A fortnight is enough to see a direction; a single night is not.",
            "Look at the shape rather than yesterday.",
            [.whoop, .derived])
    }

    private func journal() -> SectionNarrative? {
        guard inputs.journalEntryCount > 0 else {
            return SectionNarrative(
                happened: "Nothing written down today. Anything you note here is used to explain later readings.",
                sources: [.manual], confidence: confidence)
        }
        return build(
            "You noted \(inputs.journalEntryCount) things today.",
            "Notes are what turn a number into something explainable.",
            "Keep noting the unusual days; they are the ones worth explaining.",
            [.manual])
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
        return HealthTrend(kind: kind, direction: Self.direction(points, mayInterpret: mayInterpret),
                           points: points, span: points.count, confidence: confidence)
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
        let whole = Int(value)
        let minutes = Int((value - Double(whole)) * 60).clamped(to: 0...59)
        return minutes == 0 ? "\(whole)h" : "\(whole)h\(String(format: "%02d", minutes))"
    }

    static func oneDecimal(_ value: Double) -> String {
        guard value.isFinite else { return "unread" }
        return String(format: "%.1f", value)
    }
}

private extension Int {
    func clamped(to range: ClosedRange<Int>) -> Int {
        Swift.min(Swift.max(self, range.lowerBound), range.upperBound)
    }
}
