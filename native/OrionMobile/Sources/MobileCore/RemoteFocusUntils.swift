import Foundation

/// The group locks the Mac's directive holds, kept apart from the locks the phone set itself (night, threshold:
/// `until.<group>`), so a Mac that stops listing a group lifts only its own hold on it.
public enum RemoteFocusUntils {
    /// The Mac-held ends after one directive: groups it no longer lists are dropped, listed ones take the newest end still
    /// ahead, and a group with no end ahead keeps nothing. Pure.
    public static func reconcile(previous: [String: Double], plan: [LinkSnapshot.FocusListPlan], now: Double) -> [String: Double] {
        var next: [String: Double] = [:]
        for entry in plan {
            guard let until = entry.until, until > now else { continue }
            next[entry.name] = max(until, previous[entry.name] ?? 0)
        }
        return next
    }

    /// Whether a group is held right now, by the phone's own lock or the Mac's.
    public static func isHeld(local: Double, remote: Double, now: Double) -> Bool { local > now || remote > now }
}
