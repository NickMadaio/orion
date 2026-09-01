//
//  Where Orion thinks it is, versus where the machine thinks it is.
//
//  `ZonedTime` deliberately never asks the machine anything. This is the file
//  that does — or rather, the file that decides what to do once someone else
//  has asked. It is still pure: the device zone arrives as a value.
//
//  The problem it exists for, stated concretely, because it is live:
//
//    Nick's three cron jobs are pinned `America/New_York`. macOS auto-timezone
//    is on, so the moment he lands in London the MACHINE moves and the SCHEDULE
//    does not. Everything that reads the wall clock silently follows him;
//    everything that was pinned silently does not. The nightly memory rollup at
//    02:10 New York becomes 07:10 London, and no part of the system notices,
//    because each half is individually behaving exactly as written.
//
//  So the detection cannot be "has the machine's zone changed". It has to be
//  "does the machine's zone still agree with what Orion schedules against",
//  which is a question about two values rather than about an event, and is
//  therefore answerable at any time and after any number of restarts.
//
//  ## Why a trip and a move are different, and why the machine cannot tell
//
//  A zone mismatch means one of two things and they want opposite handling:
//
//    · A TRIP. Home is unchanged. The 08:00 brief should keep meaning 08:00 at
//      home, or the user gets woken at 3am in a hotel — and re-homing the cron
//      jobs for a four-day conference would be actively wrong.
//    · A MOVE. Home has changed, and everything pinned has to follow.
//
//  Nothing observable distinguishes them. A week in London and moving to London
//  look identical to the operating system on day one. What DOES distinguish
//  them is something only the user knows, so this type takes it as input: an
//  `ExpectedMove` — a destination and a date, recorded in advance. When the
//  device lands on the recorded destination on or after the recorded date, the
//  mismatch is a move; otherwise it is a trip and stays one.
//
//  That is why `ExpectedMove` is a stored fact rather than an inference. Nick
//  told Orion on 2026-07-31 that he was moving to London, and `USER.md` even
//  said to ask once afterwards. Nothing was holding the deadline, so nothing
//  asked. A date in a sentence is not a mechanism.
//
//  ## What this deliberately does NOT do
//
//  It does not re-home anything. It returns a verdict; `scripts/orion-timezone`
//  performs the change, because re-homing touches live cron jobs and a live
//  user-facing file and that belongs behind a reviewable command rather than
//  inside a value type. A policy that acts on its own conclusion is a policy
//  nobody can dry-run.
//

import Foundation

// MARK: - The recorded move

/// A move the user has told Orion about in advance.
///
/// `on` is the day the destination becomes home — the day he lands, not the
/// day he leaves. Between departure and arrival he is in transit and the old
/// home is still the right answer for anything scheduled.
public struct ExpectedMove: Equatable, Hashable, Codable, Sendable {

    public let destination: TimeZone
    public let on: CivilDay

    /// What to call the place, for anything that needs a location rather than
    /// a zone — weather being the one that exists today. A zone is not a place:
    /// `Europe/London` is not a string a geocoder should be handed.
    public let place: String?

    public init(destination: TimeZone, on: CivilDay, place: String? = nil) {
        self.destination = destination
        self.on = on
        self.place = place
    }

    private enum CodingKeys: String, CodingKey { case destination, on, place }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        destination = try IANAZone.resolve(container.decode(String.self, forKey: .destination))
        on = try container.decode(CivilDay.self, forKey: .on)
        place = try container.decodeIfPresent(String.self, forKey: .place)
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(destination.identifier, forKey: .destination)
        try container.encode(on, forKey: .on)
        try container.encodeIfPresent(place, forKey: .place)
    }
}

// MARK: - The verdict

public enum ZoneVerdict: Equatable, Sendable {

    /// The machine and the schedule agree. The normal case, and the only one
    /// that should ever be silent.
    case settled(zone: TimeZone)

    /// The machine has moved somewhere Orion was not expecting. Home stands.
    case travelling(home: TimeZone, device: TimeZone)

    /// A move was recorded, its day has come, and the machine is where it was
    /// told the machine would be. This is the one that warrants re-homing.
    case moveArrived(from: TimeZone, to: TimeZone, place: String?)

    /// A move was recorded and its day has come or passed, but the machine is
    /// still at home — he has not left yet, or the flight moved.
    ///
    /// Distinct from `settled` on purpose: nothing is wrong with the machine,
    /// but a recorded expectation has expired and something should say so
    /// rather than let the date slide the way 2026-07-31's did.
    case moveDue(to: TimeZone, on: CivilDay, daysLate: Int)

    /// A move was recorded and has not come round yet.
    case moveScheduled(to: TimeZone, on: CivilDay, daysAway: Int)

