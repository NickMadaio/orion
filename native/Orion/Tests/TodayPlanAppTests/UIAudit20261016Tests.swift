import XCTest
import SessionService
@testable import Orion

/// 2026-10-16 UI audit: the pill and guard sheet lifecycle, the now-hint, the log limiter.
final class UIAudit20261016Tests: XCTestCase {

    // MARK: Floating pill (#1)

    func testPillIsVisibleOnlyWhileMinimizedAndLive() {
        XCTAssertTrue(SessionFloatPolicy.isVisible(minimized: true, hasLiveSession: true))
        XCTAssertFalse(SessionFloatPolicy.isVisible(minimized: true, hasLiveSession: false))
        XCTAssertFalse(SessionFloatPolicy.isVisible(minimized: false, hasLiveSession: true))
    }

    func testMinimizedFlagIsClearedWhenTheSessionEnds() {
        XCTAssertTrue(SessionFloatPolicy.shouldClearMinimized(minimized: true, hasLiveSession: false))
        XCTAssertFalse(SessionFloatPolicy.shouldClearMinimized(minimized: true, hasLiveSession: true))
        XCTAssertFalse(SessionFloatPolicy.shouldClearMinimized(minimized: false, hasLiveSession: false))
    }

    // MARK: Guard request and the live session (#1, #2)

    @MainActor
    func testAbandoningTheSessionDropsLivenessAndTheGuardRequest() throws {
        let scratch = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: scratch, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: scratch) }

        let library = ClipLibrary(directory: scratch.appendingPathComponent("clips"))
        let player = ClipPlayer(library: library)
        let effects = SessionEffects(clips: player)
        let service = SessionService(store: SessionStore(url: scratch.appendingPathComponent("state.json")),
                                     history: SessionHistory(url: scratch.appendingPathComponent("history.jsonl")),
                                     effects: effects)
        let model = SessionTabModel(service: service, library: library, clipPlayer: player,
                                    music: AppleMusicControl(), enforcer: Enforcer(), effects: effects)
        _ = service.start()
        defer { service.stop() }

        model.perform(SessionTabModel.Action(title: "Start", icon: "play", kind: .start))
        XCTAssertTrue(model.hasLiveSession)
        XCTAssertNotNil(model.guardSetupRequest, "a dashboard-started block asks which apps are allowed")

        model.perform(SessionTabModel.Action(title: "Abandon", icon: "xmark", kind: .abandon))
        XCTAssertFalse(model.hasLiveSession, "the pill's rule reads this; it must drop when the session ends")
        XCTAssertNil(model.guardSetupRequest, "the sheet must not outlive its session")
        XCTAssertFalse(SessionFloatPolicy.isVisible(minimized: true, hasLiveSession: model.hasLiveSession))
    }

    // MARK: Timeline now-hint (#6)

    func testNowHintAppearsOnlyWhenTheLineIsOutOfView() {
        XCTAssertNil(DayTimeline.nowEdge(nowY: 300, scrollY: 200, viewport: 400))
        XCTAssertEqual(DayTimeline.nowEdge(nowY: 100, scrollY: 200, viewport: 400), .above)
        XCTAssertEqual(DayTimeline.nowEdge(nowY: 900, scrollY: 200, viewport: 400), .below)
        XCTAssertNil(DayTimeline.nowEdge(nowY: 900, scrollY: 200, viewport: 0), "unmeasured viewport shows nothing")
    }

    // MARK: Log noise (#7)

    func testUnchangedLineIsWrittenOnceThenOnlyAfterTheRepeatInterval() {
        var limiter = LogRateLimiter()
        let t0 = Date(timeIntervalSince1970: 1_000)
        XCTAssertTrue(limiter.shouldWrite(key: "k", message: "a", now: t0, repeatAfter: 60))
        XCTAssertFalse(limiter.shouldWrite(key: "k", message: "a", now: t0 + 1, repeatAfter: 60))
        XCTAssertFalse(limiter.shouldWrite(key: "k", message: "a", now: t0 + 59, repeatAfter: 60))
        XCTAssertTrue(limiter.shouldWrite(key: "k", message: "a", now: t0 + 61, repeatAfter: 60))
    }

    func testChangedLineIsWrittenImmediatelyAndKeysAreIndependent() {
        var limiter = LogRateLimiter()
        let t0 = Date(timeIntervalSince1970: 1_000)
        XCTAssertTrue(limiter.shouldWrite(key: "lights", message: "failed", now: t0))
        XCTAssertFalse(limiter.shouldWrite(key: "lights", message: "failed", now: t0 + 500))
        XCTAssertTrue(limiter.shouldWrite(key: "lights", message: "ok", now: t0 + 501))
        XCTAssertTrue(limiter.shouldWrite(key: "other", message: "failed", now: t0 + 501))
    }

    func testJitteryNumbersDoNotCountAsAChangeWhenASignatureIsGiven() {
        var limiter = LogRateLimiter()
        let t0 = Date(timeIntervalSince1970: 1_000)
        XCTAssertTrue(limiter.shouldWrite(key: "audio", message: "level=0.1", signature: "ear=x sent=5", now: t0, repeatAfter: 60))
        XCTAssertFalse(limiter.shouldWrite(key: "audio", message: "level=0.2", signature: "ear=x sent=5", now: t0 + 1, repeatAfter: 60))
        XCTAssertTrue(limiter.shouldWrite(key: "audio", message: "level=0.2", signature: "ear=x sent=6", now: t0 + 2, repeatAfter: 60))
    }
}
