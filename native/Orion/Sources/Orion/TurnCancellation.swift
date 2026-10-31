import Foundation

/// One turn's "he cancelled this" flag, readable from the agent queue.
///
/// `askGeneration` lives on the main thread and only orphans a reply that
/// comes back; it cannot stop a gateway call that has not started yet. On
/// 2026-10-31 Escape cancelled a turn during the inbound-turn settle wait
/// (before the process existed, so `cancelInFlight` had nothing to kill) and
/// the overheard fragment reached the gateway three seconds later anyway.
///
/// REV3 #8: it also owns the gateway process its turn started. The old
/// `GatewayClient.cancelInFlight` killed whatever process was running at that
/// instant, with no turn identity, so a cancel that landed late could stop the
/// NEXT turn. Now a cancel can only reach the process attached to its own turn.
final class TurnCancellation {
    private let lock = NSLock()
    private var cancelled = false
    private var process: Process?

    var isCancelled: Bool {
        lock.lock()
        defer { lock.unlock() }
        return cancelled
    }

    func cancel() {
        lock.lock()
        cancelled = true
        let target = process
        process = nil
        lock.unlock()
        if let target { Self.stop(target) }
    }

    /// The process this turn started. Attached after a cancel, it is stopped at
    /// once: that closes the gap between the agent queue's check and `run()`.
    func attach(_ started: Process) {
        lock.lock()
        let already = cancelled
        if !already { process = started }
        lock.unlock()
        if already { Self.stop(started) }
    }

    /// The process ended on its own; a later cancel has nothing to stop.
    func detach(_ finished: Process) {
        lock.lock()
        if process === finished { process = nil }
        lock.unlock()
    }

    /// SIGTERM, then SIGKILL after the grace period, off the caller's thread.
    static func stop(_ target: Process) {
        guard target.isRunning else { return }
        target.terminate()
        DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + RunTimeouts.killGrace) {
            if target.isRunning { kill(target.processIdentifier, SIGKILL) }
        }
    }
}
