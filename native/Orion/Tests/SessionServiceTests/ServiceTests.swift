//
//  Gate 3's exit criteria, as tests.
//
//  "Headless start/status/pause/resume/finish survives window close and app
//  restart; exactly one history record written."
//
//  A restart here is a genuinely new SessionService pointed at the same files,
//  which is what a relaunch actually is. Nothing is carried over in memory.
//

import XCTest
@testable import SessionDomain
@testable import SessionService

/// Records what it was asked to do, and can be told to fail.
final class RecordingEffects: SessionEffectHandler {
    var announcements: [Announcement] = []
    var clipsStarted: [String] = []
    var stops = 0
    var absences: [TimeInterval] = []
    var anomalies: [TimeInterval] = []

    /// When true, everything reports failure — which must leave the effects
    /// pending rather than acknowledged.
    var failEverything = false

    func announce(_ announcement: Announcement) -> Bool {
        guard !failEverything else { return false }
        announcements.append(announcement); return true
    }
    func startClip(_ clip: ClipAssignment, phaseIndex: Int) -> Bool {
        guard !failEverything else { return false }
        clipsStarted.append(clip.name); return true
    }
    func stopClip() -> Bool {
        guard !failEverything else { return false }
        stops += 1; return true
    }
    func askAboutAbsence(seconds: TimeInterval, phaseIndex: Int) -> Bool {
        guard !failEverything else { return false }
        absences.append(seconds); return true
    }
    func reportClockAnomaly(seconds: TimeInterval) -> Bool {
        guard !failEverything else { return false }
        anomalies.append(seconds); return true
    }
}

final class ServiceTests: XCTestCase {

    private var directory: URL!
    private var wall: StubWallClock!
    private var monotonic: StubMonotonicClock!
    private var effects: RecordingEffects!

    override func setUp() {
        super.setUp()
        directory = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("orion-service-tests-\(UUID().uuidString)")
        try! FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        wall = StubWallClock(Date(timeIntervalSince1970: 1_772_452_800))
        monotonic = StubMonotonicClock(3600)
        effects = RecordingEffects()
    }

    override func tearDown() {
        try? FileManager.default.removeItem(at: directory)
        super.tearDown()
    }

    /// A fresh service over the same files — exactly what a relaunch is.
    private func makeService(handler: SessionEffectHandler? = nil) -> SessionService {
        SessionService(
            store: SessionStore(url: directory.appendingPathComponent("focus-state.json")),
            history: SessionHistory(url: directory.appendingPathComponent("focus-history.jsonl")),
            clocks: Clocks(wall: wall, monotonic: monotonic),
            dayKeys: CutoffDayKeys(cutoffHour: 4, calendar: {
                var calendar = Calendar(identifier: .gregorian)
                calendar.timeZone = TimeZone(identifier: "America/New_York")!
                return calendar
            }()),
            effects: handler ?? effects
        )
    }

    private func advance(_ seconds: TimeInterval, on service: SessionService) {
        var left = seconds
        while left > 0 {
            let step = Swift.min(left, SessionService.heartbeatInterval)
            wall.advance(step); monotonic.advance(step)
            left -= step
            service.tick()
        }
    }

    private func plan(_ id: String = "S1") -> SessionPlan {
        SessionPlanBuilder.alternating(
            session: SessionID(id), focusBlocks: 2,
            focus: 120, rest: 60,
            clips: [ClipAssignment(name: "rain")], task: "write the thing"
        )
    }

    private func command(_ kind: CommandKind, _ id: String) -> Command {
        Command(requestID: RequestID(id), origin: .script, issuedAt: wall.now, kind: kind)
    }

    // MARK: The headless cycle

    func testStartStatusPauseResumeFinish() {
        let service = makeService()
        service.start()

        XCTAssertTrue(service.send(command(.start(plan: plan()), "r1")).accepted)
        XCTAssertEqual(service.snapshot().reconciliation?.status, .running(.focus))

        advance(30, on: service)
        XCTAssertTrue(service.send(command(.pause, "r2")).accepted)
        XCTAssertEqual(service.snapshot().reconciliation?.status, .paused)

        advance(600, on: service)
        XCTAssertEqual(service.snapshot().reconciliation?.servedInPhase ?? -1, 30, accuracy: 0.001)

        XCTAssertTrue(service.send(command(.resume, "r3")).accepted)
        advance(30, on: service)
        XCTAssertEqual(service.snapshot().reconciliation?.servedInPhase ?? -1, 60, accuracy: 0.001)

        XCTAssertTrue(service.send(command(.finishEarly, "r4")).accepted)
        XCTAssertEqual(service.snapshot().reconciliation?.status, .finished(.early))
        service.stop()
    }

    func testTheSessionSurvivesTheServiceBeingReplaced() {
        let first = makeService()
        first.start()
        first.send(command(.start(plan: plan()), "r1"))
        advance(60, on: first)
        first.stop()

        // The app quits. Ten minutes pass with nothing running. It comes back.
        wall.advance(600); monotonic.advance(600)

        let second = makeService()
        let snapshot = second.start()

        XCTAssertEqual(snapshot.session?.id, SessionID("S1"))
        XCTAssertEqual(snapshot.reconciliation?.status, .running(.focus))
        XCTAssertEqual(snapshot.reconciliation?.servedInPhase ?? -1, 60, accuracy: 0.001,
                       "the minute served before the quit is still served")
        XCTAssertEqual(snapshot.reconciliation?.uncounted ?? -1, 600, accuracy: 0.001,
                       "and the ten minutes it was not running are not")
        second.stop()
    }

