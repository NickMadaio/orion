import Foundation

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

struct HealthLogFile: Codable {
    var schema: String = "orion.health.v1"
    var updatedAt: String = ""
    var supplements: [Supplement] = []
    /// day -> supplement ids taken that day.
    var supplementLog: [String: [String]] = [:]
    var workouts: [WorkoutSession] = []
}

// MARK: - Store

final class HealthLog: ObservableObject {

    @Published private(set) var supplements: [Supplement] = []
    @Published private(set) var takenToday: Set<String> = []
    @Published private(set) var workouts: [WorkoutSession] = []
    @Published private(set) var lastError: String?

    /// Shared with the plugin, so Orion can write what Nick says out loud.
    static var fileURL: URL {
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
        if file.updatedAt == lastLoadedStamp { return }
        lastLoadedStamp = file.updatedAt
        supplements = file.supplements
        takenToday = Set(file.supplementLog[Self.today] ?? [])
        workouts = file.workouts.sorted { $0.startedAt > $1.startedAt }
        lastError = nil
    }

    private func read() -> HealthLogFile {
        guard let data = try? Data(contentsOf: Self.fileURL),
              let file = try? JSONDecoder().decode(HealthLogFile.self, from: data)
        else { return HealthLogFile() }
        return file
    }

    /// Read-modify-write, then republish. Atomic rename so a reader never sees
    /// a half-written file.
    private func mutate(_ change: (inout HealthLogFile) -> Void) {
        var file = read()
        change(&file)
        file.updatedAt = ISO8601DateFormatter().string(from: Date())
        do {
            try FileManager.default.createDirectory(
                at: Self.fileURL.deletingLastPathComponent(),
                withIntermediateDirectories: true,
                attributes: [.posixPermissions: 0o700]
            )
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
            let data = try encoder.encode(file)
            let temporary = Self.fileURL.appendingPathExtension("tmp")
            try data.write(to: temporary, options: .atomic)
            _ = try FileManager.default.replaceItemAt(Self.fileURL, withItemAt: temporary)
            lastLoadedStamp = nil
            load()
        } catch {
            lastError = "Could not save: \(error.localizedDescription)"
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
        }
    }

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
