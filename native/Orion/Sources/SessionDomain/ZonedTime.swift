//
//  Time that survives a flight.
//
//  Phase 40's requirement is four words long — store the UTC instant, the IANA
//  zone, the original zone, and all-day semantics — and every one of them is
//  there because a local datetime string cannot answer a question it is asked
//  from somewhere else.
//
//  The rule this file exists to make structural: **an all-day event has no
//  instant.** "8 September, all day" is the same day in New York and in London,
//  and the moment you give it a Date you have silently chosen a zone on the
//  user's behalf. That choice is right until he gets on a plane, at which point
//  a day that was correct becomes a day that starts at 7pm. So `ZonedTime` is a
//  sum type with no `instant` property: a `.moment` has one, a `.day` does not,
//  and turning a `.day` into an interval requires naming the zone out loud.
//
//  Why BOTH `zone` and `originalZone` are stored, since one looks redundant:
//
//    · `zone` is what the event is anchored to. A 09:00 lecture in London is at
//      09:00 London whether Nick is in London, in New York, or on the plane. It
//      is the zone whose wall clock owns the appointment.
//    · `originalZone` is where it was written down. It is provenance, not
//      behaviour, and it is what makes a re-homing reversible and auditable —
//      "this was created while the machine thought it was in New York" is the
//      difference between a deliberate 09:00 London and a 09:00 that used to
//      mean something else.
//
//  Discarding the second is what makes a timezone migration unreviewable: every
//  value looks native to wherever you are now, so a mis-shifted event and a
//  correct one are indistinguishable after the fact.
//
//  Nothing here reads the clock or the machine's zone. That is the whole point:
//  DST, travel and a dragged system clock are the cases that have to work, and
//  a type that consults `TimeZone.current` cannot be tested against any of them.
//  See `TimeZonePolicy` for the part that does know where the machine thinks it
//  is, kept separate for exactly this reason.
//

import Foundation

// MARK: - Zones

public enum ZoneError: Error, Equatable, CustomStringConvertible {
    /// Resolvable by Foundation, but not a zone with rules — `GMT+0500`,
    /// `EST`, `Zulu`. These carry a fixed offset and no DST history, so they
    /// are a local datetime string wearing a hat.
    case notAnIANAZone(String)

    public var description: String {
        switch self {
        case .notAnIANAZone(let identifier):
            return "\"\(identifier)\" is not an IANA zone name (expected something like Europe/London)"
        }
    }
}

/// The zone names this project is willing to store.
///
/// `TimeZone(identifier:)` accepts far more than IANA zones. `GMT+0500`
/// resolves, and so do `EST` and `Zulu` — each a FIXED OFFSET with no
/// transition rules, which is precisely the thing Phase 40 says never to rely
/// on. A value stored as `GMT+0100` is right in London in August and an hour
/// wrong in December, and nothing about it says so.
///
/// So the accepted set is exactly Foundation's own `knownTimeZoneIdentifiers`
/// — 443 names on this system — and the property that buys is worth stating:
/// **every accepted identifier round-trips through `TimeZone` byte for byte.**
/// Measured, and pinned by a test. Anything outside the set is refused rather
/// than silently canonicalised, because a quiet rewrite is the one failure a
/// stored zone must not have.
///
/// Two consequences that surprise people, both verified on this system:
///
///   · `UTC` is NOT in the list and `TimeZone(identifier: "UTC").identifier`
///     answers `"GMT"`. So `UTC` is refused and `GMT` is the spelling to use.
///     Storing `UTC` would mean reading back something you did not write.
///   · Which name of a linked pair is canonical is Foundation's choice, not the
///     obvious one. Here `Asia/Calcutta` is in the list and `Asia/Kolkata` is
///     not. A refusal names the string, so this is diagnosable in one line
///     rather than being a mysterious hour.
public enum IANAZone {

    /// Zones with real transition rules, exactly as Foundation spells them.
    public static let accepted: Set<String> = Set(TimeZone.knownTimeZoneIdentifiers)

