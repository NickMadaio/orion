import XCTest
@testable import MobileCore

/// The widgets' rules: what is on now, how ORION looks, and what he says.
final class GlanceTests: XCTestCase {
    private let calendar: Calendar = {
        var c = Calendar(identifier: .gregorian); c.timeZone = TimeZone(identifier: "Europe/London")!; return c
    }()
    private func at(_ hour: Int, _ minute: Int = 0, day: Int = 29) -> Date {
        calendar.date(from: DateComponents(year: 2026, month: 9, day: day, hour: hour, minute: minute))!
    }
    private func block(_ id: String, _ title: String, _ from: (Int, Int), _ to: (Int, Int), kind: String = "class", fixed: Bool = true) -> OrionGlance.Block {
        .init(id: id, title: title, start: at(from.0, from.1), end: at(to.0, to.1), kind: kind, fixed: fixed)
    }
    private var day: OrionGlance {
        OrionGlance(generatedAt: at(12), source: "iphone",
                    blocks: [block("m", "MKTG2201", (15, 30), (17, 0)), block("e", "ECON1115", (13, 30), (15, 0)),
                             block("s", "Side project", (17, 0), (18, 0), kind: "orion", fixed: false)],
                    todos: [.init(id: "a", title: "Laundry"), .init(id: "b", title: "Macro problem set", priority: 1),
                            .init(id: "c", title: "Done thing", priority: 1, done: true)],
                    night: .init(bed: at(23, 30), alarm: at(8, 30, day: 30)))
    }

    func testBlocksAreSortedAndNowAndNextFollowTheClock() {
        let glance = day
        XCTAssertEqual(glance.blocks.map(\.id), ["e", "m", "s"])
        XCTAssertNil(glance.current(at: at(13)))
        XCTAssertEqual(glance.upcoming(after: at(13)).first?.title, "ECON1115")
        XCTAssertEqual(glance.current(at: at(14))?.title, "ECON1115")
        XCTAssertEqual(glance.remaining(at: at(15, 45)).map(\.id), ["m", "s"])
        XCTAssertEqual(glance.progress(of: glance.blocks[0], at: at(14, 15)), 0.5, accuracy: 0.001)
    }

    func testAFixedThingWinsOverOrionsFillWhenTheyOverlap() {
        var glance = day
        glance.blocks.append(block("x", "Study", (14, 0), (15, 0), kind: "study", fixed: false))
        XCTAssertEqual(glance.current(at: at(14, 30))?.id, "e")
    }

    func testTheLineIsSpecificAndComesFromTheData() {
        let glance = day
        XCTAssertEqual(glance.line(at: at(13, 5), calendar: calendar), "ECON1115 in 25 min.")
        XCTAssertEqual(glance.line(at: at(14, 30), calendar: calendar), "ECON1115 · 30 min left, then MKTG2201.")
        XCTAssertEqual(glance.line(at: at(10), calendar: calendar), "Next: ECON1115 at 13:30.")
        XCTAssertEqual(glance.line(at: at(23, 50), calendar: calendar), "Sleep. 8h 40m left before your alarm.")
    }

    func testAnEmptyAfternoonAsks() {
        let glance = OrionGlance(generatedAt: at(12), source: "mac", blocks: [block("e", "ECON1115", (13, 30), (15, 0))])
        XCTAssertEqual(glance.line(at: at(15, 30), calendar: calendar), "The rest of today is open. What's the plan?")
        XCTAssertEqual(glance.mood(at: at(15, 30)), .asking)
        XCTAssertEqual(glance.mood(at: at(14)), .focus)
        XCTAssertFalse(glance.emptyEvening(at: at(22), calendar: calendar), "late evening is not a gap to fill")
    }

