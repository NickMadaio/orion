import SwiftUI

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

    /// Keyed by the facts, not just the day and phase. Phase alone meant a
    /// summary written at 8am stood until the afternoon even after recovery,
    /// hydration and workout counts had all moved underneath it — the same
    /// staleness that put an 81% sleep score beside a 27% tile in the brief.
    /// `prompt()` is nil when there is nothing to say; fall back to the coarse
    /// key then, since no request is made in that case anyway.
    var narrativeKey: String {
        NarrativeKey.make("health.\(dayKey).\(phase)", facts: prompt() ?? "")
    }

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
        You are Orion, reading Nick's health numbers for him. \(timeOfDay)

        \(lines.joined(separator: "\n"))

        Write 3 or 4 takeaways, one per line, in exactly this format:

        LABEL — one sentence.

        Rules:
        - LABEL is one or two words in capitals, naming what it is about \
        (RECOVERY, SLEEP, STRAIN, HYDRATION, TRAINING).
        - One sentence each, under 18 words.
        - Each takeaway must interpret or combine, never just restate a number.
        - Exactly one takeaway names the single thing most worth doing now.
        - Never state a number that is not in the facts above, and do not \
        calculate new ones. "3 of 9 bottles" must not become "33% of your goal".
        - Output nothing but the takeaway lines. No preamble, no closing line.
        - No generic wellness advice. Nothing about stretching, breathing, \
        listening to your body or staying consistent unless it follows from a \
        number above. Say something only these numbers could have produced.
        """
    }
}

/// One line of the health rail: what it is about, and what it means.
struct Takeaway: Identifiable {
    let label: String
    let text: String

    var id: String { label + text }

    /// Coloured by subject, so the rail is scannable without reading it. The
    /// model chooses the labels, so this matches loosely and falls back rather
    /// than insisting on a vocabulary a local model will not stick to.
    var tint: Color {
        let key = label.lowercased()
        if key.contains("recover") { return OrionTheme.green }
        if key.contains("sleep") || key.contains("rest") { return OrionTheme.violet }
        if key.contains("strain") || key.contains("train") || key.contains("workout") { return OrionTheme.orange }
        if key.contains("hydrat") || key.contains("water") { return OrionTheme.blue }
        if key.contains("hrv") || key.contains("heart") { return OrionTheme.red }
        if key.contains("supplement") { return OrionTheme.violet }
        return OrionTheme.accent
    }

    /// Pull takeaways out of whatever the model actually produced.
    ///
    /// Deliberately forgiving. A local model asked for `LABEL — sentence` will
    /// sometimes bullet the lines, sometimes use a colon or a hyphen, and
    /// sometimes number them. Parsing strictly would mean the rail is empty
    /// whenever it drifts, so the separator is any of the plausible ones and
    /// anything unparseable is handed back as prose by the caller.
    static func parse(_ raw: String) -> [Takeaway] {
        let separators: [Character] = ["—", "–", ":", "|"]
        var result: [Takeaway] = []

        for line in raw.split(separator: "\n") {
            var body = line.trimmingCharacters(in: .whitespaces)

            // Strip a bullet or an ordinal.
            while let first = body.first, "-*•".contains(first) {
                body = String(body.dropFirst()).trimmingCharacters(in: .whitespaces)
            }
            if let dot = body.firstIndex(of: "."), body.distance(from: body.startIndex, to: dot) <= 2,
               body[body.startIndex..<dot].allSatisfy(\.isNumber) {
                body = String(body[body.index(after: dot)...]).trimmingCharacters(in: .whitespaces)
            }

            guard let cut = body.firstIndex(where: { separators.contains($0) }) else { continue }
            let label = body[body.startIndex..<cut]
                .trimmingCharacters(in: .whitespaces)
                .replacingOccurrences(of: "*", with: "")
            let text = body[body.index(after: cut)...].trimmingCharacters(in: .whitespaces)

            // A label is short and is not a sentence. This rejects prose that
            // merely happens to contain a colon.
            guard !label.isEmpty, label.count <= 22, !label.contains("."),
                  text.count > 8
            else { continue }

            result.append(Takeaway(label: label.uppercased(), text: text))
        }
        return result
    }
}
