import AppKit
import SwiftUI

/// How he proves he is awake. The button is today's implementation; a camera push-up counter
/// can replace it later without touching the engine or the surface.
protocol AlarmDismissal: AnyObject {
    /// Shown on the dismiss control.
    var prompt: String { get }
    /// Begin whatever check there is; call `onCleared` once he has passed it.
    func begin(onCleared: @escaping () -> Void)
    /// He pressed the dismiss control. A button clears at once; a push-up check would start counting.
    func userAskedToDismiss()
    func cancel()
}

final class ButtonDismissal: AlarmDismissal {
    let prompt = "I'm up"
    private var onCleared: (() -> Void)?
    func begin(onCleared: @escaping () -> Void) { self.onCleared = onCleared }
    func userAskedToDismiss() { let done = onCleared; onCleared = nil; done?() }
    func cancel() { onCleared = nil }
}

/// The controlled-directory files the alarm reads and writes.
struct WakeAlarmFiles {
    let directory: URL
    var plan: URL { directory.appendingPathComponent("wake-plan.json") }
    var override: URL { directory.appendingPathComponent("wake-request.json") }
    var log: URL { directory.appendingPathComponent("alarm-log.jsonl") }
    var evalMarker: URL { directory.appendingPathComponent("eval-mode") }

    static var live: WakeAlarmFiles {
        WakeAlarmFiles(directory: FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".openclaw/orion-controlled"))
    }

    /// Same rule as scripts/lib/eval-mode.mjs: the marker, under two hours old.
    func isSandbox(now: Date = Date()) -> Bool {
        guard let modified = (try? FileManager.default.attributesOfItem(atPath: evalMarker.path))?[.modificationDate] as? Date else { return false }
        return now.timeIntervalSince(modified) < 2 * 3600
    }

    static func logLine(_ event: WakeAlarmEvent, at: Date) -> String {
        var row: [String: Any] = ["at": ISO8601DateFormatter().string(from: at), "event": event.name,
                                  "key": event.entry.key, "date": event.entry.date, "reason": event.entry.reason]
        if case .dismissed(_, let snoozes) = event { row["snoozes"] = snoozes }
        if case .snoozed(_, let until, let count) = event { row["until"] = ISO8601DateFormatter().string(from: until); row["snoozes"] = count }
        let data = (try? JSONSerialization.data(withJSONObject: row, options: [.sortedKeys])) ?? Data()
        return String(data: data, encoding: .utf8) ?? "{}"
    }

    /// Alarms already dismissed or given up, so a relaunch does not ring them again.
    func handledKeys() -> Set<String> {
        guard let text = try? String(contentsOf: log, encoding: .utf8) else { return [] }
        var keys = Set<String>()
        for line in text.split(separator: "\n") {
            guard let row = (try? JSONSerialization.jsonObject(with: Data(line.utf8))) as? [String: Any],
                  let event = row["event"] as? String, event == "dismissed" || event == "gave_up",
                  let key = row["key"] as? String else { continue }
            keys.insert(key)
        }
        return keys
    }

    func append(_ line: String) {
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        guard let data = (line + "\n").data(using: .utf8) else { return }
        if let handle = try? FileHandle(forWritingTo: log) {
            defer { try? handle.close() }
            _ = try? handle.seekToEnd()
            try? handle.write(contentsOf: data)
        } else {
            try? data.write(to: log)
        }
    }
}

/// Owns the timer, the sound and the full-window surface around a WakeAlarmEngine. Started from AppState.
/// A plain Timer on this long-lived object (not Timer.publish on a view, which never fires; see RefreshTicker).
@MainActor
final class WakeAlarmController {
    private let files: WakeAlarmFiles
    private let engine: WakeAlarmEngine
    private let dismissal: AlarmDismissal
    private var timer: Timer?
    private var panel: NSPanel?

    init(files: WakeAlarmFiles = .live, dismissal: AlarmDismissal = ButtonDismissal()) {
        self.files = files
        self.dismissal = dismissal
        self.engine = WakeAlarmEngine(isSandbox: { files.isSandbox() }, handled: files.handledKeys())
    }

    func start() {
        guard timer == nil else { return }
        reload()
        let timer = Timer(timeInterval: 10, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.tick() }
        }
        RunLoop.main.add(timer, forMode: .common)
        self.timer = timer
    }

    private func reload() {
        engine.load(WakeAlarmPlan.entries(plan: try? Data(contentsOf: files.plan), override: try? Data(contentsOf: files.override)))
    }

    private func tick() {
        // The plan files change under us (the scheduler, orion-wake); two small reads every 10 s is cheap.
        if !engine.isActive { reload() }
        handle(engine.tick())
    }

    private func handle(_ events: [WakeAlarmEvent]) {
        for event in events {
            files.append(WakeAlarmFiles.logLine(event, at: Date()))
            OrionLog.write("[alarm] \(event.name) — \(event.entry.date) (\(event.entry.reason))")
            switch event {
            case .fired:
                dismissal.begin { [weak self] in self?.dismiss() }
                showSurface(); ring()
            case .ring:
                showSurface(); ring()
            case .snoozed, .dismissed, .gaveUp:
                hideSurface()
            }
        }
    }

    private func dismiss() { handle(engine.dismiss().map { [$0] } ?? []) }

    private func snooze() { handle(engine.snooze().map { [$0] } ?? []) }

    private func ring() {
        ReachVolume.raiseToFull(restoreAfter: 120)
        (NSSound(named: "Sosumi") ?? NSSound(named: "Funk"))?.play()
    }

    private func showSurface() {
        let view = WakeAlarmView(prompt: dismissal.prompt, canSnooze: engine.canSnooze,
                                 onSnooze: { [weak self] in self?.snooze() },
                                 onDismiss: { [weak self] in self?.dismissal.userAskedToDismiss() })
        if let panel { (panel.contentView as? NSHostingView<WakeAlarmView>)?.rootView = view; panel.orderFrontRegardless(); return }
        let frame = NSScreen.main?.frame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        let panel = NSPanel(contentRect: frame, styleMask: [.borderless], backing: .buffered, defer: false)
        panel.level = .screenSaver
        panel.hidesOnDeactivate = false
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
        panel.contentView = NSHostingView(rootView: view)
        panel.setFrame(frame, display: true)
        panel.orderFrontRegardless()
        self.panel = panel
    }

    private func hideSurface() {
        panel?.orderOut(nil)
        panel = nil
    }
}

struct WakeAlarmView: View {
    let prompt: String
    let canSnooze: Bool
    let onSnooze: () -> Void
    let onDismiss: () -> Void

    var body: some View {
        ZStack {
            Color(red: 0.005, green: 0.012, blue: 0.022)
            VStack(spacing: 28) {
                Text(Date(), style: .time).font(.system(size: 88, weight: .thin, design: .rounded)).foregroundStyle(.white)
                Text("Time to get up.").font(.title2).foregroundStyle(.white.opacity(0.8))
                HStack(spacing: 20) {
                    if canSnooze { Button("Snooze 9 min", action: onSnooze).controlSize(.large) }
                    Button(prompt, action: onDismiss).controlSize(.large).buttonStyle(.borderedProminent)
                }
            }
        }
    }
}
