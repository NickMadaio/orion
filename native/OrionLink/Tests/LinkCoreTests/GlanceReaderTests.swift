import XCTest
import MobileCore
@testable import LinkCore

final class GlanceReaderTests: XCTestCase {
    private var home: URL!
    private var controlled: URL { home.appendingPathComponent(".openclaw/orion-controlled") }
    private let now = Date(timeIntervalSince1970: 1_790_690_000)
    private var minute: Int { Int(now.timeIntervalSince1970 / 60) }

    override func setUpWithError() throws {
        home = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: controlled, withIntermediateDirectories: true)
    }
    override func tearDownWithError() throws { try? FileManager.default.removeItem(at: home) }

    private func writeCheckins(_ items: [[String: Any]]) throws {
        try JSONSerialization.data(withJSONObject: ["checkins": items]).write(to: controlled.appendingPathComponent("checkins.json"))
    }
    private func item(_ id: String, _ phase: String, level: Int = 0, dueIn: Int) -> [String: Any] {
        ["id": id, "what": "task \(id)", "dueAt": minute + dueIn, "loop": ["phase": phase, "level": level, "nextCheckAt": minute + dueIn]]
    }

    func testTheCheckinBeingChasedWinsOverOneInProgress() throws {
        try writeCheckins([item("a", "active", dueIn: -30), item("b", "reminded", level: 2, dueIn: -5),
                           item("c", "done", dueIn: -60), item("d", "waiting", dueIn: 30)])
        let checkin = try XCTUnwrap(SnapshotReader(home: home).checkin(now: now))
        XCTAssertEqual(checkin.id, "b")
        XCTAssertEqual(checkin.level, 2)
        XCTAssertTrue(checkin.chasing)
        XCTAssertEqual(checkin.due?.timeIntervalSince1970 ?? 0, Double(minute - 5) * 60, accuracy: 0.5)
    }

    func testAFarOffWaitingCheckinIsNotShownAndFinishedOnesNever() throws {
        try writeCheckins([item("c", "done", dueIn: -60), item("d", "waiting", dueIn: 600)])
        XCTAssertNil(SnapshotReader(home: home).checkin(now: now))
        try writeCheckins([item("d", "waiting", dueIn: 45)])
        XCTAssertEqual(SnapshotReader(home: home).checkin(now: now)?.id, "d")
    }

    func testTheGlanceJoinsTheCalendarExportWithTheSnapshot() throws {
        let block = OrionGlance.Block(id: "e", title: "ECON1115", start: now.addingTimeInterval(1800), end: now.addingTimeInterval(7200), kind: "class", fixed: true)
        let calendar = OrionGlance(generatedAt: now.addingTimeInterval(-60), source: "mac-calendar", blocks: [block],
                                   todos: [.init(id: "t", title: "Problem set", priority: 1)],
                                   deadlines: [.init(id: "q", title: "Macro quiz", at: now.addingTimeInterval(86_400 * 3))])
        try GlanceFile.write(calendar, to: controlled.appendingPathComponent("glance-calendar.json"))
        let snapshot = LinkSnapshot(generatedAt: now, mac: .init(name: "Mac"),
                                    runs: [.init(id: "p", project: "ORION", status: .working, live: true, accepted: 3, total: 10, percent: 30)],
                                    approvals: [.init(id: "A", action: "x", summary: "", context: "", expiresAt: now.addingTimeInterval(60))],
                                    checkin: .init(id: "c", what: "study", phase: "active", level: 0))
        let glance = SnapshotReader(home: home).glance(from: snapshot, now: now)
        XCTAssertEqual(glance.source, "mac")
        XCTAssertEqual(glance.blocks.map(\.title), ["ECON1115"])
        XCTAssertEqual(glance.todos.first?.title, "Problem set")
        XCTAssertEqual(glance.deadlines.first?.title, "Macro quiz")
        XCTAssertEqual(glance.projects.first?.percent, 30)
        XCTAssertEqual(glance.approvals, 1)
        XCTAssertEqual(glance.checkin?.what, "study")
    }

    func testAStaleCalendarExportIsIgnored() throws {
        let old = OrionGlance(generatedAt: now.addingTimeInterval(-8 * 3600), source: "mac-calendar", todos: [.init(id: "t", title: "old")])
        try GlanceFile.write(old, to: controlled.appendingPathComponent("glance-calendar.json"))
        XCTAssertNil(SnapshotReader(home: home).glanceCalendar(now: now))
    }

    func testWidgetRequestsAreTakenOnceAndUnknownOrOldOnesDropped() throws {
        let file = home.appendingPathComponent("widget-requests.jsonl")
        let lines = [WidgetRequests.line(action: .water, id: "w1", at: now),
                     WidgetRequests.line(action: .checkinDone, id: "c1", at: now.addingTimeInterval(-30)),
                     WidgetRequests.line(action: .water, id: "old", at: now.addingTimeInterval(-3600)),
                     #"{"id":"x","action":"delete everything","at":"2026-09-29T12:00:00Z"}"#, "not json"]
        try lines.joined(separator: "\n").write(to: file, atomically: true, encoding: .utf8)
        let requests = WidgetRequests(file: file)
        XCTAssertEqual(requests.take(now: now).map(\.id), ["w1", "c1"])
        XCTAssertEqual(requests.take(now: now), [], "taken once")
        XCTAssertEqual(WidgetRequests.Action.checkinDone.entry, .checkin(action: "done"))
    }
}
