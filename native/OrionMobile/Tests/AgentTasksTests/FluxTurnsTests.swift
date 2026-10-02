import XCTest
@testable import MobileCore

final class FluxTurnsTests: XCTestCase {
    private func query(_ config: FluxConfig) -> [String: String] {
        Dictionary(uniqueKeysWithValues: URLComponents(url: config.url(), resolvingAgainstBaseURL: false)!.queryItems!.map { ($0.name, $0.value!) })
    }
    func testURLHasModelEncodingRateAndThresholds() {
        let q = query(FluxConfig(eagerEotThreshold: 0.5))
        XCTAssertEqual(q["model"], "flux-general-en"); XCTAssertEqual(q["encoding"], "linear16")
        XCTAssertEqual(q["sample_rate"], "16000"); XCTAssertEqual(q["eot_threshold"], "0.7")
        XCTAssertEqual(q["eager_eot_threshold"], "0.5"); XCTAssertEqual(q["eot_timeout_ms"], "5000")
    }
    func testURLClampsOutOfRangeValuesAndOmitsEagerWhenNil() {
        let q = query(FluxConfig(eotThreshold: -1, eotTimeoutMs: 90000))
        XCTAssertEqual(q["eot_threshold"], "0.5"); XCTAssertEqual(q["eot_timeout_ms"], "60000"); XCTAssertNil(q["eager_eot_threshold"])
        let high = query(FluxConfig(eotThreshold: 2, eagerEotThreshold: 2, eotTimeoutMs: 1))
        XCTAssertEqual(high["eot_threshold"], "1.0"); XCTAssertEqual(high["eager_eot_threshold"], "0.9"); XCTAssertEqual(high["eot_timeout_ms"], "500")
        XCTAssertEqual(query(FluxConfig(eagerEotThreshold: -1))["eager_eot_threshold"], "0.3")
    }
    func testParsesConnected() { XCTAssertEqual(FluxTurns.parse(#"{"type":"Connected","request_id":"abc"}"#), .connected(requestID: "abc")) }
    func testParsesTurnInfoWithStringNumbers() { assertTurn(#"{"type":"TurnInfo","event":"Update","turn_index":"3","transcript":"hello","end_of_turn_confidence":"0.85","words":[{"word":"hello","confidence":"0.99","start":"0.0","end":"0.5"}]}"#) }
    func testParsesTurnInfoWithRealNumbers() { assertTurn(#"{"type":"TurnInfo","event":"Update","turn_index":3,"transcript":"hello","end_of_turn_confidence":0.85,"words":[{"word":"hello","confidence":0.99,"start":0.0,"end":0.5}]}"#) }
    private func assertTurn(_ text: String) {
        XCTAssertEqual(FluxTurns.parse(text), .turn(event: .update, turnIndex: 3, transcript: "hello", words: [FluxWord(word: "hello", confidence: 0.99, start: 0, end: 0.5)], endOfTurnConfidence: 0.85))
    }
    func testParsesError() { XCTAssertEqual(FluxTurns.parse(#"{"type":"Error","code":"bad","description":"failed"}"#), .error(code: "bad", description: "failed")) }
    func testNonJSONIsNil() { XCTAssertNil(FluxTurns.parse("bad")); XCTAssertNil(FluxTurns.parse("{}")); XCTAssertNil(FluxTurns.parse("[]")) }
    private func turn(_ event: FluxEvent, _ text: String, index: Int = 0) -> FluxMessage { .turn(event: event, turnIndex: index, transcript: text, words: [], endOfTurnConfidence: nil) }
    func testTrackerFinishesOnEndOfTurn() {
        var tracker = FluxTurnTracker()
        XCTAssertEqual(tracker.absorb(turn(.update, " hello ")), .none)
        XCTAssertEqual(tracker.absorb(turn(.endOfTurn, "")), .finish("hello"))
        XCTAssertEqual(tracker.absorb(turn(.endOfTurn, " final ")), .finish("final"))
    }
    func testTrackerPreparesThenResumes() {
        var tracker = FluxTurnTracker()
        XCTAssertEqual(tracker.absorb(turn(.eagerEndOfTurn, " hello ")), .prepare("hello"))
        XCTAssertEqual(tracker.absorb(turn(.turnResumed, "")), .resume)
        XCTAssertEqual(tracker.transcript, " hello ")
    }
    func testNewTurnIndexStartsFresh() {
        var tracker = FluxTurnTracker()
        _ = tracker.absorb(turn(.update, "old"))
        XCTAssertEqual(tracker.absorb(turn(.endOfTurn, "", index: 1)), .finish("")); XCTAssertEqual(tracker.turnIndex, 1)
    }
    func testCloseStreamIsExact() { XCTAssertEqual(FluxTurns.closeStream, #"{"type":"CloseStream"}"#) }
    func testUnknownEventAndInvalidIndexDoNotCrash() {
        XCTAssertEqual(FluxTurns.parse(#"{"type":"TurnInfo","event":"future","turn_index":0}"#), .unknown(type: "TurnInfo"))
        XCTAssertEqual(FluxTurns.parse(#"{"type":"TurnInfo","event":"Update","turn_index":"1e300"}"#), .unknown(type: "TurnInfo"))
    }
}
