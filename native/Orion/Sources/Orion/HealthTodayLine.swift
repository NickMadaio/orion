import Foundation

/*
 Wave 17: the serif line under the rings. It used to repeat the Today part's coverage sentence ("Available WHOOP
 readings cover recovery, sleep, strain."), which says what the data is, not what the day is. This is a plain read of
 today from the same bands the recovery ring is tinted by (green 67+, yellow 34-66, red below). Nothing to say means
 no line at all; it never describes provenance or coverage.
*/
enum HealthTodayLine {
    /// Recovery bands match `recoveryTint` and `WhoopSnapshot.call`.
    enum Band { case low, mid, high }

    static func band(_ recovery: Int) -> Band {
        recovery >= 67 ? .high : (recovery >= 34 ? .mid : .low)
    }

    /// Under this many hours in bed, sleep is the story whatever recovery says.
    static let shortSleepHours = 6.0

    static func line(recovery: Int?, sleepHours: Double?) -> String? {
        let sleep = sleepHours.flatMap { $0.isFinite && $0 > 0 && $0 < 24 ? $0 : nil }
        switch (recovery.map { max(0, min(100, $0)) }, sleep) {
        case let (recovery?, sleep?):
            return both(recovery: recovery, sleep: sleep)
        case let (recovery?, nil):
            switch band(recovery) {
            case .high: return "Recovery \(recovery): a good day to push."
            case .mid: return "Recovery \(recovery): steady is the right pace today."
            case .low: return "Recovery \(recovery): keep today light."
            }
        case let (nil, sleep?):
            return sleep < shortSleepHours
                ? "\(hours(sleep)) of sleep: go easy on yourself today."
                : "\(hours(sleep)) of sleep: a solid night behind you."
        case (nil, nil):
            return nil
        }
    }

    private static func both(recovery: Int, sleep: Double) -> String {
        let lead = "Recovery \(recovery) and \(hours(sleep)) of sleep"
        let short = sleep < shortSleepHours
        switch (band(recovery), short) {
        case (.low, _): return "\(lead): a lighter day is smart."
        case (.mid, true): return "\(lead): a lighter day is smart."
        case (.mid, false): return "\(lead): steady is the right pace today."
        case (.high, true): return "\(lead): you can push, but ease off if you fade."
        case (.high, false): return "\(lead): a good day to push."
        }
    }

    private static func hours(_ value: Double) -> String {
        let text = String(format: "%.1f", value)
        return (text == "1.0" ? "1 hour" : "\(text) hours")
    }
}
