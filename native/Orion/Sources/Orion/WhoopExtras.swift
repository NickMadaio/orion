import Foundation

/*
 What the sleep and workout collections carry that the night-and-recovery
 readout threw away (W20, 2026-11-04: "Orion can see I slept more and schedule
 around it").

 NAPS. `/activity/sleep` returns naps as ordinary sleep records with `nap: true`.
 They used to be filtered out so an afternoon nap could not pose as the night —
 right — and then dropped, which left the planner blind to them. They are kept
 here, apart from the night, and written onto the day they ended on.

 WORKOUTS. `/activity/workout` (scope `read:workout`, already granted) is the
 strap's own record that a session happened, with its strain.
*/

/// One nap. `minutes` is time actually asleep (light + deep + REM) when WHOOP
/// scored it, else the length of the record.
struct WhoopNap: Codable, Equatable {
    var start: String
    var end: String
    var minutes: Int
    var performance: Int?
}

/// One workout WHOOP recorded.
struct WhoopWorkoutRecord: Codable, Equatable {
    var id: String
    var start: String
    var end: String
    var minutes: Int
    var strain: Double?
    var sport: String?
    var averageHeartRate: Int?
}

enum WhoopExtras {
    /// A doze shorter than this is not worth recording, and a workout shorter
    /// than this is the strap guessing.
    static let minimumNapMinutes = 5
    static let minimumWorkoutMinutes = 10

    private static func interval(_ record: [String: Any]) -> (start: Date, end: Date)? {
        guard let start = (record["start"] as? String).flatMap(WhoopClient.parseTimestamp),
              let end = (record["end"] as? String).flatMap(WhoopClient.parseTimestamp), end > start
        else { return nil }
        return (start, end)
    }

    /// Distinct naps, oldest first. Only records Whoop flags `nap: true`.
    static func naps(from sleeps: [[String: Any]]) -> [WhoopNap] {
        var seen = Set<String>()
        return sleeps.compactMap { record -> WhoopNap? in
            guard (record["nap"] as? Bool) == true,
                  let (start, end) = interval(record),
                  let startRaw = record["start"] as? String, let endRaw = record["end"] as? String,
                  seen.insert(startRaw).inserted else { return nil }
            let score = record["score"] as? [String: Any]
            var minutes = Int((end.timeIntervalSince(start) / 60).rounded())
            if let stage = score?["stage_summary"] as? [String: Any] {
                let parts = ["total_light_sleep_time_milli", "total_slow_wave_sleep_time_milli", "total_rem_sleep_time_milli"]
                    .compactMap { stage[$0] as? Double }
                if !parts.isEmpty { minutes = Int((parts.reduce(0, +) / 60_000).rounded()) }
            }
            guard minutes >= minimumNapMinutes else { return nil }
            let performance = (score?["sleep_performance_percentage"] as? Double).map { Int($0.rounded()) }
            return WhoopNap(start: startRaw, end: endRaw, minutes: minutes, performance: performance)
        }
        .sorted { $0.start < $1.start }
    }

    /// Distinct workouts, oldest first.
    static func workouts(from records: [[String: Any]]) -> [WhoopWorkoutRecord] {
        var seen = Set<String>()
        return records.compactMap { record -> WhoopWorkoutRecord? in
            guard let (start, end) = interval(record),
                  let startRaw = record["start"] as? String, let endRaw = record["end"] as? String,
                  seen.insert(startRaw).inserted else { return nil }
            let minutes = Int((end.timeIntervalSince(start) / 60).rounded())
            guard minutes >= minimumWorkoutMinutes else { return nil }
            let score = record["score"] as? [String: Any]
            return WhoopWorkoutRecord(
                id: (record["id"] as? String) ?? (record["id"] as? Int).map(String.init) ?? startRaw,
                start: startRaw, end: endRaw, minutes: minutes,
                strain: (score?["strain"] as? Double).map { ($0 * 10).rounded() / 10 },
                sport: record["sport_name"] as? String,
                averageHeartRate: (score?["average_heart_rate"] as? Double).map { Int($0.rounded()) })
        }
        .sorted { $0.start < $1.start }
    }

    /// The total across a day's naps.
    static func totalMinutes(_ naps: [WhoopNap]) -> Int { naps.reduce(0) { $0 + $1.minutes } }

    /// "1h10" or "25 min".
    static func lengthText(_ minutes: Int) -> String {
        minutes >= 60 ? "\(minutes / 60)h\(String(format: "%02d", minutes % 60))" : "\(minutes) min"
    }

    /// "napped 1h10 at 15:00" for the day's naps, or nil when there were none.
    static func napLine(_ naps: [WhoopNap], timeZone: TimeZone = .current) -> String? {
        guard !naps.isEmpty else { return nil }
        let format = DateFormatter()
        format.dateFormat = "HH:mm"
        format.timeZone = timeZone
        let parts = naps.map { nap -> String in
            let at = WhoopClient.parseTimestamp(nap.start).map { " at \(format.string(from: $0))" } ?? ""
            return "\(lengthText(nap.minutes))\(at)"
        }
        return "napped " + parts.joined(separator: ", ")
    }
}