    /// Whether this is worth interrupting the user about.
    ///
    /// `settled` and `moveScheduled` are not. Everything else is a state where
    /// what Orion does and what the user experiences have come apart.
    public var warrantsAttention: Bool {
        switch self {
        case .settled, .moveScheduled: return false
        case .travelling, .moveArrived, .moveDue: return true
        }
    }
}

// MARK: - The policy

/// Home, the recorded move, and the rule that compares them to the device.
public struct TimeZonePolicy: Equatable, Sendable {

    /// The zone Orion schedules against. Cron pins, the day cutoff and the
    /// morning brief all mean this one, not the device's.
    public let home: TimeZone

    /// The place name that goes with `home`, for weather and anything else
    /// that needs somewhere rather than a zone.
    public let place: String?

    public let expectedMove: ExpectedMove?

    public init(home: TimeZone, place: String? = nil, expectedMove: ExpectedMove? = nil) {
        self.home = home
        self.place = place
        self.expectedMove = expectedMove
    }

    /// Compare home against the device, as of an instant.
    ///
    /// `today` is derived in the DEVICE's zone, because "has the move day come"
    /// is a question about the calendar where the person is standing.
    ///
    /// Being precise about what that is worth, because it is easy to overclaim
    /// and a mutation test caught exactly that here: **every branch that reads
    /// `today` is a branch where the device IS home**, so today the two
    /// readings are the same and swapping them changes no result. It is written
    /// in the device's zone anyway because that is the answer that stays right
    /// if a later branch consults `today` while away — not because a test
    /// currently distinguishes it. The comment that used to claim otherwise was
    /// wrong.
    public func verdict(device: TimeZone, at instant: Date) -> ZoneVerdict {
        let atHome = device.identifier == home.identifier
        let today = CivilDay(of: instant, in: device)

        guard let move = expectedMove else {
            return atHome ? .settled(zone: home) : .travelling(home: home, device: device)
        }

        let arrivedOnTime = today >= move.on
        let deviceIsDestination = device.identifier == move.destination.identifier

        // Already re-homed: the recorded move is satisfied and stale.
        if home.identifier == move.destination.identifier {
            return atHome ? .settled(zone: home) : .travelling(home: home, device: device)
        }

        // Being at the destination IS the move, whatever the date says. The day
        // was an estimate and the destination was not, so arriving early counts
        // — and the alternative, treating an early arrival as a trip, would
        // leave the cron jobs in New York through the actual arrival.
        //
        // Written as one branch rather than two. It was two, identical, which
        // is how `arrivedOnTime` came to look like it gated this case when it
        // never did.
        if deviceIsDestination {
            return .moveArrived(from: home, to: move.destination, place: move.place)
        }

        if arrivedOnTime {
            let late = TimeZonePolicy.dayGap(from: move.on, to: today)
            return atHome
                ? .moveDue(to: move.destination, on: move.on, daysLate: late)
                : .travelling(home: home, device: device)
        }

        if atHome {
            return .moveScheduled(to: move.destination, on: move.on,
                                  daysAway: TimeZonePolicy.dayGap(from: today, to: move.on))
        }
        return .travelling(home: home, device: device)
    }

    /// Whole civil days between two days, never negative.
    ///
    /// Counted by walking the calendar rather than by dividing a duration:
    /// a DST day is 23 or 25 hours and dividing by 86,400 rounds a real day
    /// away twice a year.
    static func dayGap(from: CivilDay, to: CivilDay) -> Int {
        guard from < to else { return 0 }
        var count = 0
        var cursor = from
        while cursor < to {
            cursor = cursor.advanced(by: 1)
            count += 1
        }
        return count
    }

    /// The policy after a move is accepted: home becomes the destination, the
    /// place follows it, and the expectation is cleared because it happened.
    ///
    /// Clearing matters. A satisfied expectation left in place would keep
    /// matching, and a "you have arrived" notice that repeats forever is
    /// exactly the shape of thing that gets an assistant muted.
    public func accepting(_ move: ExpectedMove) -> TimeZonePolicy {
        TimeZonePolicy(home: move.destination, place: move.place ?? place, expectedMove: nil)
    }
}

// MARK: Codable

extension TimeZonePolicy: Codable {

    private enum CodingKeys: String, CodingKey { case home, place, expectedMove }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        home = try IANAZone.resolve(container.decode(String.self, forKey: .home))
        place = try container.decodeIfPresent(String.self, forKey: .place)
        expectedMove = try container.decodeIfPresent(ExpectedMove.self, forKey: .expectedMove)
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(home.identifier, forKey: .home)
        try container.encodeIfPresent(place, forKey: .place)
        try container.encodeIfPresent(expectedMove, forKey: .expectedMove)
    }
}
