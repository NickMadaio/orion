import Foundation
import SessionService

/*
 Supplements and workouts, in one file that both sides own.

 The contract is deliberately the same one `ReminderService` already uses: a
 plain JSON file written by atomic rename, polled by whoever cares. That is what
 lets Nick say "took my ashwagandha" to Orion and see it tick in the UI, without
 an IPC channel, a port, or a shared object that can quietly die while reporting
 health. This project has been bitten by exactly that before.

 What was here before was not a supplement tracker. It was an integer that went
 up when you pressed a button — it could not tell you WHICH supplement, could
 not be edited, and had no idea what Nick actually takes. Same story for
 workouts: a boolean that said "done". Neither survives contact with the
 question "did I take my vitamin D today?"

 So both are modelled properly:

   • Supplements have a defined list Nick edits, and a per-day record of which
     ones were taken. The list is the durable thing; the ticks reset each day.
   • Workouts are sessions of exercises of sets, where a set is a weight and a
     rep count. "Incline chest, 135x8, 145x6, 155x4" has to survive as three
     distinct sets or the history is worthless for progressive overload.
*/

// MARK: - Model

struct Supplement: Identifiable, Codable, Equatable {
    var id: String = UUID().uuidString
    var name: String
    /// Free text: "5g", "2 caps", "1000 IU". Not parsed, just shown.
    var dose: String = ""
    /// morning / lunch / evening / anytime. Groups the list the way the day runs.
    var timeOfDay: String = "anytime"
}

struct WorkoutSet: Identifiable, Codable, Equatable {
    var id: String = UUID().uuidString
    var weight: Double
    var reps: Int
    var unit: String = "lb"

    var label: String {
        let trimmed = weight.rounded() == weight
            ? String(Int(weight))
            : String(format: "%.1f", weight)
        return "\(trimmed)\(unit) × \(reps)"
    }
}

struct Exercise: Identifiable, Codable, Equatable {
    var id: String = UUID().uuidString
    var name: String
    var sets: [WorkoutSet] = []

    /// Weight × reps summed. The single number that says whether a session beat
    /// the last one, which is the only question progressive overload asks.
    var volume: Double {
        sets.reduce(0) { $0 + $1.weight * Double($1.reps) }
    }

    var topSet: WorkoutSet? {
        sets.max { $0.weight < $1.weight }
    }
}

struct WorkoutSession: Identifiable, Codable, Equatable {
    var id: String = UUID().uuidString
    /// yyyy-MM-dd, so a day's sessions group without timezone arithmetic.
    var day: String
    /// ISO-8601 STRING, not a Date.
    ///
    /// The plugin writes this file too, and JavaScript writes an ISO string
    /// while Swift's default JSONDecoder expects a number for `Date`. Decoding
    /// would have failed on every session the plugin created — silently, since
    /// the failure path just sets lastError — and the workout panel would have
    /// stayed empty with no clue why. ISO strings also sort correctly as text,
    /// so nothing is lost by keeping it a string.
    var startedAt: String = ISO8601DateFormatter().string(from: Date())
    var title: String = ""
    var exercises: [Exercise] = []
    var notes: String = ""

    var totalSets: Int { exercises.reduce(0) { $0 + $1.sets.count } }
    var volume: Double { exercises.reduce(0) { $0 + $1.volume } }
}

/// The portable, day-keyed part of Orion's health history.  It contains facts,
/// not a fabricated verdict: the calendar can always recompute a score from
/// the facts and the current scoring policy.
struct HealthDayRecord: Codable, Equatable {
    var waterBottles: Int = 0
    var calories: Int = 0
    var supplementIDs: [String] = []
    var recovery: Int?
    var sleepPerformance: Int?
    var sleepHours: Double?
    var hrv: Int?
    var restingHeartRate: Int?
    var strain: Double?
    var updatedAt: String = ""
}

struct NutritionEntry: Identifiable, Codable, Equatable {
    var id: String = UUID().uuidString
    var title: String
    var meal: String = "Meal"
    var calories: Int
    var protein: Int = 0
    var carbohydrates: Int = 0
    var fat: Int = 0
    var fiber: Int = 0
    var notes: String = ""
    var loggedAt: String = ISO8601DateFormatter().string(from: Date())
}

