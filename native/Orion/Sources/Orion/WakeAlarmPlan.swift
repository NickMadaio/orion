import Foundation

/// One time the Mac should wake him.
struct WakeAlarmEntry: Equatable {
    let date: String      // "YYYY-MM-DD", the day he wakes into
    let fireAt: Date
    let reason: String
    /// Stable across restarts, so a dismissed alarm is not rung again after a relaunch.
    var key: String { "\(date)@\(Int(fireAt.timeIntervalSince1970))" }
}

/// Reads `wake-plan.json` (the scheduler's alarms) and `wake-request.json` (his one-shot override)
/// from the controlled directory. A missing or invalid file is "no alarm", never a crash.
enum WakeAlarmPlan {
    static func entries(plan: Data?, override: Data?, calendar: Calendar = .current) -> [WakeAlarmEntry] {
        var byDate: [String: [WakeAlarmEntry]] = [:]
        for entry in planEntries(plan, calendar: calendar) { byDate[entry.date, default: []].append(entry) }
        // The override wins for its own date, whatever the plan said for it.
        if let manual = overrideEntry(override, calendar: calendar) { byDate[manual.date] = [manual] }
        return byDate.values.flatMap { $0 }.sorted { $0.fireAt < $1.fireAt }
    }

    private static func planEntries(_ data: Data?, calendar: Calendar) -> [WakeAlarmEntry] {
        guard let data, let root = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              let alarms = root["alarms"] as? [[String: Any]] else { return [] }
        // Only a plan Nick set rings; a plan derived from defaults ("default", or no source) never does.
        guard (root["source"] as? String) == "nick" else { return [] }
        return alarms.compactMap { row in
            // Defence in depth: only an alarm the writer marked as asked-for by Nick rings.
            guard (row["byNick"] as? Bool) == true else { return nil }
            guard let date = row["date"] as? String, isDay(date) else { return nil }
            let reason = (row["reason"] as? String) ?? "wake plan"
            if let iso = row["iso"] as? String, let at = parseISO(iso) {
                return WakeAlarmEntry(date: date, fireAt: at, reason: reason)
            }
            guard let hhmm = row["at"] as? String, let at = clock(date: date, hhmm: hhmm, calendar: calendar) else { return nil }
            return WakeAlarmEntry(date: date, fireAt: at, reason: reason)
        }
    }

    private static func overrideEntry(_ data: Data?, calendar: Calendar) -> WakeAlarmEntry? {
        guard let data, let root = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              let iso = root["at"] as? String, let at = parseISO(iso) else { return nil }
        let parts = calendar.dateComponents([.year, .month, .day], from: at)
        guard let y = parts.year, let m = parts.month, let d = parts.day else { return nil }
        return WakeAlarmEntry(date: String(format: "%04d-%02d-%02d", y, m, d), fireAt: at, reason: "you asked for this one")
    }

    static func isDay(_ text: String) -> Bool {
        text.range(of: #"^\d{4}-\d{2}-\d{2}$"#, options: .regularExpression) != nil
    }

    static func clock(date: String, hhmm: String, calendar: Calendar) -> Date? {
        let day = date.split(separator: "-").compactMap { Int($0) }
        let time = hhmm.split(separator: ":").compactMap { Int($0) }
        guard day.count == 3, time.count == 2, (0..<24).contains(time[0]), (0..<60).contains(time[1]) else { return nil }
        return calendar.date(from: DateComponents(year: day[0], month: day[1], day: day[2], hour: time[0], minute: time[1]))
    }

    static func parseISO(_ text: String) -> Date? {
        let fractional = ISO8601DateFormatter(); fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let plain = ISO8601DateFormatter(); plain.formatOptions = [.withInternetDateTime]
        return fractional.date(from: text) ?? plain.date(from: text)
    }
}
