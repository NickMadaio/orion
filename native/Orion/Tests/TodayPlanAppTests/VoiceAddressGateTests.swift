import XCTest
@testable import Orion

/// R2 live evidence (2026-10-25 / 2026-10-26): one wake word, then every later
/// turn opened by "confident speech during .thinking" — a barge-in — with no
/// address check at all (the LLM gate was removed 2026-10-08). The rehearsal
/// got 30 x "Not done: 6:00 AM–6:00 AM is shorter than 5 minutes" and the room
/// chatter became memories. These are the transcripts, as Deepgram delivered
/// them (third-party names redacted), on both sides of the line.
final class VoiceAddressGateTests: XCTestCase {

    // MARK: Fixtures — NOT said to ORION

    /// 2026-10-26 06:00–06:14, rehearsing the MKTG2201 presentation. Every one
    /// arrived as a barge-in during .thinking.
    static let rehearsal = [
        "So activity. Awareness determined by twelve main creators who focus on studying abroad, student life, or travel. Two examples",
        "Who student experience in who makes London and European travel guides. Before we sign anyone, we'll have to check the audience",
        "And about six hundred pounds per creator. Ever creator tries the product the first and sponsored posts are clearly labeled. T",
        "With still being story of lies and fits it or fits thumb in their story and update on slide we have had.",
        "Engage these videos, though. Engagement is interacting with the community. So replying to comments and --",
        "Different any viewers we have had.",
        "We with questions to Shake Later content. Every post sends viewers to a landing page that's provided from the creator most li",
        "The pricing service and the travel discount as well as compatibility. And it finishes on the eligibility check. Our engagemen",
        "Turn customers, eight thousand pounds is gonna go to promoting creator videos that drive the most eligibility checks. Another",
        "Follow already engaged. Several tracking links for creators and ads let us count each customer once.",
        "The each customer wants.",
        "Four and ads, let us count each customer once -- drive the most eligibility checks.",
        "Drive those eligibility checks. The campaign runs April to September.",
        "I eligibility checks.",
        "The September. So students discover us before they move and see follow-up ads near to their arrival. In April, we pick creato",
        "We any page setup, and we make sure the setup process is fully implemented.",
        "For Four creators start each month. Promotional run... promotion runs through months months two to six, and the final months",
        "The twenty four thousand two hundred pounds.",
        "This is into what you see on the slides, but further book it up into seventy two hundred for creators, a ten thousand pound a",
        "Five sounds allocated for production, outreach, the website, and product trials. And another two thousand pounds for any cont",
        "So impact for that budget. We're hoping to get three hundred fifty paying customers at about sixty nine pounds each.",
        "So business impact for the",
        "Any So our expected business impact for that budget, we're hoping to get three hundred fifty paying customers.",
        "It's it is profit. Or that's income, not profit. And I'll be honest, the campaign will pay for itself immediately. It's more",
        "It In the long term, build the pangs to What?",
        "It strategy. I would build a paying student customer over long term --",
        "Real cost And these are the words. These are the sources that I used throughout the slideshow to help build my point. And",
        "I time to create this wonderful slideshow. So thank you so much for watching.",
        "How",
    ]

    /// 2026-10-25 21:29–21:33, talking to people in the room.
    static let roomChatter = [
        "the",
        "No That's not a good question. Yeah. I'm not gonna ask that. You better not. because no one would work like that. Yeah. -- worried, bro.",
        "Yeah this... if I got below ninety, I'm dropping this class and retaking it next semester. I need a good I need a good GPA, bro. Yeah.",
        "Shit bro Did I actually have good grades or not? Thursday, Moss. Friday, probably just like dicks or something. Wait.",
        "Are you good Saturday idea. And nothing at the moment. But -- What? What are you doing?",
        "The office Yeah. Yeah. Yeah. till Saturday. Oh, so you -- You see, like, do you have a costume?",
        "I've I have zero cost right now.",
        "I don't So I don't...",
        "So going, like, meth coach, like, breaking bad or, like -- I know. I know. No different guys are doing breaking bad.",
        "I I need her to go, but I don't think it's gonna wanna go.",
        "Exactly remember that part. That was my goal. I need to introduce that one.",
        "Yeah but he like, he was tired of it. Wait. Let me see. He's just... I had stopped. Right? Wait. You know what? What are you",
        "Last",
        "5X equals three because you -- because if it wasn't constrained.",
        "Frozen",
        "I am excited, bro. I like how excited -- No. Sorry. Sorry. I need to actually hear you. I'm kinda excited.",
        "I'm",
    ]

    // MARK: Fixtures — said to ORION

