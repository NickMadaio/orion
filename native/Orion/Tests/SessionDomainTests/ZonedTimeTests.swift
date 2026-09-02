//
//  Phase 40's vocabulary, and the parts of Phase 68 a Mac can actually be held
//  to: DST, timezone travel, and a clock that jumps.
//
//  The thing worth saying about how these are written: almost none of them
//  compare a value to `TimeZone.current`. A test that reads the machine's zone
//  to build its expectation passes on the machine it was written on and proves
//  nothing about any other — which is exactly how the `CutoffDayKeys` defect
//  below survived a suite of 322 tests that injected `America/New_York` while
//  running on a machine that WAS `America/New_York`.
//
//  So expectations here are either literal, or derived from a formatter that
//  has been pinned to a named zone on purpose.
//

import XCTest
@testable import SessionDomain

final class ZonedTimeTests: XCTestCase {

    // MARK: Helpers

    private func zone(_ id: String) -> TimeZone {
        guard let zone = TimeZone(identifier: id) else {
            fatalError("test fixture names a zone this system does not have: \(id)")
        }
        return zone
    }

    /// Independent of the type under test: a formatter pinned to a named zone.
    private func civilDate(of instant: Date, in zone: TimeZone) -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = zone
        return formatter.string(from: instant)
    }

    private func instant(_ iso: String) -> Date {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        guard let date = formatter.date(from: iso) else {
            fatalError("test fixture is not an ISO-8601 instant: \(iso)")
        }
        return date
    }

    // MARK: - Zone validation

    /// The whole point of insisting on IANA names: a fixed offset is a local
    /// datetime string in disguise. It is right for half the year.
    func testFixedOffsetZonesAreRefusedEvenThoughFoundationResolvesThem() {
        // The precondition used to read
        //   XCTAssertNotNil(TimeZone(identifier: spelling) ?? TimeZone(identifier: "UTC"))
        // and the `??` made it unfailable, so the "even though Foundation
        // resolves them" claim was never checked -- and it was FALSE for one
        // entry: Mars/Olympus does not resolve at all. Split, so the premise is
        // asserted rather than asserted-looking. (Independent review, 2026-09-02.)
        for spelling in ["GMT+0500", "EST", "Zulu", "US/Eastern"] {
            XCTAssertNotNil(TimeZone(identifier: spelling),
                            "\(spelling) must really be resolvable by Foundation, or this test proves nothing")
            XCTAssertThrowsError(try IANAZone.resolve(spelling)) { error in
                XCTAssertEqual(error as? ZoneError, .notAnIANAZone(spelling))
            }
        }
    }

    /// A spelling Foundation does not resolve either. Refused for a different
    /// reason, and kept separate so the test above can honestly say its
    /// spellings ARE resolvable.
    func testAStringThatIsNotAZoneAtAllIsAlsoRefused() {
        XCTAssertNil(TimeZone(identifier: "Mars/Olympus"))
        XCTAssertThrowsError(try IANAZone.resolve("Mars/Olympus")) { error in
            XCTAssertEqual(error as? ZoneError, .notAnIANAZone("Mars/Olympus"))
        }
    }

    func testRealZonesResolveToExactlyTheNameTheyWereGiven() throws {
        for spelling in ["GMT", "Europe/London", "America/New_York", "Pacific/Kiritimati"] {
            XCTAssertEqual(try IANAZone.resolve(spelling).identifier, spelling)
        }
    }

    /// The invariant that justifies refusing everything outside the known set:
    /// what you store is what you read back, for every name in it.
    ///
    /// `UTC` is the cautionary case. Foundation resolves it and then answers
    /// `GMT`, so storing `UTC` means reading back a name nobody wrote — which is
    /// why it is refused and `IANAZone.utc` is spelled `GMT`.
    func testEveryAcceptedZoneNameRoundTripsByteForByte() {
        XCTAssertGreaterThan(IANAZone.accepted.count, 400, "precondition: a real zone database")

        for identifier in IANAZone.accepted {
            XCTAssertEqual(TimeZone(identifier: identifier)?.identifier, identifier,
                           "\(identifier) does not round-trip and must not be in the accepted set")
        }

        XCTAssertEqual(TimeZone(identifier: "UTC")?.identifier, "GMT", "the reason UTC is refused")
        XCTAssertFalse(IANAZone.isAccepted("UTC"))
        XCTAssertEqual(IANAZone.utc.identifier, "GMT")
    }

    // MARK: - CivilDay

    func testCivilDayRejectsDatesThatDoNotExist() {
        XCTAssertNil(CivilDay(year: 2026, month: 2, day: 29))   // 2026 is not a leap year
        XCTAssertNil(CivilDay(year: 2026, month: 13, day: 1))
        XCTAssertNil(CivilDay(year: 2026, month: 4, day: 31))
        XCTAssertNotNil(CivilDay(year: 2024, month: 2, day: 29)) // this one is
    }

    func testCivilDayParsingIsStrictAboutTheKeyFormat() {
        XCTAssertEqual(CivilDay(key: "2026-09-08")?.key, "2026-09-08")
        // The trailing-content case is the one that matters: a lenient parse of
        // an ISO instant silently discards the time and keeps the UTC date.
        XCTAssertNil(CivilDay(key: "2026-09-08T00:00:00Z"))
        XCTAssertNil(CivilDay(key: "2026-9-8"))
        XCTAssertNil(CivilDay(key: "26-09-08"))
        XCTAssertNil(CivilDay(key: ""))
        XCTAssertNil(CivilDay(key: "２０２６-０９-０８"))  // full-width digits are numbers to Swift
    }

    func testCivilDayOfAnInstantDependsOnTheZoneYouReadItIn() {
        // 03:30 UTC on 8 September: already the 8th in London, still the 7th in
        // New York. This one instant is the entire Batch B problem in miniature.
        let moment = instant("2026-09-08T03:30:00Z")

        XCTAssertEqual(CivilDay(of: moment, in: zone("Europe/London")).key, "2026-09-08")
        XCTAssertEqual(CivilDay(of: moment, in: zone("America/New_York")).key, "2026-09-07")
        XCTAssertEqual(CivilDay(of: moment, in: zone("Pacific/Kiritimati")).key, "2026-09-08")
    }

    func testCivilDayKeyRoundTripsThroughItsOwnParser() {
        for day in ["2026-01-01", "2026-09-08", "2026-12-31", "2024-02-29"] {
            XCTAssertEqual(CivilDay(key: day)?.key, day)
        }
    }

    // MARK: - DST

    /// A day is not 86,400 seconds, and this is the assertion that says so.
    func testADayIsTwentyThreeOrTwentyFiveHoursAcrossADSTTransition() {
        let london = zone("Europe/London")

        // BST ends at 02:00 on the last Sunday of October 2026.
        let fallBack = CivilDay(key: "2026-10-25")!
        XCTAssertEqual(fallBack.hours(in: london), 25, accuracy: 0.001)

        // BST begins at 01:00 on the last Sunday of March 2026.
        let springForward = CivilDay(key: "2026-03-29")!
        XCTAssertEqual(springForward.hours(in: london), 23, accuracy: 0.001)

        // And an ordinary day, so the test cannot pass by always answering 24.
        XCTAssertEqual(CivilDay(key: "2026-09-08")!.hours(in: london), 24, accuracy: 0.001)
    }

    /// The interval has to be built from the next day's start. Adding 86,400
    /// seconds gives 23:00 on a fall-back day, which leaves an hour of the day
    /// outside its own interval.
    func testTheDayIntervalCoversEveryInstantOfADSTDay() {
        let london = zone("Europe/London")
        let fallBack = CivilDay(key: "2026-10-25")!
        let interval = fallBack.interval(in: london)

        // The repeated hour: 01:30 happens twice, once BST and once GMT.
        let firstPass = instant("2026-10-25T00:30:00Z")   // 01:30 BST
        let secondPass = instant("2026-10-25T01:30:00Z")  // 01:30 GMT
        XCTAssertTrue(interval.contains(firstPass))
        XCTAssertTrue(interval.contains(secondPass))

        // The day ends exactly where the next one starts. Asserted as an
        // equality rather than with `contains`, because `DateInterval.contains`
        // is CLOSED at its end — it answers true for the end instant, so it
        // cannot express a half-open boundary and using it here would have been
        // an assertion about Foundation rather than about the day.
        XCTAssertTrue(interval.contains(instant("2026-10-25T23:59:59Z")))
        XCTAssertEqual(interval.end, fallBack.advanced(by: 1).start(in: london))

        let naiveEnd = interval.start.addingTimeInterval(86_400)
        XCTAssertLessThan(naiveEnd, interval.end,
                          "the fixed-86,400 end would fall an hour short of the real day")
    }

    /// Some zones do not have a midnight on their spring-forward date. Building
    /// 00:00 by hand there gives the previous day or nothing.
    func testStartOfDayIsCorrectInAZoneWhereMidnightDoesNotExist() {
        // Chile springs forward at 00:00 on the first Sunday of September.
        let santiago = zone("America/Santiago")
        let transition = CivilDay(key: "2026-09-06")!
        let start = transition.start(in: santiago)

        XCTAssertEqual(civilDate(of: start, in: santiago), "2026-09-06",
                       "the day must start on its own date, not the one before")
        XCTAssertEqual(transition.hours(in: santiago), 23, accuracy: 0.001)
    }

    /// 02:30 on a spring-forward morning is not a time. Rounding it to 03:30 is
    /// how an alarm ends up an hour out, so the initialiser refuses instead.
    func testAWallTimeThatDoesNotExistIsRefusedRatherThanNudged() {
        let london = zone("Europe/London")
        var missing = DateComponents()
        missing.year = 2026; missing.month = 3; missing.day = 29
        missing.hour = 1; missing.minute = 30                    // 01:00 -> 02:00 BST

        XCTAssertNil(ZonedInstant(wall: missing, in: london))

        var present = missing
        present.hour = 3
        XCTAssertNotNil(ZonedInstant(wall: present, in: london))
    }

    /// The offset is a function of the moment, not a property of the zone.
    func testOffsetIsReadAtTheInstantSoItChangesAcrossTheTransition() {
        let london = zone("Europe/London")
        let summer = ZonedInstant(instant: instant("2026-09-08T09:00:00Z"), zone: london)
        let winter = ZonedInstant(instant: instant("2026-12-08T09:00:00Z"), zone: london)

        XCTAssertEqual(summer.offsetSeconds, 3600)
        XCTAssertEqual(winter.offsetSeconds, 0)
    }

    // MARK: - Timezone travel

    /// Reading the same moment somewhere else moves the clock, not the moment.
    func testRezoningPreservesTheInstantAndChangesTheReading() {
        let newYork = zone("America/New_York")
        let london = zone("Europe/London")
        let meeting = ZonedInstant(instant: instant("2026-09-08T13:00:00Z"), zone: newYork)

        let read = meeting.rezoned(to: london)

        XCTAssertEqual(read.instant, meeting.instant, "the moment is the same moment")
        XCTAssertEqual(meeting.wall.hour, 9)   // 09:00 New York
        XCTAssertEqual(read.wall.hour, 14)     // 14:00 London
        XCTAssertEqual(read.originalZone.identifier, "America/New_York",
                       "provenance survives being read elsewhere")
        XCTAssertTrue(read.rehomed)
    }

    /// The other operation, which must never be confused with the first: a
    /// 09:00 that is still 09:00 after the move, and is therefore a different
    /// moment.
    func testReanchoringPreservesTheWallClockAndMovesTheInstant() {
        let newYork = zone("America/New_York")
        let london = zone("Europe/London")
        let alarm = ZonedInstant(instant: instant("2026-09-08T13:00:00Z"), zone: newYork)

        let moved = alarm.reanchored(to: london)

        XCTAssertNotNil(moved)
        XCTAssertEqual(moved?.wall.hour, 9, "still nine in the morning")
        XCTAssertEqual(moved?.instant, instant("2026-09-08T08:00:00Z"),
                       "which is five hours earlier in absolute terms")
        XCTAssertNotEqual(moved?.instant, alarm.instant)
    }

    func testReanchoringRefusesWhenTheWallReadingDoesNotExistInTheTargetZone() {
        let utc = zone("GMT")
        let london = zone("Europe/London")
        // 01:30 UTC on 29 March 2026 is 01:30 UTC; in London that reading is
        // skipped by the spring-forward.
        var components = DateComponents()
        components.year = 2026; components.month = 3; components.day = 29
        components.hour = 1; components.minute = 30
        let source = ZonedInstant(wall: components, in: utc)

        XCTAssertNotNil(source)
        XCTAssertNil(source?.reanchored(to: london))
    }

    // MARK: - All-day

    /// The structural rule: the sum type has no instant to take.
    func testAnAllDayValueHasNoMoment() {
        let span = AllDaySpan(from: CivilDay(key: "2026-09-08")!)
        let time = ZonedTime.day(span)

        XCTAssertNil(time.moment)
        XCTAssertTrue(time.isAllDay)
        XCTAssertNotNil(ZonedTime.moment(
            ZonedInstant(instant: instant("2026-09-08T09:00:00Z"), zone: zone("Europe/London"))
        ).moment)
    }

    /// Same day, different zones, genuinely different instants — which is why
    /// asking for the interval makes you name the zone.
    func testTheSameAllDayIsADifferentIntervalInEachZone() {
        let day = AllDaySpan(from: CivilDay(key: "2026-09-08")!)
        let london = day.interval(in: zone("Europe/London"))
        let newYork = day.interval(in: zone("America/New_York"))

        XCTAssertEqual(london.start, instant("2026-09-07T23:00:00Z"))
        XCTAssertEqual(newYork.start, instant("2026-09-08T04:00:00Z"))
        XCTAssertEqual(london.duration, 86_400, accuracy: 0.001)
        XCTAssertNotEqual(london.start, newYork.start)
    }

    func testAnAllDaySpanIsInclusiveOfItsLastDay() {
        let trip = AllDaySpan(from: CivilDay(key: "2026-09-07")!,
                              through: CivilDay(key: "2026-09-09")!)

        XCTAssertEqual(trip.dayCount, 3)
        XCTAssertEqual(trip.days.map(\.key), ["2026-09-07", "2026-09-08", "2026-09-09"])
        XCTAssertTrue(trip.contains(CivilDay(key: "2026-09-09")!))
        XCTAssertFalse(trip.contains(CivilDay(key: "2026-09-10")!))
    }

    func testASpanEndingBeforeItStartsIsClampedRatherThanInverted() {
        let backwards = AllDaySpan(from: CivilDay(key: "2026-09-09")!,
                                   through: CivilDay(key: "2026-09-07")!)
        XCTAssertEqual(backwards.dayCount, 1)
        XCTAssertEqual(backwards.through.key, "2026-09-09")
    }

    /// A span across a DST boundary is still whole days, so it is not a whole
    /// number of 24-hour blocks.
    func testASpanAcrossADSTBoundaryIsWholeDaysNotWholeMultiplesOfTwentyFourHours() {
        let span = AllDaySpan(from: CivilDay(key: "2026-10-24")!,
                              through: CivilDay(key: "2026-10-26")!)
        let hours = span.interval(in: zone("Europe/London")).duration / 3600

        XCTAssertEqual(span.dayCount, 3)
        XCTAssertEqual(hours, 73, accuracy: 0.001, "three days, one of which has 25 hours")
    }

    // MARK: - Codable

    func testAZonedInstantRoundTripsExactlyIncludingItsProvenance() throws {
        let original = ZonedInstant(instant: instant("2026-09-08T13:00:00Z"),
                                    zone: zone("Europe/London"),
                                    originalZone: zone("America/New_York"))

        let data = try JSONEncoder().encode(original)
        let back = try JSONDecoder().decode(ZonedInstant.self, from: data)

        XCTAssertEqual(back, original)
        XCTAssertEqual(back.originalZone.identifier, "America/New_York")

        let text = String(decoding: data, as: UTF8.self)
        XCTAssertTrue(text.contains("2026-09-08T13:00:00.000Z"), "stored as a readable UTC instant")

        // Foundation's JSONEncoder ESCAPES forward slashes, so the stored zone
        // reads `Europe\/London`. That is legal JSON and every parser accepts
        // it — but this wire format is a cross-language contract, and anything
        // that reaches for a substring instead of parsing (a grep, the
        // `--match` regex in orion-cron-deliver) will miss the unescaped
        // spelling. Pinned here so the next reader learns it from a test rather
        // than from a rule that silently never fires.
        XCTAssertTrue(text.contains(#"Europe\/London"#), "slashes are escaped on the way out")
        XCTAssertFalse(text.contains("\"Europe/London\""))
    }

    /// Sub-millisecond precision is truncated ON THE WAY IN, so a value equals
    /// itself after a round trip instead of almost equalling it.
    func testInstantsAreNormalisedToTheStoredPrecision() throws {
        let ragged = Date(timeIntervalSince1970: 1_788_000_000.123_456_7)
        let value = ZonedInstant(instant: ragged, zone: zone("GMT"))

        XCTAssertEqual(value.instant.timeIntervalSince1970, 1_788_000_000.123, accuracy: 1e-9)

        let back = try JSONDecoder().decode(
            ZonedInstant.self, from: try JSONEncoder().encode(value)
        )
        XCTAssertEqual(back, value)
        XCTAssertEqual(back.instant, value.instant)
    }

    func testDecodingRefusesAZoneThatIsNotIANA() {
        let json = #"{"utc":"2026-09-08T13:00:00.000Z","zone":"GMT+0100","originalZone":"UTC"}"#
        XCTAssertThrowsError(
            try JSONDecoder().decode(ZonedInstant.self, from: Data(json.utf8))
        ) { error in
            XCTAssertEqual(error as? ZoneError, .notAnIANAZone("GMT+0100"))
        }
    }

    func testTheSumTypeRoundTripsBothCases() throws {
        let cases: [ZonedTime] = [
            .moment(ZonedInstant(instant: instant("2026-09-08T09:00:00Z"),
                                 zone: zone("Europe/London"),
                                 originalZone: zone("America/New_York"))),
            .day(AllDaySpan(from: CivilDay(key: "2026-09-07")!,
                            through: CivilDay(key: "2026-09-09")!,
                            originalZone: zone("America/New_York")))
        ]
        for value in cases {
            let back = try JSONDecoder().decode(
                ZonedTime.self, from: try JSONEncoder().encode(value)
            )
            XCTAssertEqual(back, value)
        }
    }

    func testDecodingRefusesAnUnknownTimeKind() {
        let json = #"{"kind":"floating","moment":null}"#
        XCTAssertThrowsError(try JSONDecoder().decode(ZonedTime.self, from: Data(json.utf8)))
    }

    // MARK: - The day-key regression

    /// The defect, and the reason this file exists in the shape it does.
    ///
    /// `CutoffDayKeys` computed the day boundary in its INJECTED calendar's
    /// zone and then rendered it with a formatter that had no zone — so it
    /// rendered in the machine's. Whenever those disagreed the key named the
    /// wrong day.
    ///
    /// The sweep is what makes this test mean something on any machine. A
    /// single London-versus-New-York case would pass on a London machine for
    /// the wrong reason. Every zone this system knows about cannot agree with
    /// whatever zone the test happens to be running in, so the old
    /// implementation fails here regardless of where "here" is.
    func testTheDayKeyIsRenderedInTheCalendarsOwnZoneOnEveryZoneThisSystemKnows() {
        let probes = [
            instant("2026-09-08T03:30:00Z"),
            instant("2026-09-08T12:00:00Z"),
            instant("2026-01-15T23:45:00Z"),
            instant("2026-10-25T01:30:00Z")   // inside London's repeated hour
        ]

        var disagreedWithTheMachine = 0
        let machine = TimeZone.current

        for identifier in IANAZone.accepted.sorted() {
            guard let zone = TimeZone(identifier: identifier) else { continue }
            let keys = CutoffDayKeys(calendar: IANAZone.calendar(in: zone))

            for probe in probes {
                let expected = civilDate(of: keys.dayStart(at: probe), in: zone)
                XCTAssertEqual(keys.key(at: probe), expected,
                               "\(identifier) at \(probe): the key must name the day in the "
                               + "calendar's own zone, not the machine's")

                if civilDate(of: keys.dayStart(at: probe), in: machine) != expected {
                    disagreedWithTheMachine += 1
                }
            }
        }

        XCTAssertGreaterThan(
            disagreedWithTheMachine, 0,
            "this suite would be vacuous if no zone disagreed with the machine's — "
            + "the old implementation has to be able to fail here"
        )
    }

    /// The specific measured case, kept as a literal so the regression is
    /// legible without running the sweep.
    func testTheLondonDayKeyOnANewYorkMachineIsTheLondonDay() {
        let keys = CutoffDayKeys(calendar: IANAZone.calendar(in: zone("Europe/London")))
        // 05:30 in London on the 8th — past the 4am cutoff, so it is the 8th.
        XCTAssertEqual(keys.key(at: instant("2026-09-08T04:30:00Z")), "2026-09-08")
        // 03:30 in London on the 8th — before the cutoff, so it is still the 7th.
        XCTAssertEqual(keys.key(at: instant("2026-09-08T02:30:00Z")), "2026-09-07")
    }
}
