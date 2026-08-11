//
//  What survives being written down, and what happens when it does not.
//
//  A corrupt or unreadable state file must never present itself as "no session".
//  This project's worst bugs have been silent empties, and a session that
//  vanishes with nothing in a log is exactly that failure wearing a new hat.
//

import XCTest
@testable import SessionDomain

final class PersistenceTests: XCTestCase {

    // MARK: Round trip

    func testAStateSurvivesEncodingAndDecoding() {
        let harness = Harness()
        harness.start(Harness.shortPlan(clips: [ClipAssignment(name: "rain")]))
        harness.advance(seconds: 45)
        harness.send(.pause)

        let original = harness.state!
        let data = try! SessionCoding.encode(SessionDocument(session: original))
        let decoded = try! SessionCoding.decode(data).session

        XCTAssertEqual(decoded, original)
    }

    func testReconciliationIsIdenticalAfterARoundTrip() {
        let harness = Harness()
        harness.start()
        harness.advance(minutes: 2)
        harness.advance(seconds: 20)

        let stamp = ClockStamp(clocks: harness.clocks)
        let before = SessionReconciler.reconcile(harness.state!, now: stamp)

        let data = try! SessionCoding.encode(SessionDocument(session: harness.state!))
        let decoded = try! SessionCoding.decode(data).session!
        let after = SessionReconciler.reconcile(decoded, now: stamp)

        XCTAssertEqual(before, after, "persistence must not change the answer")
    }

    func testAnEmptyDocumentIsValidRatherThanAnError() {
        let data = try! SessionCoding.encode(.empty)
        let decoded = try! SessionCoding.decode(data)

        XCTAssertNil(decoded.session)
        XCTAssertEqual(decoded.schemaVersion, SessionState.currentSchemaVersion)
    }

    // MARK: Failures that must be loud

    func testCorruptBytesThrowRatherThanReadingAsNoSession() {
        let garbage = Data("{ this is not json".utf8)

        XCTAssertThrowsError(try SessionCoding.decode(garbage)) { error in
            guard case SessionStoreError.corrupt = error else {
                return XCTFail("expected .corrupt, got \(error)")
            }
        }
    }

    func testTruncatedJSONThrows() {
        let harness = Harness()
        harness.start()
        let data = try! SessionCoding.encode(SessionDocument(session: harness.state!))
        let truncated = data.prefix(data.count / 2)

        XCTAssertThrowsError(try SessionCoding.decode(Data(truncated)))
    }

    func testAFileFromTheFutureIsRefusedRatherThanGuessedAt() {
        let future = Data("""
        { "schemaVersion": 99, "session": null }
        """.utf8)

        XCTAssertThrowsError(try SessionCoding.decode(future)) { error in
            guard case SessionStoreError.fromTheFuture(let found, let supported) = error else {
                return XCTFail("expected .fromTheFuture, got \(error)")
            }
            XCTAssertEqual(found, 99)
            XCTAssertEqual(supported, SessionState.currentSchemaVersion)
        }
    }

    func testEveryStoreErrorSaysSomethingAUserCanActOn() {
        let errors: [SessionStoreError] = [
            .corrupt(underlying: "whatever"),
            .fromTheFuture(found: 2, supported: 1),
            .unmigratable(from: 0)
        ]
        for error in errors {
            XCTAssertFalse(error.message.isEmpty)
            XCTAssertGreaterThan(error.message.count, 20,
                                 "an error nobody can act on is a silent failure with extra steps")
        }
    }

    // MARK: Migration

    func testACurrentVersionDocumentPassesThroughMigrationUnchanged() {
        let harness = Harness()
        harness.start()
        let document = SessionDocument(session: harness.state!)

        let migrated = try! Migration.migrate(document)

        XCTAssertEqual(migrated, document)
    }

    func testAVersionBelowTheOldestReadableIsRefused() {
        let ancient = SessionDocument(schemaVersion: 0, session: nil)

        XCTAssertThrowsError(try Migration.migrate(ancient)) { error in
            guard case SessionStoreError.unmigratable(let from) = error else {
                return XCTFail("expected .unmigratable, got \(error)")
            }
            XCTAssertEqual(from, 0)
        }
    }

    // MARK: The golden fixture

    /// A fixed session encoded to a fixed string. If this test breaks, the
    /// on-disk format changed — which is allowed, but only together with a
    /// migration step and a bump to `currentSchemaVersion`.
    func testTheOnDiskShapeIsWhatWeThinkItIs() {
        let harness = Harness()
        harness.start()

        let data = try! SessionCoding.encode(SessionDocument(session: harness.state!))
        let json = String(decoding: data, as: UTF8.self)

        // Spot the load-bearing parts rather than the whole blob, so a
        // formatting change does not read as a format change.
        XCTAssertTrue(json.contains("\"schemaVersion\" : 1"), json)
        XCTAssertTrue(json.contains("\"dayKey\" : \"2026-03-02\""), json)
        XCTAssertTrue(json.contains("\"task\" : \"write the thing\""), json)
        XCTAssertTrue(json.contains("\"started\""), json)
        XCTAssertFalse(json.contains("plannedDuration"),
                       "planned duration is derived and must not be persisted")
    }

    // MARK: The day key

    func testTheDayKeyUsesTheFourAmCutoffAndNotUTC() {
        let keys = CutoffDayKeys(cutoffHour: 4, calendar: {
            var calendar = Calendar(identifier: .gregorian)
            calendar.timeZone = TimeZone(identifier: "America/New_York")!
            return calendar
        }())

        // 2026-03-02 22:30 in New York. toISOString() would already say the 3rd.
        let lateEvening = Date(timeIntervalSince1970: 1_772_508_600)
        XCTAssertEqual(keys.key(at: lateEvening), "2026-03-02")

        // 02:00 the following night is still the 2nd — a late night, not an
        // early morning.
        let afterMidnight = Date(timeIntervalSince1970: 1_772_517_600)
        XCTAssertEqual(keys.key(at: afterMidnight), "2026-03-02")

        // 05:00 has crossed the cutoff.
        let morning = Date(timeIntervalSince1970: 1_772_528_400)
        XCTAssertEqual(keys.key(at: morning), "2026-03-03")
    }

    func testTheDayIsFixedAtStartAndDoesNotMoveWhileTheSessionRuns() {
        // Start at 03:30, which is before the cutoff, so the session belongs to
        // the previous day. Run it past 04:00 and it must not change days
        // underneath itself.
        let harness = Harness(start: Date(timeIntervalSince1970: 1_772_523_000))
        harness.start(Harness.fullPlan())
        let dayAtStart = harness.state!.dayKey

        harness.advance(minutes: 60)

        XCTAssertEqual(harness.state!.dayKey, dayAtStart,
                       "a running session must not move between days")
    }
}
