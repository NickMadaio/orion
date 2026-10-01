import Foundation

/*
 When Nick wakes and when he should be asleep, for the day view (2026-09-30).
 Nick: "make little markers for when i wake up (orion alarm) and when i should
 be asleep by (wind down is prior to that and ends at the 'asleep' line)".

 The times are not computed here. `orion-watch` writes them every tick to
 ~/.openclaw/orion-controlled/night.json from scripts/lib/life/night.mjs, the
 same rule the phone sets its real alarm from and the planner ends the day at,
 so the line on screen, the alarm, and the wind-down block cannot disagree.
*/
struct NightMarkers: Equatable {
    var wake: Date?
    var bed: Date?
    /// True once he is actually up and `wake` is when (WHOOP, else the phone);
    /// until then `wake` is the planned alarm (2026-10-01).
    var woke = false
    /// When he actually fell asleep in the small hours of this day (last night),
    /// drawn as its own line so "asleep by" and "asleep at" can be compared.
    var fellAsleep: Date?

    private struct File: Decodable {
        struct Day: Decodable { let date: String; let wake: Int?; let bed: Int?; let woke: Bool?; let asleepAt: Int? }
        let days: [Day?]
    }

    static var fileURL: URL {
        FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".openclaw/orion-controlled/night.json")
    }

    /// The markers for `date`, or nil when the watcher has not written that day.
    static func load(for date: Date, from url: URL = fileURL, calendar: Calendar = .current) -> NightMarkers? {
        guard let data = try? Data(contentsOf: url), let file = try? JSONDecoder().decode(File.self, from: data) else { return nil }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_CA"); formatter.calendar = calendar; formatter.timeZone = calendar.timeZone
        formatter.dateFormat = "yyyy-MM-dd"
        let key = formatter.string(from: date)
        let days = file.days.compactMap { $0 }
        guard let day = days.first(where: { $0.date == key }) else { return nil }
        let midnight = calendar.startOfDay(for: date)
        // Last night's actual sleep belongs to the day before, and lands on this
        // one when it was after midnight.
        let previousKey = calendar.date(byAdding: .day, value: -1, to: midnight).map(formatter.string(from:))
        let lastNight = days.first(where: { $0.date == previousKey })?.asleepAt.flatMap { $0 >= 1440 ? $0 - 1440 : nil }
        return NightMarkers(wake: day.wake.map { midnight.addingTimeInterval(Double($0 * 60)) },
                            bed: day.bed.map { midnight.addingTimeInterval(Double($0 * 60)) },
                            woke: day.woke ?? false,
                            fellAsleep: lastNight.map { midnight.addingTimeInterval(Double($0 * 60)) })
    }
}
