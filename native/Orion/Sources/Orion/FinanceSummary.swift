import Foundation

/*
 What Orion makes of the money.

 Same shape as HealthSummary: facts Orion already computed, handed to a local
 model for the one thing a layout cannot do — saying what they mean together.

 Keyed by day rather than by phase. Balances move slowly and a summary that
 rewrote itself every time a coffee cleared would be noise; once a day is the
 right cadence for "here is what your money is doing".
*/

struct FinanceFacts: Equatable {
    var dayKey: String
    var currency: String

    var netWorth: Double
    var assets: Double
    var debts: Double
    var spentThisMonth: Double
    var incomeThisMonth: Double
    var topCategories: [(category: String, total: Double)]
    var recurringTotal: Double
    var recurringCount: Int
    var accountCount: Int

    /// Keyed by the facts, not the day. A balance that moves after the paragraph
    /// is written would otherwise leave last night's numbers described in prose
    /// beside today's figures — and money is the worst place for that.
    var narrativeKey: String {
        NarrativeKey.make("finance.\(dayKey)", facts: prompt() ?? "")
    }

    static func == (lhs: FinanceFacts, rhs: FinanceFacts) -> Bool {
        lhs.narrativeKey == rhs.narrativeKey
            && lhs.netWorth == rhs.netWorth
            && lhs.spentThisMonth == rhs.spentThisMonth
    }

    var hasAnything: Bool { accountCount > 0 }

    /// Nil when there is nothing to say, so no request is made.
    func prompt() -> String? {
        guard hasAnything else { return nil }
        var lines: [String] = [
            "- Net worth \(Money.format(netWorth, currency: currency)) "
            + "(\(Money.format(assets, currency: currency)) in assets, "
            + "\(Money.format(debts, currency: currency)) owed).",
        ]

        if spentThisMonth > 0 || incomeThisMonth > 0 {
            lines.append("- This month: \(Money.format(spentThisMonth, currency: currency)) spent, "
                         + "\(Money.format(incomeThisMonth, currency: currency)) in.")
        }
        if !topCategories.isEmpty {
            lines.append("- Biggest categories: "
                         + topCategories
                            .map { "\($0.category) \(Money.format($0.total, currency: currency))" }
                            .joined(separator: ", ") + ".")
        }
        if recurringCount > 0 {
            lines.append("- \(recurringCount) recurring charge\(recurringCount == 1 ? "" : "s") "
                         + "totalling \(Money.format(recurringTotal, currency: currency)) a month.")
        }

        return """
        You are Orion, reading Nick's finances for him.

        \(lines.joined(separator: "\n"))

        Write 3 or 4 takeaways, one per line, in exactly this format:

        LABEL — one sentence.

        Rules:
        - LABEL is one or two words in capitals, naming what it is about \
        (NET WORTH, SPENDING, RECURRING, DEBT, CASH FLOW).
        - One sentence each, under 18 words.
        - Each takeaway must interpret or combine, never just restate a figure.
        - Exactly one takeaway names the single thing most worth doing now.
        - Never state a number that is not in the facts above, and do not \
        calculate new ones or new percentages.
        - Output nothing but the takeaway lines. No preamble, no closing line.
        - No generic money advice. Nothing about building an emergency fund, \
        diversifying, or paying yourself first unless it follows from a number \
        above. Say something only these numbers could have produced.
        """
    }
}
