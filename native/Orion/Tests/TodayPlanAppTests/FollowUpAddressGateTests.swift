import XCTest
@testable import Orion

/// "Was that said to ORION?" for speech that arrives WITHOUT his name: the
/// follow-up window after a reply and a barge-in. Nick, 2026-11-02: "he doesn't
/// always know the difference between conversation to him vs background talking".
/// The text gate (`AddressGate`) admitted any 2–12 word line in the follow-up
/// window once, and any 30-word line after a question; nothing asked whose voice
/// it was, how far away it was, when it came, or whether it had anything to do
/// with what ORION just said. These cases are that table.
final class FollowUpAddressGateTests: XCTestCase {

    private typealias Outcome = AddressVerdict.Outcome

    private struct Case {
        let name: String
        let signals: AddressSignals
        let expect: Outcome
    }

    private static let askedDinner = "Moved gym to 7. Want me to push dinner back too?"
    private static let saidDone = "Done, gym is at 7 now."

    private static func followUp(
        _ text: String, question: Bool = false, speaker: SpeakerEvidence = .unknown("down"),
        level: Double? = nil, onset: TimeInterval? = nil, orion: String = saidDone, weak: Int = 0
    ) -> AddressSignals {
        AddressSignals(text: text, opening: .followUp(afterQuestion: question), weakAdmitsInARow: weak,
                       speaker: speaker, levelDeltaDB: level, onsetSeconds: onset, orionLast: orion)
    }

    private static let table: [Case] = [
        // Said to ORION
        Case(name: "command, nothing else known (daemon down) stays admitted",
             signals: followUp("move my reading block to 9"), expect: .addressed),
        Case(name: "answer to his question, quick, his voice",
             signals: followUp("nah keep dinner at 7", question: true, speaker: .scored(0.62), onset: 1.1, orion: askedDinner),
             expect: .addressed),
        Case(name: "answer to his question with daemon down still gets through",
             signals: followUp("yeah push it to 8", question: true, orion: askedDinner), expect: .addressed),
        Case(name: "acknowledgement right after a statement",
             signals: followUp("sounds good thanks", onset: 0.9), expect: .addressed),
        Case(name: "shares a word with ORION's reply",
             signals: followUp("wait is gym still with sam", onset: 2.6), expect: .addressed),
        Case(name: "his name beats every negative signal",
             signals: followUp("orion what's after that", speaker: .scored(0.2), level: -20, onset: 5.5), expect: .addressed),
        Case(name: "short stop while voice is his",
             signals: AddressSignals(text: "stop", opening: .bargeIn, speaker: .scored(0.7)), expect: .addressed),
        Case(name: "barge-in command with no other evidence",
             signals: AddressSignals(text: "cancel that", opening: .bargeIn), expect: .addressed),

        // NOT said to ORION
        Case(name: "the voice is clearly not Nick",
             signals: followUp("move it to the left a bit", speaker: .scored(0.31), onset: 1.0), expect: .notAddressed),
        Case(name: "two voices in one utterance",
             signals: followUp("add it to the list", speaker: .split(first: 0.66, last: 0.28)), expect: .notAddressed),
        Case(name: "far-field speech",
             signals: followUp("check the oven timer", speaker: .scored(0.5), level: -15, onset: 1.2), expect: .notAddressed),
        Case(name: "talking to sam",
             signals: followUp("Did you see that, Sam?", speaker: .scored(0.7), onset: 0.8), expect: .notAddressed),
        Case(name: "talking to the room",
             signals: followUp("are you guys coming to dinner", speaker: .scored(0.7), onset: 0.8), expect: .notAddressed),
        Case(name: "pointing at something in the room",
             signals: followUp("look at this", speaker: .scored(0.7), onset: 0.7), expect: .notAddressed),
        Case(name: "unrelated fragment late in the window",
             signals: followUp("i mean it was kind of mid honestly", onset: 4.8), expect: .notAddressed),
        Case(name: "unrelated short line with nothing else known",
             signals: followUp("i mean it was kind of mid honestly"), expect: .notAddressed),
        Case(name: "long unrelated line after a question is not an answer",
             signals: followUp("so then he goes like we should totally do the beach thing next week and i was like no way man",
                               question: true, orion: askedDinner), expect: .notAddressed),
        Case(name: "quieter than his turns and an uncertain voice on a weak line",
             signals: followUp("that was crazy right there", speaker: .scored(0.42), level: -8), expect: .notAddressed),
        Case(name: "the text gate's own refusal still stands",
             signals: followUp("Yeah this... if I got below ninety, I'm dropping this class bro."), expect: .notAddressed),

        // Borderline: the local model decides, and fails closed
        Case(name: "his voice, quick, but unrelated",
             signals: followUp("i mean it was kind of mid honestly", speaker: .scored(0.6), onset: 1.0), expect: .borderline),
        Case(name: "command but quiet and late",
             signals: followUp("open the window", level: -8, onset: 4.5), expect: .borderline),
    ]

