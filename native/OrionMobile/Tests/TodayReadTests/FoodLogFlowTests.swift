import XCTest
@testable import MobileCore

final class FoodLogFlowTests: XCTestCase {
    private func run(_ events: [FoodLogFlow.Event], from flow: FoodLogFlow = FoodLogFlow()) -> FoodLogFlow {
        events.reduce(flow) { $0.applying($1) }
    }

    func testOpenGoesStraightToTheCamera() {
        XCTAssertEqual(run([.open(.authorized)]).stage, .camera)
        // First run: the system asks for permission when the camera appears.
        XCTAssertEqual(run([.open(.notDetermined)]).stage, .camera)
    }

    func testNoCameraFallsBackToTheLibraryWithAMessage() {
        let flow = run([.open(.unavailable)])
        XCTAssertEqual(flow.stage, .library)
        XCTAssertNotNil(flow.notice)
    }

    func testDeniedCameraSaysSoAndOffersTheLibrary() {
        for access in [FoodLogFlow.CameraAccess.denied, .restricted] {
            let flow = run([.open(access)])
            XCTAssertEqual(flow.stage, .library)
            XCTAssertTrue(flow.notice?.contains("Settings") == true)
        }
    }

    func testPhotoFromCameraSendsThenSucceeds() {
        let sending = run([.open(.authorized), .gotPhoto])
        XCTAssertEqual(sending.stage, .sending)
        XCTAssertEqual(run([.finished(failure: nil)], from: sending).stage, .sent)
    }

    func testFailureKeepsTheReasonAndRetryResends() {
        let failed = run([.open(.authorized), .gotPhoto, .finished(failure: "Not sent")])
        XCTAssertEqual(failed.stage, .failed("Not sent"))
        XCTAssertEqual(run([.retry], from: failed).stage, .sending)
        XCTAssertEqual(run([.dismissToast], from: failed).stage, .idle)
    }

    func testLibraryAndTypingAreOneTapFromTheCamera() {
        XCTAssertEqual(run([.open(.authorized), .switchToLibrary]).stage, .library)
        XCTAssertEqual(run([.open(.authorized), .switchToTyping]).stage, .typing)
        XCTAssertEqual(run([.open(.unavailable), .switchToTyping]).stage, .typing)
        XCTAssertNil(run([.open(.unavailable), .switchToTyping]).notice)
    }

    func testTypedDescriptionSends() {
        XCTAssertEqual(run([.open(.authorized), .switchToTyping, .sendTyped]).stage, .sending)
        // Nothing to send from the camera.
        XCTAssertEqual(run([.open(.authorized), .sendTyped]).stage, .camera)
    }

    func testCancelClosesWithoutSending() {
        for open in [[FoodLogFlow.Event.open(.authorized)], [.open(.unavailable)], [.open(.authorized), .switchToTyping]] {
            XCTAssertEqual(run(open + [.cancel]).stage, .idle)
        }
    }

    func testCannotReopenWhileSending() {
        let sending = run([.open(.authorized), .gotPhoto])
        XCTAssertEqual(run([.open(.authorized)], from: sending).stage, .sending)
        XCTAssertEqual(run([.cancel], from: sending).stage, .sending)
    }

    func testReopenAfterSentStartsAgain() {
        let sent = run([.open(.authorized), .gotPhoto, .finished(failure: nil)])
        XCTAssertEqual(run([.open(.authorized)], from: sent).stage, .camera)
    }

    func testPresentationFlags() {
        XCTAssertTrue(run([.open(.authorized)]).showsCamera)
        XCTAssertTrue(run([.open(.unavailable)]).showsLibrary)
        XCTAssertTrue(run([.open(.authorized), .switchToTyping]).showsTyping)
        let sending = run([.open(.authorized), .gotPhoto])
        XCTAssertFalse(sending.showsCamera)
        XCTAssertTrue(sending.showsToast)
        XCTAssertFalse(FoodLogFlow().showsToast)
    }
}
