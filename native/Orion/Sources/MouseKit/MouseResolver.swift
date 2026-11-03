import Foundation

/// Contract lookup order. Returns nil when the press must pass through untouched.
public enum MouseResolver {
    /// `gameSession`: a game is running (even if tabbed out of). With auto-pause on, every binding passes through, in every app, before any other rule.
    public static func resolve(button: Int, bundleId: String?, isGame: Bool, bindings: BindingsFile, gameSession: Bool = false) -> MouseAction? {
        guard bindings.enabled, button >= 3 else { return nil }   // a manual off always wins
        if gameSession, bindings.autoPauseInGames { return nil }
        if let bundleId, bindings.passthroughApps.contains(bundleId) { return nil }
        if bindings.autoPassthroughGames, isGame { return nil }
        let key = String(button)
        let chosen = bundleId.flatMap { bindings.apps[$0]?[key] } ?? bindings.default[key]
        guard let chosen, chosen != .passthrough else { return nil }
        return chosen
    }
}
