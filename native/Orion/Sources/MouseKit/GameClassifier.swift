import Foundation

/// Decides whether the frontmost app is a game. Run once per app activation, never per click.
public enum GameClassifier {
    public static let knownGameBundles: Set<String> = [
        "com.mojang.minecraftlauncher", "com.mojang.minecraft", "com.riotgames.leagueoflegends",
        "com.blizzard.worldofwarcraft"
    ]

    public struct Facts {
        public var bundleId: String?
        public var name: String?
        public var category: String?          // LSApplicationCategoryType
        public var isJavaProcess: Bool
        public var windowTitle: String?
        public var isFullscreen: Bool
        public init(bundleId: String? = nil, name: String? = nil, category: String? = nil, isJavaProcess: Bool = false,
                    windowTitle: String? = nil, isFullscreen: Bool = false) {
            self.bundleId = bundleId; self.name = name; self.category = category
            self.isJavaProcess = isJavaProcess; self.windowTitle = windowTitle; self.isFullscreen = isFullscreen
        }
    }

    public static func isGame(_ f: Facts) -> Bool {
        if let id = f.bundleId, knownGameBundles.contains(id) { return true }
        if let c = f.category?.lowercased() {
            if c.contains("-games") { return true }
            return false   // an app that declares a non-game category is never a game, even fullscreen
        }
        if f.isJavaProcess {
            let hay = [f.windowTitle, f.name].compactMap { $0?.lowercased() }
            if hay.contains(where: { $0.contains("minecraft") }) { return true }
        }
        // Fullscreen, no declared category, not a system or well-known productivity app.
        return f.isFullscreen && !isKnownNonGame(f.bundleId)
    }

    private static func isKnownNonGame(_ id: String?) -> Bool {
        guard let id else { return true }   // no bundle id: cannot say it is a game
        let prefixes = ["com.apple.", "com.microsoft.", "com.google.", "org.mozilla.", "com.todesktop.",
                        "com.googlecode.iterm2", "com.tinyspeck.", "us.zoom.", "company.thebrowser."]
        return prefixes.contains { id.hasPrefix($0) }
    }
}
