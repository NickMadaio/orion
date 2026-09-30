import SwiftUI
import AppKit
import Combine

/*
 Why the Projects view never updated (2026-09-26).

 Its timers were `Timer.publish(...).autoconnect()` stored on the View structs.
 The dashboard re-renders every second (SessionTabModel's media timer), and each
 render re-creates those structs -- and with them a brand-new timer. The
 3-second and 2-second timers were restarted every second and never fired, so
 the list and the run view only changed when a tab or project was re-selected.
 (The approvals panel hit a sibling of this on 2026-09-26.)

 The fix is timers owned by objects SwiftUI keeps across renders (@StateObject),
 plus a refresh whenever the app comes to the front, plus a button.
*/
@MainActor
final class RefreshTicker: ObservableObject {
    /// Bumps on every tick, every app activation and every manual refresh.
    @Published private(set) var tick = 0
    /// Bumps only when a person asks, so views can do the heavier reloads then.
    @Published private(set) var manual = 0
    private var timer: Timer?
    private var activation: NSObjectProtocol?

    init(interval: TimeInterval) {
        let timer = Timer(timeInterval: interval, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.tick += 1 }
        }
        RunLoop.main.add(timer, forMode: .common)
        self.timer = timer
        activation = NotificationCenter.default.addObserver(
            forName: NSApplication.didBecomeActiveNotification, object: nil, queue: .main
        ) { [weak self] _ in Task { @MainActor in self?.tick += 1 } }
    }

    deinit {
        timer?.invalidate()
        if let activation { NotificationCenter.default.removeObserver(activation) }
    }

    func refreshNow() { manual += 1; tick += 1 }
}

/// The project list, re-read on its own timer and published only when it changed.
@MainActor
final class ProjectLibraryModel: ObservableObject {
    @Published private(set) var projects: [SavedProject]
    @Published private(set) var error: String?
    @Published private(set) var refreshedAt = Date()
    /// Bumps when a person presses Refresh, so the open project reloads its plan too.
    @Published private(set) var manualRefreshes = 0
    let ticker = RefreshTicker(interval: 3)
    private var watch: AnyCancellable?

    init() {
        let first = SavedProject.readAll()
        projects = first.projects
        error = first.error
        watch = ticker.$tick.dropFirst().sink { [weak self] _ in self?.refresh() }
    }

    func refresh() {
        let next = SavedProject.readAll()
        if next.projects != projects { projects = next.projects }
        if next.error != error { error = next.error }
        refreshedAt = Date()
    }

    func refreshNow() { manualRefreshes += 1; ticker.refreshNow() }
}
