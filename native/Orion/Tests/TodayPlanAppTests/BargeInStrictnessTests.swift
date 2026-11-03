import XCTest
@testable import Orion

/// 2026-11-02 23:56, Mac voice, someone else talking nearby. Three barge-in openings were all admitted
/// (orion-address-decisions.jsonl): "text: name" on an unknown voice with room words in front of his name, and a
/// four-word fragment on an unsure voice (0.31/0.43) that passed on "a request" alone. These are those lines, plus
/// held-out phrasings in his style.
final class BargeInStrictnessTests: XCTestCase {

    private func bargeIn(_ text: String, _ speaker: SpeakerEvidence = .unknown("down"), level: Double? = nil) -> AddressVerdict {
        FollowUpAddressGate.decide(AddressSignals(text: text, opening: .bargeIn, speaker: speaker, levelDeltaDB: level))
    }

    // MARK: The three logged lines

    func testLoggedWeatherLineStaysAdmittedOnHisVoiceOnceTheTailIsGone() {
        // The segment filter removes "You can take it off too. You know?"; what is left is his, and a request.
        let verdict = bargeIn("What's the weather like tomorrow", .scored(0.60))
        XCTAssertEqual(verdict.outcome, .addressed, "\(verdict.reasons)")
        XCTAssertEqual(verdict.sendText, "What's the weather like tomorrow")
    }

    func testLoggedNameLineKeepsOnlyThePartFromHisName() {
        let verdict = bargeIn("Still working Timmy, utilize. Orion, what time is", .unknown("not checked"))
        XCTAssertEqual(verdict.outcome, .addressed, "\(verdict.reasons)")
        XCTAssertEqual(verdict.sendText, "Orion, what time is")
        XCTAssertTrue(verdict.reasons.contains { $0.contains("before his name") }, "\(verdict.reasons)")
    }

    func testLoggedFragmentOnAnUnsureVoiceIsDropped() {
        let verdict = bargeIn("What time is Fuck", .split(first: 0.31, last: 0.43))
        XCTAssertEqual(verdict.outcome, .notAddressed, "\(verdict.reasons)")
        XCTAssertEqual(bargeIn("What time is Fuck", .scored(0.43)).outcome, .notAddressed)
        XCTAssertEqual(bargeIn("What time is Fuck", .unknown("down")).outcome, .notAddressed)
    }

    // MARK: Held-out: the name

    func testNameAfterRoomTalkIsTrimmedInHeldOutLines() {
        XCTAssertEqual(bargeIn("yeah he said its fine orion whats on my calendar tmrw").sendText, "orion whats on my calendar tmrw")
        XCTAssertEqual(bargeIn("no im good. Orion, turn the lights off").sendText, "Orion, turn the lights off")
    }

    func testNameAtTheEndOrStartKeepsTheWholeLine() {
        XCTAssertEqual(bargeIn("can you turn the lights off orion").sendText, "can you turn the lights off orion")
        XCTAssertEqual(bargeIn("orion set a timer for 10 min").sendText, "orion set a timer for 10 min")
        XCTAssertEqual(bargeIn("hey orion whats next").sendText, "hey orion whats next")
    }

    func testNameOnABargeInInAVoiceThatIsClearlyNotHisIsDropped() {
        XCTAssertEqual(bargeIn("Orion, what time is it", .scored(0.28)).outcome, .notAddressed)
        // The follow-up window keeps its rule: his name beats the signals there.
        let followUp = FollowUpAddressGate.decide(AddressSignals(text: "orion whats after that", opening: .followUp(afterQuestion: false),
                                                                 speaker: .scored(0.2)))
        XCTAssertEqual(followUp.outcome, .addressed)
    }

    // MARK: Held-out: unsure voice needs a whole request

