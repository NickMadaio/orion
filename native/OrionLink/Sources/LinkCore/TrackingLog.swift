import Foundation
import MobileCore

/*
 Tracking from the phone, into the Mac's health log (2026-09-28).

 Water, meals and supplements are logged on the phone because that is where
 Nick is when he drinks or eats. The Mac's health-log.json stays the single
 record: the ORION app and the plugin already share it, and this is its third
 writer. So it follows the same contract they do, exactly:

   · the whole read-modify-write happens under `<file>.lock` (O_CREAT|O_EXCL,
     broken after 15s, given up after 6s), with the file re-read inside it;
   · the new file is written to a uniquely named scratch file and renamed over
     the old one, 0600;
   · it works on the JSON as a dictionary, so every key this code does not know
     about -- workouts, goals, whatever the app adds next -- survives untouched.

 Day records are written with every non-optional key the app's `HealthDayRecord`
 decodes, because Swift's synthesized decoder does not fill in defaults: a record
 missing `waterBottles` would make the app unable to read the whole file.
*/
public struct TrackingLog {
    public let file: URL
    /// Before this hour you are still in yesterday -- the app's OrionDay rule.
    public static let cutoffHour = 4
    public static let waterGoal = 9
    /// How many geofence events are kept (C6).
    public static let placeEventLimit = 500
    static let staleLockAfter: TimeInterval = 15
    static let giveUpAfter: TimeInterval = 6

    public init(file: URL = URL(fileURLWithPath: NSHomeDirectory())
        .appendingPathComponent(".openclaw/orion-controlled/health-log.json")) {
        self.file = file
    }

    public static func dayKey(at now: Date = Date(), calendar: Calendar = .current) -> String {
        let shifted = now.addingTimeInterval(-Double(cutoffHour) * 3600)
        let parts = calendar.dateComponents([.year, .month, .day], from: shifted)
        return String(format: "%04d-%02d-%02d", parts.year ?? 0, parts.month ?? 0, parts.day ?? 0)
    }

    // MARK: - Reading

    public func today(now: Date = Date()) -> LinkSnapshot.Tracking? {
        guard let data = try? Data(contentsOf: file),
              let log = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
        let day = Self.dayKey(at: now)
        let record = (log["days"] as? [String: Any])?[day] as? [String: Any] ?? [:]
        let nutrition = log["nutritionLog"] as? [String: Any] ?? [:]
        let meals = (nutrition[day] as? [[String: Any]] ?? []).compactMap(Self.meal)
        let goals = log["nutritionGoals"] as? [String: Any] ?? [:]
        let taken = Set(record["supplementIDs"] as? [String] ?? (log["supplementLog"] as? [String: Any])?[day] as? [String] ?? [])
        let supplements = (log["supplements"] as? [[String: Any]] ?? []).compactMap { item -> LinkSnapshot.Tracking.Supplement? in
            guard let id = item["id"] as? String, let name = item["name"] as? String else { return nil }
            return .init(id: id, name: name, dose: item["dose"] as? String ?? "",
                         timeOfDay: item["timeOfDay"] as? String ?? "anytime", taken: taken.contains(id))
        }
        var seen = Set<String>()
        let recent = nutrition.keys.sorted(by: >).prefix(14)
            .flatMap { (nutrition[$0] as? [[String: Any]] ?? []).reversed().compactMap(Self.meal) }
            .filter { !$0.id.hasPrefix("manual-total") && seen.insert($0.title.lowercased()).inserted }
            .prefix(8)
        return .init(day: day, waterBottles: Self.int(record["waterBottles"]) ?? 0, waterGoal: Self.waterGoal,
                     calories: meals.isEmpty ? (Self.int(record["calories"]) ?? 0) : meals.reduce(0) { $0 + $1.calories },
                     calorieGoal: Self.int(goals["calories"]) ?? 2_200,
                     protein: meals.reduce(0) { $0 + $1.protein }, proteinGoal: Self.int(goals["protein"]) ?? 150,
                     meals: meals, supplements: supplements, recentFoods: Array(recent))
    }

