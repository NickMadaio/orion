import Foundation

/// Read the controller's durable snapshot; the UI never invents a second progress clock.
///
/// Schema v3. Three things matter in how this decodes, all about an unattended
/// run being readable at 08:00 rather than at the moment it broke:
///
///  * **Enums degrade instead of failing.** A raw value this build has not seen
///    becomes `.unknown` rather than throwing. The runtime and the app ship
///    separately, so a controller that learns a new stage must not blank the
///    whole panel on an app that has not caught up — "Unknown stage" is a far
///    better morning than "Project agent state could not be read".
///  * **Liveness is separate from status.** `status` is what the run last
///    published; `heartbeat` is whether anything is still driving it. A crashed
///    supervisor leaves `status: running` behind forever, and before there was a
///    heartbeat those two cases looked identical.
///  * **An escalation no longer means the run stopped.** v3 made escalations
///    task-level: one parks a single task and the loop carries on with the rest
///    of the plan. So `hasOpenEscalations` ("something needs you") and
///    `isBlocked` ("the run has halted") are different questions, and a panel
///    that conflates them will either cry wolf or hide a stopped run.
struct ProjectAgentStatus: Decodable {
    /// A string enum that tolerates values from a newer controller.
    enum RunStatus: String, Decodable {
        case ready, running, paused, waiting_for_review, interrupted, budget_exhausted, escalated, completed, unknown
        init(from decoder: Decoder) throws {
            self = RunStatus(rawValue: try decoder.singleValueContainer().decode(String.self)) ?? .unknown
        }
    }
    enum TaskStatus: String, Decodable {
        case queued, running, awaiting_review, accepted, blocked, unknown
        init(from decoder: Decoder) throws {
            self = TaskStatus(rawValue: try decoder.singleValueContainer().decode(String.self)) ?? .unknown
        }
    }
    enum Stage: String, Decodable {
        case queued, inspect, implement, test, review, repair, accepted, unknown
        init(from decoder: Decoder) throws {
            self = Stage(rawValue: try decoder.singleValueContainer().decode(String.self)) ?? .unknown
        }
    }

    struct WorkItem: Decodable, Identifiable {
        let id: String
        let title: String
        let weight: Double
        let status: TaskStatus
        let stage: Stage
        let attempts: Int
        let commit: String?
        let blocker: String?
        /// "plan" for approved work; anything else was authored by a review.
        let origin: String?
        let corrections: Int?
        let repairsUsed: Int?
        /// Where the worker says it has got to inside this task. Declared by the
        /// worker, recorded by the runtime, and never allowed to influence
        /// acceptance — `stage` and the checks decide that.
        let subtask: Subtask?

        var isCorrection: Bool { (origin ?? "plan") != "plan" }
    }

    struct Subtask: Decodable {
        let label: String
        let index: Int
        let total: Int
        /// Workers often start a label with "— "; that is punctuation, not content.
        var cleanLabel: String { label.trimmingCharacters(in: CharacterSet(charactersIn: "—–- ").union(.whitespaces)) }
        var caption: String { total > 1 ? "\(index)/\(total) · \(cleanLabel)" : cleanLabel }
    }

    struct Event: Decodable { let at: String; let kind: String; let message: String }
    struct Steering: Decodable, Identifiable { let id: String; let text: String; let applied: Bool }

    /// Something that needs Nick. Escalations are now TASK-LEVEL by default: one
    /// names a task, parks it, and the loop keeps working on everything else.
    /// Only a `taskId == nil` escalation, or having nothing left to claim, stops
    /// the run — so "an escalation exists" and "the run has stopped" are
    /// different facts and the panel must not conflate them.
    struct Escalation: Decodable, Identifiable {
        let id: String
        let at: String
        let kind: String
        let reason: String
        let taskId: String?
        let question: String?
        let recommendAstra: Bool
        let notified: Bool
        let resolvedAt: String?

        var isOpen: Bool { resolvedAt == nil }
        var isRunLevel: Bool { taskId == nil }
    }

    /// What a review decided, and why.
    ///
    /// `taskId` is null for a RUN-level review — the final review of the whole
    /// body of work names no task and no checkpoint.
    struct Review: Decodable, Identifiable {
        let id: String
        let at: String
        let taskId: String?
        let decision: String
        let verdict: String?
        let reviewer: String
        let summary: String
        let failed: [Finding]?
        let correctionIds: [String]?

        var subject: String { taskId ?? "the whole run" }
        var isRunLevel: Bool { taskId == nil }
        var returnedWork: Int { correctionIds?.count ?? 0 }
    }

