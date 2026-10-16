import XCTest
import MobileCore
@testable import LinkCore

/// WP5 / C6: geofence events and the phone's audio route land in the Mac's health log.
final class PlaceLogTests: XCTestCase {
    private var dir: URL!
    private var file: URL { dir.appendingPathComponent("health-log.json") }
    private let now = Date(timeIntervalSince1970: 1_790_000_000)

    override func setUpWithError() throws {
        dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let seed: [String: Any] = ["schema": "orion.health.v3", "futureField": ["kept": true]]
        try JSONSerialization.data(withJSONObject: seed).write(to: file)
        addTeardownBlock { try? FileManager.default.removeItem(at: self.dir) }
    }

    private func json() throws -> [String: Any] {
        try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: file)) as? [String: Any])
    }
    private func stamp(_ offset: Int) -> String { ISO8601DateFormatter().string(from: now.addingTimeInterval(Double(offset))) }

    func testAPlaceEntryLandsInPlaceEventsWithRoundedCoordinates() throws {
        let log = TrackingLog(file: file)
        try log.apply(.place(event: "enter", placeId: "home", at: stamp(0), latitude: 51.5273608, longitude: -0.0865265), now: now)
        let events = try XCTUnwrap(json()["placeEvents"] as? [[String: Any]])
        XCTAssertEqual(events.count, 1)
        XCTAssertEqual(events[0]["event"] as? String, "enter")
        XCTAssertEqual(events[0]["placeId"] as? String, "home")
        XCTAssertEqual(events[0]["latitude"] as? Double, 51.527)
        XCTAssertEqual(events[0]["longitude"] as? Double, -0.087)
        XCTAssertNotNil((try json()["futureField"]) as? [String: Any], "unknown keys survive")
    }

    func testPlaceEventsAreCappedAtFiveHundredKeepingTheNewest() throws {
        let log = TrackingLog(file: file)
        for index in 0..<503 {
            try log.apply(.place(event: index % 2 == 0 ? "enter" : "exit", placeId: "home", at: stamp(index)), now: now)
        }
        let events = try XCTUnwrap(json()["placeEvents"] as? [[String: Any]])
        XCTAssertEqual(events.count, 500)
        XCTAssertEqual(events.first?["at"] as? String, stamp(3))
        XCTAssertEqual(events.last?["at"] as? String, stamp(502))
    }

    func testAPlaceEventDoesNotTouchTheDayRecord() throws {
        try TrackingLog(file: file).apply(.place(event: "exit", placeId: "gym", at: stamp(0)), now: now)
        XCTAssertNil(try json()["nutritionLog"])
    }

    func testTheAudioRouteStaysOnThePhoneSignalsRow() throws {
        let log = TrackingLog(file: file)
        try log.apply(.signal(at: stamp(0), motion: "still", charging: false, latitude: nil, longitude: nil, audio: "bluetooth"), now: now)
        try log.apply(.signal(at: stamp(60), motion: "still", charging: false, latitude: nil, longitude: nil), now: now)
        let rows = try XCTUnwrap(json()["phoneSignals"] as? [[String: Any]])
        XCTAssertEqual(rows[0]["audio"] as? String, "bluetooth")
        XCTAssertNil(rows[1]["audio"])
    }
}
