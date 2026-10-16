import Darwin
import Foundation
import MobileCore

/*
 The brain.

 Orion talks to the OpenClaw gateway through the documented CLI rather than its
 WebSocket RPC surface. The RPC shape is versioned and drifts between releases;
 the CLI is the stable contract. This mirrors `ask_agent` in
 `orion/interface/server.py`, including its tolerance for the reply field having
 been renamed across releases.

 Nothing here reads, logs or copies the gateway auth token: the CLI holds its
 own credentials and we never touch them.
 */

enum GatewayError: LocalizedError {
    case missingBinary(String)
    case failed(String)
    case timedOut(Int)
    case unparseable
    case inFlight

    var errorDescription: String? {
        switch self {
        case .missingBinary(let path):
            return "The openclaw CLI is not at \(path)."
        case .failed(let detail):
            return "The agent failed: \(detail)"
        case .timedOut(let seconds):
            return "The agent did not answer within \(seconds)s."
        case .unparseable:
            return "The agent returned nothing this app could read."
        case .inFlight:
            return "A turn is already running in this session — give it a moment."
        }
    }
}

struct GatewayReply {
    var text: String
    var elapsedMs: Int
    var thinking: String? = nil
}

enum GatewayClient {
    static let binaryPath = "/Users/nickmadaio/.openclaw/bin/openclaw"
    static let configPath = "/Users/nickmadaio/.openclaw/openclaw.json"
    // A previous browser-open request left the original conversation with an
    // unresolved tool call.  Start the desktop app on a clean durable thread;
    // otherwise every later turn inherits that broken tool history.
    static let sessionKey = "orion-app-v2"

    /// The `Process` currently blocked inside `ask`, if any, so a deliberate
    /// user cancel (`cancelInFlight`) has something to signal. `ask` is always
    /// called from `AppState.agentQueue`, which is serial — there is only ever
    /// one turn in flight — but the lock costs nothing and means this file
    /// never has to assume that stays true.
    private static let runningProcessLock = NSLock()
    private static var runningProcess: Process?

    // MARK: Reachability

    /// The port the gateway listens on. Only `gateway.port` is read; the rest of
    /// the config (which contains credentials) is ignored.
    static func port() -> Int {
        guard
            let data = FileManager.default.contents(atPath: configPath),
            let root = try? JSONSerialization.jsonObject(with: data, options: []) as? [String: Any],
            let gateway = root["gateway"] as? [String: Any]
        else { return 18789 }
        if let value = gateway["port"] as? Int { return value }
        if let value = gateway["port"] as? String, let parsed = Int(value) { return parsed }
        return 18789
    }

    /// Compatibility helper for callers that need a Boolean. A listening port
    /// alone is not service readiness.
    static func isUp(timeout: TimeInterval = 0.8) -> Bool {
        GatewayHealthProbe.check(port: port(), timeout: timeout).availability == .ready
    }

    // MARK: Thinking boost — after a turn where ORION struggled

    private static var boosts: [String: Date] = [:]
    private static let boostLock = NSLock()
    private static func boostedUntil(_ session: String) -> Date? {
        boostLock.lock(); defer { boostLock.unlock() }
        return boosts[session]
    }
    private static func boost(_ session: String) {
        boostLock.lock(); defer { boostLock.unlock() }
        boosts[session] = Date().addingTimeInterval(ThinkingPolicy.boostSeconds)
    }

    private static let outreachTracker = OutreachTracker()