    static func meal(_ item: [String: Any]) -> LinkSnapshot.Tracking.Meal? {
        guard let id = item["id"] as? String, let title = item["title"] as? String else { return nil }
        return .init(id: id, title: title, meal: item["meal"] as? String ?? "Meal",
                     calories: int(item["calories"]) ?? 0, protein: int(item["protein"]) ?? 0)
    }

    static func int(_ value: Any?) -> Int? { (value as? NSNumber)?.intValue }

    // MARK: - Writing

    /// Apply one entry and return a sentence for the phone.
    @discardableResult
    public func apply(_ entry: LinkLog, now: Date = Date()) throws -> String {
        let entry = try entry.validated()
        let day = Self.dayKey(at: now)
        let stamp = ISO8601DateFormatter().string(from: now)
        var reply = ""
        try withLock {
            var log = try readForWrite()
            var days = log["days"] as? [String: Any] ?? [:]
            var record = Self.completeRecord(days[day] as? [String: Any])
            var nutrition = log["nutritionLog"] as? [String: Any] ?? [:]
            var meals = nutrition[day] as? [[String: Any]] ?? []
            switch entry {
            case .water(let delta):
                let bottles = max(0, (Self.int(record["waterBottles"]) ?? 0) + delta)
                record["waterBottles"] = bottles
                reply = "Water: \(bottles) of \(Self.waterGoal) bottles."
            case let .meal(title, meal, calories, protein, carbohydrates, fat):
                meals.append(["id": UUID().uuidString, "title": title, "meal": meal, "calories": calories,
                              "protein": protein, "carbohydrates": carbohydrates, "fat": fat, "fiber": 0,
                              "notes": "Logged from iPhone.", "loggedAt": stamp])
                reply = "Logged \(title): \(calories) kcal."
            case .removeMeal(let id):
                let before = meals.count
                meals.removeAll { $0["id"] as? String == id }
                guard meals.count < before else { throw LinkError.invalidCommand("that meal is not in today's log") }
                reply = "Removed."
            case let .supplement(id, taken):
                let known = (log["supplements"] as? [[String: Any]] ?? []).first { $0["id"] as? String == id }
                guard let known else { throw LinkError.invalidCommand("that supplement is not on the list") }
                var ids = record["supplementIDs"] as? [String] ?? []
                ids.removeAll { $0 == id }
                if taken { ids.append(id) }
                record["supplementIDs"] = ids
                var legacy = log["supplementLog"] as? [String: Any] ?? [:]
                legacy[day] = ids
                log["supplementLog"] = legacy
                reply = "\(known["name"] as? String ?? "Supplement") \(taken ? "taken" : "unticked")."
            case .checkin, .note:
                throw LinkError.invalidCommand("handled elsewhere")
            case let .signal(at, motion, charging, latitude, longitude, audio):
                var signals = log["phoneSignals"] as? [[String: Any]] ?? []
                var sample: [String: Any] = ["at": at, "motion": motion, "charging": charging]
                if let latitude, let longitude { sample["latitude"] = latitude; sample["longitude"] = longitude }
                if let audio { sample["audio"] = audio }
                signals.append(sample)
                log["phoneSignals"] = Array(signals.suffix(2000))
                reply = "Noted."
            case let .place(event, placeId, at, latitude, longitude):
                // C6: geofence enter/exit, the reliable home/away bit. Last 500, like the other histories.
                var events = log["placeEvents"] as? [[String: Any]] ?? []
                var item: [String: Any] = ["event": event, "placeId": placeId, "at": at]
                if let latitude, let longitude { item["latitude"] = latitude; item["longitude"] = longitude }
                events.append(item)
                log["placeEvents"] = Array(events.suffix(Self.placeEventLimit))
                reply = "Noted."
            case let .screen(at, locked, until, why, graceUntil, usedMinutes):
                // The latest state (what ORION reads) plus a short history for patterns.
                var state: [String: Any] = ["at": at, "locked": locked]
                if let until { state["until"] = until }
                if let why { state["why"] = why }
                if let graceUntil { state["graceUntil"] = graceUntil }
                if let usedMinutes { state["usedMinutes"] = usedMinutes }
                log["phoneScreen"] = state
                var history = log["screenLog"] as? [[String: Any]] ?? []
                history.append(state)
                log["screenLog"] = Array(history.suffix(300))
                reply = "Noted."
            case let .sleep(event, at):
                // A top-level list the app does not decode and preserves untouched.
                var sleepLog = log["sleepLog"] as? [[String: Any]] ?? []
                sleepLog.append(["event": event, "at": at, "source": "iphone"])
                log["sleepLog"] = Array(sleepLog.suffix(400))
                reply = event == "bed" ? "Logged: going to bed." : "Logged: up."
            }
            if case .water = entry {} else if case .supplement = entry {} else if case .sleep = entry {} else if case .signal = entry {} else if case .place = entry {} else if case .screen = entry {} else {
                nutrition[day] = meals
                log["nutritionLog"] = nutrition
                record["calories"] = meals.reduce(0) { $0 + (Self.int($1["calories"]) ?? 0) }
            }
            record["updatedAt"] = stamp
            days[day] = record
            log["days"] = days
            log["updatedAt"] = stamp
            if log["schema"] == nil { log["schema"] = "orion.health.v3" }
            try publish(log)
        }
        return reply
    }

