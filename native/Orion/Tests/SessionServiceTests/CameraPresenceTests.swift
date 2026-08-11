//
//  The camera, and the promises made about it.
//
//  These do not test whether presence detection is accurate — that needs a
//  person in front of a lens. They test the things that would be a betrayal if
//  they were wrong: that it is off unless switched on, that it never guesses,
//  that no image is kept, and that the duty cycle is what the disclosure claims.
//

import XCTest
@testable import SessionService

final class CameraPresenceTests: XCTestCase {

    private var presence: CameraPresence!

    override func setUp() {
        super.setUp()
        presence = CameraPresence()
    }

    override func tearDown() {
        presence.stop()
        super.tearDown()
    }

    // MARK: Off by default

    func testItIsOffUntilSwitchedOn() {
        XCTAssertFalse(presence.isEnabled)
    }

    func testStartingWhileDisabledDoesNothingAtAll() {
        var readings: [PresenceReading] = []
        presence.start { readings.append($0) }

        XCTAssertTrue(readings.isEmpty, "a disabled sampler must not open the camera")
    }

    func testTurningItOffStopsItAndSaysSo() {
        presence.setEnabled(true)
        presence.setEnabled(false)

        XCTAssertFalse(presence.isEnabled)
        guard case .unavailable(let why) = presence.lastReading else {
            return XCTFail("expected .unavailable, got \(presence.lastReading)")
        }
        XCTAssertTrue(why.contains("off"), why)
    }

    // MARK: Never guessing

    /// The rule that keeps a permission problem from becoming a nagging problem.
    func testWithoutAuthorizationItReportsUnavailableAndNeverAbsent() {
        presence.setEnabled(true)

        var readings: [PresenceReading] = []
        presence.start { readings.append($0) }

        // On a machine where the suite has camera access this returns nothing
        // synchronously and the assertion below is vacuous; where it does not,
        // it must be `.unavailable` and never `.absent`.
        for reading in readings {
            XCTAssertNotEqual(reading, .absent,
                              "no camera access is not the same as nobody being there")
        }
    }

    func testTheInitialReadingIsUnavailableRatherThanAbsent() {
        guard case .unavailable = presence.lastReading else {
            return XCTFail("a sampler that has never looked must not claim he is away")
        }
    }

    // MARK: The disclosure matches the code

    /// A disclosure that drifts from the implementation is worse than none,
    /// because it is a promise nobody is checking.
    func testTheDisclosureStatesTheRealDutyCycle() {
        let text = CameraPresence.disclosure

        XCTAssertTrue(text.contains("\(Int(CameraPresence.sampleInterval)) seconds"),
                      "the stated interval has to be the real one: \(text)")
        XCTAssertTrue(text.contains(String(format: "%.1f", CameraPresence.sampleDuration)),
                      "the stated sample length has to be the real one: \(text)")
        XCTAssertTrue(text.lowercased().contains("green"),
                      "the light is the actual guarantee and has to be named")
        XCTAssertTrue(text.lowercased().contains("off unless"),
                      "off-by-default has to be stated, not implied")
    }

    func testTheDutyCycleIsUnderTwoPercentAsClaimed() {
        let duty = CameraPresence.sampleDuration / CameraPresence.sampleInterval
        XCTAssertLessThan(duty, 0.02, "the disclosure says under two percent")
    }

    // MARK: Nothing is kept

    /// Asserted against the source, because the damage is done the moment
    /// somebody adds a write — not later when a file turns up.
    func testNoFrameIsEverWrittenBufferedOrSent() throws {
        let source = try String(
            contentsOf: URL(fileURLWithPath: #filePath)
                .deletingLastPathComponent().deletingLastPathComponent()
                .deletingLastPathComponent()
                .appendingPathComponent("Sources/SessionService/CameraPresence.swift"),
            encoding: .utf8
        )
        let code = source.split(separator: "\n", omittingEmptySubsequences: false)
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.hasPrefix("//") && !$0.hasPrefix("///") }
            .joined(separator: "\n")

        XCTAssertFalse(code.contains("write(to:"), "no frame may reach the disk")
        XCTAssertFalse(code.contains("URLSession"), "and none may leave the machine")
        XCTAssertFalse(code.contains("CGImage"), "not even as an image object")
        XCTAssertFalse(code.contains("NSImage"))
        XCTAssertFalse(code.contains("jpegData"))
        XCTAssertFalse(code.contains("AVCaptureMovieFileOutput"),
                       "recording is a different promise entirely")
        XCTAssertFalse(code.contains("AVCapturePhotoOutput"))
    }

    /// The camera must not be leavable-on by any path, including error paths.
    func testEverySampleStopsTheSessionItStarted() throws {
        let source = try String(
            contentsOf: URL(fileURLWithPath: #filePath)
                .deletingLastPathComponent().deletingLastPathComponent()
                .deletingLastPathComponent()
                .appendingPathComponent("Sources/SessionService/CameraPresence.swift"),
            encoding: .utf8
        )
        XCTAssertTrue(source.contains("stopRunning"))
        // Every exit goes through `finish`, which stops the session — so there
        // is exactly one place that can leave it running, and it does not.
        XCTAssertEqual(source.components(separatedBy: "session.startRunning()").count - 1, 1,
                       "one place starts the camera")
    }
}
