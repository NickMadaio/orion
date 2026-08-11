//
//  Ducking, and the ways it could get stuck.
//
//  The failure worth guarding against is not "the fade is slightly wrong". It is
//  the clip being left permanently quiet with nothing running to explain why,
//  which is exactly what AudioDucking does to the whole machine when the user
//  touches the volume mid-listen.
//

import XCTest
@testable import SessionService

private final class SilentClips: ClipPlaying {
    var isPlaying = false
    var nowPlaying: String?
    func play(_ name: String) -> Result<Void, ClipFailure> { .success(()) }
    func pause() {}
    func resume() {}
    func stop() {}
}

final class AudioCoordinatorTests: XCTestCase {

    private var volume: Float = 0.8
    private var coordinator: AudioCoordinator!

    override func setUp() {
        super.setUp()
        volume = 0.8
        coordinator = AudioCoordinator(
            clips: SilentClips(),
            setClipVolume: { [weak self] in self?.volume = $0 },
            currentClipVolume: { [weak self] in self?.volume ?? 0 }
        )
    }

    /// Fades run on a queue, so settle before asserting.
    private func settle() {
        let done = expectation(description: "fade")
        DispatchQueue.global().asyncAfter(deadline: .now() + 0.45) { done.fulfill() }
        wait(for: [done], timeout: 2)
    }

    func testSpeakingDucksTheClipAndFinishingRestoresIt() {
        coordinator.beginSpeaking()
        settle()
        XCTAssertLessThan(volume, 0.8, "the bed has to get out of the way")
        XCTAssertGreaterThan(volume, 0, "but not vanish — that reads as broken audio")

        coordinator.endSpeaking()
        settle()
        XCTAssertEqual(volume, 0.8, accuracy: 0.01)
    }

    func testOverlappingSpeechDoesNotRestoreUnderneathTheSecondSentence() {
        coordinator.beginSpeaking()
        coordinator.beginSpeaking()
        settle()
        let ducked = volume

        coordinator.endSpeaking()   // first sentence finishes
        settle()
        XCTAssertEqual(volume, ducked, accuracy: 0.01,
                       "the second sentence is still going")

        coordinator.endSpeaking()   // second finishes
        settle()
        XCTAssertEqual(volume, 0.8, accuracy: 0.01)
    }

    func testResetRecoversFromBeingStuckDucked() {
        coordinator.beginSpeaking()
        settle()
        XCTAssertLessThan(volume, 0.8)

        // Speech never finished — a crash, a stall, a stop mid-sentence.
        coordinator.reset()

        XCTAssertEqual(volume, 0.8, accuracy: 0.01,
                       "the clip must never be left quiet with nothing to explain it")
    }

    func testEndingWithoutBeginningDoesNothingStrange() {
        coordinator.endSpeaking()
        settle()
        XCTAssertEqual(volume, 0.8, accuracy: 0.01)
    }

    /// A rule, not a behaviour: Orion only ever quietens the source it owns.
    func testItNeverReachesForSystemVolume() throws {
        let source = try String(
            contentsOf: URL(fileURLWithPath: #filePath)
                .deletingLastPathComponent().deletingLastPathComponent()
                .deletingLastPathComponent()
                .appendingPathComponent("Sources/SessionService/AudioCoordinator.swift"),
            encoding: .utf8
        )
        // Comments only, or this test fails on the header explaining why these
        // are avoided — which is exactly the documentation worth keeping.
        let code = source
            .split(separator: "\n", omittingEmptySubsequences: false)
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.hasPrefix("//") && !$0.hasPrefix("///") && !$0.hasPrefix("*") }
            .joined(separator: "\n")

        XCTAssertFalse(code.contains("osascript"), "shelling out would duck the whole machine")
        XCTAssertFalse(code.contains("set volume output"))
        XCTAssertFalse(code.contains("AudioDucking"),
                       "ducking the whole machine would catch his music and his calls")
    }
}
