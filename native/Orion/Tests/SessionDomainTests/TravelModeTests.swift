//
//  Travel Mode, and the flight arithmetic that is the actual bug in this area.
//

import XCTest
@testable import SessionDomain

final class TravelModeTests: XCTestCase {

    private let newYork = TimeZone(identifier: "America/New_York")!
    private let london = TimeZone(identifier: "Europe/London")!
    private let tokyo = TimeZone(identifier: "Asia/Tokyo")!

    private func instant(_ iso: String) -> Date {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        guard let date = formatter.date(from: iso) else { fatalError("bad fixture \(iso)") }
        return date
    }

    // MARK: - When it is on

    func testTravelModeIsOffAtHomeAndOnAwayFromIt() {
        XCTAssertFalse(TravelMode(home: newYork, device: newYork).isActive)
        XCTAssertTrue(TravelMode(home: newYork, device: london).isActive)
    }

    func testAtHomeThereIsOneClockRatherThanTwoIdenticalOnes() {
        let settled = TravelMode(home: newYork, device: newYork)
        XCTAssertEqual(settled.clocks(at: instant("2026-09-08T13:00:00Z")).count, 1,
                       "a duplicated clock reads as a bug")
    }

    func testAwayThereAreTwoClocksWithTheDeviceFirst() {
        let away = TravelMode(home: newYork, device: london)
        let clocks = away.clocks(at: instant("2026-09-08T13:00:00Z"))

        XCTAssertEqual(clocks.count, 2)
        XCTAssertEqual(clocks[0].zone.identifier, "Europe/London", "where you are, first")
        XCTAssertEqual(clocks[0].clock, "14:00")
        XCTAssertEqual(clocks[1].zone.identifier, "America/New_York")
        XCTAssertEqual(clocks[1].clock, "09:00")
        XCTAssertEqual(clocks[1].offsetMinutes, -300, "home is five hours behind")
    }

    /// The clocks can be on different DAYS, which is most of why two are shown.
    func testTheTwoClocksCanBeOnDifferentDays() {
        let away = TravelMode(home: newYork, device: tokyo)
        let clocks = away.clocks(at: instant("2026-09-08T02:00:00Z"))

        XCTAssertEqual(clocks[0].day.key, "2026-09-08", "the 8th in Tokyo")
        XCTAssertEqual(clocks[1].day.key, "2026-09-07", "still the 7th in New York")
    }

    func testDisplacementIsZeroAtHomeAndRealAway() {
        let moment = instant("2026-09-08T13:00:00Z")
        XCTAssertEqual(TravelMode(home: newYork, device: newYork).displacementHours(at: moment), 0)
        XCTAssertEqual(TravelMode(home: newYork, device: london).displacementHours(at: moment), 5)
    }

    /// Displacement is read AT THE INSTANT, so it survives the weeks when the
    /// two zones' DST transitions have not both happened yet.
    func testDisplacementIsReadAtTheInstantSoItSurvivesUnalignedDSTDates() {
        let travel = TravelMode(home: newYork, device: london)
        // London ends BST on 25 October; New York ends EDT on 1 November. In
        // the week between, the gap is four hours rather than the usual five.
        XCTAssertEqual(travel.displacementHours(at: instant("2026-10-20T12:00:00Z")), 5)
        XCTAssertEqual(travel.displacementHours(at: instant("2026-10-28T12:00:00Z")), 4,
                       "the week the two zones disagree about DST")
        XCTAssertEqual(travel.displacementHours(at: instant("2026-11-05T12:00:00Z")), 5)
    }

    // MARK: - Unsociable hours

    func testACallThatIsFineAtHomeCanBeLateWhereYouAre() {
        let away = TravelMode(home: newYork, device: london)
        // 18:00 New York on the 8th = 23:00 London.
        let evening = instant("2026-09-08T22:00:00Z")

        XCTAssertFalse(away.isUnsociable(at: evening, in: newYork), "six in the evening at home")
        XCTAssertTrue(away.isUnsociable(at: evening, in: london), "eleven at night where he is")
    }

    func testMiddayIsSociableEverywhere() {
        let away = TravelMode(home: newYork, device: london)
        let midday = instant("2026-09-08T13:00:00Z")
        XCTAssertFalse(away.isUnsociable(at: midday, in: newYork))
        XCTAssertFalse(away.isUnsociable(at: midday, in: london))
    }

