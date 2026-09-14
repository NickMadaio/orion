import XCTest
import Foundation
@testable import Orion

final class HealthSummaryTests: XCTestCase {
    let now = ISO8601DateFormatter().date(from: "2026-09-14T01:00:00Z")!

    func facts(_ snapshot: WhoopSnapshot? = nil) -> HealthFacts {
        HealthFacts(dayKey: "2026-09-13", phase: "evening",
            healthDetails: snapshot?.healthSummaryDetails(clock: BriefClock(now: now, timeZone: TimeZone(secondsFromGMT: 0)!)) ?? [],
            bottles: 0, takenSupplementIDs: [], listedSupplementIDs: ["a", "b"],
            workoutLogged: false, workoutSets: 0, calories: 0)
    }

    func snapshot() -> WhoopSnapshot {
        WhoopSnapshot(recovery: 83, restingHeartRate: 59, hrvMilliseconds: 141,
            sleepPerformance: 87, sleepHours: 8.4, strain: 17.9,
            recordedOn: now, recoverySleepEndedAt: now.addingTimeInterval(-86400),
            sleepRecordedOn: now.addingTimeInterval(-3600),
            strainRecordedOn: now.addingTimeInterval(-172800), capturedAt: now)
    }

    func text(_ value: HealthFacts, _ response: String? = nil) -> String {
        value.takeaways(selection: response).map { $0.label + " " + $0.text }.joined(separator: "\n")
    }

    func testMissingLogsRemainUnknownWithoutRequestOrAdvice() {
        let value = facts(), rendered = text(value)
        XCTAssertNil(value.prompt())
        XCTAssertEqual(value.takeaways(selection: nil).count, 4)
        XCTAssertTrue(rendered.contains("how much you drank is unknown"))
        XCTAssertTrue(rendered.contains("whether you trained is unknown"))
        XCTAssertTrue(rendered.contains("what you ate is unknown"))
        XCTAssertFalse(rendered.contains("Rehydrate"))
        XCTAssertFalse(rendered.contains("below usual"))
    }

    func testActualSourceAdapterExcludesRawHealthFromModelPrompt() {
        let value = facts(snapshot()), prompt = value.prompt()!
        for raw in ["83", "59", "141", "87", "8.4", "17.9"] {
            XCTAssertFalse(prompt.contains(raw), "Raw measurement leaked: \(raw)")
        }
        XCTAssertTrue(prompt.contains("13 Sep 2026"))
        XCTAssertTrue(prompt.contains("12 Sep 2026"))
        XCTAssertFalse(prompt.contains("below usual"))
        XCTAssertFalse(prompt.contains("capacity"))
        XCTAssertFalse(prompt.contains("No training"))
        // Both high and low raw scores produce the same source-availability facts.
        var low = snapshot(); low.recovery = 12; low.sleepPerformance = 23
        XCTAssertEqual(prompt, facts(low).prompt())
    }

    func testManualLogsChangeFactsAndRespectActivityDay() {
        var value = facts()
        value.bottles = 3; value.calories = 1600; value.workoutLogged = true
        value.workoutSets = 5; value.takenSupplementIDs = ["a"]
        let prompt = value.prompt()!
        XCTAssertTrue(prompt.contains("activity day 2026-09-13"))
        XCTAssertTrue(prompt.contains("3 bottles"))
        XCTAssertTrue(prompt.contains("1600 calories"))
        XCTAssertTrue(prompt.contains("5 sets"))
        XCTAssertTrue(prompt.contains("1 of 2"))
        XCTAssertFalse(prompt.contains("Trained today"))
        XCTAssertNotEqual(value.narrativeKey, facts().narrativeKey)
    }

    func testWorkoutEntryWithoutSetsDoesNotBecomeNoWorkout() {
        var value = facts(); value.workoutLogged = true
        XCTAssertTrue(text(value).contains("A workout entry is present"))
        XCTAssertFalse(text(value).contains("No workout is logged"))
        XCTAssertNotNil(value.prompt())
    }

    func testSupplementOnlyDayCanBeHighlighted() {
        var value = facts(); value.takenSupplementIDs = ["a"]
        XCTAssertNotNil(value.prompt())
        XCTAssertTrue(text(value, "{\"highlight\":\"supplements\"}").hasPrefix("SUPPLEMENT LOG"))
    }

    func testRemovedSupplementCannotCountTowardRemainingCatalog() {
        var value = facts()
        value.takenSupplementIDs = ["removed", "b"]
        value.listedSupplementIDs = ["b"]
        XCTAssertEqual(value.supplementsTaken, 1)
        XCTAssertTrue(value.details.first { $0.id == "supplements" }!.text.contains("1 of 1"))
        value.takenSupplementIDs = ["removed"]
        XCTAssertEqual(value.supplementsTaken, 0)
        XCTAssertNil(value.prompt())
        XCTAssertTrue(value.details.first { $0.id == "supplements" }!.text.contains("0 of 1"))
        XCTAssertEqual(value.takenSupplementIDs, ["removed"], "Historical entry is preserved")
    }