    func testDecisionTable() {
        for item in Self.table {
            let verdict = FollowUpAddressGate.decide(item.signals)
            XCTAssertEqual(verdict.outcome, item.expect, "\(item.name): \(verdict.reasons)")
            XCTAssertFalse(verdict.reasons.isEmpty, item.name)
        }
    }

    func testWakeAndKeyOpeningsAreUntouched() {
        // The wake path stays exactly AddressGate's, whatever the new signals say.
        for opening in [VoiceTurnOpening.wake, .pushToTalk, .typed] {
            let signals = AddressSignals(text: "move gym to 7", opening: opening, speaker: .scored(0.1), levelDeltaDB: -30)
            XCTAssertEqual(FollowUpAddressGate.decide(signals).outcome, .addressed, "\(opening)")
        }
        let overheard = AddressSignals(text: "views with clicking conversation rates shown on the slides.", opening: .wake)
        XCTAssertEqual(FollowUpAddressGate.decide(overheard).outcome, .notAddressed)
    }

    func testWeakAdmitStillCountsForTheChainGuard() {
        let first = FollowUpAddressGate.decide(Self.followUp("sounds good thanks", onset: 0.9))
        XCTAssertTrue(first.isWeak)
        let second = FollowUpAddressGate.decide(Self.followUp("sounds good thanks", onset: 0.9, weak: 1))
        XCTAssertEqual(second.outcome, .notAddressed)
    }

    func testReasonsNameTheSignals() {
        let verdict = FollowUpAddressGate.decide(Self.followUp("move it to the left a bit", speaker: .scored(0.31)))
        XCTAssertTrue(verdict.reasons.contains { $0.contains("voice") }, "\(verdict.reasons)")
    }

    // MARK: Speaker reading

    func testSpeakerReadUsesTheMeasuredBands() {
        XCTAssertEqual(FollowUpAddressGate.read(.scored(0.62)), .nick)
        XCTAssertEqual(FollowUpAddressGate.read(.scored(0.45)), .nick)
        XCTAssertEqual(FollowUpAddressGate.read(.scored(0.43)), .uncertain)
        XCTAssertEqual(FollowUpAddressGate.read(.scored(0.39)), .notNick)
        XCTAssertEqual(FollowUpAddressGate.read(.split(first: 0.7, last: 0.6)), .nick)
        XCTAssertEqual(FollowUpAddressGate.read(.split(first: 0.7, last: 0.3)), .mixed)
        XCTAssertEqual(FollowUpAddressGate.read(.split(first: 0.2, last: 0.3)), .notNick)
        XCTAssertEqual(FollowUpAddressGate.read(.split(first: 0.44, last: 0.5)), .uncertain)
        XCTAssertEqual(FollowUpAddressGate.read(.unknown("no daemon")), .unknown)
    }