struct NutritionGoals: Codable, Equatable {
    var calories: Int = 2_200
    var protein: Int = 150
    var carbohydrates: Int = 250
    var fat: Int = 70
    var fiber: Int = 30
}

struct HealthLogFile: Codable {
    var schema: String = "orion.health.v3"
    var updatedAt: String = ""
    var supplements: [Supplement] = []
    /// day -> supplement ids taken that day.
    var supplementLog: [String: [String]] = [:]
    var workouts: [WorkoutSession] = []
    /// Deliberately optional for backward compatibility with the existing
    /// on-disk log and the companion plugin. Calories are a manual daily total
    /// until a nutrition/HealthKit source is connected.
    var calorieLog: [String: Int]?
    /// One plain record per logical day.  Legacy fields remain while the
    /// companion plugin migrates, so no existing data is discarded.
    var days: [String: HealthDayRecord]?
    var nutritionLog: [String: [NutritionEntry]]?
    var nutritionGoals: NutritionGoals?
}

// MARK: - Store

final class HealthLog: ObservableObject {

    @Published private(set) var supplements: [Supplement] = []
    @Published private(set) var takenToday: Set<String> = []
    @Published private(set) var workouts: [WorkoutSession] = []
    @Published private(set) var caloriesToday = 0
    @Published private(set) var mealsToday: [NutritionEntry] = []
    @Published private(set) var nutritionGoals = NutritionGoals()
    @Published private(set) var hydrationBottles = 0
    @Published private(set) var dailyRecords: [String: HealthDayRecord] = [:]
    @Published private(set) var lastError: String?

    /// Shared with the plugin, so Orion can write what Nick says out loud.
    ///
    /// `ORION_HEALTH_LOG` redirects it, and exists for exactly one caller: the
    /// race harness in `Tests/`. Without the seam that harness has two bad
    /// options — duplicate `mutate()` and prove nothing about the code that
    /// actually ships, or race Nick's real supplement list. It reads the
    /// environment of this process only, which is not a channel anything hostile
    /// reaches; the app is launched by Nick from /Applications.
    static var fileURL: URL {
        if let override = ProcessInfo.processInfo.environment["ORION_HEALTH_LOG"],
           !override.isEmpty {
            return URL(fileURLWithPath: (override as NSString).expandingTildeInPath)
        }
        let home = FileManager.default.homeDirectoryForCurrentUser
        return home
            .appendingPathComponent(".openclaw")
            .appendingPathComponent("orion-controlled")
            .appendingPathComponent("health-log.json")
    }

    private var watcher: Timer?

    /// The LOGICAL day, not the civil one.
    ///
    /// A supplement taken at 1am belongs to the day you are still in, not to
    /// the one the clock has just rolled into. Same rule everywhere — see
    /// OrionDay for why midnight is the wrong boundary for a person.
    static var today: String { OrionDay.current.key }

    func start() {
        load()
        // Polled rather than watched with FSEvents for the same reason the
        // reminder store is: a poll cannot get into a state where it believes
        // it is subscribed and is not.
        watcher = Timer.scheduledTimer(withTimeInterval: 3, repeats: true) { [weak self] _ in
            self?.load()
        }
    }

    func stop() {
        watcher?.invalidate()
        watcher = nil
    }

    // MARK: Reading

    private var lastLoadedStamp: String?
    private var lastResolvedDay: String?

