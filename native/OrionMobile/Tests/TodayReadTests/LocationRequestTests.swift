import XCTest
@testable import MobileCore

final class LocationRequestTests: XCTestCase {
    private let t0 = Date(timeIntervalSince1970: 1_793_606_400)

    func testAFreshUnansweredRequestIsAnsweredOnce() {
        let request = LocationRequest(id: "fix-1", at: t0, reason: "class soon")
        XCTAssertTrue(request.shouldAnswer(lastAnsweredID: nil, now: t0.addingTimeInterval(60)))
        XCTAssertFalse(request.shouldAnswer(lastAnsweredID: "fix-1", now: t0.addingTimeInterval(60)), "the same id is never answered twice")
        XCTAssertTrue(request.shouldAnswer(lastAnsweredID: "fix-0", now: t0.addingTimeInterval(60)), "a new id is a new ask")
    }

    func testAnExpiredOrFutureRequestIsIgnored() {
        let request = LocationRequest(id: "fix-1", at: t0)
        XCTAssertTrue(request.shouldAnswer(lastAnsweredID: nil, now: t0.addingTimeInterval(LocationRequest.lifetime)))
        XCTAssertFalse(request.shouldAnswer(lastAnsweredID: nil, now: t0.addingTimeInterval(LocationRequest.lifetime + 1)))
        XCTAssertFalse(request.shouldAnswer(lastAnsweredID: nil, now: t0.addingTimeInterval(-LocationRequest.clockSkew - 1)), "from the future")
    }

    func testAMalformedIdIsNeverAnswered() {
        XCTAssertFalse(LocationRequest(id: "", at: t0).shouldAnswer(lastAnsweredID: nil, now: t0))
        XCTAssertFalse(LocationRequest(id: "a b", at: t0).shouldAnswer(lastAnsweredID: nil, now: t0))
        XCTAssertFalse(LocationRequest(id: String(repeating: "a", count: 65), at: t0).shouldAnswer(lastAnsweredID: nil, now: t0))
    }

    func testAMacRequestCapturesEvenRightAfterAnotherCapture() {
        var gate = CaptureGate()
        XCTAssertTrue(gate.allow(.backgroundRefresh, at: t0))
        XCTAssertFalse(gate.allow(.significantChange, at: t0.addingTimeInterval(30)))
        XCTAssertTrue(gate.allow(.requested, at: t0.addingTimeInterval(31)), "the Mac asked: not throttled by the 5-minute gate")
        XCTAssertFalse(gate.allow(.backgroundRefresh, at: t0.addingTimeInterval(60)), "and it counts as the last capture")
    }
}
