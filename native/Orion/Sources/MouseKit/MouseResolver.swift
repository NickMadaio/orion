import Foundation

/// Contract lookup order. Returns nil when the press must pass through untouched.
public enum MouseResolver {
    public static func resolve(button: Int, bundleId: String?, isGame: Bool, bindings: BindingsFile) -> MouseAction? {
        guard bindings.enabled, button >= 3 else { return nil }
        if let bundleId, bindings.passthroughApps.contains(bundleId) { return nil }
        if bindings.autoPassthroughGames, isGame { return nil }
        let key = String(button)
        let chosen = bundleId.flatMap { bindings.apps[$0]?[key] } ?? bindings.default[key]
        guard let chosen, chosen != .passthrough else { return nil }
        return chosen
    }
}
