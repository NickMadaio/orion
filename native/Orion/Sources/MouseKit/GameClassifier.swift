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
        /// The executable's full path: the only reliable fact for a Java game, since window titles need Screen Recording.
        public var executablePath: String?
        public init(bundleId: String? = nil, name: String? = nil, category: String? = nil, isJavaProcess: Bool = false,
                    windowTitle: String? = nil, isFullscreen: Bool = false, executablePath: String? = nil) {
            self.executablePath = executablePath
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
            if let path = f.executablePath, isGameProcess(path: path) { return true }
        }
        // Fullscreen, no declared category, not a system or well-known productivity app.
        return f.isFullscreen && !isKnownNonGame(f.bundleId)
    }

    /// Where Minecraft's own Java runtime lives: the vanilla launcher, CurseForge, Prism, Modrinth. A system JDK never matches.
    static let javaGameHints = ["minecraft", "curseforge", "prismlauncher", "prism launcher", "modrinth", "multimc"]

    /// A `java` executable that belongs to a Minecraft install. Used to follow the real game process, not just its launcher.
    public static func isGameProcess(path: String) -> Bool {
        let lower = path.lowercased()
        guard lower.hasSuffix("/java") || lower.hasSuffix("/javaw") else { return false }
        return javaGameHints.contains { lower.contains($0) }
    }

    private static func isKnownNonGame(_ id: String?) -> Bool {
        guard let id else { return true }   // no bundle id: cannot say it is a game
        let prefixes = ["com.apple.", "com.microsoft.", "com.google.", "org.mozilla.", "com.todesktop.",
                        "com.googlecode.iterm2", "com.tinyspeck.", "us.zoom.", "company.thebrowser."]
        return prefixes.contains { id.hasPrefix($0) }
    }
}
