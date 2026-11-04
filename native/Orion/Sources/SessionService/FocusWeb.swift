//
//  What a work session allows, as the Mac shows it (2026-11-04).
//
//  `focus-web.json` (written by scripts/orion-focus-sites) carries the session's task, the apps and websites it allows, any
//  one-time site override and the end of the current phase. This reads it for the focus screen, and says whether the website guard
//  has anything to do. Pure: bytes in, value out. The app never writes the file; the scripts do.
//
//  `FocusEarlyPrompt` is the question the Finish early button asks after it ends a session. It is the same one the chat asks
//  (plugin focus-ready.ts), kept in focus-ready-pending.json so either side can hear the answer.
//

import Foundation

public struct FocusWebState: Equatable, Sendable {
    public let task: String
    public let appNames: [String]
    public let domains: [String]
    public let overrides: [String]
    public let phase: String?
    public let phaseEnd: Date?

    public init(task: String, appNames: [String], domains: [String], overrides: [String], phase: String?, phaseEnd: Date?) {
        self.task = task; self.appNames = appNames; self.domains = domains
        self.overrides = overrides; self.phase = phase; self.phaseEnd = phaseEnd
    }

    /// The state of an active session, or nil for no file, a cleared one, or one that cannot be read.
    public static func parse(_ data: Data?) -> FocusWebState? {
        guard let data,
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              object["active"] as? Bool == true,
              let task = object["task"] as? String, !task.isEmpty else { return nil }
        let strings = { (key: String) in (object[key] as? [String]) ?? [] }
        let end = (object["phaseEnd"] as? String).flatMap { ISO8601DateFormatter.withFraction.date(from: $0) ?? ISO8601DateFormatter().date(from: $0) }
        return FocusWebState(task: task, appNames: strings("allowedAppNames"), domains: strings("allowedDomains"),
                             overrides: strings("overrides"), phase: object["phase"] as? String, phaseEnd: end)
    }

    /// "SAFARI · PAGES · 9 SITES": what the focus screen prints under the task.
    public var summary: String {
        var parts = appNames.map { $0.uppercased() }
        let sites = Set(domains).union(overrides).count
        if sites > 0 { parts.append("\(sites) SITE\(sites == 1 ? "" : "S")") }
        return parts.joined(separator: " · ")
    }

    public static var defaultURL: URL {
        let env = ProcessInfo.processInfo.environment["ORION_CONTROLLED_DIR"]
        let base = env.flatMap { $0.isEmpty ? nil : URL(fileURLWithPath: ($0 as NSString).expandingTildeInPath) }
            ?? FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".openclaw/orion-controlled")
        return base.appendingPathComponent("focus-web.json")
    }

    public static func load(from url: URL = defaultURL) -> FocusWebState? {
        parse(try? Data(contentsOf: url))
    }
}

private extension ISO8601DateFormatter {
    static let withFraction: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]; return f
    }()
}

public enum FocusEarlyPrompt {
    /// The line the chat shows when the button ends a session.
    public static func line(task: String?) -> String {
        "Nice. Start your break now, or move to your next task?"
    }

    /// focus-ready-pending.json: the question just asked. `askNext`: the plugin finds the next task from the plan when he answers.
    public static func pendingJSON(task: String?, now: Date = Date()) -> Data {
        var object: [String: Any] = ["kind": "early", "askNext": true, "marked": false, "at": Int((now.timeIntervalSince1970 * 1000).rounded())]
        if let task, !task.isEmpty, task != "Focus" { object["task"] = task }
        return (try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])) ?? Data("{}".utf8)
    }

    public static func write(task: String?, to url: URL, now: Date = Date()) {
        try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? pendingJSON(task: task, now: now).write(to: url, options: .atomic)
    }

    public static var defaultURL: URL {
        FocusWebState.defaultURL.deletingLastPathComponent().appendingPathComponent("focus-ready-pending.json")
    }
}
