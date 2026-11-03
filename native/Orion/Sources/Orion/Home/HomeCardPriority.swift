import Foundation

/*
 Which card matters most (wave 17). Nick: "give a priority to each bubble and size / arrange them using that ... the
 one like the question may be higher priority, then having class is the next. idea being i need to respond to the
 question one." One ranked table, here and nowhere else. The spread (HomeCardSpread) puts tier 1 in the middle at the
 largest size and fans the rest outward by rank.

 Finance is not in the table: it is no longer a card, only a glance-row item.
*/
enum HomeCardPriority {
    /// Most important first. A kind that is not here never reaches the spread.
    static let order: [HomeCardKind] = [
        .question,  // ORION asked: needs his reply or approval
        .event,     // next or current class/event, with leave-by
        .tasks,     // overdue (or due today)
        .sleep,     // bedtime, evening only
        .focus,     // a free stretch or a tucked-away session
        .project,   // a run needing attention
        .health,    // recovery
    ]

    /// 1 = the top priority; nil = never a card.
    static func tier(_ kind: HomeCardKind) -> Int? { order.firstIndex(of: kind).map { $0 + 1 } }

    /// Bedtime and short-night cards only make sense from late afternoon through the small hours.
    static func isEvening(hour: Int) -> Bool { hour >= 17 || hour < 4 }

    /// By kind's tier, then by urgency within the kind (the card's own rank: sooner and more overdue first).
    static func ordered(_ cards: [HomeCard]) -> [HomeCard] {
        cards.compactMap { card in tier(card.kind).map { (tier: $0, card: card) } }
            .sorted { ($0.tier, $0.card.rank) < ($1.tier, $1.card.rank) }
            .map(\.card)
    }
}
