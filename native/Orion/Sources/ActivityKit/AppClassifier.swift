import Foundation
import MouseKit

/// Which kind of app is in front. Game detection is MouseKit's GameClassifier (one rule, not two); this adds the rest.
public enum AppClassifier {
    static let browsers: Set<String> = ["com.apple.safari", "com.google.chrome", "company.thebrowser.browser", "com.brave.browser",
                                        "com.microsoft.edgemac", "org.mozilla.firefox", "com.operasoftware.opera", "com.vivaldi.vivaldi"]
    static let system: Set<String> = ["com.apple.finder", "com.apple.loginwindow", "com.apple.systempreferences", "com.apple.dock",
                                      "com.apple.notificationcenterui", "com.apple.spotlight", "com.apple.controlcenter",
                                      "com.apple.activitymonitor", "com.apple.screensaver.engine", "com.nickmadaio.orion.app"]
    static let work: Set<String> = ["com.microsoft.vscode", "com.apple.dt.xcode", "com.apple.iwork.pages", "com.apple.iwork.numbers",
                                    "com.apple.iwork.keynote", "com.microsoft.word", "com.microsoft.excel", "com.microsoft.powerpoint",
                                    "com.apple.terminal", "com.googlecode.iterm2", "com.apple.mail", "notion.id", "com.apple.reminders",
                                    "com.apple.ical", "com.figma.desktop", "com.apple.textedit", "com.microsoft.outlook"]
    static let study: Set<String> = ["md.obsidian", "net.ankiweb.dtop", "com.apple.notes", "org.zotero.zotero", "com.apple.preview",
                                     "com.apple.books", "com.apple.freeform"]
    static let chat: Set<String> = ["com.apple.mobilesms", "com.hnc.discord", "net.whatsapp.whatsapp", "com.tinyspeck.slackmacgap",
                                    "ru.keepcoder.telegram", "us.zoom.xos", "com.apple.facetime", "com.microsoft.teams2", "org.whispersystems.signal-desktop"]
    static let media: Set<String> = ["com.spotify.client", "com.apple.music", "com.apple.tv", "org.videolan.vlc", "com.colliderli.iina",
                                     "com.apple.podcasts", "com.apple.quicktimeplayerx", "tv.plex.desktop", "com.netflix.netflix"]
    static let socialNames = ["instagram", "tiktok", "reddit", "twitter", "facebook", "snapchat", "bluesky", "threads"]

    /// Category from the app's own facts, with the game decision made upstream.
    public static func category(bundleId: String?, name: String?, isGame: Bool) -> ActivityCategory {
        if isGame { return .game }
        let id = bundleId?.lowercased() ?? ""
        if browsers.contains(id) { return .browser }
        if system.contains(id) { return .system }
        if work.contains(id) || id.hasPrefix("com.jetbrains.") || id.hasPrefix("com.todesktop.") { return .work }
        if study.contains(id) { return .study }
        if chat.contains(id) { return .chat }
        if media.contains(id) { return .media }
        let lower = name?.lowercased() ?? ""
        if socialNames.contains(where: { lower == $0 || lower.contains($0) }) || id.contains("twitter") || id.contains("tiktok") { return .social }
        return .other
    }

    /// Category from the full game facts: GameClassifier decides "game", including java Minecraft by executable path.
    public static func category(facts: GameClassifier.Facts) -> ActivityCategory {
        category(bundleId: facts.bundleId, name: facts.name, isGame: GameClassifier.isGame(facts))
    }

    /// "Minecraft" for a Java game, else the app's own name; nil when the app is not a game.
    public static func gameName(facts: GameClassifier.Facts) -> String? {
        guard GameClassifier.isGame(facts) else { return nil }
        if facts.isJavaProcess { return "Minecraft" }
        return facts.name ?? facts.bundleId
    }
}
