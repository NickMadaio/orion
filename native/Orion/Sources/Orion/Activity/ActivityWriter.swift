import AppKit
import ActivityKit
import Foundation
import MouseKit

/// Writes activity.json and activity-history.jsonl (ACTIVITY CONTRACT, .builds/w19/COMMON.md): what he is doing right now.
///
/// Cheap by construction: the frontmost app comes from NSWorkspace's activation notification (no polling for it); a heartbeat
/// rewrites the file every 15 s so a reader can tell it is alive, and only while a browser is in front does it poll (5 s, the
/// URL needs AppleScript). The history gets a line only when the app, category or domain changes, domains only, 7 days.
final class ActivityWriter {
    private let dir: URL
    private let probe = BrowserProbe()
    private let gameStore: GameSessionStore
    private var observer: NSObjectProtocol?
    private var timer: Timer?
    private var page: (pid: pid_t, value: BrowserProbe.Page?)?
    private var gameSeen: (key: String, since: String)?
    private var lastSignature: String?
    private var lastWriteAt: Date?
    private var lastHistoryKey: String?
    private var lastPrune: Date?
    private var probing = false

    private let iso = ISO8601DateFormatter()
    private var snapshotURL: URL { dir.appendingPathComponent("activity.json") }
    private var historyURL: URL { dir.appendingPathComponent("activity-history.jsonl") }

    init(controlledDir: URL = MouseStore.defaultControlledDir()) {
        dir = controlledDir
        gameStore = GameSessionStore(controlledDir: controlledDir)
    }

    /// A test host constructs AppState too; it must never write the live file.
    private static var underTest: Bool {
        NSClassFromString("XCTestCase") != nil || ProcessInfo.processInfo.environment["XCTestConfigurationFilePath"] != nil
    }

    func start() {
        guard observer == nil, !Self.underTest else { return }
        observer = NSWorkspace.shared.notificationCenter.addObserver(
            forName: NSWorkspace.didActivateApplicationNotification, object: nil, queue: .main) { [weak self] _ in self?.refresh() }
        refresh()
    }

    func stop() {
        if let observer { NSWorkspace.shared.notificationCenter.removeObserver(observer) }
        observer = nil; timer?.invalidate(); timer = nil
    }

    // MARK: Refresh

    private func refresh() {
        let app = NSWorkspace.shared.frontmostApplication
        let browser = BrowserProbe.supports(app?.bundleIdentifier)
        schedule(after: browser ? 5 : WriteGate.heartbeat)
        guard let app else { return }
        if browser, !probing, let id = app.bundleIdentifier {
            probing = true
            let pid = app.processIdentifier
            probe.probe(bundleId: id) { [weak self] result in
                guard let self else { return }
                self.probing = false
                self.page = (pid, result)
                self.write(app: NSWorkspace.shared.frontmostApplication)
            }
        }
        write(app: app)
    }

    private func schedule(after seconds: TimeInterval) {
        timer?.invalidate()
        let t = Timer(timeInterval: seconds, repeats: false) { [weak self] _ in self?.refresh() }
        t.tolerance = seconds / 4
        RunLoop.main.add(t, forMode: .common)
        timer = t
    }

    // MARK: Snapshot

    private func write(app: NSRunningApplication?) {
        guard let app else { return }
        let now = Date()
        let snapshot = snapshot(for: app, now: now)
        let signature = snapshot.signature
        // A browser whose page is not known yet would write a domain-less line and then a second one: wait for the probe.
        if !(snapshot.category == .browser && page?.pid != app.processIdentifier) { appendHistory(snapshot, now: now) }
        guard WriteGate.shouldWrite(lastSignature: lastSignature, lastAt: lastWriteAt, signature: signature, now: now) else { return }
        do {
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            try snapshot.encoded().write(to: snapshotURL, options: .atomic)
            lastSignature = signature; lastWriteAt = now
        } catch {
            OrionLog.write("[activity] could not write activity.json: \(error.localizedDescription)", key: "activity-write")
        }
    }

    private func snapshot(for app: NSRunningApplication, now: Date) -> ActivitySnapshot {
        let facts = MouseController.facts(for: app)
        let category = AppClassifier.category(facts: facts)
        let isBrowser = category == .browser
        let pageNow = isBrowser && page?.pid == app.processIdentifier ? page?.value : nil
        let domain = pageNow.flatMap { SiteClassifier.domain(fromURL: $0.url) }
        let name = app.localizedName ?? app.bundleIdentifier ?? "Unknown"
        let window = pageNow?.title ?? (category == .game || !isBrowser ? MouseController.windowTitle(pid: app.processIdentifier) : nil)
        return ActivitySnapshot(
            at: iso.string(from: now), idleSeconds: IdleReading.current(now: now).map { Int($0) },
            app: .init(name: name, bundleId: app.bundleIdentifier, pid: app.processIdentifier), category: category,
            window: window, url: pageNow?.url, domain: domain, siteCategory: SiteClassifier.category(domain: domain),
            game: game(facts: facts, app: app, now: now), focus: focus())
    }

    /// The game in front, with when it began: the game session's own start when it is that game, else when it was first seen here.
    private func game(facts: GameClassifier.Facts, app: NSRunningApplication, now: Date) -> ActivitySnapshot.Game? {
        guard let name = AppClassifier.gameName(facts: facts) else { gameSeen = nil; return nil }
        let key = app.bundleIdentifier ?? name
        if let seen = gameSeen, seen.key == key { return .init(name: name, since: seen.since) }
        let stored = gameStore.load().flatMap { $0.active ? $0.startedAt : nil }
        let since = stored ?? iso.string(from: now)
        gameSeen = (key, since)
        return .init(name: name, since: since)
    }

    private func focus() -> ActivitySnapshot.Focus? {
        (try? Data(contentsOf: dir.appendingPathComponent("focus-state.json"))).flatMap(FocusReader.focus(fromStateJSON:))
    }

    // MARK: History (domains only, 7 days)

    private func appendHistory(_ s: ActivitySnapshot, now: Date) {
        let line = HistoryLine(snapshot: s)
        guard HistoryLine.isChange(previous: lastHistoryKey, bundleId: line.bundleId, category: line.category, domain: line.domain),
              let data = try? line.encoded() else { return }
        lastHistoryKey = HistoryLine.key(bundleId: line.bundleId, category: line.category, domain: line.domain)
        do {
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            if let handle = try? FileHandle(forWritingTo: historyURL) {
                defer { try? handle.close() }
                _ = try? handle.seekToEnd()
                try handle.write(contentsOf: data + Data("\n".utf8))
            } else {
                try (data + Data("\n".utf8)).write(to: historyURL, options: .atomic)
            }
        } catch {
            OrionLog.write("[activity] could not append history: \(error.localizedDescription)", key: "activity-history")
        }
        pruneIfDue(now: now)
    }

    private func pruneIfDue(now: Date) {
        if let lastPrune, now.timeIntervalSince(lastPrune) < 3600 { return }
        lastPrune = now
        guard let text = try? String(contentsOf: historyURL, encoding: .utf8) else { return }
        let kept = HistoryLine.prune(text, now: now)
        if kept != text { try? kept.write(to: historyURL, atomically: true, encoding: .utf8) }
    }
}