    /// What ORION said to him first (orion-reach), only when it is plausibly what
    /// he is answering now (2026-10-16: was the last 3 from 6 hours on every turn).
    /// Call once per turn; see `OutreachTracker`.
    static func recentOutreach(now: Date = Date()) -> String {
        let file = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".openclaw/orion-controlled/outreach.jsonl")
        let text = (try? String(contentsOf: file, encoding: .utf8)) ?? ""
        return outreachTracker.prefix(rows: OutreachContext.parse(jsonl: text), now: now, replyTo: OutreachReplyTo.current)
    }

    // MARK: One agent turn

    /// Blocking. Always call from a background queue.
    static func ask(_ text: String, session: String = GatewayClient.sessionKey, model: String? = nil) throws -> GatewayReply {
        guard FileManager.default.isExecutableFile(atPath: binaryPath) else {
            throw GatewayError.missingBinary(binaryPath)
        }

        let process = Process()
        process.executableURL = URL(fileURLWithPath: binaryPath)
        process.arguments = [
            "agent",
            "--session-key", session,
            "--message", recentOutreach() + SchedulingMemory.context(for: text) + text,
            "--json",
            "--timeout", String(Int(RunTimeouts.agentTimeout))
        ]
        // Thinking only when the message needs it, or right after ORION struggled
        // (ThinkingPolicy, 2026-10-07). It was off for every turn without a picked model.
        let thinking = ThinkingPolicy.level(for: text, model: model, boostedUntil: boostedUntil(session))
        if let model { process.arguments?.append(contentsOf: ["--model", model]) }
        process.arguments?.append(contentsOf: ["--thinking", thinking])
        // The CLI is a bash shim with a `/usr/bin/env` shebang. A GUI app
        // inherits a minimal environment, so give it a PATH it can resolve.
        var environment = ProcessInfo.processInfo.environment
        let existingPath = environment["PATH"] ?? ""
        let required = "/usr/bin:/bin:/usr/sbin:/sbin:/Users/nickmadaio/.openclaw/bin"
        environment["PATH"] = existingPath.isEmpty ? required : existingPath + ":" + required
        // Gog stores the OAuth token in its encrypted local keyring.  The
        // desktop app does not inherit the user's shell environment, so pass
        // only this one already-configured value to the agent process.  It is
        // never logged, displayed, or added to the gateway configuration.
        if let keyringPassword = Secrets.value("GOG_KEYRING_PASSWORD") {
            environment["GOG_KEYRING_PASSWORD"] = keyringPassword
        }
        process.environment = environment

        let outPipe = Pipe()
        let errPipe = Pipe()
        process.standardOutput = outPipe
        process.standardError = errPipe
        process.standardInput = FileHandle.nullDevice

        let started = Date()
        do {
            try process.run()
        } catch {
            throw GatewayError.failed(error.localizedDescription)
        }

        // Tracked so a user-initiated cancel (`cancelInFlight`) has something
        // to signal. Cleared unconditionally on every exit from this function,
        // whichever path that is.
        runningProcessLock.lock()
        runningProcess = process
        runningProcessLock.unlock()
        defer {
            runningProcessLock.lock()
            if runningProcess === process { runningProcess = nil }
            runningProcessLock.unlock()
        }

        // Watchdog: the CLI has its own --timeout, this is the backstop for the
        // case where it wedges without honouring it.
        //
        // SIGTERM then SIGKILL. `terminate()` alone is a request, and a wedged
        // agent is under no obligation to take it — on 2026-08-12 one did not,
        // and because this function is called from a SERIAL queue that stranded
        // every later turn as well as this one. `.thinking` never ended and
        // Orion was deaf for twelve minutes. `AppState`'s watchdog is the floor
        // under that; this is the fix for the thing that needed a floor.
        //
        // The two delays below are `RunTimeouts.terminateAt` and `.killGrace`,
        // not literals — see that file for why the three-way tie between this
        // deadline, the config default and the app's own watchdog ceiling was
        // the exact bug that let one failure show two different messages.
        let finished = AtomicFlag(false)
        DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + RunTimeouts.terminateAt) {
            guard !finished.value, process.isRunning else { return }
            process.terminate()
            DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + RunTimeouts.killGrace) {
                guard !finished.value, process.isRunning else { return }
                kill(process.processIdentifier, SIGKILL)
            }
        }

        // stderr is drained concurrently: if we blocked on stdout while stderr
        // filled its 64K pipe buffer, the child would deadlock.
        let errorBox = DataBox()
        let errorDrained = DispatchSemaphore(value: 0)
        DispatchQueue.global(qos: .utility).async {
            errorBox.data = errPipe.fileHandleForReading.readDataToEndOfFile()
            errorDrained.signal()
        }

        // Read stdout off this thread too, and wait on it with a deadline.
        //
        // `readDataToEndOfFile` returns when every WRITE end of the pipe is
        // closed — not when the child exits. The agent spawns tools, and any
        // grandchild that inherited this pipe and outlives its parent holds it
        // open forever. Killing the agent does not help; nothing does, because
        // the read is uninterruptible. Read it on a thread we are allowed to
        // abandon, and the hang costs one leaked thread instead of the app's
        // ability to hear.
        let outBox = DataBox()
        let outDrained = DispatchSemaphore(value: 0)
        DispatchQueue.global(qos: .utility).async {
            outBox.data = outPipe.fileHandleForReading.readDataToEndOfFile()
            outDrained.signal()
        }

        // Generous: this is the backstop behind the backstop, and a slow but
        // healthy answer must never trip it. `RunTimeouts.clientReadDeadline`,
        // not a literal — it must stay comfortably past `killAt` (see that
        // file's `violations()`), which a `timeoutSeconds + 30` literal here
        // could silently stop being true of the moment either number moved.
        let deadline = DispatchTime.now() + .seconds(Int(RunTimeouts.clientReadDeadline))
        let readInTime = outDrained.wait(timeout: deadline) == .success
        if !readInTime {
            finished.value = true
            if process.isRunning { kill(process.processIdentifier, SIGKILL) }
            throw GatewayError.failed(
                "the agent stopped responding and its output never closed"
            )
        }
        _ = errorDrained.wait(timeout: deadline)
        process.waitUntilExit()
        finished.value = true
        let outData = outBox.data

        let elapsedMs = Int(Date().timeIntervalSince(started) * 1000)
        let stdout = stripANSI(String(data: outData, encoding: .utf8) ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)

        if process.terminationStatus != 0 && stdout.isEmpty {
            let stderr = stripANSI(String(data: errorBox.data, encoding: .utf8) ?? "")
                .trimmingCharacters(in: .whitespacesAndNewlines)
            let lastLine = stderr.split(separator: "\n").last.map { String($0) }
            throw GatewayError.failed(lastLine ?? "exit \(process.terminationStatus)")
        }

        // --json reserves stdout, but be forgiving about stray leading lines.
        var payload: [String: Any]?
        var candidates: [String] = [stdout]
        candidates.append(contentsOf: stdout.split(separator: "\n").reversed().map { String($0) })
        for candidate in candidates {
            let trimmed = candidate.trimmingCharacters(in: .whitespacesAndNewlines)
            guard trimmed.hasPrefix("{"), let data = trimmed.data(using: .utf8) else { continue }
            if let object = try? JSONSerialization.jsonObject(with: data, options: []) as? [String: Any] {
                payload = object
                break
            }
        }

        guard let payload else {
            if !stdout.isEmpty { return GatewayReply(text: stdout, elapsedMs: elapsedMs) }
            throw GatewayError.unparseable
        }

        let reply = extractReply(payload)
        if reply.isEmpty {
            if (payload["status"] as? String) == "in_flight" { throw GatewayError.inFlight }
            throw GatewayError.unparseable
        }
        let home = FileManager.default.homeDirectoryForCurrentUser
        if ThinkingPolicy.struggled(home: home, session: session, since: started) {
            boost(session)
            OrionLog.write("[thinking] tool calls kept failing — thinking on for the next 10 minutes")
        }
        OrionLog.write("[thinking] \(thinking) for this turn")
        return GatewayReply(text: reply, elapsedMs: elapsedMs, thinking: ChatThinking.read(home: home, session: session, since: started))
    }

    // MARK: Cancellation

    /// Ends the in-flight `ask`, if there is one, without waiting for it.
    ///
    /// Before this existed, nothing could cancel `.thinking` at all: the
    /// recovery in `AppState.recoverFromStuckThinking` only ORPHANS the call
    /// (bumps a generation so a late answer is ignored) because it fires from
    /// the watchdog, which cannot reach the `Process` — it only ever sees the
    /// symptom, long after `ask` started. This is called from the user's own
    /// cancel, which runs on the same turn and can reach it directly.
    ///
    /// SIGTERM first, same grace as the internal watchdog, then SIGKILL. A
    /// grandchild holding the pipe open can still make the READ side of `ask`
    /// take until `clientReadDeadline` to notice the process died — this
    /// function does not wait for that, and does not need to: the caller has
    /// already moved its own generation on, so a late return is harmless.
    ///
    /// Returns whether a process was actually found and signalled — false
    /// means there was nothing in flight to cancel.
    @discardableResult
    static func cancelInFlight(reason: String) -> Bool {
        runningProcessLock.lock()
        let process = runningProcess
        runningProcessLock.unlock()
        guard let process, process.isRunning else { return false }
        process.terminate()
        DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + RunTimeouts.killGrace) {
            if process.isRunning { kill(process.processIdentifier, SIGKILL) }
        }
        return true
    }

    // MARK: Progress polling

    /// One bounded page of the metadata-only audit ledger since `afterMillis`,
    /// for `RunProgressModel` only. Never the reply path — a slow or failing
    /// audit poll must never affect whether a turn's actual answer arrives.
    ///
    /// Costs 2.4-2.8s measured on this machine (`RunTimeouts.
    /// measuredAuditInvocationCost`) — call at most once per
    /// `RunTimeouts.auditPollInterval`, and never from the main thread.
    ///
    /// Returns `nil` on any failure (missing binary, non-zero exit, unparsable
    /// output, or a poll that ran long). A missed poll just means this cycle
    /// contributes nothing to the feed; it is never treated as a turn failure.
    static func auditSince(_ afterMillis: Int, session: String) -> [String: Any]? {
        guard FileManager.default.isExecutableFile(atPath: binaryPath) else { return nil }

        let process = Process()
        process.executableURL = URL(fileURLWithPath: binaryPath)
        process.arguments = [
            "audit",
            "--session", session,
            "--after", String(afterMillis),
            "--json"
        ]
        var environment = ProcessInfo.processInfo.environment
        let existingPath = environment["PATH"] ?? ""
        let required = "/usr/bin:/bin:/usr/sbin:/sbin:/Users/nickmadaio/.openclaw/bin"
        environment["PATH"] = existingPath.isEmpty ? required : existingPath + ":" + required
        // Deliberately NOT `GOG_KEYRING_PASSWORD`: this reads metadata only and
        // needs no agent credential. Widening what this process gets is
        // exactly what the hard rule about that variable exists to prevent.
        process.environment = environment

        let outPipe = Pipe()
        process.standardOutput = outPipe
        process.standardError = FileHandle.nullDevice
        process.standardInput = FileHandle.nullDevice

        do {
            try process.run()
        } catch {
            return nil
        }

        let outBox = DataBox()
        let drained = DispatchSemaphore(value: 0)
        DispatchQueue.global(qos: .utility).async {
            outBox.data = outPipe.fileHandleForReading.readDataToEndOfFile()
            drained.signal()
        }
        // Generous relative to the measured cost, but bounded: a wedged audit
        // call must not pile up behind itself forever.
        let deadline = DispatchTime.now() + .milliseconds(Int(RunTimeouts.measuredAuditInvocationCost * 3 * 1000))
        guard drained.wait(timeout: deadline) == .success else {
            if process.isRunning { kill(process.processIdentifier, SIGKILL) }
            return nil
        }
        process.waitUntilExit()
        guard process.terminationStatus == 0 else { return nil }

        let text = stripANSI(String(data: outBox.data, encoding: .utf8) ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard let jsonData = text.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: jsonData, options: []) as? [String: Any]
        else { return nil }
        return object
    }

    // MARK: Parsing

    /// Pull the assistant text out of an `openclaw agent --json` response.
    ///
    /// The documented shape is {"payloads": [{"text": ...}], "meta": {...}}, but
    /// older and newer builds have also used `text`, `reply` and `message`. We
    /// accept any of them rather than hard-failing on a field rename.
    /// Pull the assistant's text out of an `openclaw agent --json` response.
    ///
    /// The observed shape from OpenClaw 2026.7.1-2 is:
    ///
    ///     { "runId": …, "status": "ok", "summary": "completed",
    ///       "result": { "payloads": [ { "text": "pong", "mediaUrl": null } ],
    ///                   "meta": { … } } }
    ///
    /// The reply is under **`result.payloads`**, not top-level `payloads` —
    /// which is what produced "the agent returned nothing this app could read"
    /// while the CLI was in fact answering perfectly. The documentation shows
    /// the inner object, so it is an easy level to lose.
    ///
    /// Both nestings are accepted, and so are several older field names, because
    /// this shape has moved across releases and a rename should degrade into a
    /// missing reply rather than a broken app.
    static func extractReply(_ payload: [String: Any]) -> String {
        // Search the wrapper and the inner result, in that order of specificity.
        var scopes: [[String: Any]] = []
        if let result = payload["result"] as? [String: Any] { scopes.append(result) }
        scopes.append(payload)
        if let data = payload["data"] as? [String: Any] { scopes.append(data) }

        for scope in scopes {
            var parts: [String] = []
            for key in ["payloads", "messages", "outputs"] {
                guard let items = scope[key] as? [Any] else { continue }
                for item in items {
                    if let dict = item as? [String: Any],
                       let text = dict["text"] as? String,
                       !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                        parts.append(text)
                    } else if let text = item as? String,
                              !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                        parts.append(text)
                    }
                }
                if !parts.isEmpty { break }
            }
            if !parts.isEmpty {
                return parts.joined(separator: "\n\n")
                    .trimmingCharacters(in: .whitespacesAndNewlines)
            }

            for key in ["text", "reply", "message", "content", "output"] {
                if let value = scope[key] as? String,
                   !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    return value.trimmingCharacters(in: .whitespacesAndNewlines)
                }
                if let nested = scope[key] as? [String: Any],
                   let text = nested["text"] as? String,
                   !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    return text.trimmingCharacters(in: .whitespacesAndNewlines)
                }
            }
        }
        return ""
    }

    // The ESC byte is embedded directly rather than as a regex \u escape, which
    // ICU spells differently from Swift.
    private static let ansiPattern = try? NSRegularExpression(
        pattern: "\u{001B}\\[[0-9;]*[A-Za-z]",
        options: []
    )

    static func stripANSI(_ input: String) -> String {
        guard let regex = ansiPattern, !input.isEmpty else { return input }
        let range = NSRange(input.startIndex..<input.endIndex, in: input)
        return regex.stringByReplacingMatches(in: input, options: [], range: range, withTemplate: "")
    }
}

// MARK: - Small boxes for cross-queue handoff

final class DataBox {
    var data = Data()
}

final class AtomicFlag {
    private let lock = NSLock()
    private var storage: Bool

    init(_ initial: Bool) { storage = initial }

    var value: Bool {
        get { lock.lock(); defer { lock.unlock() }; return storage }
        set { lock.lock(); storage = newValue; lock.unlock() }
    }
}
