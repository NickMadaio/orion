import Foundation

/// The Mac asking the phone for one fresh location fix (2026-11-02).
///
/// On 2026-11-02 at 08:02 the newest phone fix was from 10-30, so awareness had home as unknown and a
/// "Leave in 13 min" reminder stayed a silent bubble. The rule (speak only when home is known or
/// headphones are in) was right; what was missing was ORION noticing the fix was days old and asking.
/// The Mac writes `location-request.json` when it needs a location and the last fix is stale; the Link
/// carries it in the snapshot; changing the snapshot pushes to the phone, and the phone answers with
/// one fix and a sample. `id` makes each request answered once, so a snapshot re-read cannot loop.
public struct LocationRequest: Codable, Equatable, Sendable {
    public var id: String
    public var at: Date
    /// Why the Mac asked ("class soon", "reminder held silent"): for the logs, never shown to Nick.
    public var reason: String?

    public init(id: String, at: Date, reason: String? = nil) {
        self.id = id; self.at = at; self.reason = reason
    }

    /// How long a request stands. Past it the phone ignores it: the Mac asks again if it still needs to.
    public static let lifetime: TimeInterval = 15 * 60
    /// A request stamped this far in the future is a broken clock, not a request.
    public static let clockSkew: TimeInterval = 5 * 60

    /// What an id may contain: it is compared for equality and stored, so it is short ASCII, nothing else.
    public static func isValidID(_ id: String) -> Bool {
        (1...64).contains(id.count) && id.allSatisfy { $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "-" || $0 == "_") }
    }

    /// Still standing at `now`: not expired, not from the future.
    public func isFresh(at now: Date) -> Bool {
        let age = now.timeIntervalSince(at)
        return age <= Self.lifetime && age >= -Self.clockSkew
    }

    /// Whether the phone should take a fix for this request: fresh, valid, and not the one it last answered.
    public func shouldAnswer(lastAnsweredID: String?, now: Date) -> Bool {
        Self.isValidID(id) && id != lastAnsweredID && isFresh(at: now)
    }
}
