import XCTest
@testable import Orion

/// W16-d (2026-11-02): "I responded to a proactive message in the little bubble that pops up but his response didn't pop up."
/// The bubble reply ran (chat 57B66409, 23:04:17 → 23:04:39) but the answer went only to the dashboard chat: the summon panel showed
/// nothing but the original message, and the typed origin never speaks. The bubble is now a mini-thread with its own states.
final class BubbleThreadTests: XCTestCase {
    private let t0 = Date(timeIntervalSince1970: 1_800_000_000)
    private func fresh() -> BubbleThread {
        BubbleThread(message: "You're out - is Study block still happening, or did plans change?", reachID: "reach-1", shownAt: t0)
    }

    func testAShownMessageTakesAReplyAndRemembersWhatItAnswers() {
        let shown = fresh()
        XCTAssertEqual(shown.state, .shown)
        XCTAssertTrue(shown.acceptsReply(now: t0.addingTimeInterval(60)))
        let sending = shown.replied("nah plans changed", now: t0.addingTimeInterval(60))
        XCTAssertEqual(sending.state, .sending)
        XCTAssertEqual(sending.reply, "nah plans changed")
        XCTAssertEqual(sending.reachID, "reach-1", "the reply stays bound to the message it answers")
        XCTAssertEqual(shown.state, .shown, "transitions return a new value")
    }

    func testSendingThenWaitingThenAnswered() {
        let sending = fresh().replied("nah plans changed", now: t0.addingTimeInterval(10))
        let waiting = sending.sent(generation: 7, now: t0.addingTimeInterval(11))
        XCTAssertEqual(waiting.state, .waiting)
        XCTAssertTrue(waiting.isWaiting(for: 7))
        XCTAssertFalse(waiting.isWaiting(for: 8))
        let answered = waiting.answered("Okay — want Study block moved to 9:30 PM?", generation: 7)
        XCTAssertEqual(answered.state, .answered)
        XCTAssertEqual(answered.answer, "Okay — want Study block moved to 9:30 PM?")
        XCTAssertFalse(answered.acceptsReply(now: t0.addingTimeInterval(20)), "one exchange per bubble; the chat carries the rest")
    }

    func testAnAnswerForAnotherTurnIsIgnored() {
        let waiting = fresh().replied("ok", now: t0).sent(generation: 3, now: t0)
        XCTAssertEqual(waiting.answered("something else", generation: 4).state, .waiting)
    }

    func testWaitingPastTheLimitTimesOutHonestly() {
        let waiting = fresh().replied("ok", now: t0).sent(generation: 1, now: t0)
        XCTAssertEqual(waiting.ticked(now: t0.addingTimeInterval(BubbleThread.answerLimit - 1)).state, .waiting)
        let late = waiting.ticked(now: t0.addingTimeInterval(BubbleThread.answerLimit + 1))
        XCTAssertEqual(late.state, .timedOut)
        XCTAssertEqual(late.statusLine, "Still working on it — I'll reply in chat.")
        XCTAssertTrue(late.isWaiting(for: 1), "the turn still runs; its answer is still this bubble's")
    }

    func testALateAnswerAfterTheTimeoutStillLands() {
        let late = fresh().replied("ok", now: t0).sent(generation: 1, now: t0).ticked(now: t0.addingTimeInterval(500))
        let answered = late.answered("Moved it.", generation: 1)
        XCTAssertEqual(answered.state, .answered)
        XCTAssertEqual(answered.answer, "Moved it.")
    }

    func testAFailedTurnSaysSoInTheBubble() {
        let failed = fresh().replied("ok", now: t0).sent(generation: 2, now: t0).failed(generation: 2)
        XCTAssertEqual(failed.state, .failed)
        XCTAssertEqual(failed.statusLine, "That didn't go through — it's in chat, try again there.")
    }

