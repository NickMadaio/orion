import XCTest
@testable import MobileCore

/// "Add water" from the lock screen, a widget, Control Center or Siri: one tap
/// becomes one event with an id, kept in the app group until the Mac has it.
final class WaterOutboxTests: XCTestCase {
    private var dir: URL!
    private let now = Date(timeIntervalSince1970: 1_793_620_800)

    override func setUpWithError() throws {
        dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    }
    override func tearDownWithError() throws { try? FileManager.default.removeItem(at: dir) }

    func testAddingReturnsANewOutboxAndLeavesTheOldOneAlone() {
        let empty = WaterOutbox()
        let (next, event) = empty.adding(id: "w-1", at: now)
        XCTAssertTrue(empty.pending.isEmpty)
        XCTAssertEqual(next.pending, [event])
        XCTAssertEqual(event, WaterEvent(id: "w-1", at: now, delta: 1))
    }

    func testDeliveringRemovesOnlyThoseIdsAndIsSafeToRepeat() {
        let outbox = WaterOutbox().adding(id: "a", at: now).0.adding(id: "b", at: now).0
        let once = outbox.delivering(["a"])
        XCTAssertEqual(once.pending.map(\.id), ["b"])
        XCTAssertEqual(once.delivering(["a"]), once)
    }

    func testTheSameIdIsNeverQueuedTwice() {
        let outbox = WaterOutbox().adding(id: "a", at: now).0
        XCTAssertEqual(outbox.adding(id: "a", at: now).0.pending.count, 1)
    }

    func testTheOutboxIsBoundedAndKeepsTheNewest() {
        var outbox = WaterOutbox()
        for index in 0..<(WaterOutbox.limit + 5) { outbox = outbox.adding(id: "e\(index)", at: now).0 }
        XCTAssertEqual(outbox.pending.count, WaterOutbox.limit)
        XCTAssertEqual(outbox.pending.last?.id, "e\(WaterOutbox.limit + 4)")
    }

    func testEachEventIsTheSameLogEntryTheAppsButtonsSend() throws {
        let event = WaterEvent(id: "a", at: now, delta: 1)
        XCTAssertEqual(try LinkLog.decode(event.commandText()), .water(delta: 1))
    }

    func testFileRoundTripAndAnUnreadableFileIsEmptyNotACrash() throws {
        let url = dir.appendingPathComponent(WaterOutbox.fileName)
        XCTAssertEqual(WaterOutbox.read(url), WaterOutbox())
        let outbox = WaterOutbox().adding(id: "a", at: now).0
        try outbox.write(to: url)
        XCTAssertEqual(WaterOutbox.read(url), outbox)
        try Data("not json".utf8).write(to: url)
        XCTAssertEqual(WaterOutbox.read(url), WaterOutbox())
    }

    // MARK: - The intent's store step

    func testATapQueuesTheEventAndBumpsTheGlanceAtOnce() throws {
        let glanceURL = dir.appendingPathComponent(GlanceFile.fileName)
        let glance = OrionGlance(generatedAt: now, source: "iphone",
                                 tracking: .init(water: 3, waterGoal: 9, calories: 0, calorieGoal: 2200, protein: 0, proteinGoal: 150))
        try GlanceFile.write(glance, to: glanceURL)

        let event = try WaterTap.record(in: dir, id: "tap-1", at: now)

        XCTAssertEqual(event.id, "tap-1")
        XCTAssertEqual(WaterOutbox.read(dir.appendingPathComponent(WaterOutbox.fileName)).pending.map(\.id), ["tap-1"])
        XCTAssertEqual(GlanceFile.read(glanceURL)?.tracking?.water, 4)
    }

    func testATapWithNoGlanceYetStillQueues() throws {
        _ = try WaterTap.record(in: dir, id: "tap-1", at: now)
        XCTAssertNil(GlanceFile.read(dir.appendingPathComponent(GlanceFile.fileName)))
        XCTAssertEqual(WaterOutbox.read(dir.appendingPathComponent(WaterOutbox.fileName)).pending.count, 1)
    }

    func testDeliveredEventsLeaveTheFile() throws {
        _ = try WaterTap.record(in: dir, id: "a", at: now)
        _ = try WaterTap.record(in: dir, id: "b", at: now)
        try WaterTap.delivered(["a"], in: dir)
        XCTAssertEqual(WaterTap.pending(in: dir).map(\.id), ["b"])
    }

    func testTodaysCountComesFromTheGlance() throws {
        XCTAssertNil(WaterTap.today(in: dir))
        let glance = OrionGlance(generatedAt: now, source: "iphone",
                                 tracking: .init(water: 5, waterGoal: 9, calories: 0, calorieGoal: 2200, protein: 0, proteinGoal: 150))
        try GlanceFile.write(glance, to: dir.appendingPathComponent(GlanceFile.fileName))
        XCTAssertEqual(WaterTap.today(in: dir)?.water, 5)
        XCTAssertEqual(WaterTap.today(in: dir)?.goal, 9)
    }
}
