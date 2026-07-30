import Darwin
import Foundation

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
}

enum GatewayClient {
    static let binaryPath = "/Users/nickmadaio/.openclaw/bin/openclaw"
    static let configPath = "/Users/nickmadaio/.openclaw/openclaw.json"
    static let sessionKey = "orion-app"
    static let timeoutSeconds = 180

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

    /// A TCP connect is enough: we only need to know the listener is there.
    /// Loopback either connects or refuses immediately, so a blocking connect
    /// cannot hang — but call this off the main thread anyway.
    static func isUp(timeout: TimeInterval = 0.4) -> Bool {
        let handle = socket(AF_INET, SOCK_STREAM, 0)
        guard handle >= 0 else { return false }
        defer { Darwin.close(handle) }

        var tv = timeval(tv_sec: Int(timeout), tv_usec: Int32((timeout - Double(Int(timeout))) * 1_000_000))
        setsockopt(handle, SOL_SOCKET, SO_RCVTIMEO, &tv, socklen_t(MemoryLayout<timeval>.size))
        setsockopt(handle, SOL_SOCKET, SO_SNDTIMEO, &tv, socklen_t(MemoryLayout<timeval>.size))

        var addr = sockaddr_in()
        addr.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
        addr.sin_family = sa_family_t(AF_INET)
        let resolved = min(max(port(), 1), 65535)
        addr.sin_port = UInt16(resolved).bigEndian
        addr.sin_addr.s_addr = UInt32(0x7F00_0001).bigEndian // 127.0.0.1

        let status = withUnsafePointer(to: &addr) { pointer -> Int32 in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { sa in
                Darwin.connect(handle, sa, socklen_t(MemoryLayout<sockaddr_in>.size))
            }
        }
        return status == 0
    }

    // MARK: One agent turn

    /// Blocking. Always call from a background queue.
    static func ask(_ text: String, session: String = GatewayClient.sessionKey) throws -> GatewayReply {
        guard FileManager.default.isExecutableFile(atPath: binaryPath) else {
            throw GatewayError.missingBinary(binaryPath)
        }

        let process = Process()
        process.executableURL = URL(fileURLWithPath: binaryPath)
        process.arguments = [
            "agent",
            "--session-key", session,
            "--message", text,
            "--json",
            "--timeout", String(timeoutSeconds)
        ]
        // The CLI is a bash shim with a `/usr/bin/env` shebang. A GUI app
        // inherits a minimal environment, so give it a PATH it can resolve.
        var environment = ProcessInfo.processInfo.environment
        let existingPath = environment["PATH"] ?? ""
        let required = "/usr/bin:/bin:/usr/sbin:/sbin:/Users/nickmadaio/.openclaw/bin"
        environment["PATH"] = existingPath.isEmpty ? required : existingPath + ":" + required
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

        // Watchdog: the CLI has its own --timeout, this is the backstop for the
        // case where it wedges without honouring it.
        let finished = AtomicFlag(false)
        DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + Double(timeoutSeconds + 15)) {
            if !finished.value && process.isRunning {
                process.terminate()
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

        let outData = outPipe.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        errorDrained.wait()
        finished.value = true

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
        return GatewayReply(text: reply, elapsedMs: elapsedMs)
    }

    // MARK: Parsing

    /// Pull the assistant text out of an `openclaw agent --json` response.
    ///
    /// The documented shape is {"payloads": [{"text": ...}], "meta": {...}}, but
    /// older and newer builds have also used `text`, `reply` and `message`. We
    /// accept any of them rather than hard-failing on a field rename.
    static func extractReply(_ payload: [String: Any]) -> String {
        var parts: [String] = []
        if let items = payload["payloads"] as? [Any] {
            for item in items {
                if let dict = item as? [String: Any],
                   let text = dict["text"] as? String,
                   !text.isEmpty {
                    parts.append(text)
                }
            }
        }
        if !parts.isEmpty {
            return parts.joined(separator: "\n\n").trimmingCharacters(in: .whitespacesAndNewlines)
        }

        for key in ["text", "reply", "message", "content", "output"] {
            if let value = payload[key] as? String,
               !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                return value.trimmingCharacters(in: .whitespacesAndNewlines)
            }
            if let nested = payload[key] as? [String: Any],
               let text = nested["text"] as? String {
                return text.trimmingCharacters(in: .whitespacesAndNewlines)
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