    // MARK: - Journeys

    private var theMove: Journey {
        // Departs 18:00 New York on the 7th, lands 06:00 London on the 8th.
        Journey(
            title: "Flight to London",
            departure: ZonedInstant(instant: instant("2026-09-07T22:00:00Z"), zone: newYork),
            arrival: ZonedInstant(instant: instant("2026-09-08T05:00:00Z"), zone: london))!
    }

    /// THE assertion in this file. Wall clocks say 18:00 to 06:00, which is
    /// twelve hours. It is seven.
    func testDurationComesFromTheInstantsNotTheWallClocks() {
        XCTAssertEqual(theMove.duration / 3600, 7, accuracy: 0.001)

        let departureHour = theMove.departure.wall.hour ?? -1
        let arrivalHour = theMove.arrival.wall.hour ?? -1
        XCTAssertEqual(departureHour, 18, "18:00 in New York")
        XCTAssertEqual(arrivalHour, 6, "06:00 in London")
        // The naive subtraction, spelled out so nobody reintroduces it.
        XCTAssertEqual((arrivalHour + 24 - departureHour) % 24, 12,
                       "the wall clocks say twelve, and that is the mistake")
    }

    func testEachEndReadsInItsOwnZone() {
        XCTAssertEqual(theMove.departure.civilDay.key, "2026-09-07")
        XCTAssertEqual(theMove.arrival.civilDay.key, "2026-09-08")
        XCTAssertTrue(theMove.crossesZones)
        XCTAssertEqual(theMove.clockShiftHours, 5, accuracy: 0.001, "five hours forward")
    }

    /// Westbound: the clock goes backwards and the duration does not.
    func testAWestboundJourneyHasAPositiveDurationAndANegativeShift() {
        let home = Journey(
            title: "Flight home",
            departure: ZonedInstant(instant: instant("2026-12-20T10:00:00Z"), zone: london),
            arrival: ZonedInstant(instant: instant("2026-12-20T18:00:00Z"), zone: newYork))!

        XCTAssertEqual(home.duration / 3600, 8, accuracy: 0.001)
        XCTAssertEqual(home.clockShiftHours, -5, accuracy: 0.001)
        XCTAssertEqual(home.departure.wall.hour, 10)
        XCTAssertEqual(home.arrival.wall.hour, 13, "lands at one in the afternoon, same day")
    }

    /// Arriving before departing is a data error — and it is exactly what a
    /// wall-clock comparison produces for a westbound flight.
    func testAJourneyThatArrivesBeforeItLeavesIsRefused() {
        XCTAssertNil(Journey(
            title: "Impossible",
            departure: ZonedInstant(instant: instant("2026-09-08T12:00:00Z"), zone: newYork),
            arrival: ZonedInstant(instant: instant("2026-09-08T11:00:00Z"), zone: london)))
    }

    func testAJourneyNeedsAName() {
        XCTAssertNil(Journey(
            title: "  ",
            departure: ZonedInstant(instant: instant("2026-09-07T22:00:00Z"), zone: newYork),
            arrival: ZonedInstant(instant: instant("2026-09-08T05:00:00Z"), zone: london)))
    }

    func testAJourneyThatDoesNotCrossZonesIsStillAJourney() {
        let train = Journey(
            title: "Train to Manchester",
            departure: ZonedInstant(instant: instant("2026-10-02T08:00:00Z"), zone: london),
            arrival: ZonedInstant(instant: instant("2026-10-02T10:00:00Z"), zone: london))!
        XCTAssertFalse(train.crossesZones)
        XCTAssertEqual(train.clockShiftHours, 0)
        XCTAssertEqual(train.duration / 3600, 2, accuracy: 0.001)
    }

    // MARK: - Built from the policy

    func testTravelModeAgreesWithTheTimeZonePolicyAboutHome() {
        let policy = TimeZonePolicy(home: newYork, place: "Montvale, New Jersey")
        XCTAssertTrue(TravelMode(policy: policy, device: london).isActive)
        XCTAssertFalse(TravelMode(policy: policy, device: newYork).isActive)
    }
}
