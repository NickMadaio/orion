import Foundation
import SessionDomain
import SessionService

/*
 Focus session phase changes, told to the awareness core at once (awareness
 spec 3.2, contract C3).

 Before this, held messages were released by a 5-minute poll, so a 2-minute
 break could come and go without Nick hearing a thing that had waited for it.
 Now every change of (status, phase kind, phase index) spawns, detached,
 `orion-awareness phase --from focus --to rest --session '<json>'`, which
 refreshes awareness.json and drains the held messages when the gate allows it.
 A pause that crosses 3 minutes fires once more from the heartbeat.

 The pieces are small and pure so the timing can be tested without a session:
 `SessionPhaseInfo` (what the snapshot says), `PhaseTracker` (what changed),
 `PhaseCommands` (what to run), and `PhaseHook` (the glue, with an injectable runner).
*/

/// What a session snapshot says about the phase, reduced to what the hook needs.
struct SessionPhaseInfo: Equatable {
    /// The awareness `session.state` vocabulary: focus, rest, paused, waiting, none.
    var state: String
    var phaseKind: String?
    var phaseIndex: Int
    var sessionID: String?
    var task: String?
    var remaining: TimeInterval?

    /// The identity that decides whether anything changed. Heartbeats leave it alone.
    var key: String { "\(state)|\(phaseKind ?? "-")|\(phaseIndex)" }

    init(state: String, phaseKind: String? = nil, phaseIndex: Int = 0,
         sessionID: String? = nil, task: String? = nil, remaining: TimeInterval? = nil) {
        self.state = state; self.phaseKind = phaseKind; self.phaseIndex = phaseIndex
        self.sessionID = sessionID; self.task = task; self.remaining = remaining
    }

    init(snapshot: SessionSnapshot) {
        let sessionID = snapshot.session?.plan.sessionID.raw
        let task = snapshot.session?.plan.task
        guard let now = snapshot.reconciliation else {
            self.init(state: "none"); return
        }
        let state: String
        var kind: String?
        switch now.status {
        case .running(let phase): state = phase.isFocus ? "focus" : "rest"; kind = phase.rawValue
        case .paused: state = "paused"
        case .waitingForReturn: state = "waiting"
        case .notStarted, .readyToComplete, .readyToAbandon, .finished: state = "none"
        }
        self.init(state: state, phaseKind: kind, phaseIndex: now.phaseIndex,
                  sessionID: sessionID, task: task, remaining: now.remainingInPhase)
    }
}

struct PhaseTransition: Equatable {
    var from: String
    var to: String
    /// True for the one extra fire when a pause crosses `PhaseTracker.pauseRelease`.
    var longPause = false
    var reason: String {
        switch to {
        case "none": return "end"
        default: return "break"
        }
    }
}

/// Remembers the last phase and reports a transition when it changes.
/// The first observation after launch is a baseline, not a change: nothing
/// happened, the app just started looking.
struct PhaseTracker {
    static let pauseRelease: TimeInterval = 3 * 60

    private var last: SessionPhaseInfo?
    private var since = Date.distantPast
    private var pauseFired = false

    mutating func observe(_ info: SessionPhaseInfo, now: Date) -> PhaseTransition? {
        defer { last = info }
        guard let previous = last else { since = now; return nil }
        if previous.key != info.key {
            since = now; pauseFired = false
            return PhaseTransition(from: previous.state, to: info.state)
        }
        if info.state == "paused", !pauseFired, now.timeIntervalSince(since) >= Self.pauseRelease {
            pauseFired = true
            return PhaseTransition(from: "paused", to: "paused", longPause: true)
        }
        return nil
    }
}

struct PhaseCommand: Equatable {
    var executable: String
    var arguments: [String]
}

