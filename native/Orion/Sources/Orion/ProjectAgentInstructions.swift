import Foundation

/// What the local models are actually told, and what they are thinking right now.
///
/// Three separate files with three different lifetimes, deliberately not merged:
///
///  * `activity.json` — overwritten in place every few hundred milliseconds
///    while a model generates. Disposable; losing it costs nothing.
///  * `agentic-config.json` — written by hand by Nick, never by the agent. It
///    lives outside the repository so nothing the agent runs can reach it.
///  * `prompts/*.md` — the agent operating system, in the repository, on the
///    runtime deny-list so the agent cannot edit its own instructions.

/// The live thinking channel.
struct ProjectAgentActivity: Decodable {
    let at: String
    let role: String
    let model: String?
    let phase: String
    let taskId: String?
    /// Set from real streamed tokens, not inferred from elapsed time. A spinner
    /// driven by "status is running" spins just as convincingly when the
    /// inference runtime has died.
    let thinking: Bool
    let streaming: Bool
    let thinkingChars: Int
    let outputChars: Int
    let startedAt: String?
    let trace: String
    let output: String
    let note: String?

    static let url = URL(fileURLWithPath: NSHomeDirectory())
        .appendingPathComponent(".openclaw/orion-controlled/project-agent/activity.json")

    var isIdle: Bool { role == "idle" && !streaming }

    /// How long the current generation has been running, for the "still alive" line.
    var elapsed: TimeInterval? {
        guard let startedAt, let stamp = ISO8601DateFormatter.orionActivity.date(from: startedAt) else { return nil }
        return Date().timeIntervalSince(stamp)
    }

    var headline: String {
        if isIdle { return note ?? "Idle" }
        let who = (model ?? role).uppercased()
        let doing = thinking ? "thinking" : streaming ? "writing" : "finished"
        guard let elapsed else { return "\(who) · \(doing)" }
        return "\(who) · \(doing) · \(Int(elapsed))s"
    }

    static func read(url: URL = url) -> ProjectAgentActivity? {
        guard let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(Self.self, from: data)
    }
}

private extension ISO8601DateFormatter {
    static let orionActivity: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()
}

/// The settings the runtime is using, shown rather than edited.
///
/// Editing is deliberately a file edit and not a control in this panel. `enabled`
/// is the switch that decides whether a model may change real code unattended,
/// and the whole reason it lives outside the repository is that it should take a
/// deliberate act to move. A toggle in a window is not that act. The panel shows
/// the value and the exact path, which is what someone checking on a run needs.
struct ProjectAgentSettings: Decodable {
    struct Role: Decodable {
        let model: String?
        let contextTokens: Int?
        let approxResidentGiB: Double?
        let temperature: Double?
        let think: Bool?
    }
    struct Limits: Decodable {
        let maxAttempts: Int?
        let repairAfterAttempts: Int?
        let maxCorrectionDepth: Int?
        let taskTimeoutMs: Int?
        let iterationStallLimit: Int?
        let maxConsecutiveFailures: Int?
    }
    let enabled: Bool?
    let endpoint: String?
    let memoryBudgetGiB: Double?
    let roles: [String: Role]?
    let limits: Limits?
    /// Every model this machine could be pointed at, from `orion-project-agent settings`.
    let installed: [String]?

    static let url = URL(fileURLWithPath: NSHomeDirectory())
        .appendingPathComponent(".openclaw/orion-controlled/agentic-config.json")

    var isEnabled: Bool { enabled == true }

    /// Present when the file is absent — which is the normal, disabled state.
    static func read(url: URL = url) -> ProjectAgentSettings? {
        guard let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(Self.self, from: data)
    }

    /// The richer view, via the CLI: it merges defaults, reports which models are
    /// installed, and works when no config file exists yet. Reading the raw file
    /// alone cannot do that, and showing "no models" before a first write would
    /// be wrong.
    static func load(completion: @escaping (ProjectAgentSettings?) -> Void) {
        ProjectAgentControl.run(["settings"]) { output, _ in
            guard let output, let data = output.data(using: .utf8) else { return completion(nil) }
            completion(try? JSONDecoder().decode(Self.self, from: data))
        }
    }

    var summaryRows: [(String, String)] {
        var rows: [(String, String)] = [("Unattended execution", isEnabled ? "ENABLED" : "DISABLED")]
        if let endpoint { rows.append(("Inference endpoint", endpoint)) }
        for key in ["worker", "reviewer"] {
            guard let role = roles?[key] else { continue }
            var detail = role.model ?? "unset"
            if let context = role.contextTokens { detail += " · \(context / 1024)k ctx" }
            if let resident = role.approxResidentGiB { detail += " · ~\(Int(resident)) GiB" }
            rows.append((key.capitalized + " model", detail))
        }
        if let limits {
            if let attempts = limits.maxAttempts { rows.append(("Attempts per task", String(attempts))) }
            if let repair = limits.repairAfterAttempts { rows.append(("Reviewer repairs after", "\(repair) attempts")) }
            if let depth = limits.maxCorrectionDepth { rows.append(("Correction depth limit", String(depth))) }
            if let timeout = limits.taskTimeoutMs { rows.append(("Task timeout", "\(timeout / 60_000) min")) }
        }
        return rows
    }
}

/// The agent operating system: the instruction files the local models are given.
///
/// Read from the repository rather than duplicated here, so this panel cannot
/// drift from what the models are actually sent. A second copy of a prompt is a
/// second source of truth about how an unattended agent behaves.
struct ProjectAgentInstructions {
    struct Document: Identifiable {
        let id: String
        let title: String
        let subtitle: String
        let body: String
    }

    static let promptsDirectory = URL(fileURLWithPath: "/Users/nickmadaio/Desktop/ORION/scripts/lib/agentic/prompts")

    static let catalogue: [(file: String, title: String, subtitle: String)] = [
        ("worker-system", "Worker", "What the implementation model is told, every turn"),
        ("reviewer-system", "Reviewer", "How PASS, PASS WITH TASKS and BLOCKED are decided"),
        ("reviewer-repair", "Bounded repair", "When the reviewer may write code, and how little"),
    ]

    static func load(from directory: URL = promptsDirectory) -> [Document] {
        catalogue.compactMap { entry in
            guard let body = try? String(contentsOf: directory.appendingPathComponent("\(entry.file).md"), encoding: .utf8)
            else { return nil }
            return Document(id: entry.file, title: entry.title, subtitle: entry.subtitle, body: body)
        }
    }

    /// The live contract for one task, rendered the way the model receives it.
    static func contract(for task: ProjectAgentStatus.WorkItem) -> Document {
        Document(
            id: "contract-\(task.id)",
            title: "Contract · \(task.id)",
            subtitle: task.isCorrection ? "Authored by a review, not by the plan" : "From the approved plan",
            body: """
            \(task.title)

            Status    \(task.status.rawValue)
            Stage     \(task.stage.rawValue)
            Attempts  \(task.attempts)\(task.repairsUsed.map { $0 > 0 ? " · \($0) reviewer repair(s)" : "" } ?? "")
            Weight    \(Int(task.weight))
            """
        )
    }
}