    /// One thing a review found wanting, at a stated severity.
    struct Finding: Decodable {
        let criterion: String
        let severity: String
        let evidence: String?
    }

    /// A reviewer-authored code change. Surfaced separately because it is work
    /// that was not independently reviewed.
    struct Repair: Decodable, Identifiable {
        let id: String
        let at: String
        let taskId: String
        let model: String
        let files: [String]
        let summary: String
    }

    let version: Int
    let revision: Int
    let runId: String
    let status: RunStatus
    let activeTask: String?
    let tasks: [WorkItem]
    let events: [Event]
    let steering: [Steering]
    let finalReview: Bool
    /// Set by an operator from the panel, the CLI or Discord. Optional because
    /// runs created before these existed are still perfectly readable.
    let pauseRequested: Bool?
    let stopRequested: Bool?
    let exterminateRequested: Bool?
    let escalations: [Escalation]?
    let repairs: [Repair]?
    let reviews: [Review]?
    /// "quiet" (asleep: one silent digest when the run stops) or "away" (each
    /// deferral sent as it happens). Absent on runs from before alert modes.
    let alertMode: String?
    var isAway: Bool { alertMode == "away" }

    var isPausing: Bool { pauseRequested == true }
    var isStopping: Bool { stopRequested == true }
    var isExterminating: Bool { exterminateRequested == true }

    var acceptedCount: Int { tasks.filter { $0.status == .accepted }.count }
    var blockedCount: Int { tasks.filter { $0.status == .blocked }.count }
    var correctionCount: Int { tasks.filter(\.isCorrection).count }
    var reviewerAuthoredChanges: Int { repairs?.count ?? 0 }
    /// Newest first: a review from four hours ago is history, not news.
    var reviewNotes: [Review] { (reviews ?? []).reversed() }
    var awaitingFinalReview: Bool { !tasks.isEmpty && acceptedCount == tasks.count && !finalReview }
    /// The run itself has stopped. Distinct from `hasOpenEscalations`.
    var isBlocked: Bool { status == .escalated }
    var openEscalations: [Escalation] { (escalations ?? []).filter(\.isOpen) }
    var hasOpenEscalations: Bool { !openEscalations.isEmpty }
    /// Tasks parked by an escalation while the rest of the plan continues.
    var parkedTaskIds: Set<String> { Set(openEscalations.compactMap(\.taskId)) }
    func isParked(_ task: WorkItem) -> Bool { parkedTaskIds.contains(task.id) }

    var acceptedFraction: Double {
        let total = tasks.reduce(0) { $0 + $1.weight }
        return total > 0 ? tasks.filter { $0.status == .accepted }.reduce(0) { $0 + $1.weight } / total : 0
    }

    var progressLabel: String {
        if awaitingFinalReview { return "Awaiting final review · \(acceptedCount)/\(tasks.count) tasks accepted" }
        // Flooring avoids rounding a nearly complete run to 100%.
        let percentage = min(finalReview ? 100 : 99, Int((acceptedFraction * 100).rounded(.down)))
        let suffix = correctionCount > 0 ? " · \(correctionCount) added by review" : ""
        return "\(percentage)% · \(acceptedCount)/\(tasks.count) tasks accepted\(suffix)"
    }

    var active: WorkItem? { tasks.first { $0.id == activeTask } }

    static let stateURL = URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent(".openclaw/orion-controlled/project-agent/state.json")

    enum Reading { case missing, available(ProjectAgentStatus), unreadable(String) }

    static func read(url: URL = stateURL) -> Reading {
        do { return .available(try decode(Data(contentsOf: url))) }
        catch let error as CocoaError where error.code == .fileReadNoSuchFile { return .missing }
        catch { return .unreadable("Project agent state could not be read or validated. Refresh after checking the controller.") }
    }

    static func decode(_ data: Data) throws -> ProjectAgentStatus {
        let value = try JSONDecoder().decode(Self.self, from: data)
        guard value.version == 3, value.revision >= 0, !value.runId.isEmpty,
              !value.tasks.isEmpty, value.tasks.count <= 1000,
              Set(value.tasks.map(\.id)).count == value.tasks.count,
              value.tasks.allSatisfy({ !$0.id.isEmpty && $0.weight.isFinite && $0.weight >= 1 && $0.weight <= 100 && $0.weight.rounded() == $0.weight && !$0.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && $0.attempts >= 0 }),
              value.tasks.reduce(0, { $0 + $1.weight }).isFinite,
              value.activeTask == nil || value.active != nil,
              !value.finalReview || value.acceptedCount == value.tasks.count,
              value.status != .completed || (value.finalReview && value.acceptedCount == value.tasks.count),
              // A stopped run must have something open explaining why. The
              // converse no longer holds: open escalations with the run still
              // moving is the normal, intended state.
              value.status != .escalated || value.hasOpenEscalations
        else { throw CocoaError(.fileReadCorruptFile) }
        return value
    }
}