    func testDatesArePerComponentAndFetchCannotFreshenThem() {
        var old = snapshot()
        let original = facts(old)
        old.capturedAt = now.addingTimeInterval(300)
        old.recordedOn = now.addingTimeInterval(300)
        XCTAssertEqual(original.narrativeKey, facts(old).narrativeKey)
        XCTAssertEqual(original.healthDetails, facts(old).healthDetails)
        old.sleepRecordedOn = now.addingTimeInterval(3600)
        XCTAssertTrue(facts(old).healthDetails.first { $0.id == "sleep" }!.text.contains("unknown"))
        XCTAssertNotEqual(original.narrativeKey, facts(old).narrativeKey)
        old.recoverySleepEndedAt = nil
        XCTAssertTrue(facts(old).healthDetails.first { $0.id == "recovery" }!.text.contains("unknown"))
    }

    func testPartialSourceDoesNotInventMissingReadings() {
        let partial = WhoopSnapshot(sleepPerformance: 87, capturedAt: now)
        let value = facts(partial)
        XCTAssertEqual(value.healthDetails.map(\.id), ["sleep"])
        XCTAssertTrue(value.healthDetails[0].text.contains("unknown"))
        XCTAssertNil(value.selectedDetail("{\"highlight\":\"strain\"}"))
        XCTAssertFalse(text(value).contains("No training"))
    }

    func testHeartOnlySnapshotIsAvailableWithoutSendingMeasurements() {
        let partial = WhoopSnapshot(restingHeartRate: 59, hrvMilliseconds: 141, capturedAt: now)
        let value = facts(partial)
        XCTAssertEqual(value.healthDetails.map(\.id), ["heart"])
        XCTAssertFalse(text(value).contains("WHOOP readings are unavailable"))
        XCTAssertTrue(text(value).contains("source time is unknown"))
        XCTAssertNotNil(value.prompt())
        XCTAssertFalse(value.prompt()!.contains("59"))
        XCTAssertFalse(value.prompt()!.contains("141"))
    }

    func testHostileMalformedOrOldProseAlwaysUsesFactualFallback() {
        let value = facts(snapshot()), fallback = text(value)
        for response in ["Rehydrate immediately.", "SLEEP — Your sleep is below usual.",
                         "{\"highlight\":\"hydration\",\"text\":\"Invented advice\"}",
                         "{\"highlight\":\"unknown\"}", "{\"highlight\":\"none\"}",
                         "{\"highlight\":42}", "{\"highlight\":null}", "[]",
                         "```json\n{\"highlight\":\"hydration\"}\n```",
                         "{\"highlight\":\"hydration\"} trailing",
                         String(repeating: " ", count: 257) + "{\"highlight\":\"hydration\"}"] {
            XCTAssertEqual(text(value, response), fallback, response)
        }
    }

    func testValidChoiceChangesEmphasisNotWording() {
        let value = facts(snapshot())
        let selected = value.selectedDetail("{\"highlight\":\"training\"}")!
        let rendered = value.takeaways(selection: "{\"highlight\":\"training\"}")
        XCTAssertEqual(rendered.count, 4)
        XCTAssertEqual(rendered[0].text, selected.text)
        XCTAssertEqual(Set(rendered.map(\.id)).count, 4)
        XCTAssertTrue(rendered.allSatisfy { row in value.details.contains { $0.text == row.text && $0.label == row.label } })
        XCTAssertEqual(value.narrativeKey, facts(snapshot()).narrativeKey)
        XCTAssertTrue(value.narrativeKey.hasPrefix("health-choice-v1."))
    }

    func testActualClientWriterRenderingAndCacheBoundary() throws {
        let name = "health-summary-\(UUID().uuidString)", value = facts(snapshot())
        let defaults = UserDefaults(suiteName: name)!
        defer { defaults.removePersistentDomain(forName: name) }
        // A legacy prose cache is deliberately present.
        defaults.set("Rehydrate immediately.", forKey: "orion.narrative.health.2026-09-13.evening.old")
        let payload = try JSONSerialization.data(withJSONObject: ["response": "{\"highlight\":\"hydration\"}", "thinking": "Invented advice"])
        let writer = NarrativeWriter(defaults: defaults) { _, requireEnding in
            XCTAssertFalse(requireEnding)
            return try LocalModel.responseText(payload, requireSentenceEnding: requireEnding)
        }
        writer.load(key: value.narrativeKey, style: .selectionJSON) { value.prompt() }
        let deadline = Date().addingTimeInterval(3)
        while writer.isWriting && Date() < deadline { RunLoop.main.run(until: Date().addingTimeInterval(0.01)) }
        XCTAssertFalse(writer.isWriting)
        XCTAssertTrue(text(value, writer.text(for: value.narrativeKey)).hasPrefix("WATER LOG"))
        let reopened = NarrativeWriter(defaults: defaults) { _, _ in XCTFail("Must use the cache"); return "" }
        reopened.load(key: value.narrativeKey, style: .selectionJSON) { value.prompt() }
        XCTAssertEqual(writer.text(for: value.narrativeKey), reopened.text(for: value.narrativeKey))
        var changed = value; changed.bottles = 4
        XCTAssertNil(writer.text(for: changed.narrativeKey))
        XCTAssertTrue(text(changed, writer.text(for: changed.narrativeKey)).contains("4 bottles"))
    }
}
