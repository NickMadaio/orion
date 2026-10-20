import XCTest
import MobileCore
@testable import Orion

/// The Mac's "Done early" button: its words, and that it is wired to the one planner command.
final class DoneEarlyAppTests: XCTestCase {
    private func source(_ name: String) throws -> String {
        let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        return try String(contentsOf: root.appendingPathComponent("Sources/Orion/\(name)"), encoding: .utf8)
    }

    func testTheConsoleRowSaysDoneEarly() throws {
        let row = try XCTUnwrap(QuickCommands.orionCommands(muted: false).first { $0.id == "early" })
        XCTAssertEqual(row.title, "Done early")
        XCTAssertEqual(row.symbol, DoneEarly.symbol)
        XCTAssertFalse(QuickCommands.orionCommands(muted: false).contains { $0.title.localizedCaseInsensitiveContains("out early") || $0.title == "Finished early" })
    }

    func testTheTasksTabButtonUsesTheSharedWordsAndNoOldWording() throws {
        let text = try source("TasksTab.swift")
        XCTAssertFalse(text.contains("out early"), "the old label is gone")
        XCTAssertTrue(text.contains("Label(DoneEarly.label, systemImage: DoneEarly.symbol)"))
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