    func load() {
        guard let data = try? Data(contentsOf: Self.fileURL) else {
            // No file yet is the normal first-run state, not an error.
            return
        }
        guard let file = try? JSONDecoder().decode(HealthLogFile.self, from: data) else {
            lastError = "health-log.json could not be read."
            return
        }
        // Skip the republish when nothing changed, so the 3s poll does not
        // redraw the dashboard constantly.
        let today = Self.today
        if file.updatedAt == lastLoadedStamp, today == lastResolvedDay { return }
        lastLoadedStamp = file.updatedAt
        lastResolvedDay = today
        supplements = file.supplements
        dailyRecords = file.days ?? [:]
        let todayRecord = dailyRecords[today]
        takenToday = Set(todayRecord?.supplementIDs ?? file.supplementLog[today] ?? [])
        workouts = file.workouts.sorted { $0.startedAt > $1.startedAt }
        mealsToday = (file.nutritionLog?[today] ?? []).sorted { $0.loggedAt > $1.loggedAt }
        caloriesToday = mealsToday.reduce(0) { $0 + $1.calories }
        if caloriesToday == 0 { caloriesToday = todayRecord?.calories ?? file.calorieLog?[today] ?? 0 }
        nutritionGoals = file.nutritionGoals ?? NutritionGoals()
        hydrationBottles = todayRecord?.waterBottles ?? 0
        lastError = nil
    }

    private static let knownTopLevelKeys: Set<String> = [
        "schema", "updatedAt", "supplements", "supplementLog", "workouts",
        "calorieLog", "days", "nutritionLog", "nutritionGoals",
    ]

    /// Read the typed document and retain top-level fields introduced by a
    /// newer companion. Swift's synthesized Codable conformance intentionally
    /// ignores unknown keys; writing that decoded value back without retaining
    /// them turns a harmless forward-compatible read into data loss.
    private func readForMutation() throws -> (HealthLogFile, [String: Any]) {
        do {
            let data = try Data(contentsOf: Self.fileURL)
            let file = try JSONDecoder().decode(HealthLogFile.self, from: data)
            let raw = try JSONSerialization.jsonObject(with: data) as? [String: Any] ?? [:]
            let unknown = raw.filter { !Self.knownTopLevelKeys.contains($0.key) }
            return (file, unknown)
        } catch let error as CocoaError where error.code == .fileReadNoSuchFile {
            return (HealthLogFile(), [:])
        }
    }

    private func read() -> HealthLogFile {
        (try? readForMutation().0) ?? HealthLogFile()
    }