    /// Real follow-ups and interruptions from the same fortnight, opened without
    /// the wake word. The 2026-10-08 removal was because a gate dropped five of
    /// these in one morning; none may be dropped now.
    static let addressedInterruptions = [
        "Pissing Okay. Okay. Yes. Yes. Put CS for right now until ten thirty.",
        "I'm can kill you. Orion, I'm I'm going to I'm going to die. I can't. I can't. You see that?",
        "yes, put cs lab until 10:30",
        "push my alarm to 12",
        "lets move cs lab up to 9 am",
        "change CS lab to be from 9 to 11",
        "can you throw in something before my class",
        "should i do gym first tonight?",
        "wait, stop",
        "no, move it to three",
        "Stop.",
    ]

    static let addressedFollowUps = [
        "I'm fine. It's... I'm just annoyed. Can you please put CS lab from now until ten thirty?",
        "No. You... alright. You don't need to unblock that. It's fine. Just leave it.",
        "actually do resume before gym",
        "ok and push everything 30 min",
        "dinner then gym",
        "cs lab is gonna take more like rwo hours",
        "I'm meal prepping. That's why. Sorry.",
        "going to bed now",
    ]

    /// Replies to a question ORION had just asked aloud.
    static let addressedAnswers = [
        "No. We're good. Just note that I don't have classes. I still have my lab to do, but I don't have classes.",
        "im not at the gym, im just doing cs lab right now, prob finish right before dinner",
        "yeah",
    ]

    // MARK: The gate

    func testNoRehearsalLineBecomesATurn() {
        for line in Self.rehearsal {
            XCTAssertFalse(AddressGate.classify(line, opening: .bargeIn).addressed, "rehearsal got through: \(line)")
            XCTAssertFalse(AddressGate.classify(line, opening: .followUp(afterQuestion: false), weakAdmitsInARow: 1).addressed,
                           "rehearsal got through a follow-up window: \(line)")
        }
    }

    func testNoRoomChatterBecomesATurn() {
        for line in Self.roomChatter {
            XCTAssertFalse(AddressGate.classify(line, opening: .bargeIn).addressed, "room chatter got through: \(line)")
        }
    }

    func testTheContinuingPrefixIsNotAnAddressCue() {
        let line = "(Continuing — my last message was cut off mid-sentence; this is the rest of it. Answer the whole thing.) Frozen"
        XCTAssertFalse(AddressGate.classify(line, opening: .bargeIn).addressed)
    }

    func testRealInterruptionsGetThrough() {
        for line in Self.addressedInterruptions {
            XCTAssertTrue(AddressGate.classify(line, opening: .bargeIn).addressed, "real interruption dropped: \(line)")
        }
    }

    func testRealFollowUpsGetThrough() {
        for line in Self.addressedFollowUps + Self.addressedInterruptions {
            XCTAssertTrue(AddressGate.classify(line, opening: .followUp(afterQuestion: false)).addressed, "real follow-up dropped: \(line)")
        }
    }

    func testAnswersToHisQuestionGetThrough() {
        for line in Self.addressedAnswers {
            XCTAssertTrue(AddressGate.classify(line, opening: .followUp(afterQuestion: true)).addressed, "answer dropped: \(line)")
        }
    }

    /// The key and the composer are never second-guessed. The wake word is no
    /// longer on this list: it fires on television (2026-10-31, VoiceWakeGateTests).
    func testExplicitOpeningsAreAlwaysAddressed() {
        for line in Self.rehearsal.prefix(3) + Self.roomChatter.prefix(3) {
            XCTAssertTrue(AddressGate.classify(line, opening: .pushToTalk).addressed)
            XCTAssertTrue(AddressGate.classify(line, opening: .typed).addressed)
        }
    }

    func testSayingHisNameAlwaysGetsThrough() {
        XCTAssertTrue(AddressGate.classify("so the campaign runs April to September, Orion, what's next on my day", opening: .bargeIn).addressed)
        XCTAssertTrue(AddressGate.classify("bro -- orion stop", opening: .bargeIn).addressed)
    }

    /// A short line with no command is only a weak signal; two in a row is how a
    /// rehearsal chains through follow-up windows, so the second is dropped.
    func testWeakAdmitsDoNotChain() {
        XCTAssertTrue(AddressGate.classify("dinner then gym", opening: .followUp(afterQuestion: false), weakAdmitsInARow: 0).addressed)
        XCTAssertFalse(AddressGate.classify("dinner then gym", opening: .followUp(afterQuestion: false), weakAdmitsInARow: 1).addressed)
        // A command is never weak.
        XCTAssertTrue(AddressGate.classify("push everything 30 min", opening: .followUp(afterQuestion: false), weakAdmitsInARow: 3).addressed)
        XCTAssertTrue(AddressGate.classify("dinner then gym", opening: .followUp(afterQuestion: false)).isWeak)
    }

    // MARK: Quiet window

    func testQuietRequestsAreRecognised() {
        for line in ["don't reply unless I say orion", "Don't respond unless I say your name.", "I'm rehearsing",
                     "im rehearsing my presentation", "I am practising my presentation", "im doing work shush up",
                     "be quiet for a bit", "only answer when I say orion", "stop listening"] {
            XCTAssertTrue(QuietWindow.isRequest(line), "not recognised: \(line)")
        }
        for line in ["put cs lab until 10:30", "what's on my calendar", "rehearsal is at 5, add it", "stop"] {
            XCTAssertFalse(QuietWindow.isRequest(line), "false quiet: \(line)")
        }
    }

