import Foundation

/// The small bits of wording the Home cards share: times, durations, "12 min ago", course short names. Always in
/// the brief clock's zone, with a fixed locale, so a card says the same thing on every machine and in tests.
struct HomeFormat {
    let clock: BriefClock

    var now: Date { clock.now }
    var hour: Int { clock.hour }

    private func formatter(_ pattern: String) -> DateFormatter {
        let formatter = DateFormatter()
        formatter.calendar = clock.calendar
        formatter.timeZone = clock.timeZone
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = pattern
        return formatter
    }

    /// "8:45 AM".
    func time(_ date: Date) -> String { formatter("h:mm a").string(from: date) }

    /// As said aloud: "midnight", "noon", otherwise the time.
    func spoken(_ date: Date) -> String {
        let parts = clock.calendar.dateComponents([.hour, .minute], from: date)
        switch (parts.hour, parts.minute) {
        case (0, 0): return "midnight"
        case (12, 0): return "noon"
        default: return time(date)
        }
    }

    /// "Friday October 30".
    func date(_ date: Date) -> String { formatter("EEEE MMMM d").string(from: date) }

    /// Whole minutes from now to `date`, rounded up, so 39.5 minutes away reads "40".
    func minutes(until date: Date) -> Int { Int((date.timeIntervalSince(now) / 60).rounded(.up)) }

    /// "40 MIN", "3H", "2H 30M".
    func duration(_ minutes: Int) -> String {
        let value = max(0, minutes)
        if value < 60 { return "\(value) MIN" }
        return value % 60 == 0 ? "\(value / 60)H" : "\(value / 60)H \(value % 60)M"
    }

    /// "JUST NOW", "12 MIN AGO", "2H AGO".
    func ago(_ seconds: TimeInterval) -> String {
        let minutes = Int(max(0, seconds) / 60)
        if minutes < 1 { return "JUST NOW" }
        return minutes < 60 ? "\(minutes) MIN AGO" : "\(minutes / 60)H AGO"
    }

    /// How late a task is: "2 DAYS", "1 DAY", or "SINCE 9:00 AM" when it was due earlier today.
    func lateness(_ due: Date?) -> String {
        guard let due else { return "NO DATE" }
        let calendar = clock.calendar
        let days = calendar.dateComponents([.day], from: calendar.startOfDay(for: due), to: calendar.startOfDay(for: now)).day ?? 0
        if days <= 0 { return "SINCE \(time(due))" }
        return days == 1 ? "1 DAY" : "\(days) DAYS"
    }

    /// `hour`:00 today.
    func today(hour: Int) -> Date? {
        clock.calendar.date(bySettingHour: hour, minute: 0, second: 0, of: now)
    }

    /// A course code when the title starts with one ("CS2100 Program Design — Lecture" → "CS2100"), else the
    /// title before any " — " qualifier, capped so a kicker stays one line.
    func shortName(_ title: String) -> String {
        if let range = title.range(of: #"^[A-Z]{2,5} ?\d{3,4}"#, options: .regularExpression) {
            return title[range].replacingOccurrences(of: " ", with: "")
        }
        let head = title.components(separatedBy: " — ").first ?? title
        return head.count > 26 ? String(head.prefix(25)) + "…" : head
    }

    /// "Three" for 3, up to ten; digits past that.
    static func word(_ number: Int) -> String {
        let words = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"]
        return words.indices.contains(number) ? words[number] : "\(number)"
    }
}
