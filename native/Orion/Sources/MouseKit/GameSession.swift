import Foundation

/// A game session (w18 gamemode): starts when a game becomes frontmost, ends when the game's process is gone. Tabbing out changes nothing.
/// Pure: the Mac app feeds it the frontmost app and the set of pids still running, and acts on the effect it returns.

public struct GameRef: Codable, Equatable {
    /// What to call it ("Minecraft" for a Java window titled Minecraft).
    public var name: String
    public var bundleId: String?
    /// What orion-apps matches the running game by: the bundle id, or the process name when there is none.
    public var key: String
    public var pid: Int32
    public init(name: String, bundleId: String?, key: String, pid: Int32) {
        self.name = name; self.bundleId = bundleId; self.key = key; self.pid = pid
    }
}

public struct GameSession: Equatable {
    public var active: Bool
    public var game: GameRef?
    /// Every process taken for the game (a launcher, then the game it started). The session lasts until all are gone.
    public var pids: [Int32]
    public var startedAt: String?
    public var endedAt: String?
    public static let idle = GameSession(active: false, game: nil, pids: [], startedAt: nil, endedAt: nil)
}

public enum GameSessionEvent: Equatable {
    case frontmost(GameRef, isGame: Bool, now: String)
    case alive(Set<Int32>, now: String)
}

public enum GameSessionEffect: Equatable {
    case started(GameRef)
    case ended(GameRef)
}

public enum GameSessionMachine {
    public static func reduce(_ s: GameSession, _ event: GameSessionEvent) -> (GameSession, GameSessionEffect?) {
        switch event {
        case let .frontmost(app, isGame, now):
            guard isGame else { return (s, nil) }   // tabbed out, or never a game
            if !s.active { return (GameSession(active: true, game: app, pids: [app.pid], startedAt: now, endedAt: nil), .started(app)) }
            guard !s.pids.contains(app.pid) else { return (s, nil) }
            var next = s; next.pids.append(app.pid)
            return (next, nil)
        case let .alive(running, now):
            guard s.active, let game = s.game else { return (s, nil) }
            let left = s.pids.filter { running.contains($0) }
            if left.isEmpty { return (GameSession(active: false, game: game, pids: [], startedAt: s.startedAt, endedAt: now), .ended(game)) }
            var next = s; next.pids = left
            return (next, nil)
        }
    }
}
