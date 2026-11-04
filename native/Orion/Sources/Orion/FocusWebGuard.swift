import Foundation
import SwiftUI
import SessionService

/*
 The website guard's heartbeat (2026-11-04). While a work session has a focus-web.json, every few seconds this runs
 `orion-focus-sites tick` (the installed copy under ~/.openclaw/orion-remote, like LifeWatch): it reads activity.json and, if he is
 on a site the session does not allow, nudges once and then sends the tab to a calm page. No file, no process. One tick at a time.
*/
@MainActor
final class FocusWebGuard {
    private var running = false
    private var next = Date.distantPast
    private let every: TimeInterval = 5

    func tick(now: Date = Date()) {
        guard now >= next, !running, FocusWebState.load() != nil else { return }
        next = now.addingTimeInterval(every)
        let home = FileManager.default.homeDirectoryForCurrentUser
        let node = home.appendingPathComponent(".openclaw/tools/node-v24.15.0/bin/node")
        let script = home.appendingPathComponent(".openclaw/orion-remote/scripts/orion-focus-sites")
        guard FileManager.default.isExecutableFile(atPath: node.path), FileManager.default.fileExists(atPath: script.path) else { return }
        running = true
        Task.detached {
            let process = Process()
            process.executableURL = node
            process.arguments = [script.path, "tick"]
            process.standardOutput = FileHandle.nullDevice
            process.standardError = FileHandle.nullDevice
            try? process.run()
            process.waitUntilExit()
            await MainActor.run { self.running = false }
        }
    }
}

/// What the session allows, in the focus screen's own language: a mono kicker and a quiet line under the task.
struct FocusWebStrip: View {
    @State private var state: FocusWebState? = FocusWebState.load()
    private let refresh = Timer.publish(every: 5, on: .main, in: .common).autoconnect()

    var body: some View {
        Group {
            if let state, !state.summary.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    Text("ALLOWED")
                        .font(OrionTheme.mono(8, .semibold)).tracking(2.4)
                        .foregroundStyle(OrionTheme.textDim.opacity(0.8))
                    Text(state.summary)
                        .font(OrionTheme.mono(9, .medium)).tracking(1.2)
                        .foregroundStyle(OrionTheme.textDim)
                        .lineLimit(2)
                }
                .padding(.top, 6)
                .accessibilityElement(children: .combine)
                .accessibilityLabel("Allowed during this session: \(state.summary)")
            }
        }
        .onReceive(refresh) { _ in state = FocusWebState.load() }
    }
}
