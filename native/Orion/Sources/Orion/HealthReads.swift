import Foundation
import MobileCore

/*
 Wave 18 (Health): what the page says about each ring, in words. Before this, the caption under a ring and the detail
 that hovering floated were the phase-34 section sentences ("The available WHOOP recovery reading is 78%." over
 "Whoop · high history confidence"): the number already in the ring, restated as where it came from. On the installed
 build hover did fire, and what it showed was that, so to Nick hovering "did nothing" and the page was full of stray
 coverage text. Every string here is a read of the day: what the number means and how it compares with his usual.
 Pure, so the wording is tested; nothing here mentions availability, sources, records or confidence.
*/

/// One part's hover detail: a title, one line, and an optional note under it.
struct HealthPartRead: Equatable {
    let section: HealthSection
    let title: String
    let line: String
    let note: String?
}

enum HealthReads {
    /// Everything the reads are built from, gathered once by the tab.
    struct Inputs: Equatable {
        var recovery: Int?
        /// Today's recovery minus the mean of the days before it (`Trend.delta`).
        var recoveryDelta: Double?
        var sleepHours: Double?
        var sleepPerformance: Int?
        /// The mean time in bed of the days before last night (`Trend.baseline`).
        var usualSleepHours: Double?
        var strain: Double?
        var hrvDelta: Double?
        var restingHeartRateDelta: Double?
        /// Days in the week series.
        var days: Int
        var bottles: Int
        var bottleTarget: Int
        var calories: Int
        var calorieTarget: Int
    }

    /// Under this many hours in bed, the night was short whatever else it was (shared with the Today line).
    static let shortSleepHours = HealthTodayLine.shortSleepHours

    // MARK: Captions under the rings

    static func caption(_ section: HealthSection, _ inputs: Inputs) -> String {
        switch section {
        case .recovery:
            guard let recovery = inputs.recovery else { return "no score yet" }
            switch HealthTodayLine.band(recovery) {
            case .high: return "ready to push"
            case .mid: return "steady day"
            case .low: return "take it easy"
            }
        case .sleep:
            if let performance = inputs.sleepPerformance, inputs.sleepHours != nil { return "in bed · \(performance)% of need" }
            if inputs.sleepHours != nil { return "in bed" }
            if let performance = inputs.sleepPerformance { return "\(performance)% of need" }
            return "no sleep yet"
        case .activity:
            let target = StrainTarget.forRecovery(inputs.recovery)
            return "aim for \(Int(target.low))–\(Int(target.high)) today"
        default:
            return ""
        }
    }

    // MARK: Hover details

    static func part(_ section: HealthSection, _ inputs: Inputs) -> HealthPartRead? {
        switch section {
        case .recovery: return recovery(inputs)
        case .sleep: return sleep(inputs)
        case .activity: return strain(inputs)
        case .trends: return week(inputs)
        case .energy: return fuel(inputs)
        case .today, .journal: return nil
        }
    }

    private static func recovery(_ inputs: Inputs) -> HealthPartRead {
        guard let recovery = inputs.recovery.map({ max(0, min(100, $0)) }) else {
            return HealthPartRead(section: .recovery, title: "Recovery",
                                  line: "No recovery score yet. It lands once WHOOP scores your sleep.", note: nil)
        }
        let line = "Recovery \(recovery)" + (inputs.recoveryDelta.map { ", " + compared(Int($0.rounded())) } ?? "") + "."
        let note: String
        switch HealthTodayLine.band(recovery) {
        case .high: note = "Your body has bounced back. A good day to push."
        case .mid: note = "Middle of the road. Steady effort, not a max day."
        case .low: note = "Your body is still catching up. Keep today light."
        }
        return HealthPartRead(section: .recovery, title: "Recovery", line: line, note: note)
    }

    private static func compared(_ delta: Int) -> String {
        if delta > 0 { return "\(delta) above your usual" }
        if delta < 0 { return "\(-delta) below your usual" }
        return "right on your usual"
    }

