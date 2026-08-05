import AppKit
import Foundation

/*
 The half of a timer that actually goes off.

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

struct StoredReminder: Codable, Equatable {
    var id: String
    var kind: String
    var label: String
    /// Epoch milliseconds, matching `Date.now()` on the plugin side.
    var dueAt: Double
    var createdAt: Double

    var dueDate: Date { Date(timeIntervalSince1970: dueAt / 1000) }
}

final class ReminderService {

    /// Announce a due reminder. Set by `AppState`, which owns the voice.
    var onDue: ((StoredReminder) -> Void)?

    private let url: URL
    private var timer: Timer?

    /// Ids already announced.
    ///
    /// The store is rewritten by the plugin, not by this app, so a fired
    /// reminder may still be sitting in the file the next time it is read —
    /// there is a window between firing and the plugin's next prune. Without
    /// this, a timer would announce itself once every poll for as long as that
    /// window lasts, which is the kind of bug that is merely annoying at 2pm
    /// and genuinely awful at 3am.
    private var announced = Set<String>()

    /// Every two seconds. Fine enough that "your timer is up" lands when it
    /// should, coarse enough to be free.
    private static let pollInterval: TimeInterval = 2

    /// How late is too late to still be worth saying.
    ///
    /// A Mac that was asleep for an hour should not wake and read out a timer
    /// that expired forty minutes ago as though it just happened. Anything
    /// older than this is dropped silently — the moment has passed, and saying
    /// so is worse than saying nothing.
    private static let staleAfter: TimeInterval = 120

    init(path: String? = nil) {
        let resolved = path ?? NSString(
            string: "~/.openclaw/orion-controlled/reminders.json"
        ).expandingTildeInPath
        self.url = URL(fileURLWithPath: resolved)
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
        poll()
    }

    func stop() {
        timer?.invalidate()
        timer = nil
    }

    private func poll() {
        let now = Date()
        let reminders = load()

        // Forget ids that are no longer in the store, so `announced` cannot
        // grow without bound over a long uptime.
        let liveIds = Set(reminders.map(\.id))
        announced.formIntersection(liveIds)

        for reminder in reminders {
            guard !announced.contains(reminder.id) else { continue }
            let overdue = now.timeIntervalSince(reminder.dueDate)
            guard overdue >= 0 else { continue }
            announced.insert(reminder.id)
            guard overdue <= ReminderService.staleAfter else {
                OrionLog.write("[reminder] \(reminder.id) was \(Int(overdue))s late — dropped")
                continue
            }
            OrionLog.write("[reminder] firing \(reminder.id) “\(reminder.label)”")
            onDue?(reminder)
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
