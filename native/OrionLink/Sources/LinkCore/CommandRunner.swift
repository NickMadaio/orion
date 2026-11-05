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
    /// `replyTo` is the outreach id the phone's reply answers (`--reply-to`); anything but a plain id is dropped.
    public func arguments(text: String, id: String, sentAt: Date, chat: Bool = false, replyTo: String? = nil) -> [String] {
        [remote.path, "handle", "--from", LinkSchema.sender, "--id", id,
         "--at", String(Int64(sentAt.timeIntervalSince1970 * 1000)),
         "--mode", chat ? "chat" : "command"]
            + (Self.safeReplyTo(replyTo).map { ["--reply-to", $0] } ?? [])
            + ["--", text]
    }

    /// `orion-reach` beside orion-remote in the installed mirror.
    public var reachScript: URL { remote.deletingLastPathComponent().appendingPathComponent("orion-reach") }

    public func reachProcessArguments(_ arguments: [String]) -> [String] { [reachScript.path] + arguments }

    /// Logs a message another route already delivered (`orion-reach --already-sent`). Blocking; true on exit 0.
    public func reach(arguments: [String]) -> Bool {
        let process = Process()
        process.executableURL = node
        process.arguments = reachProcessArguments(arguments)
        var env = environment()
        env["ORION_CONTROLLED_DIR"] = nil
        process.environment = env
        process.standardOutput = FileHandle.nullDevice; process.standardError = FileHandle.nullDevice
        let finished = DispatchSemaphore(value: 0)
        process.terminationHandler = { _ in finished.signal() }
        guard (try? process.run()) != nil else { return false }
        if finished.wait(timeout: .now() + 20) == .timedOut { process.terminate(); return false }
        return process.terminationStatus == 0
    }

    /// The gateway session a command runs in (also the name of its progress file).
    /// One phone conversation, one key (w20): a chat with no conversation id belongs to the phone thread, not to the Mac app's
    /// session (the tube evening ran under orion-chat-<uuid>, orion-app-v2 and orion-chat-phone-history: three memories).
    /// The id is trimmed and lowercased, so a case difference never opens a second session.
    public static func session(conversation: String?, chat: Bool = true) -> String {
        let id = conversation?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() ?? ""
        if !id.isEmpty { return "orion-chat-" + id }
        return chat ? "orion-chat-" + LinkSchema.threadID : "orion-app-v2"
    }

    static func safeReplyTo(_ id: String?) -> String? {
        guard let id, (1...80).contains(id.count),
              id.allSatisfy({ $0.isASCII && ($0.isLetter || $0.isNumber || "._:-".contains($0)) }) else { return nil }
        return id
    }

    public func environment(base: [String: String] = ProcessInfo.processInfo.environment) -> [String: String] {
        var env = base
        env["ORION_REMOTE_ALLOW"] = LinkSchema.sender
        env["PATH"] = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
        return env
    }

    /// Blocking; call off the main thread. Exit 1 with a reply is a refusal and
    /// its reply is forwarded (the bridge does the same); no reply is a failure.
    public func run(text: String, id: String, sentAt: Date, chat: Bool = false, conversation: String? = nil, model: String? = nil, replyTo: String? = nil) -> Result {
        let command: String
        do { command = try LinkCommand.validate(text) } catch { return Result(ok: false, reply: "That command was empty or too long.") }
        let process = Process()
        process.executableURL = node
        process.arguments = arguments(text: command, id: id, sentAt: sentAt, chat: chat, replyTo: replyTo)
        var env = environment()
        let session = Self.session(conversation: conversation, chat: chat)
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
            return Result(ok: false, reply: "ORION took too long on that one.")
        }
        let stdout = String(data: out.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8)?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if process.terminationStatus == 0 { var result = Result(ok: true, reply: stdout.isEmpty ? "Done." : String(stdout.prefix(4000))); if chat { result.thinking = ChatThinking.read(home: FileManager.default.homeDirectoryForCurrentUser, session: session, since: began) }; return result }
        if !stdout.isEmpty { return Result(ok: false, reply: String(stdout.prefix(4000))) }
        return Result(ok: false, reply: "Your Mac couldn’t take that one just now.")
    }
}
