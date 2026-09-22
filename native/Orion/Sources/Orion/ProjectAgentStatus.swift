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

        var isCorrection: Bool { (origin ?? "plan") != "plan" }
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
    let escalations: [Escalation]?
    let repairs: [Repair]?

    var acceptedCount: Int { tasks.filter { $0.status == .accepted }.count }
    var blockedCount: Int { tasks.filter { $0.status == .blocked }.count }
    var correctionCount: Int { tasks.filter(\.isCorrection).count }
    var reviewerAuthoredChanges: Int { repairs?.count ?? 0 }
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

    static let url = URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent(".openclaw/orion-controlled/project-agent/heartbeat.json")

    /// Seconds since the supervisor last reported, or nil when it never has.
    var age: TimeInterval? {
        guard let stamp = ISO8601DateFormatter.orionAgent.date(from: at) else { return nil }
        return Date().timeIntervalSince(stamp)
    }

    /// Generous relative to the 10s write interval, so a slow inference call is
    /// not mistaken for a dead process.
    var isLive: Bool { (age ?? .greatestFiniteMagnitude) < 60 }

    var summary: String {
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
    enum Command: String { case pause, resume, steer, resolve }
    static let executable = "/Users/nickmadaio/Desktop/ORION/scripts/orion-project-agent"

    static func arguments(_ command: Command, revision: Int, text: String = "") -> [String] {
        var result = [command.rawValue, "--revision", String(revision)]
        // Fixed argv: the instruction is ONE argument, never shell text.
        if command == .steer { result += ["--text", text] }
        if command == .resolve { result += ["--note", text] }
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

    static func send(_ command: Command, revision: Int, text: String = "", completion: @escaping (String?) -> Void) {
        execute(arguments(command, revision: revision, text: text)) { _, error in completion(error) }
    }

    private static func execute(_ arguments: [String], completion: @escaping (String?, String?) -> Void) {
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
