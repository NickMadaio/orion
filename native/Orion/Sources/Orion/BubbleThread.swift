import Foundation

/*
 The proactive bubble as a mini-thread (W16-d, 2026-11-02).

 Nick: "I responded to a proactive message in the little bubble that pops up but his response didn't pop up."
 Live evidence: outreach reach-1793660584898-1f1d6b (mac-bubble, 23:03:04Z) → his reply typed into the summon composer at
 23:04:17Z → ORION answered at 23:04:39Z into chat 57B66409 only. The summon panel drew `reachMessage` and nothing else, and a typed
 turn never speaks, so the answer existed and he never saw it. The silent bubble also never set the reply binding (only spoken
 questions did), so the plugin got the timed guess instead of the message he was looking at.

 Now one value carries the exchange: the message, his reply (bound to `reachID`), and ORION's answer or an honest status.
 shown → sending → waiting → answered, with timedOut (the turn keeps running; its answer still lands here and in chat) and failed.
 Pure and immutable: every transition returns a new value, so the states are tested without a clock or the app.
 */
struct BubbleThread: Equatable {
    enum State: Equatable { case shown, sending, waiting, answered, timedOut, failed }

    /// How long the bubble waits before saying it will answer in chat (the same 45 s the voice handoff uses).
    static let answerLimit: TimeInterval = 45
    static let timeoutLine = "Still working on it — I'll reply in chat."
    static let failedLine = "That didn't go through — it's in chat, try again there."

    let message: String
    let reachID: String?
    let shownAt: Date
    private(set) var state: State = .shown
    private(set) var reply: String?
    private(set) var answer: String?
    private(set) var generation: Int?
    private(set) var sentAt: Date?

    init(message: String, reachID: String?, shownAt: Date) {
        self.message = message
        self.reachID = reachID
        self.shownAt = shownAt
    }

    /// A reply typed now answers this message: only before it was answered, and within the reply binding's lifetime.
    func acceptsReply(now: Date) -> Bool {
        state == .shown && now.timeIntervalSince(shownAt) <= OutreachReplyTo.ttl
    }

    func replied(_ text: String, now: Date) -> BubbleThread {
        guard acceptsReply(now: now) else { return self }
        var next = self
        next.state = .sending
        next.reply = text
        return next
    }

    /// The turn left for the gateway as `generation`.
    func sent(generation: Int, now: Date) -> BubbleThread {
        guard state == .sending else { return self }
        var next = self
        next.state = .waiting
        next.generation = generation
        next.sentAt = now
        return next
    }

    /// This bubble is still owed the answer of turn `generation` (waiting, or past the limit but still running).
    func isWaiting(for generation: Int) -> Bool {
        (state == .waiting || state == .timedOut) && self.generation == generation
    }

    func answered(_ text: String, generation: Int) -> BubbleThread {
        guard isWaiting(for: generation) else { return self }
        var next = self
        next.state = .answered
        next.answer = text
        return next
    }

    func failed(generation: Int) -> BubbleThread {
        guard isWaiting(for: generation) else { return self }
        var next = self
        next.state = .failed
        return next
    }

    /// The turn stopped (cancelled, recovered, failed) without delivering: a reply still owed becomes the failed line.
    func ended() -> BubbleThread {
        guard isThinking || state == .timedOut else { return self }
        var next = self
        next.state = .failed
        return next
    }

    func ticked(now: Date) -> BubbleThread {
        guard state == .waiting, let sentAt, now.timeIntervalSince(sentAt) > Self.answerLimit else { return self }
        var next = self
        next.state = .timedOut
        return next
    }

    /// The honest line under his reply when there is no answer to show.
    var statusLine: String? {
        switch state {
        case .timedOut: return Self.timeoutLine
        case .failed: return Self.failedLine
        default: return nil
        }
    }

    /// Whether the thinking shimmer shows.
    var isThinking: Bool { state == .sending || state == .waiting }

    /// Seconds to keep the bubble on screen from now; nil while an answer is still owed.
    var keepFor: TimeInterval? {
        switch state {
        case .shown: return 120
        case .sending, .waiting: return nil
        case .answered, .timedOut, .failed: return 600
        }
    }
}
