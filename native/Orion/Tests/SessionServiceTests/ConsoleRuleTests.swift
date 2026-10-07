//
//  The two rules the Console must not break.
//
//  Both are properties of the SOURCE rather than of a running window, which is
//  the right level for them: the damage is done the moment somebody adds an
//  APPROVAL command to the list or reaches for an NSEvent monitor, not later
//  when it misbehaves.
//

import XCTest

final class ConsoleRuleTests: XCTestCase {

    private func source(_ name: String) throws -> String {
        let root = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent()
        return try String(contentsOf: root.appendingPathComponent("Sources/Orion/\(name)"),
                          encoding: .utf8)
    }

    private func code(_ text: String) -> String {
        text.split(separator: "\n", omittingEmptySubsequences: false)
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.hasPrefix("//") && !$0.hasPrefix("*") }
            .joined(separator: "\n")
    }

    /// A global NSEvent monitor is PASSIVE and cannot consume the keystroke, so
    /// the hotkey would fire AND type into whatever was frontmost.
    func testTheHotKeyUsesCarbonAndNotAPassiveMonitor() throws {
        let text = code(try source("GlobalHotKey.swift"))

        XCTAssertTrue(text.contains("RegisterEventHotKey"),
                      "only RegisterEventHotKey actually claims the combination")
        XCTAssertFalse(text.contains("addGlobalMonitorForEvents"),
                       "a global monitor cannot consume the event — \u{2325}Tab would be typed "
                       + "into the sentence being written")
    }

    /// Registration failure has to be surfaced. macOS gives the key to whoever
    /// already owns it and reports nothing.
    func testHotKeyFailureIsDisclosedRatherThanSwallowed() throws {
        let text = code(try source("GlobalHotKey.swift"))

        XCTAssertTrue(text.contains("eventHotKeyExistsErr"),
                      "the already-taken case has to be detected specifically")
        XCTAssertTrue(text.contains("disclosure"),
                      "and turned into something a person reads")
    }

    /// The safety property a convenience feature could silently delete.
    func testOnlyAutoAndNotifyMayAppearInTheConsole() throws {
        let text = code(try source("Console.swift"))

        XCTAssertTrue(text.contains("mayAppearInConsole"))
        XCTAssertTrue(text.contains("filter(\\.tier.mayAppearInConsole)"),
                      "the list has to be filtered, not merely annotated")

        // No command may be declared at a gated tier. A one-keystroke button for
        // something that is supposed to ask first has converted "ask" into
        // "press this".
        XCTAssertFalse(text.contains("tier: .approval"),
                       "an APPROVAL capability must never be one keystroke away")
        XCTAssertFalse(text.contains("tier: .never"))
    }

    /// The ⌥Tab menu's command list (7 Oct 2026) lives in its own file; the
    /// same rule holds there, and the controller still filters before showing.
    func testTheQuickMenuCatalogOffersNoGatedCommand() throws {
        let text = code(try source("QuickCommands.swift"))
        XCTAssertFalse(text.contains("tier: .approval"))
        XCTAssertFalse(text.contains("tier: .never"))
        XCTAssertTrue(code(try source("Console.swift")).contains("guard command.tier.mayAppearInConsole"),
                      "run() refuses a gated command even if one is ever listed")
    }

    /// Provenance is typed and carried, never inferred from the words.
    func testConsoleCommandsCarryTheirOwnOrigin() throws {
        let text = code(try source("Console.swift"))

        XCTAssertTrue(text.contains("origin: .console"),
                      "a sentence produced by a keystroke is not trusted user speech")
        XCTAssertFalse(text.contains("origin: .voice"))
    }
}