    private static func retainingUnknownTopLevelFields(
        _ data: Data,
        unknown: [String: Any]
    ) throws -> Data {
        guard !unknown.isEmpty else { return data }
        guard var encoded = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw CocoaError(.fileWriteUnknown)
        }
        for (key, value) in unknown where encoded[key] == nil {
            encoded[key] = value
        }
        return try JSONSerialization.data(withJSONObject: encoded, options: [.prettyPrinted, .sortedKeys])
    }

    /// Read-modify-write, then republish.
    ///
    /// Every line of the read-modify-write is inside `FileLock.withLock`, and
    /// the read happens INSIDE it. The plugin writes this same file from the
    /// daemon process, so anything read before the lock was taken is a stale
    /// copy — writing it back is exactly how "I took my ashwagandha" erases the
    /// tick Nick just made in the UI. `Tests/run-race-test.sh` measures it: this
    /// store kept 284 of its 908 writes with the lock removed, and 671 of 671
    /// with it, racing the real plugin the whole time.
    ///
    /// Synchronous, and therefore blocking on the main thread. That is a
    /// deliberate trade: the hold is a couple of milliseconds for a file this
    /// size, and keeping it synchronous means the checkmark still flips the
    /// instant Nick taps it. The pathological case — a writer killed mid-write
    /// — is bounded at `FileLock.giveUpAfter` and self-heals in 15s.
    private func mutate(_ change: (inout HealthLogFile) -> Void) {
        do {
            // Before the lock: the lockfile lives in this directory, so it has
            // to exist before anyone can take it.
            try FileManager.default.createDirectory(
                at: Self.fileURL.deletingLastPathComponent(),
                withIntermediateDirectories: true,
                attributes: [.posixPermissions: 0o700]
            )
            try FileLock.withLock(Self.fileURL) {
                let (decoded, unknown) = try readForMutation()
                var file = decoded
                Self.migrateLegacyDays(&file)
                change(&file)
                file.updatedAt = ISO8601DateFormatter().string(from: Date())

                let encoder = JSONEncoder()
                encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
                let encoded = try encoder.encode(file)
                let data = try Self.retainingUnknownTopLevelFields(encoded, unknown: unknown)
                try Self.publish(data)
            }
            lastLoadedStamp = nil
            load()
        } catch {
            lastError = "Could not save: \(error.localizedDescription)"
        }
    }

    private static func migrateLegacyDays(_ file: inout HealthLogFile) {
        var days = file.days ?? [:]
        for (day, ids) in file.supplementLog {
            var record = days[day] ?? HealthDayRecord()
            if record.supplementIDs.isEmpty { record.supplementIDs = ids }
            days[day] = record
        }
        for (day, calories) in file.calorieLog ?? [:] {
            var record = days[day] ?? HealthDayRecord()
            if record.calories == 0 { record.calories = calories }
            days[day] = record
        }
        if file.schema != "orion.health.v3" {
            var nutrition = file.nutritionLog ?? [:]
            for (day, record) in days where record.calories > 0 && (nutrition[day] ?? []).isEmpty {
                nutrition[day] = [NutritionEntry(title: "Imported daily total", meal: "Other",
                                                   calories: record.calories,
                                                   notes: "Migrated from Orion's earlier calorie total.")]
            }
            file.nutritionLog = nutrition
        }
        file.schema = "orion.health.v3"
        file.days = days
    }

    private static func touch(_ record: inout HealthDayRecord) {
        record.updatedAt = ISO8601DateFormatter().string(from: Date())
    }

    /// Write to a scratch file, then rename it over the real one.
    ///
    /// The scratch name carries a UUID, and the plugin's carries random bytes.
    /// A fixed `.json.tmp` on both sides would be byte-for-byte the same path in
    /// the same directory: the two processes would write one scratch file and
    /// race to rename it, giving real errors rather than just lost data —
    /// `ENOENT` on the node side and "couldn't be saved" here, whenever one
    /// renamed the file out from under the other. The lock alone would prevent
    /// that; unique names mean a broken stale lock cannot bring it back.
    ///
    /// `rename(2)` rather than `replaceItemAt`: it is the same atomic swap the
    /// node side does, and unlike `replaceItemAt` it also works on first run,
    /// when there is no existing file to replace.
    ///
    /// 0600 because a supplement list and a training log are Nick's business.
    private static func publish(_ data: Data) throws {
        let scratch = fileURL.deletingLastPathComponent()
            .appendingPathComponent(".health-log.\(UUID().uuidString).tmp")

        // NOT `.completeFileProtection` — see the same note in
        // SessionService/SessionStore.swift `publish`. It applies a
        // data-protection class that can make the file unreadable to any
        // process other than the one that wrote it, and this file has two
        // writers and two readers in two processes by design: the plugin's
        // health.ts reads and writes it from the daemon. In
        // ~/.openclaw/orion-controlled/ the class happens not to bite, which is
        // what makes it a quiet bug — it only fails once the path moves, and
        // `ORION_HEALTH_LOG` above moves it. The identical line in SessionStore
        // cost an afternoon exactly that way: `cat` returned "Operation not
        // permitted" for a 0600 file the user owned, as soon as the state file
        // pointed at /private/tmp.
        //
        // 0600 is the actual requirement, and it is set explicitly below.
        try data.write(to: scratch, options: [.atomic])
        try FileManager.default.setAttributes([.posixPermissions: 0o600],
                                              ofItemAtPath: scratch.path)

        guard rename(scratch.path, fileURL.path) == 0 else {
            let failure = errno
            try? FileManager.default.removeItem(at: scratch)
            throw NSError(
                domain: NSPOSIXErrorDomain,
                code: Int(failure),
                userInfo: [
                    NSLocalizedDescriptionKey:
                        "could not publish health-log.json: \(String(cString: strerror(failure)))"
                ]
            )
        }
    }

    // MARK: Supplements

    func addSupplement(_ name: String, dose: String = "", timeOfDay: String = "anytime") {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        mutate { file in
            guard !file.supplements.contains(where: {
                $0.name.caseInsensitiveCompare(trimmed) == .orderedSame
            }) else { return }
            file.supplements.append(
                Supplement(name: trimmed, dose: dose, timeOfDay: timeOfDay)
            )
        }
    }

    func removeSupplement(_ id: String) {
        mutate { file in
            file.supplements.removeAll { $0.id == id }
            for (day, taken) in file.supplementLog {
                file.supplementLog[day] = taken.filter { $0 != id }
            }
        }
    }

    func toggleSupplement(_ id: String) {
        let day = Self.today
        mutate { file in
            var taken = file.supplementLog[day] ?? []
            if let index = taken.firstIndex(of: id) {
                taken.remove(at: index)
            } else {
                taken.append(id)
            }
            file.supplementLog[day] = taken
            var record = file.days?[day] ?? HealthDayRecord()
            record.supplementIDs = taken
            Self.touch(&record)
            file.days?[day] = record
        }
    }

    // MARK: Calories

    /// Records the day's food-energy total as an explicit user entry. Orion
    /// never estimates calories from recovery or workouts, and labels this as
    /// manual until a real nutrition provider is connected.
    func setCaloriesToday(_ calories: Int) {
        let day = Self.today
        mutate { file in
            var log = file.calorieLog ?? [:]
            log[day] = max(0, calories)
            file.calorieLog = log
            var record = file.days?[day] ?? HealthDayRecord()
            record.calories = max(0, calories)
            Self.touch(&record)
            file.days?[day] = record
            var nutrition = file.nutritionLog ?? [:]
            var meals = nutrition[day] ?? []
            meals.removeAll { $0.id == "manual-total-\(day)" }
            if calories > 0 {
                meals.append(NutritionEntry(id: "manual-total-\(day)", title: "Manual daily total",
                                             meal: "Other", calories: max(0, calories),
                                             notes: "Set as a daily total."))
            }
            nutrition[day] = meals
            file.nutritionLog = nutrition
        }
    }

    // MARK: Nutrition

    func addNutrition(_ entry: NutritionEntry) {
        let title = entry.title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !title.isEmpty, entry.calories >= 0 else { return }
        let day = Self.today
        mutate { file in
            var nutrition = file.nutritionLog ?? [:]
            var entries = nutrition[day] ?? []
            var saved = entry
            saved.title = title
            entries.append(saved)
            nutrition[day] = entries
            file.nutritionLog = nutrition
            var record = file.days?[day] ?? HealthDayRecord()
            record.calories = entries.reduce(0) { $0 + $1.calories }
            Self.touch(&record)
            file.days?[day] = record
        }
    }

    func removeNutrition(_ id: String) {
        let day = Self.today
        mutate { file in
            var nutrition = file.nutritionLog ?? [:]
            var entries = nutrition[day] ?? []
            entries.removeAll { $0.id == id }
            nutrition[day] = entries
            file.nutritionLog = nutrition
            var record = file.days?[day] ?? HealthDayRecord()
            record.calories = entries.reduce(0) { $0 + $1.calories }
            Self.touch(&record)
            file.days?[day] = record
        }
    }

    func setNutritionGoals(_ goals: NutritionGoals) {
        mutate { $0.nutritionGoals = goals }
    }

    var recentFoods: [NutritionEntry] {
        var seen = Set<String>()
        return dailyRecords.keys.sorted(by: >).flatMap { day in
            read().nutritionLog?[day] ?? []
        }.filter { seen.insert($0.title.lowercased()).inserted }.prefix(8).map { $0 }
    }

    // MARK: Daily facts

    func logHydration() { setHydration(hydrationBottles + 1) }

    func removeHydration() { setHydration(max(0, hydrationBottles - 1)) }

    func setHydration(_ bottles: Int) {
        let day = Self.today
        mutate { file in
            var record = file.days?[day] ?? HealthDayRecord()
            record.waterBottles = max(0, bottles)
            Self.touch(&record)
            file.days?[day] = record
        }
    }

    /// Store only measurements actually supplied by the wearable.  Missing
    /// readings stay missing, rather than becoming zeros in the history.
    func recordWearable(recovery: Int?, sleepPerformance: Int?, sleepHours: Double?,
                        hrv: Int?, restingHeartRate: Int?, strain: Double?) {
        let day = Self.today
        mutate { file in
            var record = file.days?[day] ?? HealthDayRecord()
            if let recovery { record.recovery = recovery }
            if let sleepPerformance { record.sleepPerformance = sleepPerformance }
            if let sleepHours { record.sleepHours = sleepHours }
            if let hrv { record.hrv = hrv }
            if let restingHeartRate { record.restingHeartRate = restingHeartRate }
            if let strain { record.strain = strain }
            Self.touch(&record)
            file.days?[day] = record
        }
    }

    func record(for day: String) -> HealthDayRecord? { dailyRecords[day] }

    /// Grouped for display. A named Identifiable type rather than a tuple:
    /// SwiftUI's ForEach needs an id key path, and `\.0` is not a legal key
    /// path on a tuple.
    struct SupplementGroup: Identifiable {
        let id: String
        let items: [Supplement]
    }

    var supplementsByTime: [SupplementGroup] {
        let order = ["morning", "lunch", "evening", "anytime"]
        return order.compactMap { slot in
            let matching = supplements.filter { $0.timeOfDay == slot }
            return matching.isEmpty ? nil : SupplementGroup(id: slot, items: matching)
        }
    }

    // MARK: Workouts

    var todaysWorkout: WorkoutSession? {
        workouts.first { $0.day == Self.today }
    }

    /// Add a set, creating today's session and the exercise if needed.
    ///
    /// One entry point rather than separate create-session / create-exercise /
    /// add-set calls, because every caller — the UI and Orion — wants the same
    /// thing: "record that I just did this".
    func logSet(exercise: String, weight: Double, reps: Int, unit: String = "lb") {
        let name = exercise.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty, reps > 0 else { return }
        let day = Self.today
        mutate { file in
            var session = file.workouts.first { $0.day == day } ?? WorkoutSession(day: day)
            var exercises = session.exercises
            let index = exercises.firstIndex {
                $0.name.caseInsensitiveCompare(name) == .orderedSame
            }
            if let index {
                exercises[index].sets.append(WorkoutSet(weight: weight, reps: reps, unit: unit))
            } else {
                exercises.append(
                    Exercise(name: name, sets: [WorkoutSet(weight: weight, reps: reps, unit: unit)])
                )
            }
            session.exercises = exercises
            file.workouts.removeAll { $0.id == session.id }
            file.workouts.append(session)
        }
    }

    func removeSet(exerciseID: String, setID: String) {
        let day = Self.today
        mutate { file in
            guard let sessionIndex = file.workouts.firstIndex(where: { $0.day == day })
            else { return }
            var session = file.workouts[sessionIndex]
            guard let exerciseIndex = session.exercises.firstIndex(where: { $0.id == exerciseID })
            else { return }
            session.exercises[exerciseIndex].sets.removeAll { $0.id == setID }
            // An exercise with no sets left is noise, not history.
            if session.exercises[exerciseIndex].sets.isEmpty {
                session.exercises.remove(at: exerciseIndex)
            }
            file.workouts[sessionIndex] = session
        }
    }

    func setWorkoutTitle(_ title: String) {
        let day = Self.today
        mutate { file in
            var session = file.workouts.first { $0.day == day } ?? WorkoutSession(day: day)
            session.title = title
            file.workouts.removeAll { $0.id == session.id }
            file.workouts.append(session)
        }
    }

    /// The last time this exercise was trained before today, for a target.
    func previousBest(_ exercise: String) -> (day: String, set: WorkoutSet)? {
        let day = Self.today
        for session in workouts where session.day != day {
            if let match = session.exercises.first(where: {
                $0.name.caseInsensitiveCompare(exercise) == .orderedSame
            }), let top = match.topSet {
                return (session.day, top)
            }
        }
        return nil
    }

    var recentExerciseNames: [String] {
        var seen: [String] = []
        for session in workouts {
            for exercise in session.exercises where !seen.contains(exercise.name) {
                seen.append(exercise.name)
            }
        }
        return seen
    }
}
