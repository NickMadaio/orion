import Foundation

/// activity.json, version 1. Every contract key is always present; unknown values are an explicit null, never omitted.
public struct ActivitySnapshot: Equatable {
    public struct App: Equatable {
        public var name: String; public var bundleId: String?; public var pid: Int32
        public init(name: String, bundleId: String?, pid: Int32) { self.name = name; self.bundleId = bundleId; self.pid = pid }
    }
    public struct Game: Equatable {
        public var name: String; public var since: String
        public init(name: String, since: String) { self.name = name; self.since = since }
    }
    public struct Focus: Equatable {
        public var active: Bool; public var task: String?; public var allowedApps: [String]; public var allowedDomains: [String]
        public init(active: Bool, task: String?, allowedApps: [String], allowedDomains: [String]) {
            self.active = active; self.task = task; self.allowedApps = allowedApps; self.allowedDomains = allowedDomains
        }
    }

    public var at: String
    public var idleSeconds: Int?
    public var app: App
    public var category: ActivityCategory
    public var window: String?
    public var url: String?
    public var domain: String?
    public var siteCategory: SiteCategory?
    public var game: Game?
    public var focus: Focus?

    public init(at: String, idleSeconds: Int?, app: App, category: ActivityCategory, window: String?, url: String?,
                domain: String?, siteCategory: SiteCategory?, game: Game?, focus: Focus?) {
        self.at = at; self.idleSeconds = idleSeconds; self.app = app; self.category = category; self.window = window
        self.url = url; self.domain = domain; self.siteCategory = siteCategory; self.game = game; self.focus = focus
    }

    public func jsonObject() -> [String: Any] {
        func orNull(_ v: Any?) -> Any { v ?? NSNull() }
        return [
            "version": 1, "at": at, "idleSeconds": orNull(idleSeconds),
            "app": ["name": app.name, "bundleId": orNull(app.bundleId), "pid": Int(app.pid)] as [String: Any],
            "category": category.rawValue, "window": orNull(window), "url": orNull(url), "domain": orNull(domain),
            "siteCategory": orNull(siteCategory?.rawValue),
            "game": game.map { ["name": $0.name, "since": $0.since] as [String: Any] } ?? NSNull(),
            "focus": focus.map { ["active": $0.active, "task": orNull($0.task), "allowedApps": $0.allowedApps,
                                  "allowedDomains": $0.allowedDomains] as [String: Any] } ?? NSNull(),
        ]
    }

    public func encoded() throws -> Data {
        try JSONSerialization.data(withJSONObject: jsonObject(), options: [.prettyPrinted, .sortedKeys])
    }

    /// What counts as a change worth an immediate rewrite: everything but the clock and the idle counter.
    public var signature: String {
        [app.bundleId ?? app.name, String(app.pid), category.rawValue, window ?? "", url ?? "", game?.since ?? "", focus.map { "\($0.active)|\($0.task ?? "")" } ?? ""]
            .joined(separator: "\u{1f}")
    }
}

/// Rewrite when something changed, and otherwise at least every 15 s so a reader can tell the writer is alive.
public enum WriteGate {
    public static let heartbeat: TimeInterval = 15
    public static func shouldWrite(lastSignature: String?, lastAt: Date?, signature: String, now: Date) -> Bool {
        guard let lastSignature, let lastAt else { return true }
        return lastSignature != signature || now.timeIntervalSince(lastAt) >= heartbeat
    }
}
