import Foundation
import MobileCore

// The Phase 33 firewall, asserted NUMERICALLY.
//
// A forbidden-word list would catch "- HRV 116ms" and miss "your variability is
// 116" and "you were at 116 this morning". So this pulls every number out of the
// generated prompt and compares it against the day's actual measurements. A
// rephrasing that still leaks the value fails, which is the property that
// matters.
//
// It also asserts a POSITIVE: two different health states must produce different
// prompts. Without that, deleting the health block entirely would pass the
// firewall, and a check that goes green when the feature is removed is not a
// check. That lesson is written into MobileCoreCheck already.

var failures: [String] = []
var checks = 0

func expect(_ condition: Bool, _ message: @autoclosure () -> String) {
    checks += 1
    if !condition { failures.append(message()) }
}

/// Every integer and decimal run in a string.
func numbers(in text: String) -> [Double] {
    let pattern = try! NSRegularExpression(pattern: #"\d+(?:\.\d+)?"#)
    let range = NSRange(text.startIndex..., in: text)
    return pattern.matches(in: text, range: range).compactMap {
        Range($0.range, in: text).flatMap { Double(text[$0]) }
    }
}

struct Reading {
    let recovery: Int
    let sleepPerformance: Int
    let sleepHours: Double
    let hrv: Int
    let restingHeartRate: Int
    let strain: Double
}

// Shapes drawn from the real 41-day range in health-log.json, plus adversarial
// values chosen to collide with counts a prompt legitimately contains.
let readings: [Reading] = [
    Reading(recovery: 82, sleepPerformance: 78, sleepHours: 8.2, hrv: 116, restingHeartRate: 54, strain: 18.7),
    Reading(recovery: 33, sleepPerformance: 54, sleepHours: 5.1, hrv: 41, restingHeartRate: 71, strain: 4.2),
    Reading(recovery: 67, sleepPerformance: 85, sleepHours: 7.0, hrv: 88, restingHeartRate: 60, strain: 11.0),
    Reading(recovery: 9,  sleepPerformance: 30, sleepHours: 3.5, hrv: 22, restingHeartRate: 88, strain: 1.5),
    Reading(recovery: 100, sleepPerformance: 99, sleepHours: 9.9, hrv: 150, restingHeartRate: 44, strain: 20.9),
]

print("== health firewall ==")

for reading in readings {
    let signal = PlanningSignal.derive(
        recovery: reading.recovery,
        sleepPerformance: reading.sleepPerformance,
        sleepHours: reading.sleepHours,
        strain: reading.strain,
        sampleCount: 38,
        readingAgeHours: 3
    )
    let text = signal.promptLines().joined(separator: "\n")
    let leaked = numbers(in: text)

    let forbidden: [(String, Double)] = [
        ("recovery", Double(reading.recovery)),
        ("sleep score", Double(reading.sleepPerformance)),
        ("sleep hours", reading.sleepHours),
        ("HRV", Double(reading.hrv)),
        ("resting heart rate", Double(reading.restingHeartRate)),
        ("strain", reading.strain),
    ]
    for (name, value) in forbidden {
        // +/-1 so a rounded restatement is caught too.
        let hit = leaked.contains { abs($0 - value) <= 1.0 }
        expect(!hit, "\(name) \(value) reached the prompt: \"\(text.replacingOccurrences(of: "\n", with: " | "))\"")
    }
}

// The positive assertion. Deleting the health block would make every prompt
// identical and empty, which must fail.
let good = PlanningSignal.derive(recovery: 85, sleepPerformance: 90, sleepHours: 8.5,
                                 strain: 5, sampleCount: 38, readingAgeHours: 2)
let poor = PlanningSignal.derive(recovery: 20, sleepPerformance: 40, sleepHours: 4.0,
                                 strain: 18, sampleCount: 38, readingAgeHours: 2)
expect(!good.promptLines().isEmpty, "a good reading still says something")
expect(good.promptLines() != poor.promptLines(),
       "a good day and a bad day must not read identically -- otherwise deleting the health block passes this test")

// Confidence and freshness must survive, because they are the capability a raw
// integer never had.
let stale = PlanningSignal.derive(recovery: 82, sleepPerformance: 78, sleepHours: 8.2,
                                  strain: 9, sampleCount: 3, readingAgeHours: 96)
expect(stale.confidence == .low, "three samples is not a baseline")
expect(stale.freshness == .veryStale, "a four-day-old reading is not current")
expect(stale.promptLines().contains { $0.contains("low") && $0.contains("several days old") },
       "the prompt must be able to say the reading is weak and old")

// cognitive_capacity is the manifest's word, and the projection must be total.
expect(good.cognitiveCapacityWord == "elevated", "good recovery reads as elevated capacity")
expect(poor.cognitiveCapacityWord == "reduced", "poor recovery reads as reduced capacity")
expect(PlanningSignal().cognitiveCapacityWord == "unknown", "absent data stays unknown")

print("\(checks) checks, \(failures.count) failed")
for failure in failures { print("  FAIL \(failure)") }
exit(failures.isEmpty ? 0 : 1)