/// Whether anything is actually driving the run right now.
///
/// Read separately from `state.json` because they answer different questions and
/// are written by different things: the controller publishes state at
/// transitions, the supervisor writes a heartbeat every few seconds. A "running"
/// status with a stale heartbeat is a crashed supervisor, and that is precisely
/// what a person checking on an overnight run needs to be told.
struct ProjectAgentHeartbeat: Decodable {
    let at: String
    let phase: String?
    let pid: Int?
    let iterations: Int?
    /// Which model is working and since when, as the supervisor reports it.
    // `var` with defaults: decoded when present, and the memberwise
    // initialiser keeps its old shape for callers that predate them.
    var role: String? = nil
    var model: String? = nil
    var roleSince: String? = nil

    var since: Date? { roleSince.flatMap { ISO8601DateFormatter.orionAgent.date(from: $0) } }

    static let url = URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent(".openclaw/orion-controlled/project-agent/heartbeat.json")

    /// Seconds since the supervisor last reported, or nil when it never has.
    var age: TimeInterval? {
        guard let stamp = ISO8601DateFormatter.orionAgent.date(from: at) else { return nil }
        return Date().timeIntervalSince(stamp)
    }

    /// Generous relative to the 10s write interval, so a slow inference call is
    /// not mistaken for a dead process.
    // ISO timestamps round to milliseconds; tolerate that tiny future skew.
    var isLive: Bool { phase != "stopped" && (age ?? .greatestFiniteMagnitude) >= -1 && (age ?? .greatestFiniteMagnitude) < 60 }

    var summary: String {
        if phase == "stopped" { return "Supervisor stopped — restart it from Terminal to continue" }
        guard let age else { return "No heartbeat recorded" }
        if isLive { return "Supervisor live · \(phase ?? "running") · \(Int(age))s ago" }
        return "No heartbeat for \(Int(age))s — the supervisor is not running"
    }

    static func read(url: URL = url) -> ProjectAgentHeartbeat? {
        guard let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(Self.self, from: data)
    }
}

private extension ISO8601DateFormatter {
    /// The controller stamps with milliseconds; the default formatter rejects them.
    static let orionAgent: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()
}

enum ProjectAgentControl {
    static func canResume(_ run: ProjectAgentStatus) -> Bool {
        // `isBlocked`, not `hasOpenEscalations`: a task-level escalation parks one
        // task and leaves the rest of the run free to continue.
        !run.isBlocked && run.status != .completed &&
        ((run.isPausing || run.isStopping || run.isExterminating) ||
         (run.activeTask == nil && run.status != .interrupted && [.paused, .budget_exhausted].contains(run.status)))
    }
    static let restartCommand = "/Users/nickmadaio/Desktop/ORION/scripts/orion-agent run --until-stopped"

    /*
     Three ways to halt, and the panel must not blur them.

       pause        hold here; the lease is kept and the run continues on resume
       stop         end at the next safe boundary, fully resumable
       exterminate  abandon the generation in flight

     `exterminate` is a separate command rather than a flag on `stop` for the
     same reason it is a separate word in the CLI: the destructive one should be
     something chosen, never something reached by accident.
    */
    enum Command: String { case pause, resume, steer, resolve, stop, exterminate }
    static let executable = "/Users/nickmadaio/Desktop/ORION/scripts/orion-project-agent"

    static func arguments(_ command: Command, revision: Int, text: String = "", escalationID: String? = nil) -> [String] {
        var result = [command.rawValue, "--revision", String(revision)]
        // Fixed argv: the instruction is ONE argument, never shell text.
        if command == .steer { result += ["--text", text] }
        if command == .resolve { result += ["--id", escalationID ?? "", "--note", text] }
        return result
    }

    /// Run the operator CLI with an arbitrary fixed argv and hand back stdout.
    /// Used for the read-only and settings commands, which have no revision.
    static func run(_ arguments: [String], completion: @escaping (String?, String?) -> Void) {
        execute(arguments) { output, error in completion(error == nil ? output : nil, error) }
    }

    /// Point a role at a different model. Model choice is a preference, not run
    /// state, so it does not carry a revision and cannot disturb a review that
    /// is already in flight.
    static func setModel(role: String, model: String, completion: @escaping (String?) -> Void) {
        execute(["set-model", role, model]) { _, error in completion(error) }
    }

