//
//  The 2026-11-01 wedge and what came with it: the eval-marker rule, the
//  "session over, nothing quits" rule, and a child process that can neither
//  hang on a full pipe nor run forever.
//

import XCTest
import AppKit
@testable import SessionDomain
@testable import SessionService

private final class WedgeApps: RunningAppsReading {
    var running: [AppFacts] = []
    func facts(now: Date) -> [AppFacts] { running }
}

private final class WedgeReasoner: DistractionReasoning {
    var reply = "[]"
    func answer(_ prompt: String) throws -> String { reply }
}

private final class CleanDocuments: DocumentStateSensing {
    func documentState(pid: pid_t) -> (state: DocumentState, readableWindows: Int?) { (.clean, 1) }
}

final class AppWedgeTests: XCTestCase {

    private var directory: URL!

    override func setUp() {
        super.setUp()
        directory = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("orion-wedge-\(UUID().uuidString)")
        try! FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    }

    override func tearDown() {
        try? FileManager.default.removeItem(at: directory)
        super.tearDown()
    }

    // MARK: Eval marker — mirrors scripts/lib/eval-mode.mjs

    func testMarkerPathFollowsTheSameEnvironmentOrderAsTheScript() {
        let home = URL(fileURLWithPath: "/Users/someone")
        XCTAssertEqual(EvalMode.markerURL(environment: [:], home: home).path,
                       "/Users/someone/.openclaw/orion-controlled/eval-mode")
        XCTAssertEqual(EvalMode.markerURL(environment: ["ORION_CONTROLLED_DIR": "/tmp/copy"],
                                          home: home).path, "/tmp/copy/eval-mode")
        XCTAssertEqual(EvalMode.markerURL(environment: ["ORION_EVAL_MARKER": "/tmp/m",
                                                        "ORION_CONTROLLED_DIR": "/tmp/copy"],
                                          home: home).path, "/tmp/m")
        // JavaScript's `||` treats an empty string as unset.
        XCTAssertEqual(EvalMode.markerURL(environment: ["ORION_EVAL_MARKER": "",
                                                        "ORION_CONTROLLED_DIR": ""],
                                          home: home).path,
                       "/Users/someone/.openclaw/orion-controlled/eval-mode")
    }

    func testMarkerIsFreshForUnderTwoHoursAndNeverWhenMissing() {
        let now = Date()
        XCTAssertTrue(EvalMode.isFresh(modifiedAt: now.addingTimeInterval(-60), now: now))
        XCTAssertTrue(EvalMode.isFresh(modifiedAt: now.addingTimeInterval(-7199), now: now))
        XCTAssertFalse(EvalMode.isFresh(modifiedAt: now.addingTimeInterval(-7200), now: now),
                       "strictly under two hours, as `<` in eval-mode.mjs")
        XCTAssertFalse(EvalMode.isFresh(modifiedAt: nil, now: now))
    }

    func testMarkerOnDiskIsReadThroughTheEnvironment() throws {
        let marker = directory.appendingPathComponent("eval-mode")
        let env = ["ORION_EVAL_MARKER": marker.path]
        XCTAssertFalse(EvalMode.isActive(environment: env), "no file, not active")

        try Data().write(to: marker)
        XCTAssertTrue(EvalMode.isActive(environment: env))

        let stale = Date().addingTimeInterval(-3 * 3600)
        try FileManager.default.setAttributes([.modificationDate: stale], ofItemAtPath: marker.path)
        XCTAssertFalse(EvalMode.isActive(environment: env), "a forgotten marker expires")
    }

    // MARK: Quitting

    private func closer(evalMode: Bool) -> DistractionCloser {
        let apps = WedgeApps()
        apps.running = [AppFacts(bundleID: "com.example.game", name: "Game", isFrontmost: false,
                                 isHidden: false, isBackgroundOnly: false, isSystemComponent: false,
                                 documents: .clean, readableWindows: 1,
                                 secondsSinceLastActive: 3600, secondsSinceLaunch: 7200,
                                 editsDocuments: false)]
        let reasoner = WedgeReasoner()
        reasoner.reply = #"[{"bundle":"com.example.game","close":true,"reason":"a game"}]"#
        let quittable = QuittableApps(url: directory.appendingPathComponent("q.json"),
                                      documents: CleanDocuments())
        return DistractionCloser(apps: apps, quittable: quittable, reasoner: reasoner,
                                 isEvalMode: { evalMode })
    }

