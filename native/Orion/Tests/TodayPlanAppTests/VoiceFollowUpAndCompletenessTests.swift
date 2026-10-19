import XCTest
@testable import Orion

final class VoiceFollowUpAndCompletenessTests: XCTestCase {
    private let t0 = Date(timeIntervalSince1970: 1_800_000_000)
    private let brief = "Good morning, Nick. You have five events today, starting with Systems at 9:00 and ending with gym at 6:30 PM. "
        + "Recovery is 47 percent, sleep was 78, and yesterday's strain was 10.8, well below your usual band. "
        + "It is 61 degrees and clear, so a walk between classes is a good idea. Two reminders are still open from yesterday. "
        + "Anything you want to change?"

    // MARK: Item 1

    func testBriefIsNeverArmedEvenWhenItEndsInACourtesyQuestion() {
        XCTAssertGreaterThan(brief.count, 300)
        XCTAssertTrue(SpokenQuestionFollowUp.isNarrative(brief))
        XCTAssertFalse(SpokenQuestionFollowUp.needsAnswer(brief))
        var p = SpokenQuestionFollowUp(); p.arm(text: brief, at: t0)
        XCTAssertNil(p.armed)
        XCTAssertEqual(p.tick(now: t0.addingTimeInterval(60), idle: 1, locked: false), .none)
        var multi = SpokenQuestionFollowUp(); multi.arm(text: "Here is the list:\n- gym\n- class\nWhat should I move?", at: t0)
        XCTAssertNotNil(multi.armed, "a short list ending in a question is a question; only length and kind exclude briefs")
        var longList = SpokenQuestionFollowUp()
        longList.arm(text: "Today:\n" + String(repeating: "- a fairly long item about the day\n", count: 8) + "What should I move?", at: t0)
        XCTAssertNil(longList.armed)
    }

    func testRepeatIsTheFinalQuestionSentenceOnly() {
        let long = "I looked at your afternoon. Gym overlaps with the lab. When should I move the gym block?"
        var p = SpokenQuestionFollowUp(); p.arm(text: long, at: t0)
        XCTAssertEqual(p.tick(now: t0.addingTimeInterval(20), idle: 1, locked: false), .repeatAloud("When should I move the gym block?"))
        XCTAssertEqual(SpokenQuestionFollowUp.finalQuestion("Done. Anything else?"), "Anything else?")
        XCTAssertNil(SpokenQuestionFollowUp.finalQuestion("Done."))
    }

    func testDriverSpeaksNickPlusFinalQuestionAndOnlyOnce() {
        let f = FakeScheduler(); var now = t0; var spoken: [String] = []
        let d = SpokenQuestionDriver(scheduler: f, now: { now }, idle: { 1 }, locked: { false },
                                     onRepeatAloud: { spoken.append($0) }, onSendToPhone: { _ in XCTFail("at the Mac") })
        d.arm(text: "Gym overlaps with the lab. When should I move the gym block?")
        now = t0.addingTimeInterval(20); f.fireLive()
        XCTAssertEqual(spoken, ["Nick? When should I move the gym block?"])
        d.arm(text: spoken[0])
        now = t0.addingTimeInterval(80); f.fireLive()
        XCTAssertEqual(spoken.count, 1, "single-repeat rule")
        d.arm(text: brief)
        XCTAssertTrue(f.liveCount == 0, "a brief never schedules a timer")
    }

    func testNothingIsSentToThePhoneThatAlreadyWentThere() {
        let q = "What time should I put the review block?"
        var already = SpokenQuestionFollowUp(); already.arm(text: q, onPhone: true, at: t0)
        XCTAssertEqual(already.tick(now: t0.addingTimeInterval(21), idle: 1, locked: true), .none)
        XCTAssertEqual(already.tick(now: t0.addingTimeInterval(90), idle: 1, locked: true), .none)
        var fresh = SpokenQuestionFollowUp(); fresh.arm(text: q, at: t0)
        XCTAssertEqual(fresh.tick(now: t0.addingTimeInterval(21), idle: 1, locked: true), .sendToPhone(q))
        var home = SpokenQuestionFollowUp(); home.arm(text: q, onPhone: true, at: t0)
        XCTAssertEqual(home.tick(now: t0.addingTimeInterval(21), idle: 1, locked: false), .repeatAloud(q), "at the Mac it is still asked aloud")
    }

    func testAnswerDisarmsAndSpentQuestionStaysSpent() {
        let q = "Which one do you mean?"
        var p = SpokenQuestionFollowUp(); p.arm(text: q, at: t0); p.answered()
        XCTAssertNil(p.armed)
        p.arm(text: q, at: t0)
        _ = p.tick(now: t0.addingTimeInterval(20), idle: 1, locked: false)
        p.arm(text: "Nick? " + q, at: t0.addingTimeInterval(21))
        XCTAssertNil(p.armed)
    }

