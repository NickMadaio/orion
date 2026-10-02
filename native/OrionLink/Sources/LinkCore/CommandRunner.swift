import Foundation
import MobileCore

/// Runs one phone command through orion-remote, exactly as the Discord bridge
/// does: `handle --from phone --id <record> --at <sentAt ms> -- <text>`, with
/// the sender allowed only for this child. Every lock, replay, rate and verb rule
/// in orion-remote therefore applies to the phone unchanged.
public struct CommandRunner {
    public struct Result: Equatable, Sendable {
        public let ok: Bool
        public let reply: String
        public var thinking: String? = nil
        public init(ok: Bool, reply: String) { self.ok = ok; self.reply = reply }
    }

    public let node: URL
    public let remote: URL
    public let timeout: TimeInterval

    /// The installed copies launchd-style processes can reach (not ~/Desktop).
    public init(home: URL = URL(fileURLWithPath: NSHomeDirectory()), timeout: TimeInterval = 180) {
        self.node = home.appendingPathComponent(".openclaw/tools/node-v24.15.0/bin/node")
        self.remote = home.appendingPathComponent(".openclaw/orion-remote/scripts/orion-remote")
        self.timeout = timeout
    }

    public init(node: URL, remote: URL, timeout: TimeInterval) {
        self.node = node; self.remote = remote; self.timeout = timeout
    }

    /// `chat` sends the text to ORION as conversation, never parsed as a command
    /// ("No, I mean…" is not `deny`); the Control buttons use the command grammar.
    public func arguments(text: String, id: String, sentAt: Date, chat: Bool = false) -> [String] {
        [remote.path, "handle", "--from", LinkSchema.sender, "--id", id,
         "--at", String(Int64(sentAt.timeIntervalSince1970 * 1000)),
         "--mode", chat ? "chat" : "command", "--", text]
    }

    public func environment(base: [String: String] = ProcessInfo.processInfo.environment) -> [String: String] {
        var env = base
        env["ORION_REMOTE_ALLOW"] = LinkSchema.sender
        env["PATH"] = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
        return env
    }

    /// Blocking; call off the main thread. Exit 1 with a reply is a refusal and
    /// its reply is forwarded (the bridge does the same); no reply is a failure.
    public func run(text: String, id: String, sentAt: Date, chat: Bool = false, conversation: String? = nil, model: String? = nil) -> Result {
        let command: String
        do { command = try LinkCommand.validate(text) } catch { return Result(ok: false, reply: "That command was empty or too long.") }
        let process = Process()
        process.executableURL = node
        process.arguments = arguments(text: command, id: id, sentAt: sentAt, chat: chat)
        var env = environment()
        let session = conversation.map { "orion-chat-" + $0 } ?? "orion-app-v2"
        if chat { env["ORION_BRAIN_SESSION"] = session }
        if let model { env["ORION_BRAIN_MODEL"] = model; env["ORION_BRAIN_THINKING"] = model.hasPrefix("ollama/") ? "off" : "low" }
        process.environment = env
        let began = Date()
        let out = Pipe(), err = Pipe()
        process.standardOutput = out; process.standardError = err
        let finished = DispatchSemaphore(value: 0)
        process.terminationHandler = { _ in finished.signal() }
        do { try process.run() } catch {
            return Result(ok: false, reply: "The Mac could not start ORION's command handler (\(error.localizedDescription)).")
        }
        let deadline = DispatchTime.now() + timeout
        if finished.wait(timeout: deadline) == .timedOut {
            process.terminate()
            return Result(ok: false, reply: "ORION did not answer within \(Int(timeout)) seconds.")
        }
        let stdout = String(data: out.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8)?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if process.terminationStatus == 0 { var result = Result(ok: true, reply: stdout.isEmpty ? "Done." : String(stdout.prefix(4000))); if chat { result.thinking = ChatThinking.read(home: FileManager.default.homeDirectoryForCurrentUser, session: session, since: began) }; return result }
        if !stdout.isEmpty { return Result(ok: false, reply: String(stdout.prefix(4000))) }
        return Result(ok: false, reply: "ORION refused or could not run that (exit \(process.terminationStatus)).")
    }
}
