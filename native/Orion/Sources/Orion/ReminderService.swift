import AppKit
import Foundation

/*
 The half of a timer that actually goes off.

 (w19-reminders) It no longer decides anything: it notices that a reminder is due and runs `orion-reminders tick`,
 which words it, picks the channel (phone when he is away, bubble and voice at the Mac, phone in a game or a
 meeting, held in focus unless important), rolls recurring ones on, and says what the Mac slept through.

 The plugin can write a timer down, but it cannot wake up: it exists only for
 the moment a tool call is running. Something has to be alive at the minute the
 timer is due, and the only thing that always is, is this app. So the plugin
 owns the store and this owns the clock.

 The contract is a file and nothing else — no port, no IPC, no shared object.
 The plugin writes `reminders.json` by atomic rename; this polls it. That is
 deliberately the dumbest possible coupling: either side can crash, be rebuilt,
 or be running an older version, and the worst case is a timer that fires a few
 seconds late rather than a channel that is quietly dead. This project has been
 bitten repeatedly by things that report health while doing nothing, and a plain
 file on disk has very little room to lie.
 */

struct RepeatRule: Codable, Equatable {
    var days: [Int]
    var time: String
}

struct StoredReminder: Codable, Equatable {
    var id: String
    var kind: String
    var label: String
    /// Epoch milliseconds, matching `Date.now()` on the plugin side.
    var dueAt: Double
    var createdAt: Double
    /// Set once delivered (epoch ms); a recurring reminder keeps its last one while `dueAt` rolls on.
    var firedAt: Double? = nil
    /// "Every Monday at 9": the schedule the script rolls `dueAt` along.
    var repeatRule: RepeatRule? = nil
    /// "When I get home": fires on arrival, `dueAt` is only its expiry.
    var place: String? = nil
    /// Delivered and not yet answered (epoch ms): the one resurface after 30 minutes hangs on it.
    var open: Double? = nil
    var nudged: Bool? = nil
    /// A tick has this one in hand (epoch ms); another tick leaves it alone for a minute.
    var inflight: Double? = nil

    enum CodingKeys: String, CodingKey {
        case id, kind, label, dueAt, createdAt, firedAt, place, open, nudged, inflight
        case repeatRule = "repeat"
    }

    var dueDate: Date { Date(timeIntervalSince1970: dueAt / 1000) }
}

final class ReminderService {

    private let url: URL
    private let script: URL
    private let node: URL
    private var timer: Timer?
    private var wakeObserver: NSObjectProtocol?
    private var lastSlowTick = Date.distantPast
    private var ticking = false
    private var warnedMissingScript = false

    /// Every two seconds. Fine enough that a reminder lands within seconds of its time, coarse enough to be free.
    private static let pollInterval: TimeInterval = 2
    /// "When I get home" and "still open?" depend on where he is and what he did, not on the clock: a minute is plenty.
    private static let slowInterval: TimeInterval = 60
    /// A tick that claimed a reminder has a minute to deliver it before another tick may take it over.
    private static let claimMs: Double = 60_000

    init(path: String? = nil) {
        let resolved = path ?? NSString(
            string: "~/.openclaw/orion-controlled/reminders.json"
        ).expandingTildeInPath
        self.url = URL(fileURLWithPath: resolved)
        let home = FileManager.default.homeDirectoryForCurrentUser
        self.script = home.appendingPathComponent(".openclaw/orion-remote/scripts/orion-reminders")
        self.node = home.appendingPathComponent(".openclaw/tools/node-v24.15.0/bin/node")
    }

    /// Whether something in the store is due for the clock to act on right now. A reminder the Mac slept through
    /// counts however late it is: the script decides to say it as missed, or to drop it as too old.
    static func needsTick(_ reminders: [StoredReminder], now: Date) -> Bool {
        let t = now.timeIntervalSince1970 * 1000
        return reminders.contains { r in
            if let claimed = r.inflight, t - claimed < claimMs { return false }
            if r.place != nil && r.firedAt == nil { return t >= r.dueAt }
            return t >= r.dueAt && (r.repeatRule != nil || r.firedAt == nil)
        }
    }

    /// Reminders that wait on him rather than the clock: a place to arrive at, or an answer to a fired one.
    static func wantsSlowTick(_ reminders: [StoredReminder], now: Date) -> Bool {
        reminders.contains { r in
            (r.place != nil && r.firedAt == nil) || (r.open != nil && r.nudged != true)
        }
    }

    func start() {
        stop()
        let timer = Timer(timeInterval: ReminderService.pollInterval,
                          repeats: true) { [weak self] _ in
            self?.poll()
        }
        // `.common` so the polling survives menu tracking and window drags. On
        // the default run loop mode a timer stops while a menu is open, which
        // would mean a timer that fires only once the user stops interacting.
        RunLoop.main.add(timer, forMode: .common)
        self.timer = timer
        // A Mac that wakes has reminders it slept through: say them as soon as it is awake and the network is back.
        wakeObserver = NSWorkspace.shared.notificationCenter.addObserver(
            forName: NSWorkspace.didWakeNotification, object: nil, queue: .main
        ) { [weak self] _ in
            DispatchQueue.main.asyncAfter(deadline: .now() + 5) { self?.poll(force: true) }
        }
        poll()
    }

    func stop() {
        timer?.invalidate()
        timer = nil
        if let wakeObserver { NSWorkspace.shared.notificationCenter.removeObserver(wakeObserver) }
        wakeObserver = nil
    }

    private func poll(force: Bool = false) {
        let now = Date()
        let reminders = load()
        guard !reminders.isEmpty else { return }
        let slow = ReminderService.wantsSlowTick(reminders, now: now) && now.timeIntervalSince(lastSlowTick) >= ReminderService.slowInterval
        guard force || slow || ReminderService.needsTick(reminders, now: now) else { return }
        if slow || force { lastSlowTick = now }
        runTick()
    }

    /// The whole decision (what to say, through which channel, snooze, missed, recurring) lives in
    /// `orion-reminders tick`, which is tested; this only wakes it. Two ticks never overlap here, and the script
    /// claims each reminder under a lock, so the app and orion-proactive's backstop can both call it safely.
    private func runTick() {
        guard !ticking else { return }
        guard FileManager.default.isExecutableFile(atPath: script.path) else {
            if !warnedMissingScript {
                warnedMissingScript = true
                OrionLog.write("[reminder] orion-reminders is not installed at \(script.path): reminders will NOT fire until the scripts are deployed")
            }
            return
        }
        ticking = true
        let node = self.node, script = self.script
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            let process = Process()
            process.executableURL = node
            process.arguments = [script.path, "tick"]
            let pipe = Pipe()
            process.standardOutput = pipe
            process.standardError = pipe
            do {
                try process.run()
                process.waitUntilExit()
                let out = String(data: pipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8)?
                    .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
                if !out.isEmpty && out != "Nothing due." { OrionLog.write("[reminder] \(out)") }
            } catch {
                OrionLog.write("[reminder] could not run the clock: \(error.localizedDescription)")
            }
            DispatchQueue.main.async { self?.ticking = false }
        }
    }

    private func load() -> [StoredReminder] {
        guard let data = try? Data(contentsOf: url) else { return [] }
        // A partially-written file would decode to nothing rather than throw
        // the poll off; the plugin writes by atomic rename, so this should not
        // happen, and if it does the next poll two seconds later recovers.
        return (try? JSONDecoder().decode([StoredReminder].self, from: data)) ?? []
    }
}