    func testMoodEscalatesWithAnIgnoredCheckin() {
        var glance = day
        glance.checkin = .init(id: "c1", what: "macro study", phase: "reminded", level: 1)
        XCTAssertEqual(glance.mood(at: at(10)), .asking)
        XCTAssertEqual(glance.line(at: at(10), calendar: calendar), "Time for macro study.")
        glance.checkin?.level = 2; glance.checkin?.phase = "intervening"
        XCTAssertEqual(glance.mood(at: at(10)), .alert)
        XCTAssertEqual(glance.line(at: at(10), calendar: calendar), "Still waiting on macro study. Start now.")
        glance.checkin?.phase = "active"; glance.checkin?.level = 0
        XCTAssertEqual(glance.mood(at: at(10)), .focus, "working on it is focus, not alarm")
        XCTAssertEqual(day.mood(at: at(23, 45)), .night)
    }

    func testTodosPutPriorityFirstAndHideDone() {
        XCTAssertEqual(day.openTodos().map(\.id), ["b", "a"])
    }

    func testThePlanMergesWithoutDuplicatingTheCalendar() throws {
        let plan = try TodayPlanScheduler.propose(
            now: at(9), timeZone: "Europe/London", preferences: TodayPlanPreferences(),
            tasks: [TodayPlanTask(id: "t1", title: "Essay", minutes: 60, priority: 1)],
            commitments: [TodayPlanCommitment(id: "c", title: "ECON1115", start: at(13, 30), end: at(15))],
            reason: "test", sourceFingerprint: "f")
        let merged = OrionGlance.merge(events: [block("e", "ECON1115", (13, 30), (15, 0))], plan: plan)
        XCTAssertEqual(merged.filter { $0.title == "ECON1115" }.count, 1)
        XCTAssertEqual(merged.first { $0.title == "Essay" }?.kind, "orion")
    }

    func testKindsFromTitles() {
        XCTAssertEqual(OrionGlance.kind(of: "ECON1115 Lecture"), "class")
        XCTAssertEqual(OrionGlance.kind(of: "Ministry of Sound"), "social")
        XCTAssertEqual(OrionGlance.kind(of: "meal prep with Sam"), "social")
        XCTAssertEqual(OrionGlance.kind(of: "Macro study", orionKind: "study"), "study")
        XCTAssertEqual(OrionGlance.kind(of: "Dentist"), "event")
    }

    func testDeadlinesAreAssessmentsNotClasses() {
        XCTAssertTrue(OrionGlance.isDeadline("Macro quiz"))
        XCTAssertTrue(OrionGlance.isDeadline("Marketing presentation"))
        XCTAssertTrue(OrionGlance.isDeadline("Essay due"))
        XCTAssertFalse(OrionGlance.isDeadline("ECON1115 Lecture"))
        XCTAssertFalse(OrionGlance.isDeadline("Ministry of Sound"))
        XCTAssertFalse(OrionGlance.isDeadline("Contest night"), "a word boundary, not a substring")
    }

    func testTimelineRedrawsAtEdgesAndEveryQuarterHour() {
        let moments = day.timelineMoments(from: at(13), hours: 3)
        XCTAssertTrue(moments.contains(at(13, 30)))
        XCTAssertTrue(moments.contains(at(15)))
        XCTAssertTrue(moments.contains(at(13, 15)))
        XCTAssertEqual(moments.first, at(13))
        XCTAssertEqual(moments, moments.sorted())
    }

    func testTheFileRoundTripsAndReportsOnlyRealChanges() throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString).appendingPathComponent("glance.json")
        defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
        XCTAssertTrue(try GlanceFile.write(day, to: url))
        XCTAssertEqual(GlanceFile.read(url), day)
        var later = day; later.generatedAt = at(12, 30)
        XCTAssertFalse(try GlanceFile.write(later, to: url), "only the clock moved")
        later.approvals = 1
        XCTAssertTrue(try GlanceFile.write(later, to: url))
    }

    func testOlderSnapshotsWithoutTheNewFieldsStillDecode() throws {
        let snapshot = LinkSnapshot(generatedAt: at(12), mac: .init(name: "Mac"))
        var object = try XCTUnwrap(JSONSerialization.jsonObject(with: try LinkSnapshot.encode(snapshot)) as? [String: Any])
        object["checkin"] = nil; object["deadlines"] = nil; object["lastInputAt"] = nil
        XCTAssertNoThrow(try LinkSnapshot.decode(try JSONSerialization.data(withJSONObject: object)))
    }
}
