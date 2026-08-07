import Combine
import Foundation

/*
 What day it is, for a person rather than for a calendar.

 Midnight is the wrong boundary and the app had it in three places. Log a bottle
 of water at 1am and it counted for tomorrow; sit at the desk through midnight
 and the day's counters reset under you mid-session; and a 2am session looked
 exactly like waking up, because the date had changed. All three are the same
 mistake: treating the civil date as the day.

 A day here starts when you get up. Two sources, and the later one wins:

   • WHOOP'S WAKE TIME. The sleep record's `end` is when you actually woke, and
     it is the honest answer. Orion already fetches a week of sleep records, so
     this costs nothing extra.

   • A 4AM CUTOFF, as the floor. Whoop syncs late, and a stale wake time must
     not be able to hold yesterday open forever. Taking the later of the two
     means Whoop leads when it is fresh and the cutoff takes over when it is not.

 Taking the LATER is what makes both cases right at once:

   woke 10:00 today, now 14:00   → later of (10:00 today, 04:00 today) = 10:00 today
   woke 10:00 yesterday, now 02:00 → later of (10:00 yest, 04:00 yest)  = 10:00 yesterday
                                     ...so 2am is still yesterday. Which is the point.
   woke 10:00 yesterday, now 08:00, Whoop not synced yet
                                   → later of (10:00 yest, 04:00 today) = 04:00 today
                                     ...so a slow sync cannot swallow the morning.

 `wokeAt` stays the raw Whoop value and is reported separately, because the
 floor is a bucketing rule and should never be shown to the user as the time
 they got up.
*/

struct LogicalDay: Equatable {
    /// When this day began.
    let start: Date
    /// True when `start` came from Whoop rather than from the cutoff.
    let fromWakeTime: Bool

    /// `yyyy-MM-dd` of the day's START — the key everything buckets by.
    var key: String { OrionDay.keyFormatter.string(from: start) }

    /// How long you have been up, when that is known.
    var elapsed: TimeInterval { Date().timeIntervalSince(start) }
}

enum OrionDay {

    /// The floor. Before this hour, you are still in yesterday.
    ///
    /// Four rather than midnight because the request was explicit: working
    /// until 2am is a late night, not an early morning.
    static let cutoffHour = 4

    private static let wakeKey = "orion.day.lastWakeAt"
    private static let sessionKey = "orion.day.lastSessionAt"

    static let keyFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        formatter.locale = Locale(identifier: "en_US_POSIX")
        return formatter
    }()

    // MARK: - The day

    static func day(at now: Date = Date()) -> LogicalDay {
        let floor = cutoff(before: now)
        guard let wake = validWake(at: now), wake > floor else {
            return LogicalDay(start: floor, fromWakeTime: false)
        }
        return LogicalDay(start: wake, fromWakeTime: true)
    }

    static var current: LogicalDay { day() }

    /// The most recent occurrence of the cutoff hour at or before `now`.
    static func cutoff(before now: Date) -> Date {
        let calendar = Calendar.current
        let todaysCutoff = calendar.date(
            bySettingHour: cutoffHour, minute: 0, second: 0, of: now
        ) ?? calendar.startOfDay(for: now)
        if todaysCutoff <= now { return todaysCutoff }
        return calendar.date(byAdding: .day, value: -1, to: todaysCutoff) ?? todaysCutoff
    }

    // MARK: - Wake time

    /// Recorded by `WhoopClient` from the latest sleep record's end.
    static func recordWake(_ date: Date?) {
        guard let date else { return }
        // Never let a future timestamp in: a clock skew or a bad parse would
        // otherwise park the day start ahead of now and make every counter
        // think the day has not begun.
        guard date <= Date().addingTimeInterval(60) else { return }
        UserDefaults.standard.set(date.timeIntervalSince1970, forKey: wakeKey)
    }

    /// The stored wake time, if it is recent enough to still describe today.
    ///
    /// Twenty-six hours rather than twenty-four: a genuinely long day plus a
    /// late Whoop sync should not be treated as "no wake time at all", and the
    /// cutoff floor already handles anything staler than that.
    static func validWake(at now: Date = Date()) -> Date? {
        let stored = UserDefaults.standard.double(forKey: wakeKey)
        guard stored > 0 else { return nil }
        let wake = Date(timeIntervalSince1970: stored)
        guard wake <= now, now.timeIntervalSince(wake) < 26 * 3600 else { return nil }
        return wake
    }

    /// What to SHOW as the time you got up. Nil when it is only the cutoff, so
    /// the UI can say nothing rather than claim you woke at 4am.
    static func wokeAt(at now: Date = Date()) -> Date? {
        guard let wake = validWake(at: now) else { return nil }
        return wake >= day(at: now).start ? wake : nil
    }

    // MARK: - Sessions

    static var lastSessionAt: Date? {
        let stored = UserDefaults.standard.double(forKey: sessionKey)
        return stored > 0 ? Date(timeIntervalSince1970: stored) : nil
    }

    /// True when Orion has not been used since this day began.
    static func isFirstSession(at now: Date = Date()) -> Bool {
        guard let last = lastSessionAt else { return true }
        return last < day(at: now).start
    }

    /// A real interaction — the dashboard being opened, or a turn taken.
    ///
    /// Deliberately NOT app launch. Orion starts at login and runs all day, so
    /// launching is something that happens while you are asleep; treating it as
    /// use would mean the first session of every day was one you never had.
    static func noteSession(at now: Date = Date()) {
        UserDefaults.standard.set(now.timeIntervalSince1970, forKey: sessionKey)
    }
}

/// The observable face of the day, for views.
///
/// `isFirstSession` is LATCHED at construction and does not change afterwards.
/// Recomputing it would be correct and useless: `noteSession()` runs the moment
/// the dashboard opens, so a live value would flip to false while the brief was
/// still on screen and yank it out from under whoever was reading it.
final class DayModel: ObservableObject {

    @Published private(set) var day: LogicalDay
    @Published private(set) var isFirstSession: Bool
    @Published private(set) var wokeAt: Date?

    init() {
        day = OrionDay.current
        isFirstSession = OrionDay.isFirstSession()
        wokeAt = OrionDay.wokeAt()
    }

    /// Re-read after something that can change the answer — a Whoop sync
    /// landing a new wake time, or the day rolling over while the window is up.
    func refresh() {
        let next = OrionDay.current
        if next != day { day = next }
        let wake = OrionDay.wokeAt()
        if wake != wokeAt { wokeAt = wake }
    }

    func noteSession() {
        OrionDay.noteSession()
    }
}
