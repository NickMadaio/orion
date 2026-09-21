import Foundation

/// Read the controller's durable snapshot; the UI never invents a second progress clock.
struct ProjectAgentStatus: Decodable {
    enum RunStatus: String, Decodable { case ready, running, paused, waiting_for_review, interrupted, budget_exhausted, completed }
    enum TaskStatus: String, Decodable { case queued, running, awaiting_review, accepted, blocked }
    enum Stage: String, Decodable { case queued, inspect, implement, test, review, accepted }
    struct WorkItem: Decodable, Identifiable {
        let id: String
        let title: String
        let weight: Double
        let status: TaskStatus
        let stage: Stage
        let attempts: Int
        let commit: String?
        let blocker: String?
    }
    struct Event: Decodable { let at: String; let kind: String; let message: String }
    struct Steering: Decodable, Identifiable { let id: String; let text: String; let applied: Bool }
    let version: Int
    let revision: Int
    let runId: String
    let status: RunStatus
    let activeTask: String?
    let tasks: [WorkItem]
    let events: [Event]
    let steering: [Steering]
    let finalReview: Bool

    var acceptedCount: Int { tasks.filter { $0.status == .accepted }.count }
    var awaitingFinalReview: Bool { !tasks.isEmpty && acceptedCount == tasks.count && !finalReview }
    var acceptedFraction: Double {
        let total = tasks.reduce(0) { $0 + $1.weight }
        return total > 0 ? tasks.filter { $0.status == .accepted }.reduce(0) { $0 + $1.weight } / total : 0
    }
    var progressLabel: String {
        if awaitingFinalReview { return "Awaiting final review · \(acceptedCount)/\(tasks.count) tasks accepted" }
        // Flooring avoids rounding a nearly complete run to 100%.
        let percentage = min(finalReview ? 100 : 99, Int((acceptedFraction * 100).rounded(.down)))
        return "\(percentage)% · \(acceptedCount)/\(tasks.count) tasks accepted"
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
        guard value.version == 1, value.revision >= 0, !value.runId.isEmpty,
              !value.tasks.isEmpty, value.tasks.count <= 1000,
              Set(value.tasks.map(\.id)).count == value.tasks.count,
              value.tasks.allSatisfy({ !$0.id.isEmpty && $0.weight.isFinite && $0.weight >= 1 && $0.weight <= 100 && $0.weight.rounded() == $0.weight && !$0.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && $0.attempts >= 0 }),
              value.tasks.reduce(0, { $0 + $1.weight }).isFinite,
              value.activeTask == nil || value.active != nil,
              !value.finalReview || value.acceptedCount == value.tasks.count,
              value.status != .completed || (value.finalReview && value.acceptedCount == value.tasks.count)
        else { throw CocoaError(.fileReadCorruptFile) }
        return value
    }
}

enum ProjectAgentControl {
    enum Command: String { case pause, resume, steer }
    static let executable = "/Users/nickmadaio/Desktop/ORION/scripts/orion-project-agent"
    static func arguments(_ command: Command, revision: Int, text: String = "") -> [String] {
        var result = [command.rawValue, "--revision", String(revision)]
        if command == .steer { result += ["--text", text] }
        return result
    }
    static func send(_ command: Command, revision: Int, text: String = "", completion: @escaping (String?) -> Void) {
        let arguments = arguments(command, revision: revision, text: text)
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
            let error: String?
            do {
                try process.run()
                let timeout = DispatchWorkItem { if process.isRunning { process.terminate() } }
                DispatchQueue.global().asyncAfter(deadline: .now() + 15, execute: timeout)
                defer { timeout.cancel() }
                let data = pipe.fileHandleForReading.readDataToEndOfFile()
                process.waitUntilExit()
                let output = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
                error = process.terminationStatus == 0 ? nil : (output.isEmpty ? "Controller refused the change (exit \(process.terminationStatus))." : String(output.prefix(2000)))
            } catch let failure { error = "Could not contact the project controller: \(failure.localizedDescription)" }
            DispatchQueue.main.async { completion(error) }
        }
    }
}
