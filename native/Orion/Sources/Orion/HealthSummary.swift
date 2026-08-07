import Foundation

/*
 What Orion makes of the health numbers.

 The tab shows readings; this is the sentence that connects them. A recovery of
 72 with HRV eight above baseline and four bottles of water at 3pm is three
 facts, and the useful thing is what they mean together — which is exactly the
 job a small model is good at and a layout is not.

 Keyed by day AND phase, so it is rewritten when the day genuinely moves on —
 morning to afternoon to evening — and not once in between. Three short local
 completions a day. Writing it on every published change would mean rewriting it
 every time a bottle of water is logged, which is both wasteful and unsettling
 to read.
*/

struct HealthFacts: Equatable {
    var dayKey: String
    /// morning / day / evening — part of the cache key, and part of the prompt.
    var phase: String

    var recovery: Int?
    var recoveryDelta: String?
    var sleepPerformance: Int?
    var sleepHours: Double?
    var hrv: Int?
    var hrvDelta: String?
    var restingHeartRate: Int?
    var rhrDelta: String?
    var strain: Double?
    var strainTarget: StrainTarget

    var bottles: Int
    var bottleTarget: Int
    var supplementsTaken: Int
    var supplementsTotal: Int
    var workoutSets: Int

    var narrativeKey: String { "health.\(dayKey).\(phase)" }

    var hasAnything: Bool {
        recovery != nil || sleepPerformance != nil || strain != nil || bottles > 0 || workoutSets > 0
    }

    /// Nil when there is genuinely nothing to say, so no request is made.
    func prompt() -> String? {
        guard hasAnything else { return nil }
        var lines: [String] = []

        if let recovery {
            var line = "- Recovery \(recovery)% (\(recovery >= 67 ? "green" : recovery >= 34 ? "yellow" : "red"))"
            if let recoveryDelta { line += ", \(recoveryDelta) vs his 7-day average" }
            lines.append(line + ".")
        }
        if let sleepPerformance {
            var line = "- Sleep score \(sleepPerformance)%"
            if let sleepHours { line += ", \(String(format: "%.1f", sleepHours))h in bed" }
            lines.append(line + ".")
        }
        if let hrv {
            var line = "- HRV \(hrv)ms"
            if let hrvDelta { line += " (\(hrvDelta) vs average)" }
            lines.append(line + ".")
        }
        if let restingHeartRate {
            var line = "- Resting heart rate \(restingHeartRate)"
            if let rhrDelta { line += " (\(rhrDelta) vs average)" }
            lines.append(line + ".")
        }
        if let strain {
            lines.append("- Strain so far today \(String(format: "%.1f", strain)), "
                         + "against a suggested band of \(Int(strainTarget.low))–\(Int(strainTarget.high)).")
        } else {
            lines.append("- No strain logged yet today.")
        }
        lines.append("- Water \(bottles) of \(bottleTarget) bottles.")
        if supplementsTotal > 0 {
            lines.append("- Supplements \(supplementsTaken) of \(supplementsTotal) taken.")
        }
        lines.append(workoutSets > 0
                     ? "- Trained today: \(workoutSets) sets logged."
                     : "- No workout logged today.")

        let timeOfDay: String
        switch phase {
        case "morning": timeOfDay = "It is early in his day."
        case "evening": timeOfDay = "It is the end of his day."
        default: timeOfDay = "It is the middle of his day."
        }

        return """
        You are Orion, summarising Nick's health numbers for him. \(timeOfDay)

        \(lines.joined(separator: "\n"))

        Write 2 to 3 sentences addressed to him, as one paragraph.

        Rules:
        - Say what these numbers mean TOGETHER, not one at a time.
        - Name the single thing most worth doing about them right now.
        - Never state a number that is not in the facts above.
        - No greeting, no lists, no headings, no sign-off.
        - No generic wellness advice. Nothing about stretching, breathing, \
        listening to your body or staying consistent unless it follows from a \
        number above. Say something only these numbers could have produced.
        """
    }
}
