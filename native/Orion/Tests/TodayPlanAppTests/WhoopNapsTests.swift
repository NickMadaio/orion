import XCTest
import Foundation
@testable import Orion

final class WhoopNapsTests: XCTestCase {
    private func sleep(start: String, end: String, nap: Bool, light: Double = 0, slow: Double = 0, rem: Double = 0,
                       performance: Double? = nil) -> [String: Any] {
        var score: [String: Any] = ["stage_summary": ["total_light_sleep_time_milli": light,
                                                      "total_slow_wave_sleep_time_milli": slow,
                                                      "total_rem_sleep_time_milli": rem]]
        if let performance { score["sleep_performance_percentage"] = performance }
        return ["id": UUID().uuidString, "start": start, "end": end, "nap": nap, "score_state": "SCORED", "score": score]
    }

    func testNapsAreKeptWithAsleepMinutesAndTheNightIsNot() {
        let night = sleep(start: "2026-11-03T23:00:00Z", end: "2026-11-04T07:00:00Z", nap: false, light: 1e7)
        let nap = sleep(start: "2026-11-04T15:00:00Z", end: "2026-11-04T16:10:00Z", nap: true,
                        light: 2_400_000, slow: 1_000_000, rem: 600_000, performance: 61)
        let naps = WhoopExtras.naps(from: [night, nap, nap])
        XCTAssertEqual(naps.count, 1, "the night is not a nap, and the same nap fetched twice is one nap")
        XCTAssertEqual(naps[0].minutes, 67, "asleep time, not time in bed")
        XCTAssertEqual(naps[0].performance, 61)
        XCTAssertEqual(WhoopExtras.totalMinutes(naps), 67)
    }

    func testUnscoredNapFallsBackToItsLengthAndADozeIsDropped() {
        let unscored: [String: Any] = ["start": "2026-11-04T13:00:00Z", "end": "2026-11-04T13:40:00Z", "nap": true]
        XCTAssertEqual(WhoopExtras.naps(from: [unscored]).first?.minutes, 40)
        let doze = sleep(start: "2026-11-04T13:00:00Z", end: "2026-11-04T13:03:00Z", nap: true, light: 100_000)
        XCTAssertTrue(WhoopExtras.naps(from: [doze]).isEmpty)
    }

    func testWorkoutsKeepStrainSportAndSkipTheTooShort() {
        let gym: [String: Any] = ["id": "w1", "start": "2026-11-04T18:00:00Z", "end": "2026-11-04T19:05:00Z",
                                  "sport_name": "weightlifting", "score_state": "SCORED",
                                  "score": ["strain": 11.24, "average_heart_rate": 118.0]]
        let blip: [String: Any] = ["id": "w2", "start": "2026-11-04T20:00:00Z", "end": "2026-11-04T20:04:00Z"]
        let found = WhoopExtras.workouts(from: [gym, blip, gym])
        XCTAssertEqual(found.count, 1)
        XCTAssertEqual(found[0].minutes, 65)
        XCTAssertEqual(found[0].strain, 11.2)
        XCTAssertEqual(found[0].sport, "weightlifting")
        XCTAssertEqual(found[0].averageHeartRate, 118)
    }

    func testNapsLandOnTheirDayAndReachTheHealthRecord() {
        let nap = WhoopNap(start: "2026-11-04T15:00:00Z", end: "2026-11-04T16:10:00Z", minutes: 70, performance: nil)
        let week = WhoopClient.buildWeek(recoveries: [], sleeps: [], cycles: [], naps: [nap], workouts: [])
        let readings = week.readingsByDay
        XCTAssertEqual(readings.count, 1)
        var record = HealthDayRecord()
        record.sleepHours = 6.6
        readings.values.first!.apply(to: &record)
        XCTAssertEqual(record.napMinutes, 70)
        XCTAssertEqual(record.naps?.count, 1)
        XCTAssertEqual(record.sleepHours, 6.6, "the night is untouched")
    }

    func testNapLineSaysLengthAndClockTime() {
        let nap = WhoopNap(start: "2026-11-04T15:00:00Z", end: "2026-11-04T16:10:00Z", minutes: 70, performance: nil)
        let zone = TimeZone(identifier: "UTC")!
        XCTAssertEqual(WhoopExtras.napLine([nap], timeZone: zone), "napped 1h10 at 15:00")
        let short = WhoopNap(start: "2026-11-04T13:30:00Z", end: "2026-11-04T13:55:00Z", minutes: 25, performance: nil)
        XCTAssertEqual(WhoopExtras.napLine([short], timeZone: zone), "napped 25 min at 13:30")
        XCTAssertNil(WhoopExtras.napLine([]))
    }

    func testNapFieldsSurviveTheJSONRoundTripTheNodeSideReads() throws {
        var record = HealthDayRecord()
        record.naps = [WhoopNap(start: "a", end: "b", minutes: 25, performance: 50)]
        record.napMinutes = 25
        record.whoopWorkouts = [WhoopWorkoutRecord(id: "w", start: "a", end: "b", minutes: 30, strain: 8, sport: nil, averageHeartRate: nil)]
        let data = try JSONEncoder().encode(record)
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        XCTAssertEqual(object["napMinutes"] as? Int, 25)
        XCTAssertNotNil(object["whoopWorkouts"])
        XCTAssertEqual(try JSONDecoder().decode(HealthDayRecord.self, from: data), record)
        let old = try JSONDecoder().decode(HealthDayRecord.self, from: Data("{\"waterBottles\":1,\"calories\":0,\"supplementIDs\":[],\"updatedAt\":\"\"}".utf8))
        XCTAssertNil(old.naps, "records written before naps still decode")
    }
}
