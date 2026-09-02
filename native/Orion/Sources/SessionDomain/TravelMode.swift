//
//  Travel Mode — Phase 40's last named deliverable.
//
//  The manifest says "Create Travel Mode later", so this is the smallest thing
//  that is genuinely useful and genuinely extensible, rather than a guess at a
//  feature nobody has specified.
//
//  ## What it is
//
//  A READING layer. It never changes stored data and never re-homes anything —
//  `scripts/orion-timezone` is the only thing allowed to do that, deliberately,
//  because re-homing touches live cron jobs. Travel Mode answers "what time is
//  it there, and what does this event mean where I am standing", and stops.
//
//  That division is what makes it safe to switch on automatically the moment
//  the device zone and the home zone disagree: showing two clocks cannot break
//  anything, and moving a cron job can.
//
//  ## Journeys, and the flight question
//
//  A flight looked like it needed a new primitive — one event anchored to two
//  zones. It does not, and working out why is worth writing down.
//
//  EventKit stores a flight as two INSTANTS. Those instants are already correct
//  everywhere: a New York to London flight departing 18:00 and arriving 06:00
//  is one departure moment and one arrival moment, and rendering both in
//  whichever zone you are standing in gives the right answer at both ends. The
//  only thing that is odd is the wall clock mid-air, which is a display nicety
//  and not a correctness problem.
//
//  So a `Journey` is two `ZonedInstant`s that happen to carry different zones —
//  the existing type, used twice. What it adds is that each end is READ in its
//  own zone, so "18:00 New York → 06:00 London" appears as written rather than
//  as "23:00 → 06:00" with one end silently translated.
//
//  Duration is computed from the INSTANTS. Subtracting wall clocks gives twelve
//  hours for a seven-hour flight, and that is the actual bug in this area.
//

import Foundation

// MARK: - Reading a clock somewhere else

/// One zone's answer to "what time is it".
public struct ZoneReading: Equatable, Sendable {
    public let zone: TimeZone
    /// The civil day there, which is frequently not the civil day here.
    public let day: CivilDay
    public let hour: Int
    public let minute: Int
    /// Offset from the reader's own zone, in minutes. Negative means behind.
    public let offsetMinutes: Int

    public var clock: String { String(format: "%02d:%02d", hour, minute) }
}

// MARK: - A journey

/// Something that starts in one zone and ends in another.
///
/// Deliberately built from two `ZonedInstant`s rather than from a new two-zone
/// type. The instants are absolute and already correct; what a journey adds is
/// that each end is read in the zone it belongs to.
public struct Journey: Equatable, Sendable {
    public let title: String
    public let departure: ZonedInstant
    public let arrival: ZonedInstant

    public init?(title: String, departure: ZonedInstant, arrival: ZonedInstant) {
        let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        // Arriving before you left is a data error, not a timezone subtlety —
        // and it is exactly what a wall-clock comparison would produce for a
        // westbound flight, so refusing it here catches that mistake upstream.
        guard arrival.instant >= departure.instant else { return nil }
        self.title = trimmed
        self.departure = departure
        self.arrival = arrival
    }

    /// How long it actually takes.
    ///
    /// From the instants. Subtracting wall clocks makes a seven-hour flight
    /// look like twelve, and makes a westbound one look negative.
    public var duration: TimeInterval {
        arrival.instant.timeIntervalSince(departure.instant)
    }

    /// True when the journey crosses zones at all.
    public var crossesZones: Bool {
        departure.zone.identifier != arrival.zone.identifier
    }

    /// How many hours the clock jumps on landing. Positive going east.
    public var clockShiftHours: Double {
        let atArrival = Double(arrival.zone.secondsFromGMT(for: arrival.instant)
                               - departure.zone.secondsFromGMT(for: arrival.instant))
        return atArrival / 3600
    }

    /// "18:00 New York → 06:00 London", each end in its own zone.
    public func label(_ formatter: (ZonedInstant) -> String) -> String {
        "\(formatter(departure)) → \(formatter(arrival))"
    }
}

// MARK: - Travel Mode

/// On when the device is somewhere the schedule is not.
public struct TravelMode: Equatable, Sendable {

    public let home: TimeZone
    public let device: TimeZone

    public init(home: TimeZone, device: TimeZone) {
        self.home = home
        self.device = device
    }

    /// Built from the policy so there is one definition of "home" in the app.
    public init(policy: TimeZonePolicy, device: TimeZone) {
        self.init(home: policy.home, device: device)
    }

    /// Travel Mode is on precisely when the two disagree.
    ///
    /// Note this is TRUE during a trip as well as after a move — deliberately.
    /// Deciding which of those it is needs a fact only Nick has, which is
    /// `TimeZonePolicy`'s job; showing a second clock is useful either way and
    /// cannot be wrong.
    public var isActive: Bool { home.identifier != device.identifier }

    /// Both clocks, device first, at an instant.
    ///
    /// Returns one reading when they are the same zone rather than two
    /// identical ones — a duplicated clock reads as a bug.
    public func clocks(at instant: Date) -> [ZoneReading] {
        guard isActive else { return [reading(device, at: instant)] }
        return [reading(device, at: instant), reading(home, at: instant)]
    }

    func reading(_ zone: TimeZone, at instant: Date) -> ZoneReading {
        let components = IANAZone.calendar(in: zone)
            .dateComponents([.hour, .minute], from: instant)
        let offset = (zone.secondsFromGMT(for: instant)
                      - device.secondsFromGMT(for: instant)) / 60
        return ZoneReading(
            zone: zone,
            day: CivilDay(of: instant, in: zone),
            hour: components.hour ?? 0,
            minute: components.minute ?? 0,
            offsetMinutes: offset)
    }

    /// Whether an instant lands at an hour where a person at home would be
    /// asleep.
    ///
    /// The case this exists for: Nick in London, a standing call anchored to
    /// New York. It is 09:00 there and 14:00 here, which is fine — but the
    /// reverse, an 18:00 New York call, is 23:00 in London. Something should
    /// say so before he books it.
    public func isUnsociable(at instant: Date, in zone: TimeZone) -> Bool {
        let hour = IANAZone.calendar(in: zone)
            .dateComponents([.hour], from: instant).hour ?? 12
        return hour < TravelMode.sociableFrom || hour >= TravelMode.sociableUntil
    }

    /// Matching `orion-standing`'s quiet hours, because two definitions of
    /// "too late to bother someone" is how they drift apart.
    public static let sociableFrom = 8
    public static let sociableUntil = 23

    /// How far the device is from home right now, in hours. Zero when settled.
    public func displacementHours(at instant: Date) -> Double {
        Double(device.secondsFromGMT(for: instant) - home.secondsFromGMT(for: instant)) / 3600
    }
}
