import XCTest
@testable import ActivityKit

final class ContractTests: XCTestCase {
    private func decode(_ data: Data) -> [String: Any] {
        (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
    }

    func testSnapshotEncodesEveryContractKeyIncludingNulls() throws {
        let snap = ActivitySnapshot(at: "2026-11-04T10:00:00Z", idleSeconds: 12,
            app: .init(name: "Safari", bundleId: "com.apple.Safari", pid: 123), category: .browser,
            window: nil, domain: "youtube.com", siteCategory: .video,
            game: nil, focus: nil)
        let o = decode(try snap.encoded())
        XCTAssertEqual(o["version"] as? Int, 1)
        XCTAssertEqual(o["at"] as? String, "2026-11-04T10:00:00Z")
        XCTAssertEqual(o["idleSeconds"] as? Int, 12)
        XCTAssertEqual((o["app"] as? [String: Any])?["bundleId"] as? String, "com.apple.Safari")
        XCTAssertEqual((o["app"] as? [String: Any])?["pid"] as? Int, 123)
        XCTAssertEqual(o["category"] as? String, "browser")
        XCTAssertEqual(o["domain"] as? String, "youtube.com")
        XCTAssertEqual(o["siteCategory"] as? String, "video")
        for key in ["window", "game", "focus"] { XCTAssertTrue(o[key] is NSNull, "\(key) must be an explicit null") }
    }

    func testGameAndFocusObjects() throws {
        let snap = ActivitySnapshot(at: "t", idleSeconds: nil,
            app: .init(name: "java", bundleId: nil, pid: 9), category: .game, window: "Minecraft 1.21",
            domain: nil, siteCategory: nil,
            game: .init(name: "Minecraft", since: "2026-11-04T09:20:00Z"),
            focus: .init(active: true, task: "Finish resume", allowedApps: ["com.apple.Safari"], allowedDomains: ["docs.google.com"]))
        let o = decode(try snap.encoded())
        XCTAssertTrue(o["idleSeconds"] is NSNull)
        XCTAssertNil(o["url"], "the full URL (query string and all) is never written"); XCTAssertTrue(o["siteCategory"] is NSNull)
        XCTAssertEqual((o["game"] as? [String: Any])?["since"] as? String, "2026-11-04T09:20:00Z")
        let focus = o["focus"] as? [String: Any]
        XCTAssertEqual(focus?["task"] as? String, "Finish resume")
        XCTAssertEqual(focus?["allowedDomains"] as? [String], ["docs.google.com"])
        XCTAssertEqual(focus?["active"] as? Bool, true)
    }

    func testHistoryLineHoldsADomainNeverAFullUrl() throws {
        let snap = ActivitySnapshot(at: "2026-11-04T10:00:00Z", idleSeconds: 0,
            app: .init(name: "Safari", bundleId: "com.apple.Safari", pid: 1), category: .browser, window: "secret title",
            domain: "youtube.com", siteCategory: .video, game: nil, focus: nil)
        let line = String(decoding: try HistoryLine(snapshot: snap).encoded(), as: UTF8.self)
        XCTAssertFalse(line.contains("PRIVATE")); XCTAssertFalse(line.contains("secret title")); XCTAssertFalse(line.contains("watch?v"))
        XCTAssertFalse(line.contains("\n"))
        let o = decode(Data(line.utf8))
        XCTAssertEqual(o["bundleId"] as? String, "com.apple.Safari"); XCTAssertEqual(o["domain"] as? String, "youtube.com")
        XCTAssertEqual(o["category"] as? String, "browser"); XCTAssertEqual(o["at"] as? String, "2026-11-04T10:00:00Z")
    }

    func testPruneKeepsSevenDaysAndDropsBrokenLines() {
        let text = [#"{"at":"2026-10-20T10:00:00Z","bundleId":"a","category":"work","domain":null}"#,
                    #"{"at":"2026-10-26T10:00:00Z","bundleId":"b","category":"work","domain":null}"#,
                    "not json",
                    #"{"at":"2026-11-03T10:00:00Z","bundleId":"c","category":"game","domain":null}"#].joined(separator: "\n") + "\n"
        let now = ISO8601DateFormatter().date(from: "2026-11-04T10:00:00Z")!
        let kept = HistoryLine.prune(text, now: now)
        XCTAssertFalse(kept.contains(#""bundleId":"a""#)); XCTAssertFalse(kept.contains(#""bundleId":"b""#))
        XCTAssertTrue(kept.contains(#""bundleId":"c""#)); XCTAssertFalse(kept.contains("not json"))
    }

    func testWriteGateRewritesOnChangeAndAtLeastEveryFifteenSeconds() {
        let t0 = Date(timeIntervalSince1970: 1_000)
        XCTAssertTrue(WriteGate.shouldWrite(lastSignature: nil, lastAt: nil, signature: "a", now: t0))
        XCTAssertFalse(WriteGate.shouldWrite(lastSignature: "a", lastAt: t0, signature: "a", now: t0.addingTimeInterval(14)))
        XCTAssertTrue(WriteGate.shouldWrite(lastSignature: "a", lastAt: t0, signature: "a", now: t0.addingTimeInterval(15)))
        XCTAssertTrue(WriteGate.shouldWrite(lastSignature: "a", lastAt: t0, signature: "b", now: t0.addingTimeInterval(1)))
    }

    func testHistoryAppendsOnlyWhenTheActivityKeyChanges() {
        XCTAssertTrue(HistoryLine.isChange(previous: nil, bundleId: "a", category: .work, domain: nil))
        XCTAssertFalse(HistoryLine.isChange(previous: HistoryLine.key(bundleId: "a", category: .work, domain: nil), bundleId: "a", category: .work, domain: nil))
        XCTAssertTrue(HistoryLine.isChange(previous: HistoryLine.key(bundleId: "a", category: .browser, domain: "x.com"), bundleId: "a", category: .browser, domain: "y.com"))
    }

    func testFocusStateReaderFindsTheActiveSessionAndTolerantFields() {
        let json = #"{"schemaVersion":1,"session":{"task":"Finish resume","allowedApps":["com.apple.Safari"],"allowedDomains":["docs.google.com"],"events":[{"kind":{"started":{}}}]}}"#
        let f = FocusReader.focus(fromStateJSON: Data(json.utf8))
        XCTAssertEqual(f?.task, "Finish resume"); XCTAssertEqual(f?.allowedApps, ["com.apple.Safari"])
        let done = #"{"schemaVersion":1,"session":{"events":[{"kind":{"started":{}}},{"kind":{"finished":{"_0":"abandoned"}}}]}}"#
        XCTAssertNil(FocusReader.focus(fromStateJSON: Data(done.utf8)))
        XCTAssertNil(FocusReader.focus(fromStateJSON: Data("garbage".utf8)))
    }
}
