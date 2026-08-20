import Foundation

/*
 The week, not just the morning.

 Orion already asks Whoop for seven days of records and then throws six of them
 away. That is the whole reason the Health tab had one big number on it: a
 single recovery score, which is only interesting for about two hours after you
 wake up. The data to say "71ms, and that is eight above your usual" was already
 downloaded and discarded.

 So: keep the week, and derive the two things a single reading cannot give you —
 where today sits against your own baseline, and which way the line is going.

 Baselines here deliberately EXCLUDE the latest day. A baseline that includes
 the value being compared to it is pulled toward that value, which flattens
 exactly the deviation you are looking for. With seven points the effect is
 large enough to hide a real drop.
*/

/// One day's readings. Every field optional: Whoop scores different collections
/// at different times, so a day routinely has sleep but no strain yet.
struct WhoopDayPoint: Identifiable, Equatable {
    let date: Date
    var recovery: Int?
    var sleepPerformance: Int?
    var sleepHours: Double?
    var hrv: Int?
    var restingHeartRate: Int?
    var strain: Double?

    var id: Date { date }
}

/// A single metric across the week, with today set against its own baseline.
struct Trend: Equatable {
    /// Oldest → newest. Only days that actually have a value.
    let values: [Double]

    var latest: Double? { values.last }

    /// The mean of everything BEFORE the latest reading. Nil until there are at
    /// least two days, because "your baseline" computed from one day is just
    /// that day wearing a different label.
    var baseline: Double? {
        let prior = values.dropLast()
        guard prior.count >= 2 else { return nil }
        return prior.reduce(0, +) / Double(prior.count)
    }

    var delta: Double? {
        guard let latest, let baseline else { return nil }
        return latest - baseline
    }

    /// Signed, rounded, with a sign always shown — "+8", "−3", "0".
    func deltaLabel(decimals: Int = 0) -> String? {
        guard let delta else { return nil }
        let rounded = (delta * pow(10, Double(decimals))).rounded() / pow(10, Double(decimals))
        if abs(rounded) < pow(10, -Double(decimals)) / 2 { return "0" }
        let magnitude = String(format: "%.\(decimals)f", abs(rounded))
        // A real minus sign, not a hyphen: at small sizes a hyphen beside a
        // digit reads as a dash in the label rather than as a negative number.
        return rounded > 0 ? "+\(magnitude)" : "−\(magnitude)"
    }

    /// Normalised 0...1 for drawing, using the series' own range. A flat line
    /// sits in the middle rather than collapsing to the bottom of the box.
    var normalised: [Double] {
        guard let low = values.min(), let high = values.max() else { return [] }
        guard high - low > 0.0001 else { return values.map { _ in 0.5 } }
        return values.map { ($0 - low) / (high - low) }
    }

    var hasShape: Bool { values.count >= 2 }
}

/// Seven days of Whoop, and what can be said about them.
struct WhoopWeek: Equatable {

    /// Oldest → newest.
    var points: [WhoopDayPoint] = []

    var latest: WhoopDayPoint? { points.last }

    var recovery: Trend { trend { $0.recovery.map(Double.init) } }
    var sleepPerformance: Trend { trend { $0.sleepPerformance.map(Double.init) } }
    var sleepHours: Trend { trend { $0.sleepHours } }
    var hrv: Trend { trend { $0.hrv.map(Double.init) } }
    var restingHeartRate: Trend { trend { $0.restingHeartRate.map(Double.init) } }
    var strain: Trend { trend { $0.strain } }

    private func trend(_ value: (WhoopDayPoint) -> Double?) -> Trend {
        Trend(values: points.compactMap(value))
    }

    var isEmpty: Bool { points.isEmpty }
}

extension WhoopWeek {

    /// History, unioned by day, with the incoming fetch winning where both know
    /// about a day.
    ///
    /// Fetches are windows, not snapshots of everything — a truncated or
    /// re-scoped one should ADD to what is known rather than replace it. Whoop
    /// also rescoring a day it already scored is normal (a late nap, a corrected
    /// sleep), which is why the newer read wins per day rather than per field.
    func merging(_ incoming: WhoopWeek) -> WhoopWeek {
        var byDay: [Date: WhoopDayPoint] = [:]
        for point in points { byDay[point.date] = point }
        for point in incoming.points { byDay[point.date] = point }
        return WhoopWeek(points: byDay.values.sorted { $0.date < $1.date })
    }

    /// The week as the health log wants it: one reading per day key.
    ///
    /// Keyed by the CIVIL day of each reading, not by Orion's logical day. The
    /// calendar grid draws civil days, and this exists to colour those cells; a
    /// recovery scored at 6am belongs in the square marked with that date even
    /// on a morning Nick has not woken up into yet.
    var readingsByDay: [String: WearableReading] {
        var readings: [String: WearableReading] = [:]
        for point in points {
            readings[OrionDay.keyFormatter.string(from: point.date)] = WearableReading(
                recovery: point.recovery,
                sleepPerformance: point.sleepPerformance,
                sleepHours: point.sleepHours,
                hrv: point.hrv,
                restingHeartRate: point.restingHeartRate,
                strain: point.strain
            )
        }
        return readings
    }
}

/// What today's recovery says about how hard to go.
///
/// Whoop's own model in one sentence: recovery buys you strain. A green day
/// supports a hard session, a red one does not, and the number that matters
/// after about 10am is no longer recovery — it is how much strain you have
/// spent against what today could carry. That is the answer to "recovery is
/// only interesting in the morning".
struct StrainTarget: Equatable {
    let low: Double
    let high: Double
    let headline: String

    static func forRecovery(_ recovery: Int?) -> StrainTarget {
        guard let recovery else {
            return StrainTarget(low: 8, high: 14, headline: "No recovery score — go by feel")
        }
        switch recovery {
        case 67...:
            return StrainTarget(low: 14, high: 18, headline: "Primed for a hard session")
        case 34..<67:
            return StrainTarget(low: 10, high: 14, headline: "Maintain — not a PR day")
        default:
            return StrainTarget(low: 6, high: 10, headline: "Keep it light")
        }
    }

    /// 0...1 against the top of the band, clamped.
    func progress(_ strain: Double?) -> Double {
        guard let strain, high > 0 else { return 0 }
        return min(1, max(0, strain / high))
    }

    /// Where today's effort sits relative to the band.
    func verdict(_ strain: Double?) -> String {
        guard let strain else { return "nothing logged yet" }
        if strain < low { return "under — room for more" }
        if strain > high { return "over the band for this recovery" }
        return "in the band"
    }
}
