import Foundation

/// How the orion-control plugin routes voice turns, read from openclaw.json.
///
/// 2026-10-16 (speed audit): the app used to ignore this, so it prepended the
/// whole of SCHEDULING.md to turns the plugin was already serving from its own
/// tuned scheduling instructions on the local 9B.
struct LocalRoutingMode: Equatable {
    /// "on", "shadow" or "off"; anything unreadable is "off" so the old,
    /// fuller behaviour is what happens when this cannot be known.
    let mode: String
    let scheduleToCloud: Bool

    static let off = LocalRoutingMode(mode: "off", scheduleToCloud: false)

    /// The worker that answers a scheduling turn is local only when routing is on
    /// and scheduling has not been sent to the cloud.
    var servesSchedulingLocally: Bool { mode == "on" && !scheduleToCloud }

    static var configPath: String {
        NSString(string: "~/.openclaw/openclaw.json").expandingTildeInPath
    }

    static func current(path: String = configPath) -> LocalRoutingMode {
        guard let data = FileManager.default.contents(atPath: path) else { return .off }
        return parse(data)
    }

    static func parse(_ data: Data) -> LocalRoutingMode {
        guard let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let plugins = root["plugins"] as? [String: Any],
              let entries = plugins["entries"] as? [String: Any],
              let plugin = entries["orion-control"] as? [String: Any],
              let config = plugin["config"] as? [String: Any]
        else { return .off }
        return LocalRoutingMode(mode: (config["localRouting"] as? String) ?? "off",
                                scheduleToCloud: (config["localRoutingScheduleToCloud"] as? Bool) ?? false)
    }
}