    func testATurnThatEndsWithoutAnAnswerFailsTheBubbleButNeverAnAnsweredOne() {
        let waiting = fresh().replied("ok", now: t0).sent(generation: 2, now: t0)
        XCTAssertEqual(waiting.ended().state, .failed, "cancelled or recovered: the bubble does not shimmer forever")
        XCTAssertEqual(waiting.ticked(now: t0.addingTimeInterval(99)).ended().state, .failed)
        XCTAssertEqual(waiting.answered("done", generation: 2).ended().state, .answered)
        XCTAssertEqual(fresh().ended().state, .shown)
    }

    func testTheBubbleStaysWhileItWaitsAndClearsAfter() {
        let shown = fresh()
        XCTAssertEqual(shown.keepFor, 120)
        XCTAssertNil(shown.replied("x", now: t0).sent(generation: 1, now: t0).keepFor, "never cleared while waiting")
        XCTAssertEqual(shown.replied("x", now: t0).sent(generation: 1, now: t0).answered("y", generation: 1).keepFor, 600)
    }

    func testAReplyLongAfterTheMessageIsNotBound() {
        XCTAssertFalse(fresh().acceptsReply(now: t0.addingTimeInterval(OutreachReplyTo.ttl + 1)))
    }
}

/// The exchange is mirrored into the phone's thread as one chat turn: his words, then ORION's answer, no push.
final class BubbleMirrorTests: XCTestCase {
    func testTheOutboxRowCarriesHisWordsAndTheAnswerWithoutAPush() throws {
        let row = try XCTUnwrap(BubbleMirror.outboxRow(reachID: "reach-1", said: "nah plans changed", answer: "Okay — want it at 9:30 PM?",
                                                      at: Date(timeIntervalSince1970: 1_800_000_000)))
        XCTAssertEqual(row["id"] as? String, "bubble-reach-1-1800000000")
        XCTAssertEqual(row["said"] as? String, "nah plans changed")
        XCTAssertEqual(row["text"] as? String, "Okay — want it at 9:30 PM?")
        XCTAssertEqual(row["push"] as? Bool, false)
        XCTAssertEqual(row["kind"] as? String, "bubble-reply")
        XCTAssertNil(row["askId"], "a mirrored exchange is answered, never a new question for the phone")
    }

    func testNothingToMirrorWithoutAnAnswer() {
        XCTAssertNil(BubbleMirror.outboxRow(reachID: "r", said: "ok", answer: "  ", at: Date()))
    }

    func testTheLineIsOneJSONLine() throws {
        let line = try XCTUnwrap(BubbleMirror.line(reachID: "r", said: "a\nb", answer: "c", at: Date(timeIntervalSince1970: 0)))
        XCTAssertFalse(line.dropLast().contains("\n"))
        XCTAssertTrue(line.hasSuffix("\n"))
    }
}

/// The askId label: the plugin's bubble-reply.ts reads ", askId <id>." from it (plugin test bubble-reply.test.ts uses this exact shape).
final class OutreachLabelAskIdTests: XCTestCase {
    func testAnAskRowNamesItsAskId() {
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        let ask = OutreachAsk(askId: "ask-7f3a91c2", type: "mismatch", windowStart: "19:00", windowEnd: "20:00", place: "away", title: "Study block")
        let row = OutreachRow(id: "reach-1", text: "You're out - is Study block still happening, or did plans change? I'll update the calendar.",
                              at: now.addingTimeInterval(-60), held: false, ask: ask)
        XCTAssertEqual(OutreachContext.label(for: row, now: now),
                       "[ORION context: 1 min ago you asked \"You're out - is Study block still happening, or did plans change? I'll update the calendar.\" (Study block, planned 19:00-20:00, not started, he is away), askId ask-7f3a91c2. If he says what he did or is doing, log it.]\n")
    }

    func testNoAskIdNoMention() {
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        let row = OutreachRow(id: "r", text: "Where are you?", at: now, held: false, ask: OutreachAsk(askId: nil, type: "blank"))
        XCTAssertFalse(OutreachContext.label(for: row, now: now).contains("askId"))
    }
}
