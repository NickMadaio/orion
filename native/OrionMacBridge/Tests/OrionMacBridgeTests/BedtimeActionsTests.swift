import XCTest
@testable import OrionMacBridge

final class BedtimeActionsTests: XCTestCase {
    func testRefusesShellTerminalAndOrion() {
        for id in ["com.apple.finder", "com.apple.Terminal", "com.googlecode.iterm2", "com.apple.loginwindow",
                   "com.nickmadaio.Orion", "ai.openclaw.gateway", "com.apple.systempreferences"] {
            XCTAssertNotNil(BedtimeActions.refusal(bundleId: id), id)
        }
    }

    func testRefusesNonBundleIds() {
        XCTAssertNotNil(BedtimeActions.refusal(bundleId: "Safari; rm -rf /"))
        XCTAssertNotNil(BedtimeActions.refusal(bundleId: ""))
    }

    func testAllowsOrdinaryApps() {
        XCTAssertNil(BedtimeActions.refusal(bundleId: "com.hnc.Discord"))
        XCTAssertNil(BedtimeActions.refusal(bundleId: "com.apple.Safari"))
    }

    func testQuitOfRefusedAppThrowsBeforeTouchingAnything() {
        XCTAssertThrowsError(try BedtimeActions.quitApp(bundleId: "com.apple.finder"))
    }

    func testQuitOfAppThatIsNotRunningSaysSo() throws {
        let result = try BedtimeActions.quitApp(bundleId: "com.example.definitely-not-running")
        XCTAssertEqual(result["status"], "not_running")
    }

    func testDimNeverBrightens() {
        XCTAssertEqual(BedtimeActions.dimTarget(current: 0.8), BedtimeActions.dimLevel)
        XCTAssertEqual(BedtimeActions.dimTarget(current: 0.05), 0.05)
    }

    func testSavedLevelReadsOnlySaneValues() throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: dir) }
        let file = dir.appendingPathComponent("dim-state.json")
        XCTAssertNil(BedtimeActions.savedLevel(file))
        try Data("{\"brightness\":0.6}".utf8).write(to: file)
        XCTAssertEqual(BedtimeActions.savedLevel(file), 0.6)
        try Data("{\"brightness\":7}".utf8).write(to: file)
        XCTAssertNil(BedtimeActions.savedLevel(file))
    }
}
