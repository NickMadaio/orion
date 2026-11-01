//
//  Whether the session a piece of queued work belongs to is still the live one.
//
//  Distraction review runs on a background queue and takes seconds. On
//  2026-11-01 a session stopped at 04:44:09 and its queued review still quit
//  an app at 04:44:13. Each start gets a new generation; work captured under
//  one generation is live only while that same session is.
//

import Foundation

public final class SessionLiveness: @unchecked Sendable {
    private let lock = NSLock()
    private var generation = 0
    private var live = false

    public init() {}

    /// A new session is live. Returns its generation.
    @discardableResult
    public func begin() -> Int {
        lock.lock(); defer { lock.unlock() }
        generation += 1
        live = true
        return generation
    }

    public func end() {
        lock.lock(); defer { lock.unlock() }
        live = false
    }

    public func isLive(_ candidate: Int) -> Bool {
        lock.lock(); defer { lock.unlock() }
        return live && candidate == generation
    }
}
