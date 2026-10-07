import Foundation

/*
 ORION noticing the day on his own (2026-09-29).

 Every five minutes the app runs `orion-watch tick` (the installed copy under
 ~/.openclaw/orion-remote, which this app can reach): it asks about an empty day
 once he's up and again after his last class, and reshapes the morning after a
 short night. Its messages go into the phone link's outbox, and from there to
 his iPhone. Run from this app because this app holds the Calendar permission
 the calendar bridge needs. Driven by the dashboard's ticker, which lives as
 long as the app does.
*/
@MainActor
final class LifeWatch {
    private var next = Date()
    private var running = false
    private let every: TimeInterval = 5 * 60

    func tick(now: Date = Date()) {
        guard now >= next, !running else { return }
        next = now.addingTimeInterval(every)
        running = true
        let home = FileManager.default.homeDirectoryForCurrentUser
        let node = home.appendingPathComponent(".openclaw/tools/node-v24.15.0/bin/node")
        let script = home.appendingPathComponent(".openclaw/orion-remote/scripts/orion-watch")
        guard FileManager.default.isExecutableFile(atPath: node.path),
              FileManager.default.fileExists(atPath: script.path) else { running = false; return }
        Task.detached {
            let process = Process()
            process.executableURL = node
            process.arguments = [script.path, "tick", "--json"]
            process.standardOutput = FileHandle.nullDevice
            process.standardError = FileHandle.nullDevice
            try? process.run()
            process.waitUntilExit()
            // Watches: weather, important texts and mail (orion-watches, 2026-10-07).
            let watches = Process()
            watches.executableURL = node
            watches.arguments = [script.deletingLastPathComponent().appendingPathComponent("orion-watches").path, "tick"]
            watches.standardOutput = FileHandle.nullDevice
            watches.standardError = FileHandle.nullDevice
            try? watches.run()
            watches.waitUntilExit()
            // Speaking first, with context: session ends, bedtime only when it fits (orion-proactive).
            let proactive = Process()
            proactive.executableURL = node
            proactive.arguments = [script.deletingLastPathComponent().appendingPathComponent("orion-proactive").path, "tick"]
            proactive.standardOutput = FileHandle.nullDevice
            proactive.standardError = FileHandle.nullDevice
            try? proactive.run()
            proactive.waitUntilExit()
            await MainActor.run { self.running = false }
        }
    }
}
