//
//  Home versus the device, and the four ways they can disagree.
//
//  Written against the actual situation rather than an abstraction of it: Nick
//  is in New York on 2026-09-01, moving to London, landing on the 8th, with
//  three cron jobs pinned to New York and macOS auto-timezone switched on. Each
//  test below is one hour of that week.
//

import XCTest
@testable import SessionDomain

final class TimeZonePolicyTests: XCTestCase {

    private let newYork = TimeZone(identifier: "America/New_York")!
    private let london = TimeZone(identifier: "Europe/London")!
    private let tokyo = TimeZone(identifier: "Asia/Tokyo")!

    private func instant(_ iso: String) -> Date {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        guard let date = formatter.date(from: iso) else {
            fatalError("test fixture is not an ISO-8601 instant: \(iso)")
        }
        return date
    }

    /// The move as Nick actually described it on 2026-09-01: lands 8 September.
    private var theMove: ExpectedMove {
        ExpectedMove(destination: london,
                     on: CivilDay(key: "2026-09-08")!,
                     place: "London, United Kingdom")
    }

    private var today: TimeZonePolicy {
        TimeZonePolicy(home: newYork, place: "Montvale, New Jersey", expectedMove: theMove)
    }

    // MARK: - Before the move

    func testAtHomeBeforeTheMoveTheVerdictIsScheduledAndSaysNothing() {
        let verdict = today.verdict(device: newYork, at: instant("2026-09-01T16:00:00Z"))

        XCTAssertEqual(verdict, .moveScheduled(to: london,
                                               on: CivilDay(key: "2026-09-08")!,
                                               daysAway: 7))
        XCTAssertFalse(verdict.warrantsAttention,
                       "a move that has not happened yet is not an interruption")
    }

    /// A conference in Tokyo is not the move, and re-homing for it would be
    /// actively wrong — the 08:00 brief should keep meaning 08:00 at home.
    func testTravellingSomewhereThatIsNotTheDestinationLeavesHomeAlone() {
        let verdict = today.verdict(device: tokyo, at: instant("2026-09-03T02:00:00Z"))

        XCTAssertEqual(verdict, .travelling(home: newYork, device: tokyo))
        XCTAssertTrue(verdict.warrantsAttention)
    }

    // MARK: - The move

    func testLandingInLondonOnTheRecordedDayIsTheMove() {
        // 09:00 London on the 8th.
        let verdict = today.verdict(device: london, at: instant("2026-09-08T08:00:00Z"))

        XCTAssertEqual(verdict, .moveArrived(from: newYork, to: london,
                                             place: "London, United Kingdom"))
        XCTAssertTrue(verdict.warrantsAttention)
    }

    /// The date was an estimate; the destination was not. Arriving early is
    /// still arriving.
    func testArrivingAtTheDestinationEarlyIsStillTheMove() {
        let verdict = today.verdict(device: london, at: instant("2026-09-05T08:00:00Z"))

        XCTAssertEqual(verdict, .moveArrived(from: newYork, to: london,
                                             place: "London, United Kingdom"))
    }

    /// The failure mode this whole file is a reaction to: a date passes, the
    /// world does not match the plan, and nothing says anything. `USER.md` told
    /// Orion to ask once after the move and the deadline went by in silence.
    func testAMoveDayThatPassesWhileStillAtHomeIsReportedRatherThanIgnored() {
        let verdict = today.verdict(device: newYork, at: instant("2026-09-11T16:00:00Z"))

        XCTAssertEqual(verdict, .moveDue(to: london,
                                         on: CivilDay(key: "2026-09-08")!,
                                         daysLate: 3))
        XCTAssertTrue(verdict.warrantsAttention)
    }