    func testExactlyOneHistoryRecordEvenAcrossRestartsAndRepeatedTicks() throws {
        let service = makeService()
        service.start()
        service.send(command(.start(plan: plan()), "r1"))
        advance(60, on: service)
        service.send(command(.finishEarly, "r2"))
        service.stop()

        // Relaunch twice, ticking each time — the crash-loop shape.
        for _ in 0..<3 {
            let next = makeService()
            next.start()
            next.tick()
            next.tick()
            next.stop()
        }

        let history = SessionHistory(url: directory.appendingPathComponent("focus-history.jsonl"))
        XCTAssertEqual(try history.records().count, 1)
        XCTAssertEqual(try history.records().first?.reason, .early)
    }

    func testAFullyServedSessionArchivesItselfAsCompleted() throws {
        let service = makeService()
        service.start()
        service.send(command(.start(plan: plan()), "r1"))

        advance(300, on: service)   // 120 + 60 + 120 = 300

        XCTAssertEqual(service.snapshot().reconciliation?.status, .finished(.completed))

        let history = SessionHistory(url: directory.appendingPathComponent("focus-history.jsonl"))
        let records = try history.records()
        XCTAssertEqual(records.count, 1)
        XCTAssertEqual(records[0].reason, .completed)
        XCTAssertEqual(records[0].completedFocusBlocks, 2)
        XCTAssertEqual(records[0].dayKey, "2026-03-02")
        service.stop()
    }

    // MARK: Effects

    func testEffectsAreCarriedOutAndNotRepeated() {
        let service = makeService()
        service.start()
        service.send(command(.start(plan: plan()), "r1"))

        XCTAssertEqual(effects.clipsStarted, ["rain"])
        let announcedOnce = effects.announcements.count

        service.tick()
        service.tick()

        XCTAssertEqual(effects.clipsStarted, ["rain"], "an acknowledged effect must not repeat")
        XCTAssertEqual(effects.announcements.count, announcedOnce)
        service.stop()
    }

    func testAFailedEffectStaysPendingAndIsRetried() {
        effects.failEverything = true
        let service = makeService()
        service.start()
        service.send(command(.start(plan: plan()), "r1"))

        XCTAssertTrue(effects.clipsStarted.isEmpty)
        XCTAssertFalse(service.snapshot().reconciliation?.effects.isEmpty ?? true,
                       "nothing was acknowledged, so it is all still pending")

        effects.failEverything = false
        service.tick()

        XCTAssertEqual(effects.clipsStarted, ["rain"], "and it lands on the next pass")
        service.stop()
    }

    func testANewPhaseAnnouncesItselfWithoutRepeatingTheOldOne() {
        let service = makeService()
        service.start()
        service.send(command(.start(plan: plan()), "r1"))
        effects.announcements.removeAll()

        advance(120, on: service)   // into the break

        XCTAssertEqual(effects.announcements.count, 1)
        if case .restBeginning = effects.announcements[0] {} else {
            XCTFail("expected a rest announcement, got \(effects.announcements)")
        }
        service.stop()
    }

    // MARK: Refusals

    func testACommandWithNoSessionIsRefusedRatherThanStartingOne() {
        let service = makeService()
        service.start()

        let outcome = service.send(command(.pause, "r1"))

        XCTAssertFalse(outcome.accepted)
        XCTAssertEqual(outcome.rejection, .noSession)
        XCTAssertNil(service.snapshot().session)
        service.stop()
    }

    func testARetriedCommandIsReportedAsADuplicateNotAsAFailure() {
        let service = makeService()
        service.start()
        service.send(command(.start(plan: plan()), "r1"))
        advance(30, on: service)

        service.send(command(.pause, "same"))
        let retry = service.send(command(.pause, "same"))

        XCTAssertFalse(retry.accepted)
        XCTAssertTrue(retry.wasDuplicate)
        XCTAssertEqual(retry.snapshot.reconciliation?.status, .paused)
        service.stop()
    }

    func testAnUnreadableStateFileDoesNotStopTheAppStartingAndIsReported() throws {
        try Data("{ not json".utf8)
            .write(to: directory.appendingPathComponent("focus-state.json"))

        let service = makeService()
        let snapshot = service.start()

        XCTAssertNotNil(snapshot.failure, "the caller must be able to say 'unreadable'")
        XCTAssertNil(snapshot.session)
        XCTAssertFalse(snapshot.isRunning)
        service.stop()
    }

    // MARK: The heartbeat

    func testTheServiceWritesHeartbeatsSoACrashCostsAtMostOneInterval() {
        let service = makeService()
        service.start()
        service.send(command(.start(plan: plan()), "r1"))

        advance(110, on: service)
        service.stop()

        // Crash. Five minutes down.
        wall.advance(300); monotonic.advance(300)

        let second = makeService()
        let snapshot = second.start()

        let served = snapshot.reconciliation?.servedInPhase ?? 0
        XCTAssertGreaterThanOrEqual(served, 110 - SessionService.heartbeatInterval)
        XCTAssertLessThanOrEqual(served, 110)
        second.stop()
    }

    func testHeartbeatsDoNotBloatTheStateFile() {
        let service = makeService()
        service.start()
        service.send(command(.start(plan: plan()), "r1"))

        advance(110, on: service)

        let events = service.snapshot().session?.events.count ?? 0
        XCTAssertLessThan(events, 6, "heartbeats coalesce; they must not accumulate")
        service.stop()
    }
}