    /// The zone the wire format is written in. `GMT`, not `UTC`, for the reason
    /// above — they are the same offset and only one of them round-trips.
    public static let utc = TimeZone(identifier: "GMT")!

    public static func isAccepted(_ identifier: String) -> Bool {
        accepted.contains(identifier)
    }

    public static func resolve(_ identifier: String) throws -> TimeZone {
        guard isAccepted(identifier), let zone = TimeZone(identifier: identifier) else {
            throw ZoneError.notAnIANAZone(identifier)
        }
        return zone
    }

    /// A Gregorian calendar in `zone`, with a fixed POSIX locale.
    ///
    /// The locale is pinned because a user's regional settings can change what
    /// a week starts on, and a day key that moves with System Settings is not a
    /// key. Every civil-date computation in this file goes through here so
    /// there is one place where that is true.
    public static func calendar(in zone: TimeZone) -> Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = zone
        calendar.locale = Locale(identifier: "en_US_POSIX")
        return calendar
    }
}

// MARK: - A civil day

/// A date on a wall calendar, with no instant attached.
///
/// This is what an all-day event actually is, and what a day key actually is.
/// It is deliberately not a `Date`: a `Date` is an instant, and the whole class
/// of bugs this file addresses comes from storing a civil date as the instant
/// it happened to correspond to in whichever zone the machine was in.
public struct CivilDay: Equatable, Hashable, Codable, Sendable, Comparable, CustomStringConvertible {

    public let year: Int
    public let month: Int
    public let day: Int

    public init?(year: Int, month: Int, day: Int) {
        guard (1...12).contains(month), day >= 1 else { return nil }
        // Validated against a real calendar rather than a 28/30/31 table, so
        // leap years are the calendar's problem and not this file's.
        //
        // Read BACK, though, because `Calendar.date(from:)` is lenient: 29
        // February 2026 does not fail, it rolls forward to 1 March. Asking the
        // resulting date for its month's day-range then asks MARCH whether it
        // has a 29th, which it does — so the obvious check accepts every
        // invalid date it was written to reject. Comparing the components the
        // calendar gives back is the only version that refuses.
        var components = DateComponents()
        components.year = year
        components.month = month
        components.day = day
        components.hour = 12
        let calendar = IANAZone.calendar(in: IANAZone.utc)
        guard let date = calendar.date(from: components) else { return nil }
        let readBack = calendar.dateComponents([.year, .month, .day], from: date)
        guard readBack.year == year, readBack.month == month, readBack.day == day else {
            return nil
        }
        self.year = year
        self.month = month
        self.day = day
    }

    /// Strict `yyyy-MM-dd`. Rejects anything else, including a valid date with
    /// trailing text — `$`-style leniency is how `2026-09-08T00:00:00Z` gets
    /// parsed as a day and loses its time.
    public init?(key: String) {
        let parts = key.split(separator: "-", omittingEmptySubsequences: false)
        guard parts.count == 3,
              parts[0].count == 4, parts[1].count == 2, parts[2].count == 2,
              parts.allSatisfy({ $0.allSatisfy(\.isASCII) && $0.allSatisfy(\.isNumber) }),
              let year = Int(parts[0]), let month = Int(parts[1]), let day = Int(parts[2]) else {
            return nil
        }
        self.init(year: year, month: month, day: day)
    }

    /// The civil day `instant` falls on, read in `zone`.
    ///
    /// Naming the zone is mandatory. That is the enforcement: there is no
    /// overload that quietly uses the machine's.
    public init(of instant: Date, in zone: TimeZone) {
        let components = IANAZone.calendar(in: zone)
            .dateComponents([.year, .month, .day], from: instant)
        year = components.year ?? 1970
        month = components.month ?? 1
        day = components.day ?? 1
    }

    /// `yyyy-MM-dd`, built by hand rather than by `DateFormatter`.
    ///
    /// A formatter renders an *instant* in *its own* zone, which is the exact
    /// defect this type exists to remove — see `CutoffDayKeys`, where a
    /// formatter with no zone rendered a day boundary computed in another one.
    /// There is no instant here to get wrong.
    public var key: String {
        String(format: "%04d-%02d-%02d", year, month, day)
    }

