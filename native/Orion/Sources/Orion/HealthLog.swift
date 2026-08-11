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
                var file = read()
                change(&file)
                file.updatedAt = ISO8601DateFormatter().string(from: Date())

                let encoder = JSONEncoder()
                encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
                let data = try encoder.encode(file)
                try Self.publish(data)
            }
            lastLoadedStamp = nil
            load()
        } catch {
            lastError = "Could not save: \(error.localizedDescription)"
        }
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
