import Foundation

// A new voice turn while the last one is still in flight (w16, 2026-11-02 23:56).
//
// The weather question was paused by a barge-in, its answer arrived and was held for "continue", and the next turn
// cleared the held answer (`pausedReplacementText = nil`) and sent itself as "the rest of" the weather question. The
// weather was never answered. Now the two are compared: the same request (a correction, a continuation, the same
// question again) is merged, as before; a different question is answered as well, after the first. Never dropped.

enum TurnRelation: Equatable {
    case merge
    case separate

    /// "actually make it 7", "no wait 9:30", "i mean oat milk": the new turn fixes the last one.
    private static let correctionOpeners: [[String]] = [
        ["actually"], ["no"], ["nah"], ["wait"], ["sorry"], ["i", "mean"], ["scratch", "that"], ["instead"], ["make", "it"],
        ["not"], ["rather"],
    ]
    /// "and milk", "and saturday": the new turn carries the last one on.
    private static let continuationOpeners: Set<String> = ["and", "or", "but", "also", "plus", "then", "with", "for", "to", "at", "because"]
    /// Words that say nothing about what is being asked.
    private static let stopwords: Set<String> = [
        "the", "a", "an", "is", "it", "its", "it's", "what", "what's", "whats", "like", "my", "me", "i", "you", "to", "for", "of",
        "on", "in", "at", "be", "are", "do", "does", "can", "could", "please", "hey", "ok", "okay", "so", "um", "uh", "yeah",
        "just", "this", "that", "there", "how", "now", "right", "fuck", "shit",
    ]

    static func between(previous: String, next: String) -> TurnRelation {
        let before = AddressLexicon.words(AddressGate.normalized(previous))
        let after = AddressLexicon.strippingNames(AddressLexicon.words(AddressGate.normalized(next)))
        guard let last = before.last, !after.isEmpty else { return .separate }
        if correctionOpeners.contains(where: { after.starts(with: $0) }) { return .merge }
        if let first = after.first, continuationOpeners.contains(first) { return .merge }
        if RequestShape.danglers.contains(last) { return .merge }
        return sameIntent(before, after) ? .merge : .separate
    }

    /// Most of what the shorter one asks about is in the other.
    private static func sameIntent(_ before: [String], _ after: [String]) -> Bool {
        let left = Set(AddressLexicon.strippingNames(before)).subtracting(stopwords)
        let right = Set(after).subtracting(stopwords)
        guard !left.isEmpty, !right.isEmpty else { return false }
        return Double(left.intersection(right).count) / Double(min(left.count, right.count)) >= 0.6
    }
}

/// What the app does with the paused turn when a new one is about to be sent.
enum InFlightTurnPlan: Equatable {
    /// The new turn finishes or fixes the paused one: one request, the paused answer is superseded by the whole.
    case merge
    /// A different question. `landNow`: the paused answer is already here, show it first. `waitForPrevious`: it is
    /// still running, so the new answer waits for it (up to `AnswerOrder.patience`).
    case separate(landNow: String?, waitForPrevious: Bool)

    /// `seedWasRoom`: the barge-in that paused it was room speech; its answer already lands by itself (`OrphanedAnswers`).
    static func make(previous: String, next: String, seedWasRoom: Bool, heldAnswer: String?) -> InFlightTurnPlan {
        if seedWasRoom { return .separate(landNow: heldAnswer, waitForPrevious: false) }
        if TurnRelation.between(previous: previous, next: next) == .merge { return .merge }
        return .separate(landNow: heldAnswer, waitForPrevious: heldAnswer == nil)
    }
}

/// Later answers waiting on earlier ones, so two questions are answered in the order he asked them.
struct AnswerOrder: Equatable {
    /// How long a later answer waits for an earlier one before it is delivered anyway.
    static let patience: TimeInterval = 25

    /// later generation -> the earlier generation it waits for.
    private(set) var waits: [Int: Int] = [:]

    func waiting(later: Int, on earlier: Int) -> AnswerOrder {
        AnswerOrder(waits: waits.merging([later: earlier]) { _, new in new })
    }

    func mustWait(_ generation: Int) -> Bool { waits[generation] != nil }

    /// The earlier answer landed: the later ones waiting on it are released, oldest first.
    func landed(_ earlier: Int) -> (released: [Int], next: AnswerOrder) {
        let released = waits.filter { $0.value == earlier }.map(\.key).sorted()
        return (released, AnswerOrder(waits: waits.filter { $0.value != earlier }))
    }

    /// The earlier one failed or took too long: same as landing, for whatever waited on it.
    func gaveUp(on earlier: Int) -> (released: [Int], next: AnswerOrder) { landed(earlier) }
}

extension AddressLexicon {
    static func strippingNames(_ words: [String]) -> [String] {
        words.filter { !nameForms.contains($0) }
    }
}
