import Foundation

// PHASE 39 — the morning plan and the evening review.
//
// The manifest asks for six things in the morning — fixed commitments, flexible
// time, priority tasks, estimated workload, relevant health state, conflicts —
// a proposal for "a realistic day", and four in the evening: completed,
// incomplete, time-estimate accuracy, carry-forward. Then one line that is
// easy to skim past and is the whole point: **use results to improve future
// planning.**
//
// ## What makes a day "realistic"
//
// The Phase 32.5 charter is explicit that an optional full-day plan "must not
// become silent over-scheduling", and that is the constraint this file is built
// around. `DayPlan.propose` will not return a plan whose work exceeds the
// flexible time available. It returns fewer tasks and says how many it left
// out. A planner that fits nine hours of work into six by not mentioning it is
// how a person stops trusting the plan — the first time they notice, every
// future plan is suspect.
//
// ## Why estimates are calibrated rather than trusted
//
// Everyone underestimates. The manifest asks for time-estimate ACCURACY in the
// evening and for results to improve future planning, and those two sentences
// are one mechanism: measure the ratio of actual to estimated, and multiply
// tomorrow's estimates by it.
//
// Three guards on that, because a naive version is worse than none:
//
//   · A minimum sample count, so one chaotic Tuesday does not permanently
//     inflate every estimate.
//   · A CLAMP, because an interrupted task that took six times its estimate is
//     a story about the interruption, not about estimating.
//   · The median, not the mean, for the same reason `BaselineEngine` chose it —
//     one catastrophic day should not move the number that quietly reshapes
//     every future day.
//
// ## Health enters as a state, never as a number
//
// `relevantHealth` is a `PlanningSignal`-shaped set of categories, matching
// Phase 33's boundary and Phase 38's advisor. There is no percentage in this
// file and there should never be one.

// MARK: - Tasks

/// A piece of work with a guess attached.
public struct PlannedTask: Sendable, Equatable, Identifiable {
    public let id: String
    public let title: String
    /// What Nick thinks it will take.
    public let estimateMinutes: Int
    /// Lower number sorts first. Deliberately not an enum: priorities get
    /// reordered constantly and a three-case enum forces a fight about whether
    /// something is "high" or "medium" when all that matters is what comes
    /// first.
    public let priority: Int
    /// Set in the evening.
    public let actualMinutes: Int?
    public let completed: Bool

    public init?(
        id: String, title: String, estimateMinutes: Int, priority: Int = 5,
        actualMinutes: Int? = nil, completed: Bool = false
    ) {
        guard !id.trimmingCharacters(in: .whitespaces).isEmpty else { return nil }
        guard !title.trimmingCharacters(in: .whitespaces).isEmpty else { return nil }
        guard estimateMinutes > 0, estimateMinutes <= 12 * 60 else { return nil }
        if let actualMinutes, actualMinutes < 0 { return nil }
        self.id = id
        self.title = title
        self.estimateMinutes = estimateMinutes
        self.priority = priority
        self.actualMinutes = actualMinutes
        self.completed = completed
    }
}

// MARK: - Conflicts

/// Something wrong with the day that ORION can see and cannot fix.
public struct PlanConflict: Sendable, Equatable {
    public enum Kind: String, Sendable, CaseIterable {
        /// Two required commitments at the same time. Only Nick can resolve it.
        case overlap
        /// More work asked for than there is room for.
        case overCommitted = "over_committed"
    }

    public let kind: Kind
    public let detail: String
}

// MARK: - Calibration

/// How wrong the estimates have been, and by how much.
///
/// The mechanism behind "use results to improve future planning". A factor
/// above 1 means things take longer than expected, which is the usual direction.
public struct EstimateCalibration: Sendable, Equatable {

    /// Below this many finished, timed tasks there is no factor — just 1.
    /// Five, so one chaotic Tuesday cannot permanently inflate every estimate.
    public static let minimumSamples = 5

    /// The widest correction that will ever be applied.
    ///
    /// A task that ran six times over is a story about an interruption, not
    /// about estimating, and letting it through would turn a half-hour job into
    /// a three-hour block forever.
    public static let bounds: ClosedRange<Double> = 0.5...2.0

    public let factor: Double
    public let sampleCount: Int

    public var isCalibrated: Bool { sampleCount >= EstimateCalibration.minimumSamples }

    /// Learn from finished work.
    ///
    /// The MEDIAN ratio, not the mean, for the reason `BaselineEngine` chose it:
    /// one catastrophic day should not move the number that quietly reshapes
    /// every future day.
    public static func from(_ tasks: [PlannedTask]) -> EstimateCalibration {
        let ratios = tasks.compactMap { task -> Double? in
            guard task.completed, let actual = task.actualMinutes, actual > 0 else { return nil }
            return Double(actual) / Double(task.estimateMinutes)
        }
        guard ratios.count >= minimumSamples else {
            return EstimateCalibration(factor: 1, sampleCount: ratios.count)
        }
        let median = CorrelationEngine.median(ratios)
        let clamped = Swift.min(Swift.max(median, bounds.lowerBound), bounds.upperBound)
        return EstimateCalibration(factor: clamped, sampleCount: ratios.count)
    }

    /// What to budget for a task, given what history says.
    public func adjusted(_ minutes: Int) -> Int {
        Int((Double(minutes) * factor).rounded())
    }
}

