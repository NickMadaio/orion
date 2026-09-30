import Foundation

/// Questions a clock can answer, answered without the brain (2026-09-29).
///
/// Nick: "for only asking him the time he was kinda slow." Asking the brain
/// what time it is costs a full round trip (seconds) for something the Mac
/// knows instantly. Only exact, whole questions qualify — "what time is my
/// class" is a calendar question and still goes to ORION.
public enum QuickAnswer {
    public static func reply(to text: String, now: Date = Date(), calendar: Calendar = .current) -> String? {
        let t = stripLeadIn(normalise(text))
        // Spoken, so "7:59 PM" rather than "19:59" ("nineteen fifty-nine").
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX"); formatter.timeZone = calendar.timeZone
        formatter.dateFormat = "h:mm a"
        let time = formatter.string(from: now)
        let dayName = now.formatted(Date.FormatStyle(locale: Locale(identifier: "en_GB")).weekday(.wide))
        let date = now.formatted(Date.FormatStyle(locale: Locale(identifier: "en_GB")).day().month(.wide))
        if timeQuestions.contains(t) { return "It's \(time)." }
        if dayQuestions.contains(t) { return "It's \(dayName), \(date)." }
        if dateQuestions.contains(t) { return "It's \(dayName), \(date)." }
        return nil
    }

    static let timeQuestions: Set<String> = [
        "what time is it", "what time is it now", "what time is it right now", "whats the time", "what is the time",
        "whats the time now", "time", "the time", "what's the time", "do you know what time it is", "tell me the time",
        "what time is it currently", "orion what time is it", "hey orion what time is it",
    ]
    static let dayQuestions: Set<String> = [
        "what day is it", "what day is it today", "whats today", "what is today", "what day is today",
    ]
    static let dateQuestions: Set<String> = [
        "whats the date", "what is the date", "whats todays date", "what is todays date", "whats the date today",
        "what is the date today", "todays date",
    ]

    /// "And what time is it?", "Okay so what's the time", "Hey Orion, what day is it".
    static func stripLeadIn(_ text: String) -> String {
        let fillers: Set<String> = ["and", "so", "ok", "okay", "hey", "orion", "um", "uh", "well", "yo", "quick", "question", "then", "now", "sorry", "wait", "also", "but"]
        var words = text.split(separator: " ").map(String.init)
        while let first = words.first, fillers.contains(first), words.count > 2 { words.removeFirst() }
        return words.joined(separator: " ")
    }

    static func normalise(_ text: String) -> String {
        text.lowercased()
            .replacingOccurrences(of: "’", with: "'")
            .replacingOccurrences(of: "'", with: "")
            .components(separatedBy: CharacterSet.letters.union(.whitespaces).inverted).joined()
            .split(separator: " ").joined(separator: " ")
            .trimmingCharacters(in: .whitespaces)
    }
}
