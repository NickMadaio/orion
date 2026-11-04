import XCTest
@testable import MobileCore

final class LinkSyncStatusTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_800_000_000)
    private func ago(_ seconds: TimeInterval) -> Date { now.addingTimeInterval(-seconds) }

    func testAgePhrases() {
        XCTAssertEqual(LinkSyncStatus.age(ago(10), now: now), "just now")
        XCTAssertEqual(LinkSyncStatus.age(ago(60 * 4), now: now), "4 min ago")
        XCTAssertEqual(LinkSyncStatus.age(ago(3600 * 3 + 100), now: now), "3 h ago")
        XCTAssertEqual(LinkSyncStatus.age(ago(86_400 * 2 + 5), now: now), "2 d ago")
        XCTAssertEqual(LinkSyncStatus.age(now.addingTimeInterval(500), now: now), "just now")   // a skewed clock is never negative
    }

    func testFreshDataIsCalm() {
        let line = LinkSyncStatus.line(snapshotAt: ago(20), problem: nil, now: now)
        XCTAssertEqual(line.text, "Synced just now")
        XCTAssertEqual(line.tone, .fresh)
    }

    func testOldDataSaysHowOldAndOffersRetry() {
        let line = LinkSyncStatus.line(snapshotAt: ago(3600 * 5), problem: nil, now: now)
        XCTAssertEqual(line.text, "Last synced 5 h ago")
        XCTAssertEqual(line.tone, .stale)
    }

    func testNeverSyncedIsWaitingNotBlank() {
        let line = LinkSyncStatus.line(snapshotAt: nil, problem: nil, now: now)
        XCTAssertEqual(line.tone, .waiting)
        XCTAssertFalse(line.text.isEmpty)
    }

    func testProblemWinsAndKeepsTheCachedAge() {
        let withCache = LinkSyncStatus.line(snapshotAt: ago(7200), problem: "No connection to iCloud right now.", now: now)
        XCTAssertEqual(withCache.tone, .problem)
        XCTAssertEqual(withCache.text, "No connection to iCloud right now.")
        XCTAssertEqual(withCache.detail, "Showing what I had from 2 h ago")
        let none = LinkSyncStatus.line(snapshotAt: nil, problem: "Sign in to iCloud on this iPhone.", now: now)
        XCTAssertNil(none.detail)
    }
}

final class LinkSnapshotCacheTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_800_000_000)
    private func tempURL() -> URL { FileManager.default.temporaryDirectory.appendingPathComponent("snap-\(UUID().uuidString).json") }
    private func snapshot(at date: Date) -> LinkSnapshot {
        LinkSnapshot(generatedAt: date, mac: .init(name: "Mac", battery: 80, charging: true, diskFreeGB: 100, uptimeHours: 5, runningApps: [], locked: false),
                     health: [.init(date: "2026-11-04", recovery: 73, hrv: 133, restingHeartRate: 48, sleepHours: 6.6, sleepPerformance: 72, strain: 4.9)])
    }

    func testRoundTripKeepsHealth() throws {
        let url = tempURL(); defer { try? FileManager.default.removeItem(at: url) }
        let data = try LinkSnapshot.encode(snapshot(at: now.addingTimeInterval(-300)))
        LinkSnapshotCache.save(data, to: url)
        let loaded = LinkSnapshotCache.load(from: url, now: now)
        XCTAssertEqual(loaded?.health?.last?.recovery, 73)
    }

    func testMissingCorruptAndAncientCachesAreNil() throws {
        let url = tempURL(); defer { try? FileManager.default.removeItem(at: url) }
        XCTAssertNil(LinkSnapshotCache.load(from: url, now: now))
        try Data("not json".utf8).write(to: url)
        XCTAssertNil(LinkSnapshotCache.load(from: url, now: now))
        LinkSnapshotCache.save(try LinkSnapshot.encode(snapshot(at: now.addingTimeInterval(-9 * 86_400))), to: url)
        XCTAssertNil(LinkSnapshotCache.load(from: url, now: now))
    }
}