    static func send(_ command: Command, revision: Int, text: String = "", escalationID: String? = nil, projectID: String? = nil, completion: @escaping (String?) -> Void) {
        execute(arguments(command, revision: revision, text: text, escalationID: escalationID) + (projectID.map { ["--project", $0] } ?? [])) { _, error in completion(error) }
    }

    /*
     Halts carry no revision.

     Steering is built on a snapshot and has to say which one, so a stale
     instruction is refused rather than applied to work that has moved on. A
     halt is the opposite: "whatever it is doing, hold it" — and a revision
     check there would refuse Stop because the run advanced thirty seconds ago,
     which is exactly when Nick needs it to work. Halting the model is the one
     control that must never fail on a technicality.
    */
    static let halts: [Command] = [.pause, .stop, .exterminate, .resume]

    /// Asleep or away. A preference, so like a halt it carries no revision.
    static func alertArguments(away: Bool, projectID: String) -> [String] {
        ["alerts", away ? "away" : "quiet", "--project", projectID]
    }

    static func setAlerts(away: Bool, projectID: String, completion: @escaping (String?) -> Void) {
        execute(alertArguments(away: away, projectID: projectID)) { _, error in completion(error) }
    }

    static func haltArguments(_ command: Command, projectID: String) -> [String]? {
        guard halts.contains(command) else { return nil }
        return [command.rawValue, "--project", projectID]
    }

    static func halt(_ command: Command, projectID: String, completion: @escaping (String?) -> Void) {
        guard let arguments = haltArguments(command, projectID: projectID) else {
            completion("\(command.rawValue) is not a halt command."); return
        }
        execute(arguments) { _, error in completion(error) }
    }

    /// What each halt does, in the words shown beside its button. Kept in step
    /// with `projectCommands` in scripts/lib/agentic/brief.mjs, which is what
    /// `orion-agent --project <id> commands` prints.
    static func explanation(_ command: Command) -> String {
        switch command {
        case .pause: return "Holds at the next task boundary and keeps its place. Use it when you want it to wait, not end."
        case .stop: return "The normal way to stop. The step in flight finishes, then the run ends cleanly and can be continued later."
        case .exterminate: return "Abandons the model call in flight right now. Accepted work is never lost; the half-done step is thrown away when it next starts."
        case .resume: return "Clears a pause, stop or exterminate. If the run has already ended, press Continue project to start it again."
        case .steer: return "Gives it an instruction in plain words, applied at the next task boundary."
        case .resolve: return "Answers an escalation, with a note on why it is now safe to continue."
        }
    }

    static let repository = "/Users/nickmadaio/Desktop/ORION"
    static let projectsExecutable = repository + "/scripts/orion-projects"

    struct Reference: Identifiable {
        let command: String
        let what: String
        var id: String { command }
    }

    /*
     The commands for one project, with its id filled in, for the night the app
     is closed or Nick has forgotten the spelling. Same spelling as the full
     reference in brief.mjs — repository-relative after one `cd` — so what the
     app shows and what the terminal prints can be compared line for line.
    */
    static func commandReference(projectID id: String) -> [Reference] {
        let agent = "scripts/orion-agent --project \(id)"
        let control = "scripts/orion-project-agent --project \(id)"
        return [
            Reference(command: "cd \(repository)", what: "Every command below runs from the ORION folder."),
            Reference(command: "\(agent) status", what: "What it is doing now, any open escalations, and the revision number N that steer and resolve need."),
            Reference(command: "\(control) pause", what: explanation(.pause)),
            Reference(command: "\(control) stop", what: explanation(.stop)),
            Reference(command: "\(control) exterminate", what: explanation(.exterminate)),
            Reference(command: "\(control) resume", what: "Clears a pause, stop or exterminate. It does not restart a run that has already ended; use launch for that."),
            Reference(command: "\(control) steer --revision N --text \"...\"", what: explanation(.steer) + " N comes from status."),
            Reference(command: "\(control) resolve --revision N --id ESCALATION_ID --note \"...\"", what: explanation(.resolve) + " The id is in status and in the alert."),
            Reference(command: "\(agent) brief", what: "Writes the Astra review brief and prints where it saved it."),
            Reference(command: "scripts/orion-projects launch \(id) --until-stopped", what: "Starts or continues it until you stop it. Use --until ISO_TIME for a fixed stop time; add keep-awake flags as needed."),
            Reference(command: "\(agent) commands", what: "Prints the full list, with more detail."),
        ]
    }

