import Foundation

/*
 What the self-development loop is doing, read from the file it already writes.

 `scripts/orion-code` writes `selfdev-state.json` after every task, and this
 reads THAT rather than shelling out to `orion-code status` or keeping its own
 idea of the run. One writer, one file, one truth -- a second source of truth is
 a lie with a delay fuse, and this project has already paid for that lesson more
 than once.

 Everything here is derived, nothing is cached across reads, and a missing or
 unreadable file is a normal state rather than an error: the loop has usually
 never been run.
 */

struct SelfDevelopmentStatus {

    enum Activity: Equatable {
        /// Running right now, with a live pid.
        case running
        /// Reached its own end -- either the time ran out or nothing was left.
        case finished
        /// The pid is gone and it never wrote a finish time. Killed, crashed,
        /// or the machine slept through the deadline. A real outcome, and one
        /// worth naming rather than reporting the last number it happened to
        /// write as though the run had ended tidily.
        case stoppedWithoutFinishing
        /// No state file at all.
        case neverRun
    }

    var activity: Activity = .neverRun
    var startedAt: String?
    var finishedAt: String?
    var landed: Int = 0
    var didNotLand: Int = 0
    var currentTask: String?
    var stoppedBecause: String?
    var mode: String?

    /// The one-line answer, phrased the way the CLI phrases it.
    var headline: String {
        switch activity {
        case .running:
            return "Running — \(landed) landed, \(didNotLand) did not"
        case .finished:
            return "Finished — \(landed) landed, \(didNotLand) did not"
        case .stoppedWithoutFinishing:
            return "Stopped without finishing — \(landed) landed before it stopped"
        case .neverRun:
            return "Not run yet"
        }
    }

    /// The second line, when there is something honest to add.
    var detail: String? {
        switch activity {
        case .running:
            return currentTask
        case .finished:
            return stoppedBecause.map { "Stopped because \($0)." }
        case .stoppedWithoutFinishing:
            return "Nothing was lost — everything that passed is already committed."
        case .neverRun:
            return "Start it with: orion-code loop --hours 7"
        }
    }

    static let stateURL = URL(fileURLWithPath: NSHomeDirectory())
        .appendingPathComponent(".openclaw/orion-controlled/selfdev-state.json")
    static let reportURL = URL(fileURLWithPath: NSHomeDirectory())
        .appendingPathComponent(".openclaw/orion-controlled/selfdev-report.md")

    /// Read the current state. Never throws: not-run is the common case.
    static func read(
        stateURL: URL = SelfDevelopmentStatus.stateURL,
        isAlive: (Int32) -> Bool = SelfDevelopmentStatus.processIsAlive
    ) -> SelfDevelopmentStatus {
        guard
            let data = try? Data(contentsOf: stateURL),
            let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return SelfDevelopmentStatus() }

        var status = SelfDevelopmentStatus()
        status.startedAt = object["started"] as? String
        status.finishedAt = object["finished"] as? String
        status.landed = object["passed"] as? Int ?? 0
        status.didNotLand = object["failed"] as? Int ?? 0
        status.currentTask = object["last"] as? String
        status.stoppedBecause = object["stopped_because"] as? String
        status.mode = object["mode"] as? String

        if status.finishedAt != nil {
            status.activity = .finished
        } else if let pid = object["pid"] as? Int, isAlive(Int32(pid)) {
            status.activity = .running
        } else if object["pid"] != nil {
            status.activity = .stoppedWithoutFinishing
        } else {
            status.activity = .neverRun
        }
        return status
    }

    /// Signal 0 asks "does this pid exist and may I signal it" without sending
    /// anything, which is exactly the question.
    static func processIsAlive(_ pid: Int32) -> Bool {
        kill(pid, 0) == 0
    }

    /// The `## Commits on the branch` block of the report, if there is one.
    static func recentWork(reportURL: URL = SelfDevelopmentStatus.reportURL) -> [String] {
        guard let text = try? String(contentsOf: reportURL, encoding: .utf8) else { return [] }
        guard let marker = text.range(of: "## Commits on the branch") else { return [] }
        return text[marker.upperBound...]
            .split(separator: "\n")
            .map(String.init)
            .filter { !$0.isEmpty && !$0.hasPrefix("```") && $0 != "(none)" }
            .prefix(8)
            .map { String($0) }
    }
}