    /// The day boundary decides scheduled-versus-due, and it is a CIVIL day
    /// boundary: 2026-09-08T01:00Z is the 8th in London but still 21:00 on the
    /// 7th in New York, and he is in New York.
    ///
    /// What this test does NOT prove, said out loud because a mutation test
    /// showed it: it does not distinguish reading `today` in the device's zone
    /// from reading it in home's. Every branch that consults `today` is a
    /// branch where the device IS home, so the two are identical. The
    /// distinction is documented at `verdict(device:at:)` as a choice, not as a
    /// tested property.
    func testTheDayBoundaryDecidesScheduledVersusDue() {
        let eveningBefore = today.verdict(device: newYork, at: instant("2026-09-08T01:00:00Z"))
        XCTAssertEqual(eveningBefore, .moveScheduled(to: london,
                                                     on: CivilDay(key: "2026-09-08")!,
                                                     daysAway: 1))

        // 12:00 New York on the 8th: the day has come and he has not gone.
        let onTheDay = today.verdict(device: newYork, at: instant("2026-09-08T16:00:00Z"))
        XCTAssertEqual(onTheDay, .moveDue(to: london,
                                          on: CivilDay(key: "2026-09-08")!, daysLate: 0))
    }

    /// Being at the destination is the move, on any date — which is why
    /// `arrivedOnTime` does not gate that branch. Pinned so the branch cannot
    /// quietly grow a date condition back.
    func testTheDestinationDecidesTheMoveRegardlessOfTheRecordedDate() {
        let expected = ZoneVerdict.moveArrived(from: newYork, to: london,
                                               place: "London, United Kingdom")
        for moment in ["2026-09-02T08:00:00Z",   // six days early
                       "2026-09-08T01:00:00Z",   // the small hours of the day itself
                       "2026-09-08T08:00:00Z",   // the day, in the morning
                       "2026-10-20T08:00:00Z"] { // six weeks late
            XCTAssertEqual(today.verdict(device: london, at: instant(moment)), expected,
                           "at \(moment)")
        }
    }

    // MARK: - After the move

    func testAcceptingTheMoveRehomesEverythingAndClearsTheExpectation() {
        let after = today.accepting(theMove)

        XCTAssertEqual(after.home.identifier, "Europe/London")
        XCTAssertEqual(after.place, "London, United Kingdom")
        XCTAssertNil(after.expectedMove, "a satisfied expectation must not survive")
    }

    /// The muting failure: a "you have arrived" that keeps arriving. Once home
    /// is the destination, the normal state has to be silent again.
    func testOnceRehomedTheVerdictGoesQuiet() {
        let after = today.accepting(theMove)
        let verdict = after.verdict(device: london, at: instant("2026-09-20T08:00:00Z"))

        XCTAssertEqual(verdict, .settled(zone: london))
        XCTAssertFalse(verdict.warrantsAttention)
    }

    /// A stale expectation that was never cleared must not re-fire either —
    /// belt and braces, because the clearing happens in a different file.
    func testAnExpectationPointingAtTheCurrentHomeIsTreatedAsSpent() {
        let stale = TimeZonePolicy(home: london, place: "London, United Kingdom",
                                   expectedMove: theMove)
        let verdict = stale.verdict(device: london, at: instant("2026-09-20T08:00:00Z"))

        XCTAssertEqual(verdict, .settled(zone: london))
    }

    /// After the move, a trip back to New York is a trip.
    func testAfterTheMoveGoingBackToNewYorkIsTravellingNotComingHome() {
        let after = today.accepting(theMove)
        let verdict = after.verdict(device: newYork, at: instant("2026-12-24T16:00:00Z"))

        XCTAssertEqual(verdict, .travelling(home: london, device: newYork))
    }

    // MARK: - No expectation recorded

    func testWithNoRecordedMoveAMismatchIsAlwaysJustTravel() {
        let plain = TimeZonePolicy(home: newYork, place: "Montvale, New Jersey")

        XCTAssertEqual(plain.verdict(device: newYork, at: instant("2026-09-01T16:00:00Z")),
                       .settled(zone: newYork))
        XCTAssertEqual(plain.verdict(device: london, at: instant("2026-09-08T08:00:00Z")),
                       .travelling(home: newYork, device: london))
    }

    // MARK: - Clock skew

