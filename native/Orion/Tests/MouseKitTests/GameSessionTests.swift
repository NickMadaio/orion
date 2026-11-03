import XCTest
@testable import MouseKit

/// w18 gamemode: the session state machine, the bindings override while it runs, the file it persists and the words it says.
final class GameSessionTests: XCTestCase {
    private let mc = GameRef(name: "Minecraft", bundleId: nil, key: "java", pid: 100)
    private let launcher = GameRef(name: "Minecraft Launcher", bundleId: "com.mojang.minecraftlauncher", key: "com.mojang.minecraftlauncher", pid: 90)

    private func bindings() -> BindingsFile {
        var b = BindingsFile()
            .settingDefault(3, .system("stageManager"))
            .settingApp("com.apple.Safari", button: 3, .system("missionControl"))
        b.passthroughApps = []
        return b
    }

    // MARK: state machine

    func testGameBecomingFrontmostStartsASession() {
        let (s, effect) = GameSessionMachine.reduce(.idle, .frontmost(mc, isGame: true, now: "t1"))
        XCTAssertTrue(s.active); XCTAssertEqual(s.game, mc); XCTAssertEqual(s.pids, [100]); XCTAssertEqual(s.startedAt, "t1")
        XCTAssertEqual(effect, .started(mc))
    }

    func testANonGameFrontmostStartsNothing() {
        let (s, effect) = GameSessionMachine.reduce(.idle, .frontmost(GameRef(name: "Safari", bundleId: "com.apple.Safari", key: "com.apple.Safari", pid: 5), isGame: false, now: "t1"))
        XCTAssertEqual(s, .idle); XCTAssertNil(effect)
    }

    func testTabbingOutDoesNotEndIt() {
        let (started, _) = GameSessionMachine.reduce(.idle, .frontmost(mc, isGame: true, now: "t1"))
        let safari = GameRef(name: "Safari", bundleId: "com.apple.Safari", key: "com.apple.Safari", pid: 5)
        let (tabbed, e1) = GameSessionMachine.reduce(started, .frontmost(safari, isGame: false, now: "t2"))
        XCTAssertEqual(tabbed, started); XCTAssertNil(e1)
        let (still, e2) = GameSessionMachine.reduce(tabbed, .alive([100, 5], now: "t3"))
        XCTAssertTrue(still.active); XCTAssertNil(e2)
    }

    func testTheSessionEndsWhenTheGameProcessQuits() {
        let (started, _) = GameSessionMachine.reduce(.idle, .frontmost(mc, isGame: true, now: "t1"))
        let (ended, effect) = GameSessionMachine.reduce(started, .alive([5, 6], now: "t9"))
        XCTAssertFalse(ended.active); XCTAssertEqual(ended.endedAt, "t9"); XCTAssertEqual(ended.game, mc)
        XCTAssertEqual(effect, .ended(mc))
        // and a second tick after the end does nothing
        let (again, e2) = GameSessionMachine.reduce(ended, .alive([], now: "t10"))
        XCTAssertEqual(again, ended); XCTAssertNil(e2)
    }

    func testALauncherThenItsGameIsOneSessionThatOutlivesTheLauncher() {
        let (a, _) = GameSessionMachine.reduce(.idle, .frontmost(launcher, isGame: true, now: "t1"))
        let (b, e) = GameSessionMachine.reduce(a, .frontmost(mc, isGame: true, now: "t2"))
        XCTAssertNil(e); XCTAssertEqual(b.game, launcher); XCTAssertEqual(Set(b.pids), [90, 100]); XCTAssertEqual(b.startedAt, "t1")
        let (c, e2) = GameSessionMachine.reduce(b, .alive([100], now: "t3"))   // launcher closed itself, the game runs on
        XCTAssertTrue(c.active); XCTAssertNil(e2)
        let (d, e3) = GameSessionMachine.reduce(c, .alive([], now: "t4"))
        XCTAssertFalse(d.active); XCTAssertEqual(e3, .ended(launcher))
    }

    func testAnotherSessionCanStartAfterOneEnds() {
        let (a, _) = GameSessionMachine.reduce(.idle, .frontmost(mc, isGame: true, now: "t1"))
        let (b, _) = GameSessionMachine.reduce(a, .alive([], now: "t2"))
        let (c, effect) = GameSessionMachine.reduce(b, .frontmost(launcher, isGame: true, now: "t3"))
        XCTAssertTrue(c.active); XCTAssertEqual(effect, .started(launcher)); XCTAssertNil(c.endedAt)
    }

    // MARK: the override

    func testASessionPassesEveryBindingThroughInEveryApp() {
        for id in ["com.apple.finder", "com.apple.Safari", "x.game", nil] as [String?] {
            XCTAssertNil(MouseResolver.resolve(button: 3, bundleId: id, isGame: false, bindings: bindings(), gameSession: true), String(describing: id))
        }
    }

