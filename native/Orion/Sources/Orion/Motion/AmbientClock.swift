import AppKit
import OrionViews
import SwiftUI

/*
 One shared ambient clock, with pause rules (wave 12, 2026-11-02, review #12).

 Idle animation (the thinking glimmer, an orb, a dial) should cost nothing when nobody can see it. The rule is
 the same everywhere: it stands still when the window is hidden, minimised or fully covered, in Low Power Mode,
 and under Reduce Motion, and it resumes from the SAME phase rather than jumping.

 The pieces:
   · `AmbientTimeline` (OrionViews/SoftReveal.swift): the clock itself, reading `\.ambientPaused` and Reduce
     Motion. Anything animating at idle wraps its drawing in one.
   · `.ambientPauseRules()` (here): put once at a window's root; it watches the NSWindow and sets
     `\.ambientPaused` for everything below it.
   · `AmbientPolicy.shouldPause`: the rule as a pure function, so it is tested without a window.
*/

enum AmbientPolicy {
    /// Whether idle animation should stand still. Reduce Motion is handled by `AmbientTimeline` itself.
    static func shouldPause(windowVisible: Bool, miniaturized: Bool, appHidden: Bool, lowPower: Bool) -> Bool {
        !windowVisible || miniaturized || appHidden || lowPower
    }
}

extension View {
    /// Sets `\.ambientPaused` from the hosting window's visibility. Apply once, near the window's root.
    func ambientPauseRules() -> some View { modifier(AmbientPauseRules()) }
}

private struct AmbientPauseRules: ViewModifier {
    @State private var paused = false

    func body(content: Content) -> some View {
        content
            .environment(\.ambientPaused, paused)
            .background(WindowActivityProbe { paused = $0 })
    }
}

/// An invisible view that reports whether its window can be seen.
private struct WindowActivityProbe: NSViewRepresentable {
    let onChange: (Bool) -> Void

    func makeNSView(context: Context) -> ProbeView {
        let view = ProbeView()
        view.onChange = onChange
        return view
    }

    func updateNSView(_ view: ProbeView, context: Context) { view.onChange = onChange }

    final class ProbeView: NSView {
        var onChange: (Bool) -> Void = { _ in }
        private var tokens: [NSObjectProtocol] = []
        private var last: Bool?

        override func viewDidMoveToWindow() {
            super.viewDidMoveToWindow()
            tokens.forEach { NotificationCenter.default.removeObserver($0) }
            tokens = []
            guard let window else { report(); return }
            let center = NotificationCenter.default
            let names: [Notification.Name] = [NSWindow.didChangeOcclusionStateNotification, NSWindow.didMiniaturizeNotification,
                                              NSWindow.didDeminiaturizeNotification]
            for name in names {
                tokens.append(center.addObserver(forName: name, object: window, queue: .main) { [weak self] _ in self?.report() })
            }
            for name in [NSApplication.didHideNotification, NSApplication.didUnhideNotification, .NSProcessInfoPowerStateDidChange] {
                tokens.append(center.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in self?.report() })
            }
            report()
        }

        private func report() {
            let paused = AmbientPolicy.shouldPause(
                windowVisible: window?.occlusionState.contains(.visible) ?? true,
                miniaturized: window?.isMiniaturized ?? false,
                appHidden: NSApp.isHidden,
                lowPower: ProcessInfo.processInfo.isLowPowerModeEnabled)
            guard paused != last else { return }
            last = paused
            // Deferred: this can fire during a SwiftUI update, and the callback writes @State.
            DispatchQueue.main.async { [onChange] in onChange(paused) }
        }

        deinit { tokens.forEach { NotificationCenter.default.removeObserver($0) } }
    }
}
