//
//  Clips, with real audio files written to a real directory.
//
//  The fixtures are generated rather than committed: a few seconds of tone is
//  enough to prove a file opens, reports a duration and plays, and checking
//  binary audio into the repo to test a directory listing would be a poor trade.
//

import XCTest
import AVFoundation
@testable import SessionDomain
@testable import SessionService

final class ClipTests: XCTestCase {

    private var directory: URL!
    private var library: ClipLibrary!

    override func setUp() {
        super.setUp()
        directory = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("orion-clips-\(UUID().uuidString)")
        try! FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        library = ClipLibrary(directory: directory)
    }

    override func tearDown() {
        try? FileManager.default.removeItem(at: directory)
        super.tearDown()
    }

    /// A real, decodable .caf file of the requested length.
    @discardableResult
    private func writeClip(_ name: String, seconds: Double = 2) throws -> URL {
        let url = directory.appendingPathComponent("\(name).caf")
        let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 44100,
                                   channels: 2, interleaved: false)!
        let file = try AVAudioFile(forWriting: url, settings: format.settings)

        let frames = AVAudioFrameCount(44100 * seconds)
        let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frames)!
        buffer.frameLength = frames
        for frame in 0..<Int(frames) {
            let t = Double(frame) / 44100
            let value = Float(sin(2 * .pi * 220 * t) * 0.2)
            buffer.floatChannelData![0][frame] = value
            buffer.floatChannelData![1][frame] = value
        }
        try file.write(from: buffer)
        return url
    }

    // MARK: Discovery

    func testClipsAreFoundAndTimed() throws {
        try writeClip("rain", seconds: 2)
        try writeClip("forest", seconds: 3)

        let inventory = library.inventory()

        XCTAssertEqual(inventory.clips.map(\.name), ["forest", "rain"], "sorted by file name")
        XCTAssertEqual(inventory.clips.first { $0.name == "rain" }?.duration ?? 0, 2, accuracy: 0.05)
        XCTAssertNil(inventory.explanation, "there is nothing to explain when it worked")
    }

    func testAMissingDirectorySaysSoRatherThanLookingEmpty() {
        let absent = ClipLibrary(directory: directory.appendingPathComponent("nope"))

        let inventory = absent.inventory()

        XCTAssertTrue(inventory.isEmpty)
        XCTAssertNotNil(inventory.directoryProblem)
        XCTAssertTrue(inventory.explanation?.contains("no clip folder") ?? false,
                      inventory.explanation ?? "")
    }

    func testAnEmptyDirectorySaysWhereToPutFiles() {
        let inventory = library.inventory()

        XCTAssertTrue(inventory.isEmpty)
        XCTAssertNil(inventory.directoryProblem, "the folder is fine; it is just empty")
        XCTAssertTrue(inventory.explanation?.contains(directory.path) ?? false,
                      inventory.explanation ?? "")
    }

    func testAFileThatIsNotAudioIsRejectedWithAReasonNotIgnored() throws {
        try Data("this is not audio".utf8)
            .write(to: directory.appendingPathComponent("broken.wav"))

        let inventory = library.inventory()

        XCTAssertTrue(inventory.clips.isEmpty)
        XCTAssertEqual(inventory.rejected.count, 1)
        XCTAssertEqual(inventory.rejected[0].name, "broken.wav")
        XCTAssertTrue(inventory.explanation?.contains("broken.wav") ?? false,
                      "a file Nick can see in Finder must not be silently ignored")
    }

    func testAnEmptyFileIsRejectedAsEmpty() throws {
        try Data().write(to: directory.appendingPathComponent("zero.wav"))

        XCTAssertEqual(library.inventory().rejected.first?.reason, "the file is empty")
    }

    func testNonAudioExtensionsAreSkippedQuietly() throws {
        try Data("notes".utf8).write(to: directory.appendingPathComponent("README.txt"))
        try writeClip("rain")

        let inventory = library.inventory()

        XCTAssertEqual(inventory.clips.map(\.name), ["rain"])
        XCTAssertTrue(inventory.rejected.isEmpty,
                      "a stray text file is not a broken clip and must not be reported as one")
    }

    // MARK: Validation timing

    func testRevalidateCatchesAFileThatVanishedAfterSetup() throws {
        let url = try writeClip("rain")
        XCTAssertNoThrow(try XCTUnwrap(library.clip(named: "rain")))

        // Fifty minutes later: the drive unmounted, or Nick tidied up.
        try FileManager.default.removeItem(at: url)

        switch library.revalidate(named: "rain") {
        case .success:
            XCTFail("a clip that is gone must not validate")
        case .failure(let failure):
            XCTAssertTrue(failure.reason.contains("rain"), failure.reason)
        }
    }

    func testRevalidateCatchesAFileThatBecameUnreadable() throws {
        let url = try writeClip("rain")
        try Data("truncated".utf8).write(to: url)

        switch library.revalidate(named: "rain") {
        case .success: XCTFail("a corrupted clip must not validate")
        case .failure(let failure): XCTAssertTrue(failure.reason.contains("rain"), failure.reason)
        }
    }

    // MARK: Shuffle

    func testShuffledOrderIsAPermutation() {
        let order = library.shuffledOrder(count: 3)
        XCTAssertEqual(order.sorted(), [0, 1, 2])
    }

    func testShuffleAppliedToAPlanKeepsDurationsAndMovesClips() {
        let clips = [ClipAssignment(name: "a"), ClipAssignment(name: "b"),
                     ClipAssignment(name: "c")]
        let plan = SessionPlanBuilder.alternating(
            session: SessionID("S1"), focusBlocks: 3,
            focus: 3000, rest: 600, clips: clips, task: "t"
        )

        let shuffled = SessionPlanBuilder.assigning(clips, to: plan, order: [2, 0, 1])

        XCTAssertEqual(shuffled.phases.map(\.requestedDuration), plan.phases.map(\.requestedDuration))
        XCTAssertEqual(shuffled.phases.filter(\.kind.isFocus).compactMap(\.clip?.name),
                       ["c", "a", "b"])
        XCTAssertNil(shuffled.phases.first { !$0.kind.isFocus }?.clip,
                     "breaks keep no clip")
    }

    // MARK: The player

    func testPlayingAMissingClipFailsLoudlyRatherThanSilently() {
        let player = ClipPlayer(library: library)
        var reported: String?
        player.onFailure = { reported = $0 }

        let result = player.play("nothing-here")

        guard case .failure(let failure) = result else { return XCTFail("expected a failure") }
        XCTAssertTrue(failure.reason.contains("nothing-here"), failure.reason)
        XCTAssertNotNil(reported, "the UI has to be able to say why it is quiet")
        XCTAssertNil(player.nowPlaying)
        XCTAssertEqual(player.lastFailure, failure.reason)
    }

    func testPlayingARealClipLoopsRatherThanEndingThePhase() throws {
        try writeClip("rain", seconds: 1)
        let player = ClipPlayer(library: library)

        guard case .success = player.play("rain") else { return XCTFail("should have played") }
        XCTAssertEqual(player.nowPlaying, "rain")
        XCTAssertTrue(player.isPlaying)

        // Past the end of a one-second file. Looping means it is still going —
        // the clock owns the boundary, not the file.
        Thread.sleep(forTimeInterval: 1.4)
        XCTAssertTrue(player.isPlaying, "numberOfLoops = -1: the file must never end the phase")
        XCTAssertNil(player.lastFailure)

        player.stop()
        XCTAssertFalse(player.isPlaying)
        XCTAssertNil(player.nowPlaying)
    }

    func testPauseKeepsItsOffsetAndResumeContinuesFromThere() throws {
        try writeClip("rain", seconds: 5)
        let player = ClipPlayer(library: library)
        player.play("rain")

        Thread.sleep(forTimeInterval: 0.6)
        player.pause()
        XCTAssertFalse(player.isPlaying)

        Thread.sleep(forTimeInterval: 0.3)
        player.resume()

        XCTAssertTrue(player.isPlaying)
        XCTAssertEqual(player.nowPlaying, "rain", "resume must not restart a different clip")
        player.stop()
    }

    func testStartingASecondClipReplacesTheFirst() throws {
        try writeClip("rain")
        try writeClip("forest")
        let player = ClipPlayer(library: library)

        player.play("rain")
        player.play("forest")

        XCTAssertEqual(player.nowPlaying, "forest")
        player.stop()
    }

    func testVolumeIsTheSourcesOwnAndNotTheSystems() throws {
        // Regression guard for a rule rather than a behaviour: Orion only ever
        // controls the source it owns. If this ever starts shelling out to
        // `osascript ... set volume`, it would duck Nick's music and his calls.
        let source = try String(contentsOf: URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("Sources/SessionService/ClipPlayer.swift"), encoding: .utf8)

        XCTAssertFalse(source.contains("set volume"),
                       "never use global system volume for a clip")
        XCTAssertFalse(source.contains("osascript"))
    }
}
