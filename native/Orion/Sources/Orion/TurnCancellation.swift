import Foundation

/// One turn's "he cancelled this" flag, readable from the agent queue.
///
/// `askGeneration` lives on the main thread and only orphans a reply that
/// comes back; it cannot stop a gateway call that has not started yet. On
/// 2026-10-31 Escape cancelled a turn during the inbound-turn settle wait
/// (before the process existed, so `cancelInFlight` had nothing to kill) and
/// the overheard fragment reached the gateway three seconds later anyway.
final class TurnCancellation {
    private let lock = NSLock()
    private var cancelled = false

    var isCancelled: Bool {
        lock.lock()
        defer { lock.unlock() }
        return cancelled
    }

    func cancel() {
        lock.lock()
        cancelled = true
        lock.unlock()
    }
}