    private static func sleep(_ inputs: Inputs) -> HealthPartRead {
        let hours = inputs.sleepHours.flatMap { $0.isFinite && $0 > 0 && $0 < 24 ? $0 : nil }
        guard let hours else {
            let line = inputs.sleepPerformance.map { "\($0)% of the sleep you needed." } ?? "No sleep has come through yet."
            return HealthPartRead(section: .sleep, title: "Sleep", line: line, note: nil)
        }
        let line = "\(hoursText(hours)) in bed" + (inputs.sleepPerformance.map { ", \($0)% of what you needed" } ?? "") + "."
        return HealthPartRead(section: .sleep, title: "Sleep", line: line, note: sleepNote(hours, usual: inputs.usualSleepHours))
    }

    private static func sleepNote(_ hours: Double, usual: Double?) -> String {
        let gap = usual.flatMap { $0.isFinite && $0 > 0 ? hours - $0 : nil }
        if hours < shortSleepHours {
            let under = gap.flatMap { $0 <= -0.25 ? ", \(hoursText(-$0)) under your usual" : nil } ?? ""
            return "A short night\(under). An early one tonight pays it back."
        }
        guard let gap else { return "Enough to work with." }
        if gap <= -0.5 { return "\(hoursText(-gap)) under your usual, but enough to work with." }
        if gap >= 0.5 { return "\(hoursText(gap)) more than usual. That helps." }
        return "About your usual night."
    }

    private static func strain(_ inputs: Inputs) -> HealthPartRead {
        let target = StrainTarget.forRecovery(inputs.recovery)
        let band = "Today can carry about \(Int(target.low)) to \(Int(target.high))."
        guard let strain = inputs.strain.flatMap({ $0.isFinite ? $0 : nil }) else {
            return HealthPartRead(section: .activity, title: "Strain", line: "No strain yet today. \(band)", note: nil)
        }
        let note: String
        if strain < target.low { note = "Room for a proper session." }
        else if strain > target.high { note = "Past what today can carry. Ease off." }
        else { note = "Right where today wants you." }
        return HealthPartRead(section: .activity, title: "Strain",
                              line: "Strain \(String(format: "%.1f", strain)) so far. \(band)", note: note)
    }

    private static func week(_ inputs: Inputs) -> HealthPartRead? {
        let items = [("recovery", inputs.recoveryDelta), ("HRV", inputs.hrvDelta),
                     ("resting heart rate", inputs.restingHeartRateDelta)]
            .compactMap { name, delta in delta.flatMap { $0.isFinite ? "\(name) \(signed(Int($0.rounded())))" : nil } }
        guard inputs.days >= 2, !items.isEmpty else { return nil }
        return HealthPartRead(section: .trends, title: "Your week",
                              line: "Against your usual: " + items.joined(separator: ", ") + ".",
                              note: "Across the last \(inputs.days) days.")
    }

    private static func signed(_ value: Int) -> String {
        value > 0 ? "+\(value)" : (value < 0 ? "−\(-value)" : "0")
    }

    private static func fuel(_ inputs: Inputs) -> HealthPartRead {
        let water = "\(inputs.bottles) of \(inputs.bottleTarget) bottles"
        let food = "\(inputs.calories) of \(inputs.calorieTarget) calories"
        let line: String
        switch (inputs.bottles > 0, inputs.calories > 0) {
        case (true, true): line = "\(water) and \(food) so far."
        case (true, false): line = "\(water) so far, no food logged yet."
        case (false, true): line = "\(food) so far, no water logged yet."
        case (false, false): line = "No water or food logged yet today."
        }
        return HealthPartRead(section: .energy, title: "Food and water", line: line, note: nil)
    }

    static func hoursText(_ value: Double) -> String {
        let text = String(format: "%.1f", value)
        return text == "1.0" ? "1 hour" : "\(text) hours"
    }
}