// MARK: - The morning

public struct DayPlan: Sendable, Equatable {

    public let commitments: [Commitment]
    /// The tasks that actually fit, in priority order.
    public let scheduled: [PlannedTask]
    /// The ones that did not, said out loud rather than dropped.
    public let deferred: [PlannedTask]
    /// Minutes not already spoken for by a commitment.
    public let flexibleMinutes: Int
    /// Calibrated total for `scheduled`.
    public let workloadMinutes: Int
    public let conflicts: [PlanConflict]
    public let calibration: EstimateCalibration

    /// The states Phase 33 permits across the boundary. No numbers.
    public let sleep: SleepState
    public let recovery: PhysicalRecovery
    public let energy: EnergyState

    /// The day a person is actually awake for, in minutes.
    ///
    /// Not 24 hours: a plan that treats 3am as schedulable is not a plan. From
    /// 08:00 to 22:00 unless someone says otherwise.
    public static let wakingStart = 8 * 60
    public static let wakingEnd = 22 * 60

    /// Build a realistic day.
    ///
    /// Realistic means the scheduled work FITS. Tasks are taken in priority
    /// order until the calibrated budget is spent, and everything after that is
    /// `deferred` rather than quietly omitted.
    public static func propose(
        commitments: [Commitment],
        tasks: [PlannedTask],
        history: [PlannedTask] = [],
        availableMinutes: Int? = nil,
        sleep: SleepState = .unknown,
        recovery: PhysicalRecovery = .unknown,
        energy: EnergyState = .unknown
    ) -> DayPlan {
        let calibration = EstimateCalibration.from(history)
        let committed = commitments.reduce(0) { $0 + $1.durationMinutes }
        let waking = wakingEnd - wakingStart
        // A timeline consumer can supply the union of actual free intervals,
        // after sleep, transitions and protected free time. Legacy callers
        // retain the original budget contract.
        let flexible = Swift.max(0, Swift.min(25 * 60, availableMinutes ?? (waking - committed)))

        var scheduled: [PlannedTask] = []
        var deferred: [PlannedTask] = []
        var spent = 0
        for task in tasks.filter({ !$0.completed }).sorted(by: { ($0.priority, $0.id) < ($1.priority, $1.id) }) {
            let cost = calibration.adjusted(task.estimateMinutes)
            if spent + cost <= flexible {
                scheduled.append(task)
                spent += cost
            } else {
                deferred.append(task)
            }
        }

        var conflicts = overlaps(in: commitments)
        if !deferred.isEmpty {
            conflicts.append(PlanConflict(
                kind: .overCommitted,
                detail: "\(deferred.count) task(s) do not fit in the "
                    + "\(flexible / 60)h \(flexible % 60)m you have left."))
        }

        return DayPlan(
            commitments: commitments.sorted { $0.startMinute < $1.startMinute },
            scheduled: scheduled, deferred: deferred,
            flexibleMinutes: flexible, workloadMinutes: spent,
            conflicts: conflicts, calibration: calibration,
            sleep: sleep, recovery: recovery, energy: energy)
    }

    /// Required commitments that collide. Reported, never resolved — two
    /// lectures at once is Nick's problem to sort out and ORION pretending
    /// otherwise would be Phase 38's prohibition by the back door.
    static func overlaps(in commitments: [Commitment]) -> [PlanConflict] {
        let sorted = commitments.sorted { $0.startMinute < $1.startMinute }
        var found: [PlanConflict] = []
        for (index, first) in sorted.enumerated() {
            for second in sorted.dropFirst(index + 1) {
                guard second.startMinute < first.startMinute + first.durationMinutes else { break }
                found.append(PlanConflict(
                    kind: .overlap,
                    detail: "\(first.title) and \(second.title) overlap."))
            }
        }
        return found
    }
}

// MARK: - The evening

public struct EveningReview: Sendable, Equatable {

    public let completed: [PlannedTask]
    public let incomplete: [PlannedTask]
    /// Median actual-over-estimate for today's finished work, or nil when
    /// nothing finished with a recorded time. Nil rather than 1.0: "no data"
    /// and "spot on" are different answers and collapsing them makes the
    /// evening review lie on a day nothing got done.
    public let estimateAccuracy: Double?
    /// What to move to tomorrow.
    public let carryForward: [PlannedTask]
    /// What today teaches the next plan.
    public let calibration: EstimateCalibration

    public static func of(_ tasks: [PlannedTask], history: [PlannedTask] = []) -> EveningReview {
        let done = tasks.filter(\.completed)
        let notDone = tasks.filter { !$0.completed }
        let ratios = done.compactMap { task -> Double? in
            guard let actual = task.actualMinutes, actual > 0 else { return nil }
            return Double(actual) / Double(task.estimateMinutes)
        }
        return EveningReview(
            completed: done,
            incomplete: notDone,
            estimateAccuracy: ratios.isEmpty ? nil : CorrelationEngine.median(ratios),
            // Priority order, so tomorrow starts with what mattered most today
            // rather than with whatever happened to be last in the list.
            carryForward: notDone.sorted { ($0.priority, $0.id) < ($1.priority, $1.id) },
            calibration: EstimateCalibration.from(history + done))
    }
}
