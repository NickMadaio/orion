import Foundation

// PHASE 37 — user-defined experiments.
//
// "Try no caffeine after 2pm for a fortnight and see what happens to recovery."
// The manifest asks for five things to be definable — behaviour, metric,
// duration, baseline, potential confounders — plus automatic tracking, clear
// uncertainty, and one prohibition: do not treat experiments as clinical trials
// or medical conclusions.
//
// ## What an experiment here is, and is not
//
// It is a NAMED WINDOW over the same data Phase 36 already reads, with a
// baseline captured before it starts. It is not a trial. There is no
// randomisation, no control arm, no blinding, and one participant who knows
// exactly what he is testing. Every one of those absences is a reason the result
// cannot support a causal claim, which is why `ExperimentResult` reports an
// `Association` — the Phase 36 type that can only phrase itself four ways — and
// has no field anywhere that says "worked".
//
// ## Why confounders are a first-class field rather than a note
//
// The manifest lists them among the five definable things, and the reason shows
// up the moment you run one. Nick tests caffeine for a fortnight; he also flies
// to London in the middle of it. The recovery drop is real and the experiment
// is worthless, and a result that does not say so is worse than no result —
// he will act on it.
//
// So a confounder that actually occurred during the window is COUNTED, and a
// result whose window is contaminated past `confoundedThreshold` is reported as
// inconclusive rather than as a finding. That is a rule about the data, not a
// caveat in prose that a reader skips.
//
// ## Uncertainty is structural, not a disclaimer
//
// There is no "success" boolean. The strongest thing an experiment can say is
// the strongest thing Phase 36 can say, and the weakest is `.insufficientData`.
// A disclaimer under a verdict gets ignored; a type with no verdict in it
// cannot be misread.

// MARK: - Definition

/// What a person set out to test.
public struct Experiment: Sendable, Equatable, Identifiable {

    public let id: String
    /// What Nick is changing.
    public let behaviour: JournalEventType
    /// What he is watching. The manifest's "metric".
    public let metric: CorrelationOutcome
    /// How many days it runs for.
    public let durationDays: Int
    /// The day it began, as a `yyyy-MM-dd` key so it lines up with
    /// `CorrelationDay` without needing a timezone. Phase 40's lesson: a civil
    /// date is not an instant, and giving it one picks a zone silently.
    public let startedOn: String
    /// What the metric looked like BEFORE it started. Captured at definition
    /// time, not recomputed later — a baseline that moves with the experiment
    /// is not a baseline.
    public let baseline: ExperimentBaseline?
    /// Other behaviours that would muddy the reading if they happened too.
    public let confounders: [JournalEventType]

    /// A fortnight is the shortest window this will accept.
    ///
    /// Not arbitrary: Phase 36 needs five days on each side before it will say
    /// anything, and an experiment shorter than that can only ever return
    /// "insufficient data" — which would make the feature look broken rather
    /// than make the user careful.
    public static let minimumDuration = 14

    public init?(
        id: String, behaviour: JournalEventType, metric: CorrelationOutcome,
        durationDays: Int, startedOn: String,
        baseline: ExperimentBaseline? = nil,
        confounders: [JournalEventType] = []
    ) {
        guard !id.trimmingCharacters(in: .whitespaces).isEmpty else { return nil }
        guard durationDays >= Experiment.minimumDuration else { return nil }
        guard startedOn.count == 10, startedOn.filter({ $0 == "-" }).count == 2 else { return nil }
        // Testing a behaviour against itself is not an experiment, and a
        // confounder that IS the behaviour would always contaminate the window.
        guard !confounders.contains(behaviour) else { return nil }
        guard behaviour != .note else { return nil }
        self.id = id
        self.behaviour = behaviour
        self.metric = metric
        self.durationDays = durationDays
        self.startedOn = startedOn
        self.baseline = baseline
        self.confounders = confounders
    }
}

/// What the metric looked like before the experiment began.
public struct ExperimentBaseline: Sendable, Equatable {
    public let mean: Double
    public let spread: Double
    public let dayCount: Int

    public init?(mean: Double, spread: Double, dayCount: Int) {
        guard mean.isFinite, spread.isFinite, spread >= 0, dayCount > 0 else { return nil }
        self.mean = mean
        self.spread = spread
        self.dayCount = dayCount
    }
}

// MARK: - Tracking

/// Where an experiment has got to.
public enum ExperimentStage: String, Sendable, CaseIterable {
    case notStarted = "not_started"
    case running
    case complete
}

/// What an experiment has to say, which is deliberately not much.
public struct ExperimentResult: Sendable, Equatable {

    public let experiment: Experiment
    public let stage: ExperimentStage
    /// Days inside the window that carry a reading for the metric.
    public let observedDays: Int
    /// Days inside the window on which a declared confounder also occurred.
    public let confoundedDays: Int
    /// Confounders that actually turned up, so the reader knows WHICH.
    public let confoundersSeen: [JournalEventType]