    public var description: String { key }

    // MARK: Turning a day into time, which requires a zone

    /// Midnight, or whatever the zone uses instead.
    ///
    /// `startOfDay` rather than constructing 00:00, because in some zones
    /// midnight does not exist on a spring-forward date and constructing it
    /// gives you either the previous day or nothing.
    public func start(in zone: TimeZone) -> Date {
        let calendar = IANAZone.calendar(in: zone)
        var components = DateComponents()
        components.year = year
        components.month = month
        components.day = day
        components.hour = 12                    // midday, then walk back
        guard let midday = calendar.date(from: components) else {
            return Date(timeIntervalSince1970: 0)
        }
        return calendar.startOfDay(for: midday)
    }

    /// The half-open interval `[start, nextDayStart)`.
    ///
    /// Derived from the NEXT day's start rather than by adding 86,400 seconds,
    /// because a DST day is 23 or 25 hours long and the fixed number is wrong
    /// twice a year in every zone that observes it.
    public func interval(in zone: TimeZone) -> DateInterval {
        let from = start(in: zone)
        let to = advanced(by: 1).start(in: zone)
        return DateInterval(start: from, end: max(to, from))
    }

    /// How many hours this day actually has in `zone`. 23 or 25 on a
    /// transition, 24 otherwise.
    public func hours(in zone: TimeZone) -> Double {
        interval(in: zone).duration / 3600
    }

    public func advanced(by days: Int) -> CivilDay {
        let calendar = IANAZone.calendar(in: IANAZone.utc)
        var components = DateComponents()
        components.year = year
        components.month = month
        components.day = day
        components.hour = 12
        guard let noon = calendar.date(from: components),
              let moved = calendar.date(byAdding: .day, value: days, to: noon) else {
            return self
        }
        return CivilDay(of: moved, in: IANAZone.utc)
    }

    public static func < (lhs: CivilDay, rhs: CivilDay) -> Bool {
        (lhs.year, lhs.month, lhs.day) < (rhs.year, rhs.month, rhs.day)
    }

    // MARK: Codable — a bare `yyyy-MM-dd` string, not a three-field object

    public init(from decoder: Decoder) throws {
        let key = try decoder.singleValueContainer().decode(String.self)
        guard let parsed = CivilDay(key: key) else {
            throw DecodingError.dataCorrupted(.init(
                codingPath: decoder.codingPath,
                debugDescription: "\"\(key)\" is not a yyyy-MM-dd civil day"
            ))
        }
        self = parsed
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(key)
    }
}

// MARK: - A moment

/// A UTC instant, the zone it is anchored to, and the zone it was written in.
///
/// The instant is normalised to whole milliseconds at construction. That is not
/// arbitrary: the stored form is an ISO-8601 string with milliseconds, and a
/// value whose in-memory precision exceeds its stored precision stops equalling
/// itself after a round trip. Truncating on the way in makes the type honest
/// about what it can actually keep.
public struct ZonedInstant: Equatable, Hashable, Sendable {

    /// The only absolute thing here. Everything else is a way of reading it.
    public let instant: Date

    /// The zone whose wall clock this is anchored to.
    public let zone: TimeZone

    /// The zone it was created in. Provenance; never used to compute anything.
    public let originalZone: TimeZone

    public init(instant: Date, zone: TimeZone, originalZone: TimeZone? = nil) {
        self.instant = Self.toMilliseconds(instant)
        self.zone = zone
        self.originalZone = originalZone ?? zone
    }

