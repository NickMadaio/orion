//
//  The files, and what happens to them when things go wrong.
//
//  Every test here uses a real file in a real temporary directory. Mocking the
//  filesystem would test the mock: the properties that matter — atomic replace,
//  the lock, 0600, a torn line — are properties of the filesystem, not of a
//  protocol we could substitute.
//

import XCTest
@testable import SessionDomain
@testable import SessionService

final class StoreTests: XCTestCase {

    private var directory: URL!
    private var store: SessionStore!
    private var history: SessionHistory!

    override func setUp() {
        super.setUp()
        directory = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("orion-session-tests-\(UUID().uuidString)")
        try! FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        store = SessionStore(url: directory.appendingPathComponent("focus-state.json"))
        history = SessionHistory(url: directory.appendingPathComponent("focus-history.jsonl"))
    }

    override func tearDown() {
        try? FileManager.default.removeItem(at: directory)
        super.tearDown()
    }

    private func makeSession() -> SessionState {
        let plan = SessionPlanBuilder.alternating(
            session: SessionID("S1"), focusBlocks: 2,
            focus: 120, rest: 60, task: "write the thing"
        )
        return SessionState(
            id: SessionID("S1"), dayKey: "2026-03-02", plan: plan,
            events: [LifecycleEvent(
                id: "start", stamp: ClockStamp(wall: Date(timeIntervalSince1970: 1_772_452_800),
                                               uptime: 3600),
                kind: .started
            )]
        )
    }

    // MARK: Store

    func testAMissingFileReadsAsAnEmptyDocumentNotAnError() throws {
        let document = try store.load()
        XCTAssertNil(document.session)
    }

    func testAWrittenSessionComesBackIdentical() throws {
        let session = makeSession()
        try store.write(SessionDocument(session: session))

        XCTAssertEqual(try store.load().session, session)
    }

    func testTheStateFileIsNotWorldReadable() throws {
        try store.write(SessionDocument(session: makeSession()))

        let attributes = try FileManager.default.attributesOfItem(atPath: store.url.path)
        let permissions = (attributes[.posixPermissions] as? NSNumber)?.intValue ?? 0
        XCTAssertEqual(permissions & 0o077, 0,
                       "a session names what Nick is working on")
    }

    func testAnEmptyFileIsTreatedAsAbsentRatherThanCorrupt() throws {
        try Data().write(to: store.url)

        // A power cut mid-rename leaves this. There is nothing to recover, and
        // refusing to start a new session would turn a power cut into an outage.
        XCTAssertNil(try store.load().session)
    }

    func testCorruptBytesSurfaceAsAnErrorRatherThanAsNoSession() throws {
        try Data("{ not json".utf8).write(to: store.url)

        XCTAssertThrowsError(try store.load())

        let (document, failure) = store.loadForDisplay()
        XCTAssertNil(document.session)
        XCTAssertNotNil(failure, "the caller has to be able to say 'unreadable', not 'nothing'")
    }

    func testAnUnreadableFileIsNeverOverwritten() throws {
        let garbage = Data("{ not json".utf8)
        try garbage.write(to: store.url)

        XCTAssertThrowsError(try store.mutate { _ in SessionDocument(session: self.makeSession()) })
        XCTAssertEqual(try Data(contentsOf: store.url), garbage,
                       "refusing to read it must also mean refusing to destroy it")
    }

    func testMutateReturningNilLeavesTheFileAlone() throws {
        try store.write(SessionDocument(session: makeSession()))
        let before = try FileManager.default.attributesOfItem(atPath: store.url.path)[.modificationDate] as! Date

        Thread.sleep(forTimeInterval: 0.01)
        try store.mutate { _ in nil }

        let after = try FileManager.default.attributesOfItem(atPath: store.url.path)[.modificationDate] as! Date
        XCTAssertEqual(before, after, "a rejected command must not rewrite identical bytes")
    }

    func testNoScratchFilesAreLeftBehind() throws {
        for _ in 0..<5 {
            try store.write(SessionDocument(session: makeSession()))
        }
        let leftovers = try FileManager.default
            .contentsOfDirectory(atPath: directory.path)
            .filter { $0.hasSuffix(".tmp") || $0.hasSuffix(".lock") }
        XCTAssertEqual(leftovers, [])
    }

    // MARK: History

    private func makeRecord(id: String = "S1", day: String = "2026-03-02") -> HistoryRecord {
        HistoryRecord(
            sessionID: id, dayKey: day, task: "write the thing",
            startedAt: Date(timeIntervalSince1970: 1_772_452_800),
            endedAt: Date(timeIntervalSince1970: 1_772_456_400),
            reason: .completed,
            plannedFocusSeconds: 240, servedFocusSeconds: 240,
            plannedRestSeconds: 60, servedRestSeconds: 60,
            completedFocusBlocks: 2, totalFocusBlocks: 2,
            uncountedSeconds: 0, approximate: false
        )
    }

    func testAppendingWritesOneLine() throws {
        XCTAssertTrue(try history.append(makeRecord()))

        let records = try history.records()
        XCTAssertEqual(records.count, 1)
        XCTAssertEqual(records[0].sessionID, "S1")
    }

    func testAppendingTheSameSessionTwiceWritesOnce() throws {
        XCTAssertTrue(try history.append(makeRecord()))
        XCTAssertFalse(try history.append(makeRecord()),
                       "a crash between the write and the acknowledgement must not duplicate it")

        XCTAssertEqual(try history.records().count, 1)
    }

    func testDifferentSessionsBothLand() throws {
        try history.append(makeRecord(id: "S1"))
        try history.append(makeRecord(id: "S2"))

        XCTAssertEqual(try history.records().map(\.sessionID), ["S1", "S2"])
    }

    func testATornFinalLineDoesNotMakeTheWholeHistoryUnreadable() throws {
        try history.append(makeRecord(id: "S1"))
        try history.append(makeRecord(id: "S2"))

        // Simulate a power cut mid-append.
        var data = try Data(contentsOf: history.url)
        data.append(contentsOf: Array("{\"sessionID\":\"S3\",\"da".utf8))
        try data.write(to: history.url)

        let (records, skipped) = try history.readWithFailures()
        XCTAssertEqual(records.map(\.sessionID), ["S1", "S2"],
                       "losing the last line must not lose the other two")
        XCTAssertEqual(skipped, 1)
    }

    func testRecordsCanBeFetchedForOneLogicalDay() throws {
        try history.append(makeRecord(id: "S1", day: "2026-03-02"))
        try history.append(makeRecord(id: "S2", day: "2026-03-03"))

        XCTAssertEqual(try history.records(on: "2026-03-02").map(\.sessionID), ["S1"])
    }

    func testHistoryIsOneObjectPerLine() throws {
        try history.append(makeRecord(id: "S1"))
        try history.append(makeRecord(id: "S2"))

        let text = String(decoding: try Data(contentsOf: history.url), as: UTF8.self)
        let lines = text.split(separator: "\n")
        XCTAssertEqual(lines.count, 2)
        for line in lines {
            XCTAssertNoThrow(try JSONSerialization.jsonObject(with: Data(line.utf8)))
        }
    }
}
