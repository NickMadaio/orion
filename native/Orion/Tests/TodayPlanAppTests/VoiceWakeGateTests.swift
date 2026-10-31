import XCTest
@testable import Orion

/// 2026-10-31, build 1052: Nick was watching a body-cam video, not talking to
/// ORION. The wake word fired on the video twice (voice ID "did not answer —
/// waking anyway", then "accepted 0.459"), Deepgram opened, and he pressed
/// Escape to get rid of it, which finishes a listening turn and sends it. A
/// wake opening was "explicit", so `AddressGate` never read a word of it, and
/// the server answered the first fragment with "Go on.".
///
/// The transcripts below are exactly what reached the gateway.
final class VoiceWakeGateTests: XCTestCase {

    static let bodyCamAfterFalseWake = [
        "insert at just the right point in the shoe to pick it up properly and reliably. And then",
        "pond. I always... I say... I see this every time we watch a body cam video and somebody",
        // 2026-10-26 05:59, overheard: joined mid-sentence, finished cleanly.
        "views with clicking conversation rates shown on the slides.",
    ]

    /// What Nick actually says after "Orion", from the same sessions. Deepgram
    /// lines are capitalised and punctuated; Apple's on-device ear is neither.
    static let realWakeTurns = [
        "Start up another focus session.",
        "I'm meal prepping. That's why. Sorry.",
        "No. We're good. Just note that I don't have classes. I still have my lab to do, but I don't have classes.",
        "I'm fine. It's... I'm just annoyed. Can you please put CS lab from now until ten thirty?",
        "what's on my calendar",
        "tell me a joke",
        "ugh today sucked",
        "do you think i need a rest day honestly?",
        "oye ORION cual es mi proxima clase?",
        // Half a request is still a request: the server holds it with "Go on.".
        "can you move gym to after my",
    ]

    func testOverheardSpeechAfterAFalseWakeIsNotSent() {
        for line in Self.bodyCamAfterFalseWake {
            let decision = AddressGate.classify(line, opening: .wake)
            XCTAssertFalse(decision.addressed, "overheard line sent after a wake: \(line)")
        }
    }

    func testRealWakeTurnsStillGetThrough() {
        for line in Self.realWakeTurns {
            XCTAssertTrue(AddressGate.classify(line, opening: .wake).addressed, "real wake turn dropped: \(line)")
        }
    }

    func testHisNameRescuesAnyWakeTurn() {
        XCTAssertTrue(AddressGate.classify("and then, Orion, and then", opening: .wake).addressed)
    }

    /// "And then" / "…somebody" on their own: trailing off, nothing asked, not said to ORION.
    func testTrailingFragmentsWithNoAddressAreNotSent() {
        let openings: [VoiceTurnOpening] = [.wake, .bargeIn, .followUp(afterQuestion: false), .followUp(afterQuestion: true)]
        for opening in openings {
            for line in ["And then", "and then", "and somebody", "So the thing with the", "I was going to say that"] {
                XCTAssertFalse(AddressGate.classify(line, opening: opening).addressed, "\(opening) sent the fragment: \(line)")
            }
        }
    }

    func testTheKeyAndTheComposerAreNeverSecondGuessed() {
        for line in Self.bodyCamAfterFalseWake + ["And then"] {
            XCTAssertTrue(AddressGate.classify(line, opening: .pushToTalk).addressed)
            XCTAssertTrue(AddressGate.classify(line, opening: .typed).addressed)
        }
    }

    func testFragmentShapes() {
        XCTAssertTrue(AddressGate.endsMidClause(AddressLexicon.words("and then")))
        XCTAssertFalse(AddressGate.endsMidClause(AddressLexicon.words("dinner then gym")))
        XCTAssertTrue(AddressGate.looksOverheard("pond. I always... I say"))
        XCTAssertTrue(AddressGate.looksOverheard("views with clicking conversation rates shown on the slides."))
        XCTAssertFalse(AddressGate.looksOverheard("Start up another focus session."))
        XCTAssertFalse(AddressGate.looksOverheard("ugh today sucked"))
    }
}