    /// Control arm: a live session outside eval does reach the quit (the
    /// fake bundle is not running, so the outcome is .notRunning).
    func testALiveSessionOutsideEvalReachesTheQuit() {
        let outcomes = closer(evalMode: false).closeDistractions(task: "econ", stillLive: { true })
        XCTAssertEqual(outcomes, [.notRunning("Game")])
    }

    func testASessionThatIsNoLongerLiveQuitsNothing() {
        XCTAssertEqual(closer(evalMode: false).closeDistractions(task: "econ",
                                                                 stillLive: { false }), [])
    }

    /// The session ends while the model is reasoning: live when the review
    /// starts, not live by the time the quit would run.
    func testASessionThatEndsDuringTheReviewQuitsNothing() {
        let liveness = SessionLiveness()
        let generation = liveness.begin()
        var asked = 0
        let outcomes = closer(evalMode: false).closeDistractions(task: "econ", stillLive: {
            asked += 1
            if asked == 2 { liveness.end() }
            return liveness.isLive(generation)
        })
        XCTAssertEqual(outcomes, [])
    }

    func testEvalModeLogsWhatItWouldCloseAndClosesNothing() {
        let subject = closer(evalMode: true)
        var lines: [String] = []
        subject.onLog = { lines.append($0) }
        XCTAssertEqual(subject.closeDistractions(task: "econ", stillLive: { true }), [])
        XCTAssertTrue(lines.contains { $0.contains("would close Game") }, lines.joined(separator: "\n"))
    }

    func testANewSessionDoesNotReviveTheOldOnesWork() {
        let liveness = SessionLiveness()
        let first = liveness.begin()
        liveness.end()
        let second = liveness.begin()
        XCTAssertFalse(liveness.isLive(first))
        XCTAssertTrue(liveness.isLive(second))
    }

    // MARK: Child processes

    private func script(_ name: String, _ body: String) throws -> URL {
        let url = directory.appendingPathComponent(name)
        try ("#!/bin/sh\n" + body + "\n").write(to: url, atomically: true, encoding: .utf8)
        try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: url.path)
        return url
    }

    /// 200 KB on each stream: an undrained pipe fills at about 64 KB and the
    /// child blocks forever.
    func testLargeOutputOnBothStreamsCannotFillThePipe() throws {
        let loud = try script("loud.sh", """
        head -c 204800 /dev/zero | tr '\\0' 'x'
        head -c 204800 /dev/zero | tr '\\0' 'y' >&2
        exit 0
        """)
        let started = Date()
        let result = BoundedProcess.run(executable: loud, arguments: [], timeout: 10)
        XCTAssertFalse(result.timedOut)
        XCTAssertEqual(result.status, 0)
        XCTAssertEqual(result.stdout.count, 204_800)
        XCTAssertEqual(result.stderr.count, 204_800)
        XCTAssertLessThan(Date().timeIntervalSince(started), 5)
    }

    func testAChildThatNeverFinishesIsStoppedAtTheTimeout() throws {
        let sleeper = try script("sleeper.sh", "exec sleep 60")
        let started = Date()
        let result = BoundedProcess.run(executable: sleeper, arguments: [], timeout: 1)
        XCTAssertTrue(result.timedOut)
        XCTAssertFalse(result.succeeded)
        XCTAssertLessThan(Date().timeIntervalSince(started), 6)
    }

    func testShortcutsListReadsALargeListAndAHungShortcutIsReportedNotWaitedOn() throws {
        // Stands in for /usr/bin/shortcuts: `list` prints 200 KB of names and
        // noise on stderr; `run` hangs.
        let fake = try script("shortcuts.sh", """
        if [ "$1" = "list" ]; then
          i=0
          while [ $i -lt 5000 ]; do echo "Shortcut number $i padded out to forty bytes"; i=$((i+1)); done
          head -c 204800 /dev/zero >&2
          exit 0
        fi
        exec sleep 60
        """)
        let cli = ShortcutsCLI(executable: fake, timeout: 1)
        let names = cli.names()
        XCTAssertEqual(names?.count, 5000)
        XCTAssertEqual(names?.first, "Shortcut number 0 padded out to forty bytes")

        let started = Date()
        let run = cli.run("ORION Focus Toggle", input: "on work")
        XCTAssertFalse(run.worked)
        XCTAssertNotNil(run.launchFailure)
        XCTAssertLessThan(Date().timeIntervalSince(started), 6)
    }

    func testAMissingExecutableIsALaunchFailureNotAHang() {
        let result = BoundedProcess.run(executable: directory.appendingPathComponent("nope"),
                                        arguments: [], timeout: 1)
        XCTAssertNotNil(result.launchFailure)
        XCTAssertNil(ShortcutsCLI(executable: directory.appendingPathComponent("nope")).names())
    }
}