    static func execute(_ arguments: [String], executable: String = executable, completion: @escaping (String?, String?) -> Void) {
        DispatchQueue.global(qos: .userInitiated).async {
            let process = Process()
            process.executableURL = URL(fileURLWithPath: executable)
            process.arguments = arguments
            var environment = ProcessInfo.processInfo.environment
            environment["PATH"] = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
            process.environment = environment
            process.standardInput = FileHandle.nullDevice
            let pipe = Pipe()
            process.standardOutput = pipe
            process.standardError = pipe
            var capturedOutput: String?
            let error: String?
            do {
                try process.run()
                let timeout = DispatchWorkItem { if process.isRunning { process.terminate() } }
                DispatchQueue.global().asyncAfter(deadline: .now() + 15, execute: timeout)
                defer { timeout.cancel() }
                let data = pipe.fileHandleForReading.readDataToEndOfFile()
                process.waitUntilExit()
                let output = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
                capturedOutput = output
                error = process.terminationStatus == 0 ? nil : (output.isEmpty ? "Controller refused the change (exit \(process.terminationStatus))." : String(output.prefix(2000)))
            } catch let failure { error = "Could not contact the project controller: \(failure.localizedDescription)" }
            DispatchQueue.main.async { completion(capturedOutput, error) }
        }
    }
}

/*
 How a project keeps the Mac awake while it runs.

 Mirrors `launchOptions` in project.json, which `orion-projects launch` saves
 after validating it (scripts/lib/agentic/awake.mjs owns the rules). The app
 only shows these as starting toggles and passes them back as flags; it never
 writes project.json itself, so there is exactly one validator.
*/
struct ProjectLaunchOptions: Equatable {
    var preventSleep = true
    var keepDisplayOn = false
    /// 0 is off. Otherwise how often activity is declared, 1–60 minutes.
    var nudgeMinutes = 0

    /*
     Every launch states its options in full, because the CLI reads a missing
     flag as the built-in default rather than "whatever was saved" — there is
     no --keep-display-off, so that is the only way turning something off can
     stick.
    */
    var launchFlags: [String] {
        guard preventSleep else { return ["--no-keep-awake"] }
        return (keepDisplayOn ? ["--keep-display-on"] : []) + (nudgeMinutes > 0 ? ["--nudge-minutes", String(nudgeMinutes)] : [])
    }

    /// The saved options, or the defaults for a project that has none yet (or
    /// whose record this build cannot read — launch validates it regardless).
    static func read(projectRoot: URL) -> ProjectLaunchOptions {
        struct Record: Decodable { let launchOptions: ProjectLaunchOptions? }
        guard let data = try? Data(contentsOf: projectRoot.appendingPathComponent("project.json")),
              let record = try? JSONDecoder().decode(Record.self, from: data) else { return ProjectLaunchOptions() }
        return record.launchOptions ?? ProjectLaunchOptions()
    }
}

// In an extension so the struct keeps its memberwise and default initialisers.
extension ProjectLaunchOptions: Decodable {
    private enum CodingKeys: String, CodingKey { case preventSleep, keepDisplayOn, nudgeMinutes }
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        preventSleep = try container.decodeIfPresent(Bool.self, forKey: .preventSleep) ?? true
        keepDisplayOn = try container.decodeIfPresent(Bool.self, forKey: .keepDisplayOn) ?? false
        nudgeMinutes = try container.decodeIfPresent(Int.self, forKey: .nudgeMinutes) ?? 0
        guard (0...60).contains(nudgeMinutes), preventSleep || (!keepDisplayOn && nudgeMinutes == 0)
        else { throw CocoaError(.fileReadCorruptFile) }
    }
}

/// `orion-projects preflight`: read-only power, lid and idle-sleep facts, with
/// the summary line and warnings already worded by awake.mjs.
struct ProjectPreflight: Decodable {
    struct Lid: Decodable { let risk: String; let reason: String }
    let summary: String
    let warnings: [String]
    let lid: Lid
    let powerSource: String?
    let idleSleepMinutes: Int?
}

/// The keep-awake half of launch.json. `SavedProject.Launch` reads the status
/// half; this reads what `serve` recorded about keeping the Mac awake for it.
struct ProjectLaunchReceipt: Decodable {
    struct KeepAwake: Decodable {
        let preventSleep: Bool
        let active: Bool
        let summary: String
    }
    let status: String
    let keepAwake: KeepAwake?
    let warnings: [String]?

    static func read(projectRoot: URL) -> ProjectLaunchReceipt? {
        guard let data = try? Data(contentsOf: projectRoot.appendingPathComponent("launch.json")) else { return nil }
        return try? JSONDecoder().decode(Self.self, from: data)
    }
}
