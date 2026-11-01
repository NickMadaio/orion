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
//     stdout and stderr are drained by readability handlers from the moment
//     the child starts, and closed when the call returns.
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
        let stdoutDrain = PipeDrain(out.fileHandleForReading, group: drained)
        let stderrDrain = PipeDrain(err.fileHandleForReading, group: drained)

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
        // child's exit. Take what arrived, then close our read ends so neither
        // a handler nor a descriptor outlives this call.
        _ = drained.wait(timeout: .now() + grace)
        stdoutDrain.close()
        stderrDrain.close()

        let status = process.isRunning ? -1 : process.terminationStatus
        return BoundedProcessResult(status: status, stdout: stdoutDrain.data,
                                    stderr: stderrDrain.data, timedOut: timedOut,
                                    launchFailure: nil)
    }
}

/// Reads one pipe as data arrives, via a readability handler rather than a
/// blocked thread, so the child can never stall on a full pipe and closing
/// the drain leaves nothing behind.
private final class PipeDrain: @unchecked Sendable {
    private let lock = NSLock()
    private let handle: FileHandle
    private let group: DispatchGroup
    private var buffer = Data()
    private var finished = false

    init(_ handle: FileHandle, group: DispatchGroup) {
        self.handle = handle
        self.group = group
        group.enter()
        handle.readabilityHandler = { [weak self] _ in self?.readAvailable() }
    }

    /// POSIX read rather than `availableData`, which raises an Objective-C
    /// exception on a closed descriptor instead of returning an error.
    private func readAvailable() {
        lock.lock(); defer { lock.unlock() }
        guard !finished else { return }
        var chunk = [UInt8](repeating: 0, count: 65_536)
        let got = read(handle.fileDescriptor, &chunk, chunk.count)
        if got > 0 {
            buffer.append(contentsOf: chunk[0..<got])
        } else if got == 0 || (errno != EAGAIN && errno != EINTR) {
            finishLocked()
        }
    }

    private func finishLocked() {
        guard !finished else { return }
        finished = true
        handle.readabilityHandler = nil
        group.leave()
    }

    /// Stop reading and release the descriptor, whether or not EOF came.
    func close() {
        lock.lock(); defer { lock.unlock() }
        finishLocked()
        try? handle.close()
    }

    var data: Data {
        lock.lock(); defer { lock.unlock() }
        return buffer
    }
}
