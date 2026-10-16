import Foundation

/// 2026-10-16 UI audit #7 (log noise): a line is written when it CHANGES, and
/// at most once per `repeatAfter` seconds while it stays the same, so a poll
/// that finds the same thing every two minutes does not write 600 identical
/// lines. Pure and clock-injected so it can be tested.
struct LogRateLimiter {
    private var lastValue: [String: String] = [:]
    private var lastWritten: [String: Date] = [:]

    /// - Parameters:
    ///   - key: which stream of lines this is ("audio", "lights", ...).
    ///   - signature: what must differ for the line to count as new. Defaults
    ///     to the message itself; pass something coarser when the message holds
    ///     jittery numbers (the audio level) that are not themselves news.
    ///   - repeatAfter: write an unchanged line anyway after this long. Nil
    ///     means never repeat.
    mutating func shouldWrite(key: String, message: String, signature: String? = nil,
                              now: Date = Date(), repeatAfter: TimeInterval? = nil) -> Bool {
        let signature = signature ?? message
        let changed = lastValue[key] != signature
        let due: Bool
        if let repeatAfter, let last = lastWritten[key] {
            due = now.timeIntervalSince(last) >= repeatAfter
        } else {
            due = false
        }
        guard changed || due else { return false }
        lastValue[key] = signature
        lastWritten[key] = now
        return true
    }
}