    // MARK: Item 2

    func testCompleteTextEndingInQuoteBracketEmojiOrListItemIsAccepted() {
        let good = [
            "Recovery was strong and sleep held steady.",
            "He called it \u{201C}a solid night.\u{201D}",
            "Sleep was long (about eight hours).",
            "Sleep was long (about eight hours)",
            "Rest day suggested [see strain].",
            "You slept well \u{1F634}",
            "Great recovery today! \u{1F389}",
            "Priorities today:\n- Finish the lab\n- Gym at six",
            "1. Finish the lab\n2. Gym at six",
            "Strong **recovery**",
            "Wait\u{2026}",
        ]
        for text in good { XCTAssertTrue(TextCompleteness.isComplete(text), text) }
        for text in good {
            let body = try! JSONSerialization.data(withJSONObject: ["response": text])
            XCTAssertEqual(try LocalModel.responseText(body, requireSentenceEnding: true), text.trimmingCharacters(in: .whitespacesAndNewlines))
        }
    }

    func testRealMidSentenceCutsAreRejected() {
        let cut = [
            "Your recovery was high and you should",
            "Your recovery was high and",
            "He said \"go to the",
            "Sleep was long (about eight",
            "Priorities today:\n- Finish the lab\n- Gym at the",
            "Recovery is 47, which is",
            "Sleep was long,",
            "Recovery was strong \u{2014}",
        ]
        for text in cut {
            XCTAssertFalse(TextCompleteness.isComplete(text), text)
            let body = try! JSONSerialization.data(withJSONObject: ["response": text])
            XCTAssertThrowsError(try LocalModel.responseText(body, requireSentenceEnding: true), text) {
                XCTAssertEqual($0 as? LocalModelError, .truncated)
            }
        }
    }

    func testDefaultBudgetFitsTheLongestNarrativeMode() {
        // Longest local mode: four "LABEL — sentence" lines, sentence under 18 words, label two words. Very pessimistic 3 tokens/word.
        let words = 4 * (2 + 1 + 18), tokens = words * 3
        XCTAssertGreaterThanOrEqual(LocalModel.defaultMaxTokens, tokens + 100)
        // Paragraph mode: three sentences of up to 35 words.
        XCTAssertGreaterThanOrEqual(LocalModel.defaultMaxTokens, 3 * 35 * 2)
        let body = LocalModel.requestBody(prompt: "p", model: LocalModel.defaultModel, maxTokens: LocalModel.defaultMaxTokens, temperature: 0.1)
        let predict = (body["options"] as? [String: Any])?["num_predict"] as? Int
        XCTAssertGreaterThanOrEqual(predict ?? 0, LocalModel.defaultMaxTokens)
    }

    // MARK: Item 3 (cause of the 10-19 double speech)

    /// The log shows one 359-char brief (08:22:19) and then "[question] repeating aloud" at 08:23:09 for 365 chars: the app's own
    /// follow-up was the second time. That path can no longer be armed by the brief.
    func testTheFollowUpRepeatOfTheBriefIsTheAppCauseAndIsClosed() {
        var p = SpokenQuestionFollowUp()
        p.arm(text: brief, reachID: "reach-1", at: t0)
        p.speechEnded(at: t0.addingTimeInterval(30))
        XCTAssertEqual(p.tick(now: t0.addingTimeInterval(51), idle: 0, locked: false), .none)
    }

    func testListItemCutMidWordIsRejectedAndCompleteShortItemAccepted() {
        XCTAssertTrue(TextCompleteness.isComplete("Practice:\n- leetcode"), "jargon is not a cut")
        XCTAssertFalse(TextCompleteness.isComplete("Things to do:\n- book the flight.\n- call the dent"))
        XCTAssertFalse(TextCompleteness.isComplete("Things to do:\n- call the dentist and"))
        XCTAssertTrue(TextCompleteness.isComplete("Things to do:\n- call the dentist"))
        XCTAssertTrue(TextCompleteness.isComplete("- call the dentist"))
        XCTAssertTrue(TextCompleteness.isComplete("- buy milk\n- call the dentist"))
    }
}

final class FakeScheduler: QuestionScheduler {
    private var pending: [(fire: () -> Void, id: Int)] = []
    private var cancelled = Set<Int>(); private var next = 0
    var liveCount: Int { pending.filter { !cancelled.contains($0.id) }.count }
    func schedule(after seconds: TimeInterval, _ fire: @escaping () -> Void) -> () -> Void {
        next += 1; let id = next
        pending.append((fire, id))
        return { [self] in cancelled.insert(id) }
    }
    func fireLive() { let live = pending.filter { !cancelled.contains($0.id) }; pending = []; live.forEach { $0.fire() } }
}
