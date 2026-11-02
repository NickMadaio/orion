import Foundation

/// The sleep plan Nick set (`wake-plan.json`, written by the Mac's sleep-plan scheduler), carried to the phone in the
/// link snapshot so the phone's alarms and wind-down follow it with the Mac off (2026-11-02, W10-E).
///
/// `alarms[].date` is the day he wakes into; `bedtimes[].date` is the EVENING the night begins on, and its HH:MM may be
/// after midnight (then it falls on the next calendar day). Only a plan whose `source` is "nick" is ever acted on:
/// a plan built from defaults must never ring an alarm he did not ask for.
public struct WakePlan: Codable, Equatable, Sendable {
    public struct Alarm: Codable, Equatable, Sendable {
        public var date: String
        public var at: String
        public var iso: String?
        public var reason: String?
        /// Set by the writer only on alarms Nick asked for; an alarm without it never rings.
        public var byNick: Bool?
        public init(date: String, at: String, iso: String? = nil, reason: String? = nil, byNick: Bool? = nil) {
            self.date = date; self.at = at; self.iso = iso; self.reason = reason; self.byNick = byNick
        }
    }
    public struct Bedtime: Codable, Equatable, Sendable {
        public var date: String
        public var sleepBy: String
        public var nudgeAt: String
        public var sleepByIso: String?
        public var nudgeAtIso: String?
        public init(date: String, sleepBy: String, nudgeAt: String, sleepByIso: String? = nil, nudgeAtIso: String? = nil) {
            self.date = date; self.sleepBy = sleepBy; self.nudgeAt = nudgeAt; self.sleepByIso = sleepByIso; self.nudgeAtIso = nudgeAtIso
        }
    }

    public var source: String
    /// Kept as the writer's text: the snapshot's date decoder rejects fractional seconds.
    public var generatedAt: String?
    public var alarms: [Alarm]
    public var bedtimes: [Bedtime]

    public init(source: String, generatedAt: String? = nil, alarms: [Alarm] = [], bedtimes: [Bedtime] = []) {
        self.source = source; self.generatedAt = generatedAt; self.alarms = alarms; self.bedtimes = bedtimes
    }

    /// A plan Nick set, not one made of defaults.
    public var isNicks: Bool { source == "nick" }

    /// One alarm to ring.
    public struct Wanted: Equatable, Sendable {
        public let fireAt: Date
        public let reason: String?
        public init(fireAt: Date, reason: String?) { self.fireAt = fireAt; self.reason = reason }
    }

    public static func dayKey(_ date: Date, calendar: Calendar = .current) -> String {
        let p = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", p.year ?? 0, p.month ?? 0, p.day ?? 0)
    }

    static func clock(day: String, hhmm: String, calendar: Calendar) -> Date? {
        let d = day.split(separator: "-").compactMap { Int($0) }
        let t = hhmm.split(separator: ":").compactMap { Int($0) }
        guard d.count == 3, t.count == 2, (0..<24).contains(t[0]), (0..<60).contains(t[1]) else { return nil }
        return calendar.date(from: DateComponents(year: d[0], month: d[1], day: d[2], hour: t[0], minute: t[1]))
    }

    static func parseISO(_ text: String?) -> Date? {
        guard let text else { return nil }
        let fractional = ISO8601DateFormatter(); fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let plain = ISO8601DateFormatter(); plain.formatOptions = [.withInternetDateTime]
        return fractional.date(from: text) ?? plain.date(from: text)
    }

    /// The plan's alarms still ahead, by wake day. Empty unless Nick set the plan.
    public func alarms(after now: Date, calendar: Calendar = .current) -> [String: Wanted] {
        guard isNicks else { return [:] }
        var byDay: [String: Wanted] = [:]
        for alarm in alarms {
            guard alarm.byNick == true else { continue }
            guard let at = Self.parseISO(alarm.iso) ?? Self.clock(day: alarm.date, hhmm: alarm.at, calendar: calendar), at > now else { continue }
            byDay[alarm.date] = Wanted(fireAt: at, reason: alarm.reason)
        }
        return byDay
    }

    /// The alarm planned for a wake day, still ahead.
    public func alarm(forWakeDay day: String, after now: Date, calendar: Calendar = .current) -> Wanted? {
        alarms(after: now, calendar: calendar)[day]
    }

    /// Bedtime and wind-down moment for the night that begins on `evening` (yyyy-MM-dd). Nil unless Nick set the plan.
    public func bedtime(nightOf evening: String, calendar: Calendar = .current) -> (sleepBy: Date, nudgeAt: Date)? {
        guard isNicks, let row = bedtimes.first(where: { $0.date == evening }),
              let start = Self.clock(day: evening, hhmm: "00:00", calendar: calendar) else { return nil }
        func instant(_ iso: String?, _ hhmm: String) -> Date? {
            if let iso = Self.parseISO(iso) { return iso }
            let t = hhmm.split(separator: ":").compactMap { Int($0) }
            guard t.count == 2, (0..<24).contains(t[0]), (0..<60).contains(t[1]) else { return nil }
            // Evening times stay on `evening`; small hours belong to the next calendar day.
            guard let day = calendar.date(byAdding: .day, value: t[0] < 12 ? 1 : 0, to: start) else { return nil }
            return calendar.date(bySettingHour: t[0], minute: t[1], second: 0, of: day)
        }
        guard let bed = instant(row.sleepByIso, row.sleepBy), let nudge = instant(row.nudgeAtIso, row.nudgeAt), nudge <= bed else { return nil }
        return (bed, nudge)
    }
}

/// Which alarms the phone should have scheduled.
public enum AlarmPlanner {
    /// How many mornings ahead the phone holds alarms for.
    public static let horizonDays = 7

    /// Tonight's computed wake (which already carries a wake request and a late-night shift), the request itself, and
    /// every upcoming entry of a plan Nick set: one alarm per wake day. The request wins for its own day, tonight's
    /// computed wake for its own day, then the plan. Never a plan from defaults. The caller only passes `tonight` when his
    /// own Wake alarm setting is on, so tonight's wake is his choice, as it was before the sleep plan existed.
    public static func wanted(tonight: Date?, wakeRequest: Date?, plan: WakePlan?, now: Date,
                              calendar: Calendar = .current) -> [WakePlan.Wanted] {
        var byDay = plan?.alarms(after: now, calendar: calendar) ?? [:]
        if let tonight, tonight > now {
            let day = WakePlan.dayKey(tonight, calendar: calendar)
            byDay[day] = WakePlan.Wanted(fireAt: tonight, reason: byDay[day]?.reason)
        }
        if let request = wakeRequest, request > now {
            byDay[WakePlan.dayKey(request, calendar: calendar)] = WakePlan.Wanted(fireAt: request, reason: nil)
        }
        let limit = calendar.date(byAdding: .day, value: horizonDays + 1, to: calendar.startOfDay(for: now)) ?? now.addingTimeInterval(8 * 86_400)
        return byDay.values.filter { $0.fireAt < limit }.sorted { $0.fireAt < $1.fireAt }
    }
}
