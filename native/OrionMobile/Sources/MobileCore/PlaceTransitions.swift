import Foundation

/// Which geofence state reports become a place event (the phone's PlaceMonitor, WP5).
public enum PlaceTransitions {
    /// The state CLMonitor reports for a place is only worth sending when it is new information:
    /// the first state ever seen for a place (where he is right now, e.g. "enter" home), or a change.
    /// A repeat of the state already recorded is dropped. `previous` is nil the first time a place is seen.
    public static func shouldEmit(previous: String?, new: String) -> Bool {
        guard ["enter", "exit"].contains(new) else { return false }
        return previous != new
    }
}

extension LinkSnapshot.KnownPlace {
    /// Home as Nick confirmed it (Scape Shoreditch). Mirrors SEEDED_HOME in scripts/lib/awareness/places.mjs:
    /// the Mac publishes this when it has no known-places file, and the phone falls back to it.
    public static let seededHome = LinkSnapshot.KnownPlace(id: "home", name: "Scape Shoreditch", lat: 51.5273608, lon: -0.0865265, radiusM: 150, kind: "home")
}