    /// Build from a wall-clock reading in a named zone.
    ///
    /// Returns nil when those components do not name a real instant — 02:30 on
    /// a spring-forward morning does not exist, and inventing one by rounding
    /// is how an alarm ends up an hour out.
    public init?(wall components: DateComponents, in zone: TimeZone, originalZone: TimeZone? = nil) {
        var strict = IANAZone.calendar(in: zone)
        // The default resolution strategy nudges a nonexistent time forward.
        // We want to know instead.
        strict.timeZone = zone
        guard let date = strict.date(from: components) else { return nil }
        let readBack = strict.dateComponents([.year, .month, .day, .hour, .minute], from: date)
        guard readBack.year == components.year,
              readBack.month == components.month,
              readBack.day == components.day,
              readBack.hour == (components.hour ?? readBack.hour),
              readBack.minute == (components.minute ?? readBack.minute) else {
            return nil
        }
        self.init(instant: date, zone: zone, originalZone: originalZone)
    }

    private static func toMilliseconds(_ date: Date) -> Date {
        Date(timeIntervalSince1970: (date.timeIntervalSince1970 * 1000).rounded() / 1000)
    }

    // MARK: Reading it

    public var civilDay: CivilDay { CivilDay(of: instant, in: zone) }

    public func civilDay(in other: TimeZone) -> CivilDay { CivilDay(of: instant, in: other) }

    /// Wall-clock fields in the anchoring zone.
    public var wall: DateComponents {
        IANAZone.calendar(in: zone)
            .dateComponents([.year, .month, .day, .hour, .minute, .second], from: instant)
    }

    /// Offset from UTC AT THIS INSTANT, which is what makes it right across a
    /// DST boundary — a zone's offset is a function of the moment, not a
    /// constant.
    public var offsetSeconds: Int { zone.secondsFromGMT(for: instant) }

    /// True when the anchoring zone is no longer the one it was written in.
    public var rehomed: Bool { zone.identifier != originalZone.identifier }

    // MARK: Changing it

    /// Read the same moment in a different zone.
    ///
    /// The instant does not move — that is the definition. `originalZone` is
    /// carried through unchanged, so a value can be re-read any number of times
    /// and still say where it came from.
    public func rezoned(to newZone: TimeZone) -> ZonedInstant {
        ZonedInstant(instant: instant, zone: newZone, originalZone: originalZone)
    }

    /// Keep the WALL TIME and change the zone — a 09:00 meeting that moves from
    /// New York to London and is still at 09:00.
    ///
    /// The opposite of `rezoned`, and the reason both exist with names that
    /// cannot be confused: one preserves the moment, the other preserves the
    /// clock reading, and picking the wrong one silently shifts an appointment
    /// by the offset between the zones. Returns nil when the wall reading does
    /// not exist in the target zone.
    public func reanchored(to newZone: TimeZone) -> ZonedInstant? {
        ZonedInstant(wall: wall, in: newZone, originalZone: originalZone)
    }
}

// MARK: Codable

extension ZonedInstant: Codable {

    private enum CodingKeys: String, CodingKey {
        case utc, zone, originalZone
    }

    /// ISO-8601 with milliseconds, always `Z`.
    ///
    /// Readable by the node scripts that share this data, which is the reason
    /// it is a string rather than an epoch double — the wire format here is a
    /// cross-language contract and a human has to be able to read a ledger row.
    static let wireFormatter: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        formatter.timeZone = IANAZone.utc
        return formatter
    }()

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let raw = try container.decode(String.self, forKey: .utc)
        guard let instant = Self.wireFormatter.date(from: raw) else {
            throw DecodingError.dataCorrupted(.init(
                codingPath: container.codingPath + [CodingKeys.utc],
                debugDescription: "\"\(raw)\" is not an ISO-8601 UTC instant"
            ))
        }
        let zone = try IANAZone.resolve(container.decode(String.self, forKey: .zone))
        let original = try IANAZone.resolve(container.decode(String.self, forKey: .originalZone))
        self.init(instant: instant, zone: zone, originalZone: original)
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(Self.wireFormatter.string(from: instant), forKey: .utc)
        try container.encode(zone.identifier, forKey: .zone)
        try container.encode(originalZone.identifier, forKey: .originalZone)
    }
}

// MARK: - All-day