    func testQuietWindowHoldsUntilHisNameOrTheTimeout() {
        let t0 = Date(timeIntervalSince1970: 1_800_000_000)
        let quiet = QuietWindow.off.started(at: t0)
        XCTAssertTrue(quiet.isActive(at: t0.addingTimeInterval(60)))
        // A command that would normally be addressed is still held: only his name opens it.
        XCTAssertFalse(quiet.admits("push everything 30 min", opening: .bargeIn, at: t0.addingTimeInterval(60)))
        XCTAssertFalse(quiet.admits("dinner then gym", opening: .followUp(afterQuestion: true), at: t0.addingTimeInterval(60)))
        XCTAssertTrue(quiet.admits("orion, push everything 30 min", opening: .bargeIn, at: t0.addingTimeInterval(60)))
        XCTAssertTrue(quiet.admits("anything", opening: .wake, at: t0.addingTimeInterval(60)))
        XCTAssertTrue(quiet.admits("anything", opening: .pushToTalk, at: t0.addingTimeInterval(60)))
        // Timeout.
        XCTAssertFalse(quiet.isActive(at: t0.addingTimeInterval(QuietWindow.defaultDuration + 1)))
        XCTAssertTrue(quiet.admits("push everything 30 min", opening: .bargeIn, at: t0.addingTimeInterval(QuietWindow.defaultDuration + 1)))
        // Cleared.
        XCTAssertFalse(quiet.cleared().isActive(at: t0.addingTimeInterval(60)))
        XCTAssertEqual(QuietWindow.off.started(at: t0).until, t0.addingTimeInterval(QuietWindow.defaultDuration))
    }

    func testQuietWindowClearsOnAnExplicitAddress() {
        let t0 = Date(timeIntervalSince1970: 1_800_000_000)
        let quiet = QuietWindow.off.started(at: t0)
        XCTAssertTrue(quiet.after("so the campaign runs", opening: .bargeIn).isActive(at: t0),
                      "room speech must not clear the quiet window")
        XCTAssertFalse(quiet.after("orion what time is it", opening: .bargeIn).isActive(at: t0))
        XCTAssertFalse(quiet.after("anything", opening: .wake).isActive(at: t0))
    }

    // MARK: The same failure, spoken twice

    func testTheRehearsalFailureIsSpokenOnce() {
        let t0 = Date(timeIntervalSince1970: 1_800_000_000)
        let first = "Not done: 6:00 AM–6:00 AM is shorter than 5 minutes."
        let second = "Not done: 6:03 AM–6:03 AM is shorter than 5 minutes."
        let memory = SpokenFailureMemory.empty
        XCTAssertFalse(memory.shouldSuppress(first, at: t0))
        let after = memory.recording(first, at: t0)
        XCTAssertTrue(after.shouldSuppress(second, at: t0.addingTimeInterval(180)))
        XCTAssertTrue(after.shouldSuppress(first, at: t0.addingTimeInterval(599)))
        XCTAssertFalse(after.shouldSuppress(first, at: t0.addingTimeInterval(601)))
    }

    func testOnlyFailuresAreDeduplicated() {
        let t0 = Date(timeIntervalSince1970: 1_800_000_000)
        let ok = "Done: CS Lab now 9:00 AM–9:45 AM."
        let memory = SpokenFailureMemory.empty.recording(ok, at: t0)
        XCTAssertFalse(memory.shouldSuppress(ok, at: t0.addingTimeInterval(10)))
        XCTAssertTrue(SpokenFailureMemory.isFailure("What time or how long do you mean? I haven't changed anything."))
        XCTAssertTrue(SpokenFailureMemory.isFailure("Not done: 10:30 AM is more than 3 hours ahead of now (6:05 AM); log is for what already happened."))
        XCTAssertTrue(SpokenFailureMemory.isFailure("Connection error."))
        XCTAssertFalse(SpokenFailureMemory.isFailure("That's a tough call, Nick."))
    }

    func testDifferentFailuresAreBothSpoken() {
        let t0 = Date(timeIntervalSince1970: 1_800_000_000)
        let memory = SpokenFailureMemory.empty.recording("Not done: 6:00 AM–6:00 AM is shorter than 5 minutes.", at: t0)
        XCTAssertFalse(memory.shouldSuppress("Not done: there's no movable block by that name.", at: t0.addingTimeInterval(30)))
    }

    func testFailureMemoryForgetsOldEntries() {
        let t0 = Date(timeIntervalSince1970: 1_800_000_000)
        let memory = SpokenFailureMemory.empty
            .recording("Not done: a.", at: t0)
            .recording("Not done: b.", at: t0.addingTimeInterval(700))
        XCTAssertEqual(memory.count, 1)
    }
}
