import XCTest
import MobileCore
import PaletteKit
@testable import Orion

/// The Mac's "Done early" button: its words, and that it is wired to the one planner command.
final class DoneEarlyAppTests: XCTestCase {
    private func source(_ name: String) throws -> String {
        let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        return try String(contentsOf: root.appendingPathComponent("Sources/Orion/\(name)"), encoding: .utf8)
    }

    func testTheConsoleRowSaysDoneEarly() throws {
        let rows = PaletteRanker.results(input: .search("done early"), context: PaletteModel.emptyContext, frecency: Frecency(), now: Date())
        let row = try XCTUnwrap(rows.first { $0.action == .finishEarly })
        XCTAssertEqual(row.title, "Done early")
        XCTAssertEqual(row.title, DoneEarly.label)
        XCTAssertFalse(rows.contains { $0.title.localizedCaseInsensitiveContains("out early") || $0.title == "Finished early" })
    }

    func testTheTasksTabButtonUsesTheSharedWordsAndNoOldWording() throws {
        let text = try source("TasksTab.swift")
        XCTAssertFalse(text.contains("out early"), "the old label is gone")
        // Wave 13: the button became the header's glow pill; the words and glyph still come from DoneEarly.
        XCTAssertTrue(text.contains("GlowPill(title: DoneEarly.label"))
        XCTAssertTrue(text.contains("symbol: DoneEarly.symbol"))
        XCTAssertTrue(text.contains("DoneEarly.accessibilityLabel"), "VoiceOver text comes from the same place")
        XCTAssertTrue(text.contains("state.finishEarly(\"auto\")"), "one press, the planner works out what is current")
        XCTAssertFalse(text.contains("state.earlyFinish?.kind == \"none\""), "it is never disabled for having nothing on: it answers instead")
    }

    @MainActor
    func testTheAppRunsTheEarlyCommandThroughTheSharedMapping() throws {
        let text = try source("AppState.swift")
        XCTAssertTrue(text.contains("DoneEarly.rescheduleArguments(mode: mode)"))
        XCTAssertTrue(text.contains("DoneEarly.summary(from: result.1)"), "the chat shows one line, not the planner's whole log")
    }
}
