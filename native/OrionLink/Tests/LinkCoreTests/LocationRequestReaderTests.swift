import XCTest
import MobileCore
@testable import LinkCore

/// The Mac's ask for a fresh phone fix travels from `location-request.json` (written by orion-awareness, in the exact
/// shape scripts/lib/awareness/fix-request.mjs writes) into the snapshot, and survives the snapshot's encode/decode.
final class LocationRequestReaderTests: XCTestCase {
    private var home: URL!
    private let now = ISO8601DateFormatter().date(from: "2026-11-02T08:00:00Z")!

    override func setUpWithError() throws {
        home = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: home.appendingPathComponent(".openclaw/orion-controlled"), withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: self.home) }
    }
    private func write(_ json: String) throws {
        try json.write(to: home.appendingPathComponent(".openclaw/orion-controlled/location-request.json"), atomically: true, encoding: .utf8)
    }

    func testAFreshRequestInTheScriptsShapeIsCarried() throws {
        try write(#"{"id":"fix-1793606400000-a1b2c3","at":"2026-11-02T07:55:00.000Z","reason":"class soon","lastFixAt":"2026-10-30T16:27:59Z"}"#)
        let request = try XCTUnwrap(SnapshotReader(home: home).locationRequest(now: now))
        XCTAssertEqual(request.id, "fix-1793606400000-a1b2c3")
        XCTAssertEqual(request.reason, "class soon")
    }

    func testAnExpiredMissingBrokenOrBadIdRequestIsNil() throws {
        let reader = SnapshotReader(home: home)
        XCTAssertNil(reader.locationRequest(now: now), "no file")
        try write(#"{"id":"fix-1","at":"2026-11-02T07:40:00.000Z"}"#)
        XCTAssertNil(reader.locationRequest(now: now), "20 minutes old is past the 15-minute lifetime")
        try write(#"{"id":"../../etc","at":"2026-11-02T07:59:00.000Z"}"#)
        XCTAssertNil(reader.locationRequest(now: now), "an id is short ASCII letters, digits, - and _ only")
        try write(#"{"id":"fix-2","at":"not a time"}"#)
        XCTAssertNil(reader.locationRequest(now: now))
        try write("not json")
        XCTAssertNil(reader.locationRequest(now: now))
    }

    func testTheRequestRoundTripsThroughTheSnapshot() throws {
        let request = LocationRequest(id: "fix-9", at: now, reason: "reminder held silent")
        let snapshot = LinkSnapshot(generatedAt: now, mac: .init(name: "Mac"), locationRequest: request)
        let decoded = try LinkSnapshot.decode(LinkSnapshot.encode(snapshot))
        XCTAssertEqual(decoded.locationRequest, request)
        let older = try LinkSnapshot.decode(LinkSnapshot.encode(LinkSnapshot(generatedAt: now, mac: .init(name: "Mac"))))
        XCTAssertNil(older.locationRequest, "a snapshot without the field still decodes")
    }
}
