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

    /// The health picture, as categories. Phase 33: no raw measurement crosses
    /// into a prompt. There is deliberately no `hrv`, `restingHeartRate`,
    /// `recovery` or `sleepPerformance` property here any more -- the guarantee
    /// is that `prompt()` CANNOT print them, because they are not in scope,
    /// rather than that it happens not to.
    var signal: PlanningSignal
    /// Whether today's logged strain sits under, inside or over the suggested
    /// band. Three bits, derived from the band and the reading, never the
    /// reading itself.
    var strainPosition: StrainPosition

    var bottles: Int
    var bottleTarget: Int
    var supplementsTaken: Int
    var supplementsTotal: Int
    var workoutSets: Int
    var calories: Int

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
        signal.hasAnything || strainPosition != .nothingLogged
            || bottles > 0 || workoutSets > 0 || calories > 0
    }

    /// Nil when there is genuinely nothing to say, so no request is made.
    func prompt() -> String? {
        guard hasAnything else { return nil }
        var lines: [String] = []

        lines.append(contentsOf: signal.promptLines())
        lines.append(strainPosition.line)
        lines.append("- Water \(bottles) of \(bottleTarget) bottles.")
        if supplementsTotal > 0 {
            lines.append("- Supplements \(supplementsTaken) of \(supplementsTotal) taken.")
        }
        lines.append(workoutSets > 0
                     ? "- Trained today: \(workoutSets) sets logged."
                     : "- No workout logged today.")
        if calories > 0 {
            lines.append("- Food logged today: \(calories) calories, entered manually.")
        }

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
        (RECOVERY, SLEEP, STRAIN, HYDRATION, TRAINING, NUTRITION).
        - One sentence each, under 18 words.
        - Each takeaway must interpret or combine, never just restate a number.
        - Exactly one takeaway names the single thing most worth doing now.
        - State NO health numbers at all -- no heart rate, no variability, no \
        recovery or sleep percentage, no strain figure. There are none in the \
        facts above; do not estimate, infer or invent one. The hydration, \
        supplement and training counts are the only numbers you may use, and \
        only as given: "3 of 9 bottles" must not become "33% of your goal".
        - If the reading confidence is low, or it is not current, say so plainly \
        rather than sounding certain about it.
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
