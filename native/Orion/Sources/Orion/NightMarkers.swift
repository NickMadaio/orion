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

    private struct File: Decodable {
        struct Day: Decodable { let date: String; let wake: Int?; let bed: Int? }
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
        guard let day = file.days.compactMap({ $0 }).first(where: { $0.date == key }) else { return nil }
        let midnight = calendar.startOfDay(for: date)
        return NightMarkers(wake: day.wake.map { midnight.addingTimeInterval(Double($0 * 60)) },
                            bed: day.bed.map { midnight.addingTimeInterval(Double($0 * 60)) })
    }
}