    /// Phase 68's clock-skew case. The verdict is a pure function of the device
    /// zone and the instant — there is no stored "last seen" anywhere — so a
    /// clock that jumps cannot latch a wrong answer that outlives the jump.
    func testAClockJumpChangesOnlyWhatTheClockActuallyDetermines() {
        let policy = today

        let normal = policy.verdict(device: newYork, at: instant("2026-09-01T16:00:00Z"))
        // NTP drags the clock a year into the future, then back.
        let skewed = policy.verdict(device: newYork, at: instant("2027-09-01T16:00:00Z"))
        let restored = policy.verdict(device: newYork, at: instant("2026-09-01T16:00:00Z"))

        XCTAssertEqual(normal, .moveScheduled(to: london,
                                              on: CivilDay(key: "2026-09-08")!, daysAway: 7))
        // 358, not 365: lateness is counted from the MOVE day (8 September),
        // not from the day the clock jumped away from.
        XCTAssertEqual(skewed, .moveDue(to: london,
                                        on: CivilDay(key: "2026-09-08")!, daysLate: 358))
        XCTAssertEqual(restored, normal, "the wrong answer does not survive the jump")
    }

    /// A clock dragged backwards past the recorded day must not produce a
    /// negative gap, which would render as "in -3 days".
    func testDayGapsNeverGoNegative() {
        let policy = today
        let verdict = policy.verdict(device: newYork, at: instant("2020-01-01T12:00:00Z"))

        guard case .moveScheduled(_, _, let daysAway) = verdict else {
            return XCTFail("expected a scheduled move, got \(verdict)")
        }
        XCTAssertGreaterThan(daysAway, 0)
        XCTAssertEqual(TimeZonePolicy.dayGap(from: CivilDay(key: "2026-09-08")!,
                                             to: CivilDay(key: "2026-09-01")!), 0)
    }

    /// Counting days by walking the calendar rather than dividing a duration,
    /// so a 23-hour and a 25-hour day both count as one.
    func testDayGapsCountCivilDaysAcrossADSTTransition() {
        // 24 October to 27 October 2026 spans the end of BST.
        XCTAssertEqual(TimeZonePolicy.dayGap(from: CivilDay(key: "2026-10-24")!,
                                             to: CivilDay(key: "2026-10-27")!), 3)
        XCTAssertEqual(TimeZonePolicy.dayGap(from: CivilDay(key: "2026-12-31")!,
                                             to: CivilDay(key: "2027-01-01")!), 1)
        XCTAssertEqual(TimeZonePolicy.dayGap(from: CivilDay(key: "2024-02-28")!,
                                             to: CivilDay(key: "2024-03-01")!), 2)
    }

    // MARK: - Codable

    func testThePolicyRoundTripsIncludingTheRecordedMove() throws {
        let data = try JSONEncoder().encode(today)
        let back = try JSONDecoder().decode(TimeZonePolicy.self, from: data)

        XCTAssertEqual(back, today)
        XCTAssertEqual(back.expectedMove?.destination.identifier, "Europe/London")
        XCTAssertEqual(back.expectedMove?.on.key, "2026-09-08")
        XCTAssertEqual(back.expectedMove?.place, "London, United Kingdom")

        // Escaped, because Foundation's JSONEncoder escapes forward slashes —
        // see the note in ZonedTimeTests.
        let text = String(decoding: data, as: UTF8.self)
        XCTAssertTrue(text.contains(#"America\/New_York"#))
        XCTAssertTrue(text.contains("2026-09-08"))
    }

    func testAPolicyWithNoMoveRoundTrips() throws {
        let plain = TimeZonePolicy(home: london, place: "London, United Kingdom")
        let back = try JSONDecoder().decode(
            TimeZonePolicy.self, from: try JSONEncoder().encode(plain)
        )
        XCTAssertEqual(back, plain)
        XCTAssertNil(back.expectedMove)
    }

    func testDecodingRefusesAHomeZoneThatIsNotIANA() {
        let json = #"{"home":"EST","place":"Montvale, New Jersey"}"#
        XCTAssertThrowsError(
            try JSONDecoder().decode(TimeZonePolicy.self, from: Data(json.utf8))
        ) { error in
            XCTAssertEqual(error as? ZoneError, .notAnIANAZone("EST"))
        }
    }
}
