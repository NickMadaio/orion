import XCTest
@testable import MobileCore

final class CaptureGateTests: XCTestCase {
    private let t0 = Date(timeIntervalSince1970: 1_790_000_000)

    func testTheAnswerToOurOwnRequestDoesNotStartACapture() {
        var gate = CaptureGate()
        gate.noteRequestedFix(at: t0)
        XCTAssertTrue(gate.consumeRequestedFix(at: t0.addingTimeInterval(2)))
        XCTAssertFalse(gate.consumeRequestedFix(at: t0.addingTimeInterval(3)), "only the one fix is ours")
    }

    func testARequestThatNeverArrivedCannotSwallowALaterRealUpdate() {
        var gate = CaptureGate()
        gate.noteRequestedFix(at: t0)
        XCTAssertFalse(gate.consumeRequestedFix(at: t0.addingTimeInterval(CaptureGate.requestedFixWindow + 1)))
    }

    func testAnUpdateWeDidNotRequestIsNotOurs() {
        var gate = CaptureGate()
        XCTAssertFalse(gate.consumeRequestedFix(at: t0))
    }

    func testBackgroundCapturesAreOnePerFiveMinutes() {
        var gate = CaptureGate()
        XCTAssertTrue(gate.allow(.significantChange, at: t0))
        XCTAssertFalse(gate.allow(.significantChange, at: t0.addingTimeInterval(5)))
        XCTAssertFalse(gate.allow(.backgroundRefresh, at: t0.addingTimeInterval(299)))
        XCTAssertTrue(gate.allow(.backgroundRefresh, at: t0.addingTimeInterval(300)))
    }

    func testAGeofenceEventAlwaysCapturesOnce() {
        var gate = CaptureGate()
        XCTAssertTrue(gate.allow(.significantChange, at: t0))
        XCTAssertTrue(gate.allow(.geofence, at: t0.addingTimeInterval(1)))
        XCTAssertTrue(gate.allow(.geofence, at: t0.addingTimeInterval(2)))
    }

    func testTheLoopIsBrokenEndToEnd() {
        // capture -> requestLocation -> update -> (ours, skipped): one capture, not a cycle.
        var gate = CaptureGate()
        var captures = 0
        var update = { (at: Date) in
            if gate.consumeRequestedFix(at: at) { return }
            if gate.allow(.significantChange, at: at) { captures += 1; gate.noteRequestedFix(at: at) }
        }
        for i in 0..<10 { update(t0.addingTimeInterval(Double(i) * 5)) }
        XCTAssertEqual(captures, 1)
    }
}
