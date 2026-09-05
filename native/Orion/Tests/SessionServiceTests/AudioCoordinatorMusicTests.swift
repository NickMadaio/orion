//
//  The conversation-spanning Music duck, proven by mutation.
//
//  These are new tests for new behaviour added to `AudioCoordinator` in the
//  audio-coexistence pass: `beginConversation()` / `endConversation()`, which
//  duck Apple Music for the WHOLE exchange (listening + thinking + speaking)
//  rather than only the sentence being spoken, restore it only if Nick did
//  not touch Music's own volume meanwhile, and recover if the previous run
//  crashed mid-duck. Kept in a separate file rather than added to
//  AudioCoordinatorTests.swift, which this pass does not own.
//

import XCTest
@testable import SessionService

private final class FakeMusic: MusicDucking {
    var volume: Double?
    var isPlaying = true
    private(set) var setCalls: [Double] = []

    func duckableVolume() -> Double? {
        guard isPlaying else { return nil }
        return volume
    }

    func setDuckedVolume(_ value: Double) {
        setCalls.append(value)
        volume = value
    }
}

private final class SilentClips: ClipPlaying {
    var isPlaying = false
    var nowPlaying: String?
    func play(_ name: String) -> Result<Void, ClipFailure> { .success(()) }
    func pause() {}
    func resume() {}
    func stop() {}
}

final class AudioCoordinatorMusicTests: XCTestCase {

    private var clipVolume: Float = 1.0
    private var music: FakeMusic!
    private var coordinator: AudioCoordinator!

    override func setUp() {
        super.setUp()
        clipVolume = 1.0
        music = FakeMusic()
        music.volume = 0.8
        coordinator = AudioCoordinator(
            clips: SilentClips(),
            setClipVolume: { [weak self] in self?.clipVolume = $0 },
            currentClipVolume: { [weak self] in self?.clipVolume ?? 0 },
            music: music
        )
    }

    /// Music ducking happens on its own queue; give it a beat to land.
    private func settle() {
        let done = expectation(description: "music duck")
        DispatchQueue.global().asyncAfter(deadline: .now() + 0.2) { done.fulfill() }
        wait(for: [done], timeout: 2)
    }

    func testConversationDucksMusicAndEndingRestoresIt() {
        coordinator.beginConversation()
        settle()
        XCTAssertEqual(music.volume ?? -1, 0.8 * coordinator.musicDuckedFraction, accuracy: 0.001)

        coordinator.endConversation()
        settle()
        XCTAssertEqual(music.volume ?? -1, 0.8, accuracy: 0.001,
                       "Music must be back once the WHOLE exchange ends")
    }

    /// This is the literal defect being fixed: the old code restored the
    /// instant `.listening` ended, i.e. the moment Orion started thinking or
    /// speaking. The new lease must hold across nested phase changes within
    /// one exchange and only let go when the LAST holder ends.
    func testDuckSurvivesThroughListeningThinkingAndSpeakingAsOneExchange() {
        // listening begins
        coordinator.beginConversation()
        settle()
        let duckedDuringListening = music.volume
        XCTAssertLessThan(duckedDuringListening ?? 1, 0.8)

        // NOT calling endConversation here models "still in the exchange" —
        // a real caller would only call it once, at listening-start, and
        // once more at idle-return. This test simply asserts the duck is
        // still down after an arbitrary amount of "thinking" time passes with
        // no matching end call — i.e. it does not silently expire.
        settle()
        XCTAssertEqual(music.volume ?? -1, duckedDuringListening ?? -2, accuracy: 0.001,
                       "must still be ducked while Orion is thinking/speaking")

        coordinator.endConversation()
        settle()
        XCTAssertEqual(music.volume ?? -1, 0.8, accuracy: 0.001)
    }

    func testOverlappingConversationsDoNotRestoreUnderneathEachOther() {
        coordinator.beginConversation()
        coordinator.beginConversation()   // e.g. barge-in reopening listening
        settle()
        let ducked = music.volume

        coordinator.endConversation()
        settle()
        XCTAssertEqual(music.volume ?? -1, ducked ?? -2, accuracy: 0.001, "the outer exchange is still open")

        coordinator.endConversation()
        settle()
        XCTAssertEqual(music.volume ?? -1, 0.8, accuracy: 0.001)
    }

    /// Nick's rule, applied to Music too: his hand on the volume beats an
    /// automatic restore.
    func testManualVolumeChangeDuringTheExchangeWinsOverAutoRestore() {
        coordinator.beginConversation()
        settle()
        // Nick reaches over and changes it himself while Orion is still going.
        music.volume = 0.5

        coordinator.endConversation()
        settle()
        XCTAssertEqual(music.volume ?? -1, 0.5, accuracy: 0.001,
                       "his manual change must not be clobbered by the automatic restore")
    }

    func testMusicBelowTheFloorIsNotTouched() {
        music.volume = 0.05
        coordinator.beginConversation()
        settle()
        XCTAssertEqual(music.volume ?? -1, 0.05, accuracy: 0.001, "too quiet to be worth ducking")
    }

    func testMusicNotPlayingIsNotTouched() {
        music.isPlaying = false
        coordinator.beginConversation()
        settle()
        XCTAssertEqual(music.setCalls.count, 0)
    }

    /// The unconditional half — `reset()` is what a crash-safety path and the
    /// "restore audio now" panic button both call. Unlike `endConversation()`
    /// it must put Music back even if the volume looks hand-changed, because
    /// the caller is asking for an unconditional restore, not a guess.
    func testResetForcesMusicBackRegardlessOfApparentManualChange() {
        coordinator.beginConversation()
        settle()
        music.volume = 0.5   // looks hand-changed
        coordinator.reset()
        XCTAssertEqual(music.volume ?? -1, 0.8, accuracy: 0.001,
                       "reset() is the unconditional restore, not the polite one")
    }

    func testNoMusicSourceIsSafe() {
        let noMusicCoordinator = AudioCoordinator(
            clips: SilentClips(),
            setClipVolume: { _ in },
            currentClipVolume: { 0 }
        )
        noMusicCoordinator.beginConversation()
        noMusicCoordinator.endConversation()
        noMusicCoordinator.reset()
        // No crash, no assertion failure — that is the whole test.
    }
}
