import XCTest
@testable import MouseKit

final class ScrollWheelTests: XCTestCase {
    // MARK: classifier

    func testNotchedMouseWheelIsDiscrete() {
        XCTAssertTrue(ScrollWheelPolicy.isDiscreteWheel(isContinuous: 0, scrollPhase: 0, momentumPhase: 0))
    }
    func testContinuousScrollIsLeftAlone() {
        XCTAssertFalse(ScrollWheelPolicy.isDiscreteWheel(isContinuous: 1, scrollPhase: 0, momentumPhase: 0))
    }
    func testGesturePhasesAreLeftAlone() {
        XCTAssertFalse(ScrollWheelPolicy.isDiscreteWheel(isContinuous: 0, scrollPhase: 2, momentumPhase: 0))
        XCTAssertFalse(ScrollWheelPolicy.isDiscreteWheel(isContinuous: 0, scrollPhase: 0, momentumPhase: 1))
        XCTAssertFalse(ScrollWheelPolicy.isDiscreteWheel(isContinuous: 1, scrollPhase: 4, momentumPhase: 2))
    }

    // MARK: decision: 3 modes x game x natural

    func testInvertDecisionTable() {
        let table: [(ReverseWheelMode, Bool, Bool, Bool)] = [
            // mode, game, natural, expected
            (.games, true, true, true), (.games, true, false, false), (.games, false, true, false), (.games, false, false, false),
            (.always, true, true, true), (.always, true, false, false), (.always, false, true, true), (.always, false, false, false),
            (.never, true, true, false), (.never, true, false, false), (.never, false, true, false), (.never, false, false, false),
        ]
        for (mode, game, natural, expected) in table {
            XCTAssertEqual(ScrollWheelPolicy.shouldInvert(mode: mode, gameSession: game, naturalScrolling: natural), expected, "\(mode) game=\(game) natural=\(natural)")
        }
    }

    // MARK: deltas

    func testNegatesEveryField() {
        let d = ScrollDeltas(delta1: 3, delta2: -1, pointDelta1: 30, pointDelta2: -10, fixed1: 3.5, fixed2: -1.25)
        XCTAssertEqual(d.negated(), ScrollDeltas(delta1: -3, delta2: 1, pointDelta1: -30, pointDelta2: 10, fixed1: -3.5, fixed2: 1.25))
        XCTAssertEqual(d.negated().negated(), d)
    }

    // MARK: natural-scrolling default

    func testNaturalScrollingDefaultsOnWhenUnset() {
        XCTAssertTrue(ScrollWheelPolicy.naturalScrolling(fromDefault: nil))
        XCTAssertTrue(ScrollWheelPolicy.naturalScrolling(fromDefault: true))
        XCTAssertFalse(ScrollWheelPolicy.naturalScrolling(fromDefault: false))
        XCTAssertFalse(ScrollWheelPolicy.naturalScrolling(fromDefault: 0))
    }

    // MARK: contract

    func testDefaultsToAlways() { XCTAssertEqual(BindingsFile().reverseWheel, .always) }
    func testRoundTripAllModes() throws {
        for mode in [ReverseWheelMode.games, .always, .never] {
            var b = BindingsFile(); b.reverseWheel = mode
            let data = try MouseCodec.encode(b)
            XCTAssertTrue(String(data: data, encoding: .utf8)!.contains("\"reverseWheel\" : \"\(mode.rawValue)\""))
            XCTAssertEqual(MouseCodec.decodeBindings(data), b)
        }
    }
    func testOldFileWithoutFieldDecodesToAlways() {
        XCTAssertEqual(MouseCodec.decodeBindings(Data(#"{"version":1,"enabled":true}"#.utf8)).reverseWheel, .always)
    }
    func testUnknownValueFallsBackToAlways() {
        XCTAssertEqual(MouseCodec.decodeBindings(Data(#"{"reverseWheel":"sideways"}"#.utf8)).reverseWheel, .always)
    }
    func testContractLiteral() {
        XCTAssertEqual(MouseCodec.decodeBindings(Data(#"{"reverseWheel":"always"}"#.utf8)).reverseWheel, .always)
    }
    func testWheelStateInvert() {
        var s = WheelState(mode: .games, natural: true, gameSession: false)
        XCTAssertFalse(s.invert)
        s.gameSession = true
        XCTAssertTrue(s.invert)
    }
    func testPillTitles() {
        XCTAssertEqual(ReverseWheelMode.allCases.map(MouseSetupPlan.wheelTitle), ["In games", "Always", "Never"])
    }
}
