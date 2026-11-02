/// Where a paused voice turn's answer goes when it lands (w16, 2026-11-02 23:01).
///
/// Room speech paused "What's the weather gonna be like tomorrow?", the address gate dropped that speech as not said to ORION,
/// and the answer that arrived eight seconds later sat in `pausedReplacementText` waiting for a "continue" nobody said: the chat
/// got no reply at all. He asked; the answer is his. It is held only while he is still finishing his own sentence (that
/// continuation replaces it); otherwise it goes to the bubble and the saved chat, without being spoken over the room.
enum PausedAnswerLanding: Equatable {
    /// Shown and saved to the chat now, not spoken.
    case bubble
    /// He is still talking: "continue" plays it, and the rest of his sentence replaces it.
    case hold

    static func on(seedWasRoom: Bool, listening: Bool) -> PausedAnswerLanding {
        !seedWasRoom && listening ? .hold : .bubble
    }
}

/// Turns whose pause was room speech (the address gate dropped it): each answer goes to the chat when it lands, even after
/// another turn started (2026-11-02 23:11, a second spoken question cleared the first's pause and its answer was thrown away).
struct OrphanedAnswers: Equatable {
    private(set) var generations: Set<Int> = []

    func adding(_ generation: Int) -> OrphanedAnswers {
        OrphanedAnswers(generations: generations.union([generation]))
    }

    /// Whether this turn was orphaned, and the ledger without it.
    func claiming(_ generation: Int) -> (Bool, OrphanedAnswers) {
        guard generations.contains(generation) else { return (false, self) }
        return (true, OrphanedAnswers(generations: generations.subtracting([generation])))
    }
}
