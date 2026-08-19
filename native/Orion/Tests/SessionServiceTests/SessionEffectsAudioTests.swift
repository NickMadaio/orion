import XCTest
@testable import SessionDomain
@testable import SessionService

final class SessionEffectsAudioTests: XCTestCase {
    private final class Clips: ClipPlaying {
        var played: [String] = []
        var pauseCount = 0
        var resumeCount = 0
        var isPlaying = false
        var nowPlaying: String?

        func play(_ name: String) -> Result<Void, ClipFailure> {
            played.append(name)
            nowPlaying = name
            isPlaying = true
            return .success(())
        }
        func pause() { pauseCount += 1; isPlaying = false }
        func resume() { resumeCount += 1; isPlaying = true }
        func stop() { isPlaying = false; nowPlaying = nil }
    }

    func testSelectingAppleMusicPreventsAPhaseTransitionStartingAClipUnderIt() {
        let clips = Clips()
        let effects = SessionEffects(clips: clips)
        effects.setClipPlaybackEnabled(false)

        XCTAssertTrue(effects.startClip(ClipAssignment(name: "binaural"), phaseIndex: 0))
        XCTAssertTrue(clips.played.isEmpty)
        XCTAssertEqual(clips.pauseCount, 2, "source switch and phase effect both fail quiet")
        XCTAssertNil(effects.clipProblem, "Apple Music selection is intentional, not a clip failure")
    }

    func testSelectingBinauralLetsTheSessionClockStartItsAssignedClip() {
        let clips = Clips()
        let effects = SessionEffects(clips: clips)
        effects.setClipPlaybackEnabled(true)

        XCTAssertTrue(effects.startClip(ClipAssignment(name: "binaural"), phaseIndex: 0))
        XCTAssertEqual(clips.played, ["binaural"])
    }

    func testManualBinauralPauseSurvivesRunningSessionHeartbeats() {
        let clips = Clips()
        let effects = SessionEffects(clips: clips)
        effects.setClipPlaybackEnabled(true)
        XCTAssertTrue(effects.startClip(ClipAssignment(name: "binaural"), phaseIndex: 0))

        effects.setClipPausedByUser(true)
        effects.setAudioPaused(false)
        effects.setAudioPaused(false)

        XCTAssertFalse(clips.isPlaying)
        XCTAssertEqual(clips.resumeCount, 0,
                       "a running-session heartbeat must not override the player's pause button")

        effects.setClipPausedByUser(false)
        XCTAssertTrue(clips.isPlaying)
        XCTAssertEqual(clips.resumeCount, 1)
    }
}
