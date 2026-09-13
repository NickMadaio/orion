import XCTest
import Foundation
@testable import Orion

final class BriefModelBoundaryTests: XCTestCase {
    func response(_ text: String) throws -> Data {
        try JSONSerialization.data(withJSONObject: ["response": text, "thinking": "Never display this"])
    }
    func store() -> UserDefaults {
        let name = "brief-boundary-\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: name)!
        addTeardownBlock { defaults.removePersistentDomain(forName: name) }
        return defaults
    }
    func settle(_ writer: NarrativeWriter) {
        let deadline = Date().addingTimeInterval(3)
        while writer.isWriting && Date() < deadline { RunLoop.main.run(until: Date().addingTimeInterval(0.01)) }
        XCTAssertFalse(writer.isWriting)
    }
    func narrative() -> BriefNarrative {
        BriefNarrative(clock: BriefClock(now: Date()), schedule: "no timed calendar events remain today.",
                       tasks: "One reminder remains unfinished.",
                       highlights: [BriefHighlight(id: "recovery", text: "A dated supported detail.")])
    }
    func testStructuredModelResponseReachesValidatedViewAndCache() throws {
        let brief = narrative(), defaults = store(), payload = try response("{\"highlight\":\"recovery\"}")
        let writer = NarrativeWriter(defaults: defaults) { _, requireEnding in
            // Actual LocalModel response validation, as consumed by the writer.
            try LocalModel.responseText(payload, requireSentenceEnding: requireEnding)
        }
        writer.load(key: brief.key, style: .selectionJSON) { brief.prompt }
        settle(writer)
        XCTAssertEqual(brief.selectedHighlight(writer.text(for: brief.key)), "A dated supported detail.")
        XCTAssertTrue(brief.text(selection: writer.text(for: brief.key)).hasSuffix("A dated supported detail."))
        let reopened = NarrativeWriter(defaults: defaults) { _, _ in XCTFail("Must use cache"); return "" }
        reopened.load(key: brief.key, style: .selectionJSON) { brief.prompt }
        XCTAssertEqual(brief.selectedHighlight(reopened.text(for: brief.key)), "A dated supported detail.")
    }
    func testProseConsumersRetainTheirTruncationGuard() throws {
        let payload = try response("{\"highlight\":\"recovery\"}")
        XCTAssertThrowsError(try LocalModel.responseText(payload, requireSentenceEnding: true))
        let writer = NarrativeWriter(defaults: store()) { _, requireEnding in
            try LocalModel.responseText(payload, requireSentenceEnding: requireEnding)
        }
        writer.load(key: "prose") { "Write a paragraph" }
        settle(writer)
        XCTAssertNil(writer.text)
        XCTAssertEqual(try LocalModel.responseText(response("A whole sentence."), requireSentenceEnding: true), "A whole sentence.")
    }
    func testStructuredStyleCannotRepairBadOutputIntoAValidSelection() throws {
        let brief = narrative()
        for invalid in ["Here's your choice:\n{\"highlight\":\"recovery\"}",
                        "\"{\"highlight\":\"recovery\"}\"", "{\"highlight\":\"missing\"}",
                        "```json\n{\"highlight\":\"recovery\"}\n```",
                        "{\"highlight\":\"recovery\"} extra text", "{\"highlight\":",
                        "You have a full day free.", "{\"highlight\":\"recovery\",\"text\":\"Invented\"}"] {
            let payload = try response(invalid)
            let writer = NarrativeWriter(defaults: store()) { _, requireEnding in
                try LocalModel.responseText(payload, requireSentenceEnding: requireEnding)
            }
            writer.load(key: brief.key, style: .selectionJSON) { brief.prompt }
            settle(writer)
            XCTAssertEqual(brief.text(selection: writer.text(for: brief.key)), brief.text(selection: nil))
        }
    }
    func testStaleSelectionCannotReachNewFactsAndEmptyResponseNeverUsesThinking() throws {
        let brief = narrative(), payload = try response("{\"highlight\":\"recovery\"}")
        let writer = NarrativeWriter(defaults: store()) { _, requireEnding in
            try LocalModel.responseText(payload, requireSentenceEnding: requireEnding)
        }
        writer.load(key: brief.key, style: .selectionJSON) { brief.prompt }
        writer.load(key: "changed", style: .selectionJSON) { nil }
        settle(writer)
        XCTAssertNil(writer.text(for: "changed"))
        XCTAssertThrowsError(try LocalModel.responseText(response(""), requireSentenceEnding: false))
    }
}