    /// The finding, in Phase 36's vocabulary. Nil while the experiment is still
    /// running — a partial result is the single most misread thing an
    /// experiment can produce.
    public let association: Association?

    /// True when so much of the window was contaminated that the reading cannot
    /// be trusted, regardless of what the numbers say.
    public let inconclusive: Bool

    /// The sentence a person reads. Never a verdict.
    public var summary: String {
        switch stage {
        case .notStarted:
            return "\(experiment.behaviour.rawValue.capitalized) versus "
                + "\(experiment.metric.label): not started."
        case .running:
            return "\(experiment.behaviour.rawValue.capitalized) versus "
                + "\(experiment.metric.label): \(observedDays) of "
                + "\(experiment.durationDays) days recorded. No reading until it finishes."
        case .complete:
            if inconclusive {
                let names = confoundersSeen.map(\.rawValue).joined(separator: ", ")
                return "Inconclusive: \(confoundedDays) of \(observedDays) days also had "
                    + "\(names.isEmpty ? "something else going on" : names) in them."
            }
            return association?.sentence
                ?? "Not enough days with a reading to say anything yet."
        }
    }
}

public enum ExperimentEngine {

    /// The share of observed days that may carry a confounder before the result
    /// is called inconclusive.
    ///
    /// A third. Low enough that a fortnight with five disrupted days is still
    /// reportable, high enough that a move to another country in the middle of
    /// it is not. Named so it can be argued with rather than buried.
    public static let confoundedThreshold = 1.0 / 3.0

    /// Track an experiment against the days recorded so far.
    ///
    /// `days` is the same `CorrelationDay` list Phase 36 reads, so an experiment
    /// is a window over existing data rather than a second recording path. Two
    /// sources of truth about what happened on the 8th is how they disagree.
    public static func track(
        _ experiment: Experiment, days: [CorrelationDay], today: String
    ) -> ExperimentResult {
        let window = days
            .filter { $0.dayKey >= experiment.startedOn }
            .filter { $0.dayKey < endKey(experiment) }
        let observed = window.filter { $0.value(for: experiment.metric) != nil }

        let stage: ExperimentStage
        if today < experiment.startedOn {
            stage = .notStarted
        } else if today < endKey(experiment) {
            stage = .running
        } else {
            stage = .complete
        }

        let seen = experiment.confounders.filter { confounder in
            observed.contains { $0.behaviours.contains(confounder) }
        }
        let confounded = observed.filter { day in
            !experiment.confounders.filter(day.behaviours.contains).isEmpty
        }.count

        let contaminated = !observed.isEmpty
            && Double(confounded) / Double(observed.count) > confoundedThreshold

        // A finding only at the end, and only from a clean window. A partial
        // result is the single most misread thing an experiment can produce,
        // and a contaminated one is worse than none because it will be acted on.
        let association: Association?
        if stage == .complete && !contaminated {
            // `observed`, NOT `days`. Passing the whole history made the
            // reported finding a statement about every day ORION has ever seen
            // while `observedDays` beside it counted only the window -- so a
            // 14-day experiment printed "34 with, 14 without" on the same
            // screen as "14 days observed", and data from outside the window
            // could and did invert the sign of the result. `durationDays` had
            // no effect on the finding at all.
            association = CorrelationEngine.association(
                days: observed, behaviour: experiment.behaviour, outcome: experiment.metric)
        } else {
            association = nil
        }

        return ExperimentResult(
            experiment: experiment, stage: stage, observedDays: observed.count,
            confoundedDays: confounded, confoundersSeen: seen,
            association: association, inconclusive: stage == .complete && contaminated)
    }

    /// The exclusive end of the window, as a day key.
    ///
    /// Computed with a real calendar rather than by string arithmetic on the
    /// day number, which breaks at every month boundary.
    public static func endKey(_ experiment: Experiment) -> String {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = IANAZoneGMT
        guard let start = dayFormatter.date(from: experiment.startedOn),
              let end = calendar.date(byAdding: .day, value: experiment.durationDays, to: start)
        else { return experiment.startedOn }
        return dayFormatter.string(from: end)
    }

    static let IANAZoneGMT = TimeZone(identifier: "GMT")!

    static let dayFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: "GMT")
        return formatter
    }()

    /// Capture what the metric looked like over the days BEFORE a start date.
    ///
    /// Separate from `track` on purpose: a baseline is taken once, at
    /// definition time. Recomputing it later against a moving window is how an
    /// experiment quietly grades itself against its own result.
    public static func captureBaseline(
        days: [CorrelationDay], metric: CorrelationOutcome, before startedOn: String
    ) -> ExperimentBaseline? {
        let values = days.filter { $0.dayKey < startedOn }
            .compactMap { $0.value(for: metric) }
        guard !values.isEmpty else { return nil }
        return ExperimentBaseline(
            mean: CorrelationEngine.mean(values),
            spread: CorrelationEngine.deviation(values),
            dayCount: values.count)
    }
}
