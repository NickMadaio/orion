import Foundation

/// The phone Health screen's words, as the Mac Health tab says them: a verdict and plain lines, no data-source or
/// coverage text. Pure, so the screen only lays out what this returns.
public enum HealthReadout {
    public static let empty = "Recovery, sleep and strain show up here once your Mac has them."
    public static let strainMax = 21.0

    public static func verdict(recovery: Int?) -> String {
        guard let recovery else { return "Not recorded yet" }
        if recovery >= 67 { return "Ready to push" }
        if recovery >= 34 { return "Steady, not a peak day" }
        return "Take it easy"
    }

    /// Sleep as a share of what was needed, 0...1.
    public static func sleepFraction(_ day: LinkSnapshot.HealthDay) -> Double? {
        RingMath.fraction(day.sleepPerformance.map(Double.init), of: 100)
    }

    public static func strainFraction(_ day: LinkSnapshot.HealthDay) -> Double? {
        RingMath.fraction(day.strain, of: strainMax)
    }

    public static func lines(_ day: LinkSnapshot.HealthDay) -> [String] {
        var lines: [String] = []
        if let hours = day.sleepHours {
            let slept = String(format: "You slept %.1f hour", hours) + (hours == 1 ? "" : "s")
            lines.append(day.sleepPerformance.map { "\(slept), \($0)% of what you need." } ?? slept + ".")
        }
        let heart = [day.hrv.map { "Heart rate variability \($0) ms" }, day.restingHeartRate.map { "resting heart rate \($0) bpm" }].compactMap { $0 }
        if !heart.isEmpty { lines.append(heart.joined(separator: ", ") + ".") }
        if let strain = day.strain { lines.append(String(format: "Strain so far %.1f of 21.", strain)) }
        return lines
    }
}