enum PhaseCommands {
    /// The session JSON of contract C1 (`session` facet), plus the source marker.
    static func sessionJSON(_ info: SessionPhaseInfo, now: Date) -> String {
        var object: [String: Any] = [
            "state": info.state, "phaseIndex": info.phaseIndex,
            "at": ISO8601DateFormatter().string(from: now), "source": "phase-hook",
        ]
        if let id = info.sessionID { object["sessionId"] = id }
        if let task = info.task, !task.isEmpty { object["task"] = task }
        if let remaining = info.remaining, remaining.isFinite, info.state == "focus" || info.state == "rest" {
            object["phaseEndsAt"] = ISO8601DateFormatter().string(from: now.addingTimeInterval(max(0, remaining)))
        }
        let data = (try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])) ?? Data("{}".utf8)
        return String(decoding: data, as: UTF8.self)
    }

    /// `phase` first (it refreshes and drains in one go). When the awareness CLI
    /// is not installed or fails, the drain is spawned by name so a break still
    /// releases what waited for it. Entering focus drains nothing.
    static func plan(_ transition: PhaseTransition, info: SessionPhaseInfo, now: Date,
                     node: String, scriptsDir: String, exists: (String) -> Bool) -> (primary: PhaseCommand?, fallback: PhaseCommand?) {
        guard exists(node) else { return (nil, nil) }
        let awareness = scriptsDir + "/orion-awareness"
        let reach = scriptsDir + "/orion-reach"
        let primary = exists(awareness)
            ? PhaseCommand(executable: node, arguments: [awareness, "phase", "--from", transition.from, "--to", transition.to,
                                                        "--session", sessionJSON(info, now: now)])
            : nil
        let fallback = transition.to != "focus" && exists(reach)
            ? PhaseCommand(executable: node, arguments: [reach, "--drain-held", "--reason", transition.reason])
            : nil
        return (primary, fallback)
    }
}

/// Glue: watches snapshots, fires the commands. Safe to call from any queue.
final class PhaseHook {
    typealias Runner = (PhaseCommand) -> Bool
    static let timeout: TimeInterval = 30

    private let lock = NSLock()
    private var tracker = PhaseTracker()
    private let run: Runner
    private let exists: (String) -> Bool
    private let scriptsDir: String
    private let node: String
    private let log: (String) -> Void
    private let queue = DispatchQueue(label: "orion.phase-hook", qos: .utility)

    init(run: @escaping Runner = PhaseHook.spawn,
         exists: @escaping (String) -> Bool = { FileManager.default.isExecutableFile(atPath: $0) || FileManager.default.fileExists(atPath: $0) },
         home: String = FileManager.default.homeDirectoryForCurrentUser.path,
         log: @escaping (String) -> Void = { OrionLog.write($0) }) {
        self.run = run; self.exists = exists; self.log = log
        node = home + "/.openclaw/tools/node-v24.15.0/bin/node"
        scriptsDir = home + "/.openclaw/orion-remote/scripts"
    }

    /// Called on every session change, heartbeats included. Spawns only on a change.
    /// `sync` is for tests; the app runs the commands on a utility queue.
    func observe(_ info: SessionPhaseInfo, now: Date = Date(), sync: Bool = false) {
        lock.lock()
        let transition = tracker.observe(info, now: now)
        lock.unlock()
        guard let transition else { return }
        let work = { self.fire(transition, info: info, now: now) }
        if sync { work() } else { queue.async(execute: work) }
    }

    private func fire(_ transition: PhaseTransition, info: SessionPhaseInfo, now: Date) {
        let name = "\(transition.from)->\(transition.to)"
        let plan = PhaseCommands.plan(transition, info: info, now: now, node: node, scriptsDir: scriptsDir, exists: exists)
        guard plan.primary != nil || plan.fallback != nil else {
            log("[phase] \(name) hook skipped (awareness scripts not installed)"); return
        }
        if let primary = plan.primary, run(primary) { log("[phase] \(name) hook ok"); return }
        if let fallback = plan.fallback, run(fallback) { log("[phase] \(name) hook ok (drain only)"); return }
        log("[phase] \(name) hook failed")
    }

    /// Detached from the app's run loop, killed after `timeout`. True on exit 0.
    static func spawn(_ command: PhaseCommand) -> Bool {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: command.executable)
        process.arguments = command.arguments
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        do { try process.run() } catch { return false }
        let killer = DispatchWorkItem { if process.isRunning { process.terminate() } }
        DispatchQueue.global().asyncAfter(deadline: .now() + timeout, execute: killer)
        process.waitUntilExit()
        killer.cancel()
        return process.terminationStatus == 0
    }
}
