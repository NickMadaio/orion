import Foundation

/// One line in, a to-do with everything set out (2026-10-13): "essay #school !high fri 5pm".
///
/// `#tag` and `!`/`!!`/`!!!` (or `!low`/`!med`/`!high`) are taken from anywhere. A date or
/// time is taken only from the END of the line, optionally after "by", "due", "on", "at" —
/// so "plan sat hike with Sam" keeps its "sat", and "essay due fri" does not.
public enum TodoQuickAdd {
    public static func parse(_ text: String, now: Date = Date(), calendar: Calendar = .current) -> TodoDraft {
        var words: [String] = []
        var draft = TodoDraft(title: "")
        for word in text.split(whereSeparator: \.isWhitespace).map(String.init) {
            if word.count > 1, word.hasPrefix("#"), word.dropFirst().allSatisfy({ $0.isLetter || $0.isNumber || $0 == "-" || $0 == "_" }) {
                draft.tags = TaskNotes.cleanTags(draft.tags + [String(word.dropFirst())])
            } else if let level = priority(word) {
                draft.priority = level
            } else {
                words.append(word)
            }
        }
        if let (kept, due, timed) = trailingDue(words, now: now, calendar: calendar), !kept.isEmpty {
            words = kept
            draft.due = due
            draft.dueHasTime = timed
        }
        draft.title = words.joined(separator: " ")
        return draft
    }

    static func priority(_ word: String) -> TodoPriority? {
        switch word.lowercased() {
        case "!", "!low", "!lo", "!l": .low
        case "!!", "!med", "!medium", "!m": .medium
        case "!!!", "!high", "!hi", "!h": .high
        default: nil
        }
    }

    // MARK: - The trailing date

    private struct Clock { var hour: Int; var minute: Int }

    /// Strips a date and/or time phrase off the end; returns what is left and when it is due.
    private static func trailingDue(_ words: [String], now: Date, calendar: Calendar) -> ([String], Date, Bool)? {
        var rest = words.map { $0.lowercased() }
        var day: Date?
        var time: Clock?
        // Up to three passes: "fri 5pm", "5pm fri", "at 5pm on fri".
        for _ in 0..<3 {
            var progressed = false
            if time == nil, let (n, t) = takeTime(rest) { rest.removeLast(n); time = t; progressed = true }
            if day == nil, let (n, d, t) = takeDay(rest, now: now, calendar: calendar) {
                rest.removeLast(n); day = d; progressed = true
                if time == nil, let t { time = t }
            }
            if (day != nil || time != nil), let last = rest.last, ["by", "due", "on", "at", "@", "for"].contains(last) { rest.removeLast(); progressed = true }
            if !progressed { break }
        }
        guard day != nil || time != nil else { return nil }
        let base = calendar.startOfDay(for: day ?? now)
        var due: Date
        if let time {
            due = calendar.date(bySettingHour: time.hour, minute: time.minute, second: 0, of: base) ?? base
            if day == nil, due <= now { due = calendar.date(byAdding: .day, value: 1, to: due) ?? due }
        } else {
            due = calendar.date(bySettingHour: 23, minute: 59, second: 0, of: base) ?? base
        }
        return (Array(words.prefix(rest.count)), due, time != nil)
    }

    /// "5pm", "5:30pm", "5 pm", "17:15", "noon", "midnight", "at 5" (only after "at").
    private static func takeTime(_ rest: [String]) -> (Int, Clock)? {
        guard let last = rest.last else { return nil }
        if last == "noon" { return (1, Clock(hour: 12, minute: 0)) }
        if last == "midnight" { return (1, Clock(hour: 23, minute: 59)) }
        if ["am", "pm"].contains(last), rest.count >= 2, let c = clock(rest[rest.count - 2] + last) { return (2, c) }
        if let c = clock(last), last.contains(":") || last.hasSuffix("am") || last.hasSuffix("pm") { return (1, c) }
        // A bare hour only counts after "at": "at 5" is 5 PM if that is the sensible reading.
        if rest.count >= 2, rest[rest.count - 2] == "at", let hour = Int(last), (1...12).contains(hour) {
            return (1, Clock(hour: hour < 8 ? hour + 12 : hour, minute: 0))
        }
        return nil
    }

    private static func clock(_ word: String) -> Clock? {
        var body = Substring(word)
        var half: String?
        if body.hasSuffix("am") || body.hasSuffix("pm") { half = String(body.suffix(2)); body = body.dropLast(2) }
        let parts = body.split(separator: ":", omittingEmptySubsequences: false)
        guard (1...2).contains(parts.count), (1...2).contains(parts[0].count), parts.allSatisfy({ !$0.isEmpty && $0.allSatisfy(\.isASCII) && $0.allSatisfy(\.isNumber) }),
              var hour = Int(parts[0]) else { return nil }
        let minute = parts.count == 2 ? Int(parts[1]) ?? 99 : 0
        guard minute < 60, parts.count == 1 || parts[1].count == 2 else { return nil }
        if let half {
            guard (1...12).contains(hour) else { return nil }
            if half == "pm", hour < 12 { hour += 12 }
            if half == "am", hour == 12 { hour = 0 }
        } else if parts.count == 1 || hour > 23 { return nil }
        return Clock(hour: hour, minute: minute)
    }

