import Foundation

/// What orion-apps game-prep recorded for the session: read back to say what was closed and to reopen the apps afterwards.
public struct ClosedApp: Codable, Equatable {
    public var name: String
    public var bundleId: String?
    public var path: String?
    public var kind: String?
    public init(name: String, bundleId: String?, path: String?, kind: String?) { self.name = name; self.bundleId = bundleId; self.path = path; self.kind = kind }
}

public struct PrepRecord: Decodable, Equatable {
    public var headline: String?
    public var closed: [ClosedApp]
    private enum Keys: String, CodingKey { case headline, closed }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Keys.self)
        headline = try? c.decode(String.self, forKey: .headline)
        closed = (try? c.decode([ClosedApp].self, forKey: .closed)) ?? []
    }
}

/// Reads a JSON object file and writes one back (tmp + rename), keeping keys it does not own.
enum JSONObjectFile {
    static func read(_ url: URL) -> [String: Any] {
        ((try? Data(contentsOf: url)).flatMap { try? JSONSerialization.jsonObject(with: $0) }) as? [String: Any] ?? [:]
    }
    static func write(_ object: [String: Any], to url: URL) throws {
        let dir = url.deletingLastPathComponent()
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let tmp = dir.appendingPathComponent(".\(url.lastPathComponent).\(UUID().uuidString).tmp")
        try JSONSerialization.data(withJSONObject: object, options: [.prettyPrinted, .sortedKeys]).write(to: tmp)
        if FileManager.default.fileExists(atPath: url.path) { _ = try FileManager.default.replaceItemAt(url, withItemAt: tmp) }
        else { try FileManager.default.moveItem(at: tmp, to: url) }
    }
}

/// ~/.openclaw/orion-controlled/game-session.json. The Mac app owns the session keys, orion-apps owns "prep"; each re-reads before writing
/// and unknown keys are kept, so neither drops the other's. A new session starts with a clean prep record.
public struct GameSessionStore {
    public let url: URL
    public init(controlledDir: URL) { url = controlledDir.appendingPathComponent("game-session.json") }

    public func save(_ s: GameSession) throws {
        var file = JSONObjectFile.read(url)
        if (file["startedAt"] as? String) != s.startedAt { file["prep"] = nil }
        file["version"] = 1
        file["active"] = s.active
        file["pids"] = s.pids.map { Int($0) }
        file["startedAt"] = s.startedAt
        file["endedAt"] = s.endedAt
        file["paused"] = ["mouse": s.active]
        if let g = s.game {
            var game: [String: Any] = ["name": g.name, "key": g.key, "pid": Int(g.pid)]
            if let b = g.bundleId { game["bundleId"] = b }
            file["game"] = game
        }
        try JSONObjectFile.write(file, to: url)
    }

    public func prep() -> PrepRecord? {
        guard let p = JSONObjectFile.read(url)["prep"], let data = try? JSONSerialization.data(withJSONObject: p) else { return nil }
        return try? JSONDecoder().decode(PrepRecord.self, from: data)
    }
}

/// ~/.openclaw/orion-controlled/game-prep.json: { autoPrep, keep }. The keep list is orion-apps' and the chat's; the Mac app only flips autoPrep.
public struct GamePrepConfigStore {
    public let url: URL
    public init(controlledDir: URL) { url = controlledDir.appendingPathComponent("game-prep.json") }

    /// On unless switched off.
    public func autoPrep() -> Bool { (JSONObjectFile.read(url)["autoPrep"] as? Bool) ?? true }

    public func setAutoPrep(_ on: Bool) throws {
        var file = JSONObjectFile.read(url)
        file["version"] = 1
        file["autoPrep"] = on
        try JSONObjectFile.write(file, to: url)
    }
}

/// ORION's two lines about a game session.
public enum GameWords {
    public static func started(headline: String?) -> String {
        guard let headline, !headline.isEmpty else { return "Game mode on. Mouse shortcuts paused." }
        return "Game mode: \(headline). Mouse shortcuts paused."
    }

    /// Only apps with a Dock icon come back, never the background launchers and helpers that were closed with them.
    public static func reopenable(_ closed: [ClosedApp]) -> [ClosedApp] {
        closed.filter { $0.kind != "accessory" && ($0.path?.isEmpty == false) }
    }

    public static func gameOver(_ closed: [ClosedApp]) -> String? {
        let names = reopenable(closed).map(\.name)
        guard !names.isEmpty else { return nil }
        let list: String
        switch names.count {
        case 1: list = names[0]
        case 2: list = "\(names[0]) and \(names[1])"
        case 3: list = "\(names[0]), \(names[1]) and \(names[2])"
        default: list = "\(names[0]), \(names[1]), \(names[2]) and \(names.count - 3) more"
        }
        return "Game over — want me to reopen \(list)?"
    }
}
