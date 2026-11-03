import AppKit
import Foundation
import PaletteKit

/// The installed apps, found off the main thread and cached in orion-controlled so the first open is instant.
enum PaletteAppIndex {
    private static let roots = ["/Applications", "/Applications/Utilities", "/System/Applications", "/System/Applications/Utilities",
                                "/System/Library/CoreServices",
                                FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Applications").path]
    private static let staleAfter: TimeInterval = 30 * 60

    private struct Cache: Codable { var at: Double; var apps: [Entry] }
    private struct Entry: Codable { var name: String; var path: String }

    private static var cacheURL: URL {
        FrecencyFile.standard.url.deletingLastPathComponent().appendingPathComponent("palette-apps.json")
    }

    static func scan() -> [PaletteInstalledApp] {
        var seen = Set<String>()
        return roots.flatMap { root -> [PaletteInstalledApp] in
            ((try? FileManager.default.contentsOfDirectory(atPath: root)) ?? []).filter { $0.hasSuffix(".app") }.map {
                PaletteInstalledApp(name: String($0.dropLast(4)), path: URL(fileURLWithPath: root).appendingPathComponent($0).path)
            }
        }.filter { seen.insert($0.name.lowercased()).inserted }.sorted { $0.name.lowercased() < $1.name.lowercased() }
    }

    /// The cached list and whether it is old enough to rescan.
    static func cached(now: Date = Date()) -> (apps: [PaletteInstalledApp], stale: Bool) {
        guard let data = try? Data(contentsOf: cacheURL), let cache = try? JSONDecoder().decode(Cache.self, from: data) else { return ([], true) }
        return (cache.apps.map { PaletteInstalledApp(name: $0.name, path: $0.path) }, now.timeIntervalSince1970 - cache.at > staleAfter)
    }

    static func save(_ apps: [PaletteInstalledApp], now: Date = Date()) {
        let cache = Cache(at: now.timeIntervalSince1970, apps: apps.map { Entry(name: $0.name, path: $0.path) })
        try? FileManager.default.createDirectory(at: cacheURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? JSONEncoder().encode(cache).write(to: cacheURL, options: .atomic)
    }

    /// Apps with a Dock icon, which is what "switch to" means. Cheap enough for the main thread.
    static func running() -> [PaletteRunningApp] {
        let own = Bundle.main.bundleIdentifier
        return NSWorkspace.shared.runningApplications.compactMap { app in
            guard app.activationPolicy == .regular, let id = app.bundleIdentifier, id != own,
                  let name = app.localizedName, let path = app.bundleURL?.path else { return nil }
            return PaletteRunningApp(name: name, bundleID: id, path: path, frontmost: app.isActive)
        }.sorted { $0.name.lowercased() < $1.name.lowercased() }
    }
}