/// One or more whole civil days, with no instant anywhere in it.
///
/// `through` is INCLUSIVE — the last day of the span, not the exclusive end.
/// EventKit and Google disagree about this and both spellings look reasonable,
/// so it is stated in the name of the initialiser argument rather than left to
/// whoever reads the struct next. Off-by-one on a multi-day span is the single
/// most common all-day defect there is.
public struct AllDaySpan: Equatable, Hashable, Codable, Sendable {

    public let from: CivilDay
    public let through: CivilDay

    /// Where it was written down. Provenance only — an all-day span is
    /// floating, and this must never be used to give it an instant.
    public let originalZone: TimeZone?

    public init(from: CivilDay, through: CivilDay? = nil, originalZone: TimeZone? = nil) {
        self.from = from
        let last = through ?? from
        self.through = max(last, from)
        self.originalZone = originalZone
    }

    public var dayCount: Int {
        var count = 1
        var cursor = from
        while cursor < through {
            cursor = cursor.advanced(by: 1)
            count += 1
        }
        return count
    }

    public var days: [CivilDay] {
        var result: [CivilDay] = [from]
        var cursor = from
        while cursor < through {
            cursor = cursor.advanced(by: 1)
            result.append(cursor)
        }
        return result
    }

    public func contains(_ day: CivilDay) -> Bool { day >= from && day <= through }

    /// The instants this span covers, in a zone you have to name.
    ///
    /// This is the only way an all-day value becomes time, and it takes the
    /// zone as an argument precisely so that the choice appears at the call
    /// site and can be reviewed.
    public func interval(in zone: TimeZone) -> DateInterval {
        DateInterval(start: from.interval(in: zone).start,
                     end: through.interval(in: zone).end)
    }

    private enum CodingKeys: String, CodingKey { case from, through, originalZone }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let start = try container.decode(CivilDay.self, forKey: .from)
        let end = try container.decode(CivilDay.self, forKey: .through)
        let zoneName = try container.decodeIfPresent(String.self, forKey: .originalZone)
        self.init(from: start, through: end,
                  originalZone: try zoneName.map(IANAZone.resolve))
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(from, forKey: .from)
        try container.encode(through, forKey: .through)
        try container.encodeIfPresent(originalZone?.identifier, forKey: .originalZone)
    }
}

// MARK: - The sum

/// Either a moment or some whole days. There is no third thing, and there is
/// deliberately no `instant` property on the sum: reaching the time inside a
/// `.day` means calling `interval(in:)` and naming a zone.
public enum ZonedTime: Equatable, Hashable, Sendable {
    case moment(ZonedInstant)
    case day(AllDaySpan)

    public var isAllDay: Bool {
        if case .day = self { return true }
        return false
    }

    /// The moment, when there is one. Nil for all-day, by design — a caller
    /// that needs an instant from a day has to say in which zone.
    public var moment: ZonedInstant? {
        if case .moment(let value) = self { return value }
        return nil
    }

    public func interval(in zone: TimeZone) -> DateInterval {
        switch self {
        case .moment(let value):
            return DateInterval(start: value.instant, duration: 0)
        case .day(let span):
            return span.interval(in: zone)
        }
    }

    /// The civil day(s) this covers when read in `zone`.
    public func civilDays(in zone: TimeZone) -> [CivilDay] {
        switch self {
        case .moment(let value): return [value.civilDay(in: zone)]
        case .day(let span): return span.days
        }
    }
}

extension ZonedTime: Codable {

    private enum CodingKeys: String, CodingKey { case kind, moment, day }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        switch try container.decode(String.self, forKey: .kind) {
        case "moment":
            self = .moment(try container.decode(ZonedInstant.self, forKey: .moment))
        case "day":
            self = .day(try container.decode(AllDaySpan.self, forKey: .day))
        case let other:
            throw DecodingError.dataCorrupted(.init(
                codingPath: container.codingPath + [CodingKeys.kind],
                debugDescription: "unknown time kind \"\(other)\" (expected moment or day)"
            ))
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .moment(let value):
            try container.encode("moment", forKey: .kind)
            try container.encode(value, forKey: .moment)
        case .day(let span):
            try container.encode("day", forKey: .kind)
            try container.encode(span, forKey: .day)
        }
    }
}
