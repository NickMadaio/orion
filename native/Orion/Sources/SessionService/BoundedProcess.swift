//
//  Run a child process without ever hanging the caller.
//
//  Two hangs this exists to close, both found on 2026-11-01:
//
//  1. `waitUntilExit()` spins a nested run loop. Called on the main thread it
//     lets SwiftUI re-enter mid-update, which is half of the deadlock that
//     wedged the app. This waits on a semaphore signalled by the termination
//     handler instead — no run loop is pumped.
//  2. A `Pipe()` nobody reads holds about 64 KB. A child that writes more
//     blocks forever on write, never exits, and the wait never returns. Both
//     stdout and stderr are drained on their own threads from the moment the
//     child starts.
//
//  And a timeout: a child that will not finish is asked to stop (SIGTERM),
//  then made to (SIGKILL), and the caller is told it timed out.
//

import Foundation

public struct BoundedProcessResult: Equatable, Sendable {
    public let status: Int32
    public let stdout: Data
    public let stderr: Data
    public let timedOut: Bool
    public let launchFailure: String?

    public var succeeded: Bool { status == 0 && !timedOut && launchFailure == nil }
}

public enum BoundedProcess {

    /// How long a stopped child gets between SIGTERM and SIGKILL, and how long
    /// the pipes get to reach EOF after the child is gone.
    static let grace: TimeInterval = 2

    public static func run(executable: URL, arguments: [String],
                           timeout: TimeInterval) -> BoundedProcessResult {
        let process = Process()
        process.executableURL = executable
        process.arguments = arguments
        process.standardInput = FileHandle.nullDevice
        let out = Pipe()
        let err = Pipe()
        process.standardOutput = out
        process.standardError = err

        let exited = DispatchSemaphore(value: 0)
        process.terminationHandler = { _ in exited.signal() }

        do {
            try process.run()
        } catch {
            return BoundedProcessResult(status: -1, stdout: Data(), stderr: Data(),
                                        timedOut: false,
                                        launchFailure: error.localizedDescription)
        }

        let drained = DispatchGroup()
        let stdoutBox = drain(out.fileHandleForReading, group: drained)
        let stderrBox = drain(err.fileHandleForReading, group: drained)

        var timedOut = false
        if exited.wait(timeout: .now() + timeout) == .timedOut {
            timedOut = true
            process.terminate()
            if exited.wait(timeout: .now() + grace) == .timedOut {
                kill(process.processIdentifier, SIGKILL)
                _ = exited.wait(timeout: .now() + grace)
            }
        }
        // A grandchild that inherited the pipe can hold it open past the
        // child's exit. Take what arrived rather than wait on it.
        _ = drained.wait(timeout: .now() + grace)

        let status = process.isRunning ? -1 : process.terminationStatus
        return BoundedProcessResult(status: status, stdout: stdoutBox.data,
                                    stderr: stderrBox.data, timedOut: timedOut,
                                    launchFailure: nil)
    }

    /// Read a pipe to EOF on its own thread, so the child can never block on
    /// a full pipe.
    private static func drain(_ handle: FileHandle, group: DispatchGroup) -> DataBox {
        let box = DataBox()
        group.enter()
        DispatchQueue.global(qos: .utility).async {
            box.set(handle.readDataToEndOfFile())
            group.leave()
        }
        return box
    }
}

/// A lock-guarded slot the drain thread fills and the caller reads.
private final class DataBox: @unchecked Sendable {
    private let lock = NSLock()
    private var value = Data()

    func set(_ data: Data) {
        lock.lock(); defer { lock.unlock() }
        value = data
    }

    var data: Data {
        lock.lock(); defer { lock.unlock() }
        return value
    }
}
