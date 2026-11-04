import Foundation

extension PhoneHomeBuilder {
    /// Home's words for times and spans, matching the Mac Home (HomeFormat): "8:45 AM", "40 MIN", "3H 20M".
    struct Format {
        let calendar: Calendar

        private func formatter(_ pattern: String, locale: String = "en_US_POSIX") -> DateFormatter {
            let formatter = DateFormatter()
            formatter.locale = Locale(identifier: locale)
            formatter.timeZone = calendar.timeZone
            formatter.dateFormat = pattern
            return formatter
        }

        func time(_ date: Date) -> String { formatter("h:mm a").string(from: date) }

        /// "Monday 2 November".
        func date(_ date: Date) -> String { formatter("EEEE d MMMM", locale: "en_GB").string(from: date) }

        /// Whole minutes from one moment to another, rounded up so "starts in" never undersells.
        func minutes(from start: Date, to end: Date) -> Int {
            let seconds = end.timeIntervalSince(start)
            guard seconds.isFinite else { return 0 }
            return max(0, Int((seconds / 60).rounded(.up)))
        }

        func duration(_ minutes: Int) -> String {
            let value = max(0, minutes)
            if value < 60 { return "\(value) MIN" }
            return value % 60 == 0 ? "\(value / 60)H" : "\(value / 60)H \(value % 60)M"
        }

        func ago(_ seconds: TimeInterval) -> String {
            let minutes = seconds.isFinite ? Int(max(0, seconds) / 60) : 0
            if minutes < 1 { return "JUST NOW" }
            return minutes < 60 ? "\(minutes) MIN AGO" : "\(minutes / 60)H AGO"
        }

        /// A course code when the title starts with one ("CS2100 Lab" → "CS2100"), else the title, kept short.
        func shortName(_ title: String) -> String {
            if let range = title.range(of: #"^[A-Z]{2,5} ?\d{3,4}"#, options: .regularExpression) {
                return title[range].replacingOccurrences(of: " ", with: "")
            }
            let head = title.components(separatedBy: " — ").first ?? title
            return head.count > 26 ? String(head.prefix(25)) + "…" : head
        }

        /// The health log's day key: the day turns at 4 AM, as on the Mac.
        func dayKey(_ date: Date) -> String {
            let parts = calendar.dateComponents([.year, .month, .day], from: date.addingTimeInterval(-4 * 3600))
            return String(format: "%04d-%02d-%02d", parts.year ?? 0, parts.month ?? 0, parts.day ?? 0)
        }
    }
}

/// "1 minute", "2 minutes": one word for every place that counts something in a sentence.
public enum Plural {
    public static func count(_ value: Int, _ noun: String) -> String { "\(value) \(noun)\(value == 1 ? "" : "s")" }
}