    func testVerificationResultMapsToEvidence() {
        XCTAssertEqual(SpeakerEvidence(.match(score: 0.6)), .scored(0.6))
        XCTAssertEqual(SpeakerEvidence(.reject(score: 0.3, threshold: 0.83)), .scored(0.3))
        XCTAssertEqual(SpeakerEvidence(.cannotVerify(reason: "x")), .unknown("x"))
    }

    func testTwoHalvesCombine() {
        XCTAssertEqual(SpeakerEvidence.combine(.scored(0.6), .scored(0.3)), .split(first: 0.6, last: 0.3))
        XCTAssertEqual(SpeakerEvidence.combine(.scored(0.6), .unknown("too short")), .scored(0.6))
        XCTAssertEqual(SpeakerEvidence.combine(.unknown("down"), .scored(0.5)), .scored(0.5))
        XCTAssertEqual(SpeakerEvidence.combine(.unknown("down"), .unknown("down")), .unknown("down"))
    }

    /// The R2 room transcripts, said by Nick himself to friends right after a
    /// reply: none of them may be admitted on the new signals' say-so.
    func testRoomTranscriptsAreNeverAdmittedOnHisVoiceAlone() {
        for line in VoiceAddressGateTests.roomChatter + VoiceAddressGateTests.rehearsal {
            let signals = Self.followUp(line, speaker: .scored(0.6), onset: 3)
            let verdict = FollowUpAddressGate.decide(signals)
            let before = AddressGate.classify(line, opening: .followUp(afterQuestion: false))
            if !before.addressed { XCTAssertEqual(verdict.outcome, .notAddressed, line) }
            if before.isWeak { XCTAssertNotEqual(verdict.outcome, .addressed, line) }
        }
    }

    // MARK: Context

    func testOtherAddressee() {
        XCTAssertEqual(AddressContext.otherAddressee("Did you see that, Sam?"), "Sam")
        XCTAssertEqual(AddressContext.otherAddressee("Sam, come look at this."), "Sam")
        XCTAssertEqual(AddressContext.otherAddressee("are you guys ready"), "the room")
        XCTAssertEqual(AddressContext.otherAddressee("that's crazy, man."), "man")
        XCTAssertNil(AddressContext.otherAddressee("Push it to eight, please."))
        XCTAssertNil(AddressContext.otherAddressee("Okay, move gym to seven."))
        XCTAssertNil(AddressContext.otherAddressee("Tomorrow, move gym to seven."))
        XCTAssertNil(AddressContext.otherAddressee("Thanks, Orion."))
        XCTAssertNil(AddressContext.otherAddressee("yeah push it"))
    }

    func testRelatesToOrionsLastTurn() {
        XCTAssertTrue(AddressContext.relates("no keep dinner where it is", to: Self.askedDinner, afterQuestion: true))
        XCTAssertTrue(AddressContext.relates("yeah do it", to: Self.askedDinner, afterQuestion: true))
        XCTAssertTrue(AddressContext.relates("perfect thanks", to: Self.saidDone, afterQuestion: false))
        XCTAssertFalse(AddressContext.relates("yeah that movie was mid", to: Self.saidDone, afterQuestion: false))
        XCTAssertFalse(AddressContext.relates("i mean it was kind of mid honestly", to: Self.saidDone, afterQuestion: false))
        XCTAssertFalse(AddressContext.relates("anything", to: "", afterQuestion: false))
    }

    func testDeicticAside() {
        XCTAssertTrue(AddressContext.isDeicticAside("look at this"))
        XCTAssertTrue(AddressContext.isDeicticAside("Check this out."))
        XCTAssertTrue(AddressContext.isDeicticAside("come here real quick"))
        XCTAssertFalse(AddressContext.isDeicticAside("check my calendar"))
        XCTAssertFalse(AddressContext.isDeicticAside("look up the weather"))
    }
}
