import ThinkingOrbsKit

/// The Visual chosen in Settings → Core, stored as its raw value under `storageKey`. Home and the floating voice view
/// both draw whichever this is. An unknown or missing value is Thinking Orion, the default.
enum HologramStyle: String, CaseIterable {
    case thinkingOrion
    case original
    case blackHole
    /// Thinking Orion recoloured in electric azure (wave 13).
    case blueOrion

    static let storageKey = "orion.dashboard.coreStyle"

    init(stored: String?) {
        self = stored.flatMap(HologramStyle.init(rawValue:)) ?? .thinkingOrion
    }

    /// The colours the shell and orb draw in. Black Hole draws its own and ignores this.
    var palette: HoloPalette { self == .blueOrion ? .blue : .gold }
}
