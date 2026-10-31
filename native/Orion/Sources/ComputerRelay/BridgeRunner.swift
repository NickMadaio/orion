import Darwin
import Foundation

/// Runs one bridge request and returns its stdout. Injected so the relay can be tested
/// against a fake; the real one spawns orion-mac-bridge as THIS process's child, which is
/// what makes macOS check Accessibility against Orion.app rather than the gateway.
public protocol BridgeRunning {
    func run(line: Data) -> Result<Data, BridgeRunFailure>
}

public enum BridgeRunFailure: Error, Equatable, CustomStringConvertible {
    case binaryRefused(String)
    case launchFailed(String)
    case timedOut
    case outputTooLarge

    public var description: String {
        switch self {
        case .binaryRefused(let why): return "the Orion app refused to run the screen bridge: \(why)"
        case .launchFailed(let why): return "the Orion app could not start the screen bridge: \(why)"
        case .timedOut: return "the screen bridge did not answer the Orion app in time"
        case .outputTooLarge: return "the screen bridge's answer was larger than the relay accepts"
        }
    }
}

public struct ProcessBridgeRunner: BridgeRunning {
    public let binary: URL
    public let timeout: TimeInterval

    public init(binary: URL, timeout: TimeInterval = 15) {
        self.binary = binary
        self.timeout = timeout
    }

    /// The first candidate that exists. The installed copy comes first: it sits outside
    /// ~/Desktop, which is itself TCC-protected for an app.
    public static func locate(home: URL = URL(fileURLWithPath: NSHomeDirectory())) -> URL? {
        [".openclaw/orion-remote/bin/orion-mac-bridge",
         "Desktop/ORION/native/OrionMacBridge/.build/release/orion-mac-bridge"]
            .map { home.appendingPathComponent($0) }
            .first { FileManager.default.isExecutableFile(atPath: $0.path) }
    }

    /// A same-user binary that nobody else can rewrite. Anything else could turn the app's
    /// Accessibility grant into someone else's.
    public static func checkBinary(_ url: URL) -> String? {
        var info = stat()
        guard stat(url.path, &info) == 0 else { return "not found at \(url.lastPathComponent)" }
        guard (info.st_mode & S_IFMT) == S_IFREG else { return "not a regular file" }
        guard info.st_uid == getuid() else { return "owned by another user" }
        guard (info.st_mode & 0o022) == 0 else { return "writable by group or others" }
        guard (info.st_mode & 0o100) != 0 else { return "not executable" }
        return nil
    }

    public func run(line: Data) -> Result<Data, BridgeRunFailure> {
        if let why = Self.checkBinary(binary) { return .failure(.binaryRefused(why)) }
        let process = Process()
        process.executableURL = binary
        process.arguments = []
        process.environment = ["HOME": NSHomeDirectory(), "PATH": "/usr/bin:/bin:/usr/sbin:/sbin"]
        let input = Pipe(), output = Pipe()
        process.standardInput = input
        process.standardOutput = output
        process.standardError = FileHandle.nullDevice
        do { try process.run() } catch { return .failure(.launchFailed(error.localizedDescription)) }
        try? input.fileHandleForWriting.write(contentsOf: line)
        try? input.fileHandleForWriting.close()

        let collected = OutputCollector(limit: RelayProtocol.Limits.maxBridgeOutputBytes)
        let reader = DispatchQueue(label: "orion.relay.bridge-reader")
        let done = DispatchSemaphore(value: 0)
        reader.async {
            collected.drain(output.fileHandleForReading)
            done.signal()
        }
        if done.wait(timeout: .now() + timeout) == .timedOut || collected.overflowed {
            process.terminate()
            kill(process.processIdentifier, SIGKILL)
            _ = done.wait(timeout: .now() + 2)
            return .failure(collected.overflowed ? .outputTooLarge : .timedOut)
        }
        let deadline = Date().addingTimeInterval(2)
        while process.isRunning, Date() < deadline { usleep(10_000) }
        if process.isRunning { kill(process.processIdentifier, SIGKILL) }
        return .success(collected.data)
    }
}

/// Reads a pipe until EOF or the cap, then stops reading so a runaway child cannot fill memory.
final class OutputCollector {
    private let limit: Int
    private(set) var data = Data()
    private(set) var overflowed = false

    init(limit: Int) { self.limit = limit }

    func drain(_ handle: FileHandle) {
        while true {
            let chunk = handle.availableData
            if chunk.isEmpty { return }
            if data.count + chunk.count > limit {
                overflowed = true
                return
            }
            data.append(chunk)
            // One response line is all the relay sends per spawn; stop at the first newline.
            if chunk.contains(0x0A) { return }
        }
    }
}