    /// Every key the app requires, with the app's defaults, over what is there.
    static func completeRecord(_ existing: [String: Any]?) -> [String: Any] {
        var record: [String: Any] = ["waterBottles": 0, "calories": 0, "supplementIDs": [String](), "updatedAt": ""]
        for (key, value) in existing ?? [:] { record[key] = value }
        return record
    }

    private func readForWrite() throws -> [String: Any] {
        do {
            let data = try Data(contentsOf: file)
            guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                throw LinkError.invalidCommand("the health log is not readable")
            }
            return object
        } catch let error as CocoaError where error.code == .fileReadNoSuchFile {
            return ["schema": "orion.health.v3", "supplements": [Any](), "supplementLog": [String: Any](), "workouts": [Any]()]
        }
    }

    private func publish(_ log: [String: Any]) throws {
        let data = try JSONSerialization.data(withJSONObject: log, options: [.prettyPrinted, .sortedKeys])
        let scratch = file.deletingLastPathComponent().appendingPathComponent(".health-log.\(UUID().uuidString).tmp")
        try data.write(to: scratch)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: scratch.path)
        guard rename(scratch.path, file.path) == 0 else {
            let failure = errno
            try? FileManager.default.removeItem(at: scratch)
            throw NSError(domain: NSPOSIXErrorDomain, code: Int(failure))
        }
    }

    /// The app's and the plugin's lock, byte for byte: see FileLock.swift.
    private func withLock(_ body: () throws -> Void) throws {
        try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true,
                                                attributes: [.posixPermissions: 0o700])
        let lockPath = file.path + ".lock"
        let deadline = Date().addingTimeInterval(Self.giveUpAfter)
        while true {
            let descriptor = open(lockPath, O_CREAT | O_EXCL | O_WRONLY, 0o600)
            if descriptor >= 0 {
                close(descriptor)
                defer { unlink(lockPath) }
                return try body()
            }
            guard errno == EEXIST else { throw NSError(domain: NSPOSIXErrorDomain, code: Int(errno)) }
            if let taken = (try? FileManager.default.attributesOfItem(atPath: lockPath))?[.modificationDate] as? Date,
               Date().timeIntervalSince(taken) > Self.staleLockAfter {
                unlink(lockPath)
            }
            if Date() >= deadline { throw LinkError.invalidCommand("the health log stayed busy; try again") }
            usleep(20_000)
        }
    }
}
