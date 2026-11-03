import XCTest
@testable import Orion

/// Wave 17 (Health): the serif "today" line is a read of the day, never a coverage sentence; hover and click state.
@MainActor
final class Wave17HealthLineTests: XCTestCase {
    func testNickFixtureReadsAsALighterDay() {
        XCTAssertEqual(HealthTodayLine.line(recovery: 57, sleepHours: 4.3),
                       "Recovery 57 and 4.3 hours of sleep: a lighter day is smart.")
    }

    func testBandsAndFixtures() {
        XCTAssertEqual(HealthTodayLine.line(recovery: 85, sleepHours: 8.1),
                       "Recovery 85 and 8.1 hours of sleep: a good day to push.")
        XCTAssertEqual(HealthTodayLine.line(recovery: 85, sleepHours: 4.0),
                       "Recovery 85 and 4.0 hours of sleep: you can push, but ease off if you fade.")
        XCTAssertEqual(HealthTodayLine.line(recovery: 20, sleepHours: 8.0),
                       "Recovery 20 and 8.0 hours of sleep: a lighter day is smart.")
        XCTAssertEqual(HealthTodayLine.line(recovery: 50, sleepHours: 7.5),
                       "Recovery 50 and 7.5 hours of sleep: steady is the right pace today.")
        XCTAssertEqual(HealthTodayLine.line(recovery: 90, sleepHours: nil), "Recovery 90: a good day to push.")
        XCTAssertEqual(HealthTodayLine.line(recovery: nil, sleepHours: 5.0),
                       "5.0 hours of sleep: go easy on yourself today.")
    }

    func testEmptyWhenThereIsNothingToSay() {
        XCTAssertNil(HealthTodayLine.line(recovery: nil, sleepHours: nil))
        XCTAssertNil(HealthTodayLine.line(recovery: nil, sleepHours: .nan))
        XCTAssertNil(HealthTodayLine.line(recovery: nil, sleepHours: 0))
    }

    func testNeverCoverageOrProvenanceText() {
        let banned = ["available", "cover", "whoop", "readings", "source", "confidence", "history"]
        for recovery in [nil, 10, 40, 80] as [Int?] {
            for sleep in [nil, 3.0, 7.0] as [Double?] {
                guard let line = HealthTodayLine.line(recovery: recovery, sleepHours: sleep)?.lowercased() else { continue }
                for word in banned { XCTAssertFalse(line.contains(word), "\(line) mentions \(word)") }
            }
        }
    }

    func testClickPinsAndUnpinsAndBeatsHover() {
        let controller = HealthHoverController(grace: .milliseconds(10))
        controller.enter(.recovery)
        XCTAssertEqual(controller.current, .recovery)
        controller.toggle(.sleep)
        XCTAssertEqual(controller.current, .sleep, "a pinned part wins over the hovered one")
        controller.toggle(.activity)
        XCTAssertEqual(controller.current, .activity, "clicking another ring moves the pin")
        controller.toggle(.activity)
        XCTAssertEqual(controller.current, .recovery, "unpinning falls back to the hover")
    }

    func testRendersHealthPageWithTheNewLine() throws {
        try TabRender.write("w17f-health-today-line", TabRender.page(.health) {
            HealthTab(state: AppState(), whoop: TabRender.whoop(), health: HealthLog(), connections: ConnectionsModel(),
                      day: LogicalDay(start: Calendar.current.startOfDay(for: Date()).addingTimeInterval(7 * 3600), fromWakeTime: true),
                      writer: NarrativeWriter())
        })
    }
}
