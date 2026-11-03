import XCTest
@testable import PaletteKit

final class FrecencyTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_800_000_000)

    func testNoPicksIsNoBoost() {
        XCTAssertEqual(Frecency().boost(for: "a", query: "", now: now), 0)
    }

    func testRecentPickBoostsMoreThanOldOne() {
        let recent = Frecency().recording("a", query: "", now: now.addingTimeInterval(-60))
        let old = Frecency().recording("a", query: "", now: now.addingTimeInterval(-40 * 86_400))
        XCTAssertGreaterThan(recent.boost(for: "a", query: "", now: now), old.boost(for: "a", query: "", now: now))
    }

    func testRepeatedPicksBoostMore() {
        var once = Frecency().recording("a", query: "", now: now.addingTimeInterval(-3600))
        var many = once
        for i in 1...4 { many = many.recording("a", query: "", now: now.addingTimeInterval(Double(-3600 + i * 60))) }
        once = once.recording("b", query: "", now: now)
        XCTAssertGreaterThan(many.boost(for: "a", query: "", now: now), once.boost(for: "a", query: "", now: now))
    }

    func testBoostIsCapped() {
        var f = Frecency()
        for i in 0..<200 { f = f.recording("a", query: "", now: now.addingTimeInterval(Double(-i))) }
        XCTAssertLessThanOrEqual(f.boost(for: "a", query: "", now: now), Frecency.maxBoost + Frecency.maxQueryBoost)
    }

    func testRecordingIsImmutable() {
        let base = Frecency()
        _ = base.recording("a", query: "x", now: now)
        XCTAssertEqual(base, Frecency())
    }

    func testQueryAffinityLearnsThePickedRow() {
        let f = Frecency().recording("game-ready", query: "gam", now: now)
        XCTAssertGreaterThan(f.boost(for: "game-ready", query: "gam", now: now), f.boost(for: "game-ready", query: "", now: now))
        XCTAssertGreaterThan(f.boost(for: "game-ready", query: "ga", now: now), f.boost(for: "game-ready", query: "zz", now: now))
    }

    func testRoundTripsThroughJSON() throws {
        let f = Frecency().recording("a", query: "q", now: now)
        let back = try Frecency.decode(f.encoded())
        XCTAssertEqual(back, f)
    }

    func testCorruptDataIsAnEmptyHistoryNotACrash() {
        XCTAssertEqual(Frecency.decode(Data("not json".utf8)), Frecency())
    }

    func testHistoryIsBounded() {
        var f = Frecency()
        for i in 0..<(Frecency.maxItems + 50) { f = f.recording("id\(i)", query: "", now: now.addingTimeInterval(Double(i))) }
        XCTAssertLessThanOrEqual(f.itemCount, Frecency.maxItems)
        XCTAssertNotEqual(f.boost(for: "id\(Frecency.maxItems + 49)", query: "", now: now.addingTimeInterval(1000)), 0)
    }

    func testFileStoreWritesAndReads() throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("pal-\(UUID().uuidString)")
        let store = FrecencyFile(url: dir.appendingPathComponent("palette-frecency.json"))
        XCTAssertEqual(store.load(), Frecency())
        try store.save(Frecency().recording("a", query: "", now: now))
        XCTAssertGreaterThan(store.load().boost(for: "a", query: "", now: now), 0)
    }
}
