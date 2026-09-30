import XCTest
@testable import Orion

/*
 The app's half of keep-awake and the halt buttons. Both halves are argv the app
 hands to the controller, so the tests pin the argv: a flag spelt differently
 here than in awake.mjs would be refused at launch, and a halt that carried a
 revision would be refused whenever the run had moved on — which is exactly when
 Nick presses Stop.
*/
final class ProjectKeepAwakeTests: XCTestCase {
    func testRunLogTailKeepsTheNewestReadableLines() throws {
        let file = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: file) }
        try (1...220).map { "entry \($0)" }.joined(separator: "\n").write(to: file, atomically: true, encoding: .utf8)
        let tail = ProjectRunLog.tail(file, maxBytes: 48_000, maxLines: 20)
        XCTAssertFalse(tail.contains("entry 199\n"))
        XCTAssertTrue(tail.hasPrefix("entry 201"))
        XCTAssertTrue(tail.hasSuffix("entry 220"))
    }

    func testLaunchFlagsStateTheOptionsInFull() {
        XCTAssertEqual(ProjectLaunchOptions().launchFlags, [], "the defaults need no flags")
        XCTAssertEqual(ProjectLaunchOptions(preventSleep: false).launchFlags, ["--no-keep-awake"])
        XCTAssertEqual(ProjectLaunchOptions(keepDisplayOn: true, nudgeMinutes: 5).launchFlags,
                       ["--keep-display-on", "--nudge-minutes", "5"])
        // Off wins outright: a display or nudge option under keep-awake-off is
        // refused by the CLI, so the app must never send one.
        XCTAssertEqual(ProjectLaunchOptions(preventSleep: false, keepDisplayOn: true, nudgeMinutes: 5).launchFlags,
                       ["--no-keep-awake"])
    }

    func testSavedOptionsDecodeWithDefaultsAndRefuseWhatTheCLIWouldRefuse() throws {
        let decode = { (json: String) in try JSONDecoder().decode(ProjectLaunchOptions.self, from: Data(json.utf8)) }
        XCTAssertEqual(try decode("{}"), ProjectLaunchOptions())
        XCTAssertEqual(try decode(#"{"nudgeMinutes":10}"#), ProjectLaunchOptions(nudgeMinutes: 10))
        XCTAssertThrowsError(try decode(#"{"nudgeMinutes":61}"#))
        XCTAssertThrowsError(try decode(#"{"preventSleep":false,"keepDisplayOn":true}"#))
    }

    func testAnUnreadableProjectRecordStartsFromTheDefaults() throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }
        XCTAssertEqual(ProjectLaunchOptions.read(projectRoot: dir), ProjectLaunchOptions(), "no project.json yet")
        try Data(#"{"launchOptions":{"nudgeMinutes":99}}"#.utf8).write(to: dir.appendingPathComponent("project.json"))
        XCTAssertEqual(ProjectLaunchOptions.read(projectRoot: dir), ProjectLaunchOptions())
        try Data(#"{"launchOptions":{"keepDisplayOn":true}}"#.utf8).write(to: dir.appendingPathComponent("project.json"))
        XCTAssertEqual(ProjectLaunchOptions.read(projectRoot: dir), ProjectLaunchOptions(keepDisplayOn: true))
    }

    func testHaltsNameTheProjectAndCarryNoRevision() {
        for command in ProjectAgentControl.halts {
            let argv = ProjectAgentControl.haltArguments(command, projectID: "alpha")
            XCTAssertEqual(argv, [command.rawValue, "--project", "alpha"])
            XCTAssertFalse(argv?.contains("--revision") ?? true, "\(command) must never fail on a stale revision")
        }
        XCTAssertEqual(ProjectAgentControl.halts, [.pause, .stop, .exterminate, .resume])
        // Steering and resolving answer a specific snapshot, so they are not halts.
        XCTAssertNil(ProjectAgentControl.haltArguments(.steer, projectID: "alpha"))
        XCTAssertNil(ProjectAgentControl.haltArguments(.resolve, projectID: "alpha"))
    }

    func testEveryListedCommandIsForThisProject() {
        let reference = ProjectAgentControl.commandReference(projectID: "alpha")
        XCTAssertEqual(reference.first?.command, "cd \(ProjectAgentControl.repository)")
        for line in reference.dropFirst() {
            XCTAssertTrue(line.command.contains("--project alpha") || line.command.contains("launch alpha "),
                          "\(line.command) would act on some other run")
            XCTAssertFalse(line.command.contains("<"), "\(line.command) has a placeholder zsh would read as a redirect")
            XCTAssertFalse(line.what.isEmpty)
        }
        for halt in ["pause", "stop", "exterminate", "resume"] {
            XCTAssertTrue(reference.contains { $0.command == "scripts/orion-project-agent --project alpha \(halt)" }, halt)
        }
    }

    /// The shape `orion-projects preflight` prints, trimmed to what the app reads.
    func testPreflightAndReceiptDecodeFromTheControllersOutput() throws {
        let preflight = try JSONDecoder().decode(ProjectPreflight.self, from: Data(#"""
        {"at":"2026-09-23T10:00:00.000Z","available":true,"powerSource":"battery","batteryPercent":42,
         "idleSleepMinutes":1,"displaySleepMinutes":10,"sleepDisabled":false,"hasLid":true,"lidClosed":false,
         "lidCloseSleeps":false,"displays":1,"externalDisplay":false,"vorssaintRunning":true,
         "lid":{"risk":"protected","reason":"macOS reports closing the lid will not sleep this Mac."},
         "summary":"On battery 42% · idle-sleeps after 1 min · lid close covered",
         "warnings":["On battery power (42%, discharging). Keep-awake still works, but a flat battery ends the run — plug in for anything long."]}
        """#.utf8))
        XCTAssertEqual(preflight.lid.risk, "protected")
        XCTAssertEqual(preflight.idleSleepMinutes, 1)
        XCTAssertEqual(preflight.warnings.count, 1)

        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }
        XCTAssertNil(ProjectLaunchReceipt.read(projectRoot: dir))
        try Data(#"""
        {"status":"running","detail":"Waiting for the supervisor heartbeat","at":"2026-09-23T10:00:01.000Z",
         "keepAwake":{"preventSleep":true,"keepDisplayOn":false,"nudgeMinutes":0,"active":true,
                      "summary":"Keeping this Mac awake · display may sleep · no activity nudge","boundToPid":4242},
         "warnings":[]}
        """#.utf8).write(to: dir.appendingPathComponent("launch.json"))
        let receipt = try XCTUnwrap(ProjectLaunchReceipt.read(projectRoot: dir))
        XCTAssertEqual(receipt.status, "running")
        XCTAssertEqual(receipt.keepAwake?.active, true)
        // A receipt from before keep-awake existed still reads.
        try Data(#"{"status":"stopped","detail":"done","at":"2026-09-20T10:00:00.000Z"}"#.utf8)
            .write(to: dir.appendingPathComponent("launch.json"))
        XCTAssertNil(try XCTUnwrap(ProjectLaunchReceipt.read(projectRoot: dir)).keepAwake)
    }
}
