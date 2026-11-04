import XCTest
@testable import MobileCore

final class HealthReadoutTests: XCTestCase {
    private func day(recovery: Int? = nil, hrv: Int? = nil, rhr: Int? = nil, sleep: Double? = nil, perf: Int? = nil, strain: Double? = nil)
        -> LinkSnapshot.HealthDay {
        .init(date: "2026-11-03", recovery: recovery, hrv: hrv, restingHeartRate: rhr, sleepHours: sleep, sleepPerformance: perf, strain: strain)
    }

    func testVerdictBands() {
        XCTAssertEqual(HealthReadout.verdict(recovery: 80), "Ready to push")
        XCTAssertEqual(HealthReadout.verdict(recovery: 50), "Steady, not a peak day")
        XCTAssertEqual(HealthReadout.verdict(recovery: 20), "Take it easy")
        XCTAssertEqual(HealthReadout.verdict(recovery: nil), "Not recorded yet")
    }

    func testFractionsAreClampedAndMissingStaysNil() {
        XCTAssertEqual(HealthReadout.sleepFraction(day(perf: 92)), 0.92)
        XCTAssertEqual(HealthReadout.sleepFraction(day(perf: 130)), 1)
        XCTAssertNil(HealthReadout.sleepFraction(day()))
        XCTAssertEqual(HealthReadout.strainFraction(day(strain: 10.5)) ?? 0, 0.5, accuracy: 0.001)
        XCTAssertEqual(HealthReadout.strainFraction(day(strain: 25)), 1)
        XCTAssertNil(HealthReadout.strainFraction(day()))
    }

    func testPlainLinesReadLikeSentencesAndSkipWhatIsMissing() {
        let lines = HealthReadout.lines(day(recovery: 84, hrv: 64, rhr: 52, sleep: 7.5, perf: 92, strain: 12.3))
        XCTAssertEqual(lines, ["You slept 7.5 hours, 92% of what you need.", "Heart rate variability 64 ms, resting heart rate 52 bpm.", "Strain so far 12.3 of 21."])
        XCTAssertEqual(HealthReadout.lines(day(sleep: 6)), ["You slept 6.0 hours."])
        XCTAssertEqual(HealthReadout.lines(day()), [])
    }

    func testNoSourceOrCoverageWording() {
        let all = HealthReadout.lines(day(recovery: 1, hrv: 1, rhr: 1, sleep: 1, perf: 1, strain: 1)) + [HealthReadout.empty]
        for line in all {
            XCTAssertFalse(line.localizedCaseInsensitiveContains("whoop"))
            XCTAssertFalse(line.localizedCaseInsensitiveContains("coverage"))
        }
    }
}