    /// today / tonight / tomorrow / tmrw / weekdays / next fri / next week / weekend /
    /// in 3 days / oct 20 / 20 oct / 20th october.
    private static func takeDay(_ rest: [String], now: Date, calendar: Calendar) -> (Int, Date, Clock?)? {
        guard let last = rest.last else { return nil }
        let today = calendar.startOfDay(for: now)
        let add = { (days: Int) in calendar.date(byAdding: .day, value: days, to: today)! }
        let previous = rest.count >= 2 ? rest[rest.count - 2] : nil
        switch last {
        case "today", "tod": return (1, today, nil)
        case "tonight": return (1, today, Clock(hour: 20, minute: 0))
        case "tomorrow", "tmrw", "tmr", "tomorow", "tomoz": return (1, add(1), nil)
        case "week" where previous == "next":
            let weekStart = calendar.dateInterval(of: .weekOfYear, for: now)?.start ?? today
            return (2, calendar.date(byAdding: .day, value: 7, to: weekStart)!, nil)
        case "weekend": return ((previous == "this" || previous == "the") ? 2 : 1, nextWeekday(7, from: today, calendar: calendar, includeToday: true), nil)
        case "days", "day", "weeks", "week":
            guard rest.count >= 3, rest[rest.count - 3] == "in", let n = Int(rest[rest.count - 2]) ?? (rest[rest.count - 2] == "a" ? 1 : nil) else { break }
            return (3, add(last.hasPrefix("week") ? n * 7 : n), nil)
        default: break
        }
        if let weekday = weekdayNumber(last) {
            if previous == "next" {
                var date = nextWeekday(weekday, from: today, calendar: calendar, includeToday: false)
                let thisWeekEnd = calendar.dateInterval(of: .weekOfYear, for: now)?.end ?? date
                if date < thisWeekEnd { date = calendar.date(byAdding: .day, value: 7, to: date)! }
                return (2, date, nil)
            }
            return (previous == "this" ? 2 : 1, nextWeekday(weekday, from: today, calendar: calendar, includeToday: true), nil)
        }
        // "oct 20", "20 oct", "20th october"
        if let previous {
            if let month = monthNumber(previous), let day = dayNumber(last) { return (2, monthDay(month, day, now: now, calendar: calendar), nil) }
            if let month = monthNumber(last), let day = dayNumber(previous) { return (2, monthDay(month, day, now: now, calendar: calendar), nil) }
        }
        return nil
    }

    private static func weekdayNumber(_ word: String) -> Int? {
        let names = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"]
        let aliases = ["tues": "tue", "weds": "wed", "thur": "thu", "thurs": "thu"]
        let key = aliases[word] ?? (word.count >= 3 ? String(word.prefix(3)) : word)
        guard let index = names.firstIndex(of: key) else { return nil }
        // Only real spellings: "monster" must not read as Monday.
        let full = TodoBoard.weekdayNames[index]
        return (word == key || aliases[word] != nil || full == word) ? index + 1 : nil
    }

    private static func monthNumber(_ word: String) -> Int? {
        guard word.count >= 3, let index = TodoBoard.monthNames.firstIndex(where: { $0 == word || ($0.hasPrefix(word) && word.count <= 4) }) else { return nil }
        return index + 1
    }

    private static func dayNumber(_ word: String) -> Int? {
        var digits = Substring(word)
        for suffix in ["st", "nd", "rd", "th"] where digits.hasSuffix(suffix) { digits = digits.dropLast(2) }
        guard (1...2).contains(digits.count), digits.allSatisfy({ $0.isASCII && $0.isNumber }), let day = Int(digits), (1...31).contains(day) else { return nil }
        return day
    }

    private static func monthDay(_ month: Int, _ day: Int, now: Date, calendar: Calendar) -> Date {
        let year = calendar.component(.year, from: now)
        let this = calendar.date(from: DateComponents(year: year, month: month, day: day)) ?? now
        return this < calendar.startOfDay(for: now) ? calendar.date(byAdding: .year, value: 1, to: this)! : this
    }

    /// The next date with that weekday (1 = Sunday … 7 = Saturday).
    private static func nextWeekday(_ weekday: Int, from today: Date, calendar: Calendar, includeToday: Bool) -> Date {
        let current = calendar.component(.weekday, from: today)
        var delta = (weekday - current + 7) % 7
        if delta == 0 && !includeToday { delta = 7 }
        return calendar.date(byAdding: .day, value: delta, to: today)!
    }
}