    func testTheSessionWinsEvenWhenAutoGamePassthroughIsOffAndAnAppOverrideExists() {
        var b = bindings(); b.autoPassthroughGames = false
        XCTAssertNil(MouseResolver.resolve(button: 3, bundleId: "com.apple.Safari", isGame: false, bindings: b, gameSession: true))
        XCTAssertEqual(MouseResolver.resolve(button: 3, bundleId: "com.apple.Safari", isGame: false, bindings: b, gameSession: false), .system("missionControl"))
    }

    func testWithoutASessionNothingChanges() {
        XCTAssertEqual(MouseResolver.resolve(button: 3, bundleId: "com.apple.finder", isGame: false, bindings: bindings()), .system("stageManager"))
    }

    // MARK: file

    private func tmp() -> URL { FileManager.default.temporaryDirectory.appendingPathComponent("gs-\(UUID().uuidString)") }

    func testPersistingKeepsWhatTheNodeSideWroteAndAStartDropsOldPrep() throws {
        let dir = tmp(); let store = GameSessionStore(controlledDir: dir)
        let (started, _) = GameSessionMachine.reduce(.idle, .frontmost(mc, isGame: true, now: "2026-11-03T20:00:00Z"))
        try store.save(started)
        let raw = try JSONSerialization.jsonObject(with: Data(contentsOf: store.url)) as! [String: Any]
        XCTAssertEqual(raw["active"] as? Bool, true)
        XCTAssertEqual((raw["game"] as? [String: Any])?["key"] as? String, "java")
        XCTAssertEqual((raw["paused"] as? [String: Any])?["mouse"] as? Bool, true)
        // orion-apps writes its prep record into the same file
        var withPrep = raw
        withPrep["prep"] = ["headline": "closed Chrome and Epic Games Launcher, freed ~6 GB", "closed": [
            ["name": "Chrome", "path": "/Applications/Google Chrome.app", "kind": "regular"], ["name": "Epic Games Launcher", "path": "/Applications/Epic.app", "kind": "accessory"]]]
        try JSONSerialization.data(withJSONObject: withPrep).write(to: store.url)
        let (ended, _) = GameSessionMachine.reduce(started, .alive([], now: "t2"))
        try store.save(ended)
        XCTAssertEqual(store.prep()?.headline, "closed Chrome and Epic Games Launcher, freed ~6 GB")
        XCTAssertEqual(store.prep()?.closed.map(\.name), ["Chrome", "Epic Games Launcher"])
        XCTAssertEqual((try JSONSerialization.jsonObject(with: Data(contentsOf: store.url)) as! [String: Any])["active"] as? Bool, false)
        let (next, _) = GameSessionMachine.reduce(ended, .frontmost(launcher, isGame: true, now: "t3"))
        try store.save(next)
        XCTAssertNil(store.prep())   // a new session starts with a clean record
    }

    func testAutoPrepDefaultsOnAndTheSwitchKeepsTheKeepList() throws {
        let dir = tmp(); let config = GamePrepConfigStore(controlledDir: dir)
        XCTAssertTrue(config.autoPrep())
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        try JSONSerialization.data(withJSONObject: ["version": 1, "autoPrep": true, "keep": ["Discord"]]).write(to: config.url)
        try config.setAutoPrep(false)
        XCTAssertFalse(config.autoPrep())
        let raw = try JSONSerialization.jsonObject(with: Data(contentsOf: config.url)) as! [String: Any]
        XCTAssertEqual(raw["keep"] as? [String], ["Discord"])
    }

    // MARK: words

    func testStartMessage() {
        XCTAssertEqual(GameWords.started(headline: "closed Chrome, Epic Games and 4 helpers, freed ~6 GB"),
                       "Game mode: closed Chrome, Epic Games and 4 helpers, freed ~6 GB. Mouse shortcuts paused.")
        XCTAssertEqual(GameWords.started(headline: nil), "Game mode on. Mouse shortcuts paused.")
        XCTAssertEqual(GameWords.started(headline: "nothing needed closing"), "Game mode: nothing needed closing. Mouse shortcuts paused.")
    }

    func testReopenQuestionNamesOnlyRealAppsNotLaunchersInTheBackground() {
        let closed = [ClosedApp(name: "Chrome", bundleId: "c", path: "/A/Chrome.app", kind: "regular"), ClosedApp(name: "Slack", bundleId: "s", path: "/A/Slack.app", kind: "regular"),
                      ClosedApp(name: "Epic Games Launcher", bundleId: "e", path: "/A/Epic.app", kind: "accessory")]
        XCTAssertEqual(GameWords.reopenable(closed).map(\.name), ["Chrome", "Slack"])
        XCTAssertEqual(GameWords.gameOver(closed), "Game over — want me to reopen Chrome and Slack?")
        XCTAssertNil(GameWords.gameOver([closed[2]]))
        XCTAssertNil(GameWords.gameOver([]))
        let many = (1...5).map { ClosedApp(name: "App\($0)", bundleId: nil, path: "/A/\($0).app", kind: "regular") }
        XCTAssertEqual(GameWords.gameOver(many), "Game over — want me to reopen App1, App2, App3 and 2 more?")
    }
}