    func testUnsureVoiceNeedsAWholeRequest() {
        XCTAssertEqual(bargeIn("what time is it", .scored(0.43)).outcome, .addressed)
        XCTAssertEqual(bargeIn("what's the weather tmrw uh", .scored(0.42)).outcome, .addressed)
        XCTAssertEqual(bargeIn("set a timer for", .scored(0.43)).outcome, .notAddressed)
        XCTAssertEqual(bargeIn("whats on my um", .unknown("down")).outcome, .notAddressed)
        XCTAssertEqual(bargeIn("move gym to like shit", .scored(0.41)).outcome, .notAddressed)
    }

    func testHisVoiceStillCarriesARoughLine() {
        XCTAssertEqual(bargeIn("what time is fuck", .scored(0.62)).outcome, .addressed)
        XCTAssertEqual(bargeIn("stop", .scored(0.7)).outcome, .addressed)
        XCTAssertEqual(bargeIn("cancel that").outcome, .addressed)
    }

    func testPartlyNotHisAndNoHalfHisIsNotHim() {
        XCTAssertEqual(FollowUpAddressGate.read(.split(first: 0.31, last: 0.43), opening: .bargeIn), .notNick)
        XCTAssertEqual(FollowUpAddressGate.read(.split(first: 0.31, last: 0.43), opening: .followUp(afterQuestion: false)), .uncertain)
    }

    // MARK: Barge-in at least as strict as follow-up

    func testBargeInIsNeverLooserThanAFollowUp() {
        let texts = ["move gym to 7", "what time is it", "What time is Fuck", "whats the weather tmrw", "set a timer for",
                     "stop", "cancel that", "can u check my calendar", "i mean it was kind of mid honestly", "that was crazy right there",
                     "Still working Timmy, utilize. Orion, what time is"]
        let speakers: [SpeakerEvidence] = [.unknown("down"), .scored(0.62), .scored(0.43), .scored(0.3),
                                           .split(first: 0.31, last: 0.43), .split(first: 0.6, last: 0.5), .split(first: 0.7, last: 0.3)]
        let levels: [Double?] = [nil, -3, -8, -14]
        for text in texts { for speaker in speakers { for level in levels {
            let barge = FollowUpAddressGate.decide(AddressSignals(text: text, opening: .bargeIn, speaker: speaker, levelDeltaDB: level))
            let follow = FollowUpAddressGate.decide(AddressSignals(text: text, opening: .followUp(afterQuestion: false),
                                                                   speaker: speaker, levelDeltaDB: level))
            if barge.outcome == .addressed {
                XCTAssertEqual(follow.outcome, .addressed, "\(text) \(speaker) \(String(describing: level)): barge \(barge.reasons) follow \(follow.reasons)")
            }
        } } }
    }

    func testLogShowsWhatWasSentAndWhatWasDropped() throws {
        var signals = AddressSignals(text: "Still working Timmy, utilize. Orion, what time is", opening: .bargeIn)
        signals.dropped = [DroppedSegment(text: "You know?", reason: "follows another voice")]
        let verdict = FollowUpAddressGate.decide(signals)
        let line = AddressDecisionLog.line(verdict: verdict, signals: verdict.signals, judged: nil, at: Date(timeIntervalSince1970: 0))
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(line.utf8)) as? [String: Any])
        XCTAssertEqual(object["sent"] as? String, "Orion, what time is")
        XCTAssertEqual((object["dropped"] as? [[String: String]])?.first?["text"], "You know?")
    }

    // MARK: Whole requests

    func testWholeRequestShape() {
        XCTAssertTrue(RequestShape.isWhole("What's the weather like tomorrow"))
        XCTAssertTrue(RequestShape.isWhole("what time is it"))
        XCTAssertTrue(RequestShape.isWhole("cancel that"))
        XCTAssertTrue(RequestShape.isWhole("stop"))
        XCTAssertFalse(RequestShape.isWhole("What time is Fuck"))
        XCTAssertFalse(RequestShape.isWhole("what time is"))
        XCTAssertFalse(RequestShape.isWhole("set a timer for"))
        XCTAssertFalse(RequestShape.isWhole("i mean it was kind of mid honestly"))
    }
}
