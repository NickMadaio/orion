import XCTest
@testable import MobileCore

final class PlaceTransitionTests: XCTestCase {
    func testTheFirstKnownStateIsReported() {
        XCTAssertTrue(PlaceTransitions.shouldEmit(previous: nil, new: "enter"))
        XCTAssertTrue(PlaceTransitions.shouldEmit(previous: nil, new: "exit"))
    }

    func testAChangeIsReportedAndARepeatIsNot() {
        XCTAssertTrue(PlaceTransitions.shouldEmit(previous: "enter", new: "exit"))
        XCTAssertTrue(PlaceTransitions.shouldEmit(previous: "exit", new: "enter"))
        XCTAssertFalse(PlaceTransitions.shouldEmit(previous: "enter", new: "enter"))
    }

    func testAnythingButEnterOrExitIsIgnored() {
        XCTAssertFalse(PlaceTransitions.shouldEmit(previous: nil, new: "unknown"))
    }

    func testSeededHomeMatchesTheMacsHomeAndSurvivesTheSnapshot() throws {
        let home = LinkSnapshot.KnownPlace.seededHome
        XCTAssertEqual(home.lat, 51.5273608); XCTAssertEqual(home.lon, -0.0865265); XCTAssertEqual(home.radiusM, 150)
        let mac = LinkSnapshot.Mac(name: "Mac", runningApps: [], locked: false)
        let snapshot = LinkSnapshot(generatedAt: Date(timeIntervalSince1970: 1_790_000_000), mac: mac, knownPlaces: [home])
        XCTAssertEqual(try LinkSnapshot.decode(try LinkSnapshot.encode(snapshot)).knownPlaces, [home])
    }
}

final class QueuePriorityTests: XCTestCase {
    func testAWakeSignalOutlivesPlainSamples() {
        let at = "2026-10-21T09:17:00Z"
        let wake = LinkLog.sleep(event: "unplugged", at: at)
        let sample = LinkLog.signal(at: at, motion: "still", charging: false, latitude: nil, longitude: nil)
        XCTAssertTrue(SignalQueuePolicy.isPlace(wake))
        let kept = SignalQueuePolicy.trim([wake, sample, sample], limit: 2, isPlace: SignalQueuePolicy.isPlace)
        XCTAssertEqual(kept, [wake, sample])
    }
}
