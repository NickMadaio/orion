import AppKit
import OrionViews
import SwiftUI

/*
 One shared ambient clock, with pause rules (wave 12, 2026-11-02, review #12; reworked wave 14).

 Idle animation (the thinking glimmer, an orb, a dial) should cost nothing when nobody can see it. It stands still
 when the window is truly hidden: ordered out, minimised, the app hidden, the window on another Space, or the
 displays asleep or the session locked. Reduce Motion stills it too (`AmbientTimeline` reads that itself). It
 resumes from the SAME phase rather than jumping.

 Wave 14 (Nick, build 1253: "the hologram on the home page ... isnt moving"). Two rules froze a window he was
 looking at:
   · Low Power Mode paused everything. His Mac was on battery at 5% with Low Power on (pmset `powermode 1`,
     ProcessInfo.isLowPowerModeEnabled true), so every idle animation stood still while the window was in front
     of him. Low Power now THROTTLES (`\.ambientThrottled`: draw at a lower rate) instead of pausing.
   · Occlusion is only trusted for opaque windows. The dashboard window is transparent (isOpaque false, clear
     background) and ORION is an LSUIElement app with transparent full-screen panels of its own; for that window
     type `occlusionState` is not a reliable "can be seen" signal. A transparent window that is ordered in, on the
     active Space, with the displays awake, counts as visible whatever occlusion reports.

 The pieces:
   · `AmbientTimeline` (OrionViews/SoftReveal.swift): the clock itself, reading `\.ambientPaused` and Reduce
     Motion. Anything animating at idle wraps its drawing in one.
   · `.ambientPauseRules()` (here): put once at a window's root; it watches the NSWindow and sets
     `\.ambientPaused` and `\.ambientThrottled` for everything below it.
   · `AmbientPolicy.decide`: the rule as a pure function over `AmbientSignals`, so it is tested without a window.
*/

/// What the probe reads from the window, the app and the machine. Plain values, so the rule is a pure function.
struct AmbientSignals: Equatable {
    /// `NSWindow.isVisible`: ordered in.
    var orderedIn = true
    var miniaturized = false
    var appHidden = false
    var onActiveSpace = true
    /// Displays asleep, screen saver or the session locked / switched away.
    var screensAsleep = false
    /// `occlusionState.contains(.visible)`.
    var occlusionVisible = true
    /// `NSWindow.isOpaque`. Occlusion is only believed for opaque windows.
    var windowOpaque = true
    var lowPower = false
}

enum AmbientDecision: Equatable {
    case run
    /// Run at a lower frame rate (Low Power Mode).
    case throttle
    case pause

    var paused: Bool { self == .pause }
    var throttled: Bool { self == .throttle }
}

enum AmbientPolicy {
    /// Whether idle animation runs, runs slower, or stands still. Reduce Motion is handled by `AmbientTimeline`.
    static func decide(_ s: AmbientSignals) -> AmbientDecision {
        let hidden = !s.orderedIn || s.miniaturized || s.appHidden || !s.onActiveSpace || s.screensAsleep
        // Covered by another window: only trusted when this window is opaque (see the header).
        let covered = s.windowOpaque && !s.occlusionVisible
        if hidden || covered { return .pause }
        return s.lowPower ? .throttle : .run
    }

    /// The frame rate to draw at: `fps` normally, a third less under Low Power (never below 12).
    static func frameRate(_ fps: Double, throttled: Bool) -> Double {
        throttled ? max(12, (fps * 2 / 3).rounded()) : fps
    }
}

private struct AmbientThrottledKey: EnvironmentKey {
    static let defaultValue = false
}

extension EnvironmentValues {
    /// True in Low Power Mode: idle animation keeps moving, at `AmbientPolicy.frameRate(_:throttled:)`.
    var ambientThrottled: Bool {
        get { self[AmbientThrottledKey.self] }
        set { self[AmbientThrottledKey.self] = newValue }
    }
}

extension View {
    /// Sets `\.ambientPaused` and `\.ambientThrottled` from the hosting window. Apply once, near the window's root.
    func ambientPauseRules() -> some View { modifier(AmbientPauseRules()) }
}

private struct AmbientPauseRules: ViewModifier {
    @State private var decision = AmbientDecision.run

    func body(content: Content) -> some View {
        content
            .environment(\.ambientPaused, decision.paused)
            .environment(\.ambientThrottled, decision.throttled)
            .background(WindowActivityProbe { decision = $0 })
    }
}

/// An invisible view that reports whether its window can be seen.
private struct WindowActivityProbe: NSViewRepresentable {
    let onChange: (AmbientDecision) -> Void

    func makeNSView(context: Context) -> ProbeView {
        let view = ProbeView()
        view.onChange = onChange
        return view
    }

    func updateNSView(_ view: ProbeView, context: Context) { view.onChange = onChange }

    final class ProbeView: NSView {
        var onChange: (AmbientDecision) -> Void = { _ in }
        private var tokens: [(NotificationCenter, NSObjectProtocol)] = []
        private var last: AmbientDecision?
        private var screensAsleep = false

        override func viewDidMoveToWindow() {
            super.viewDidMoveToWindow()
            removeObservers()
            guard let window else { report(); return }
            let center = NotificationCenter.default
            let windowNames: [Notification.Name] = [
                NSWindow.didChangeOcclusionStateNotification, NSWindow.didMiniaturizeNotification,
                NSWindow.didDeminiaturizeNotification, NSWindow.didChangeScreenNotification,
            ]
            for name in windowNames { observe(center, name, object: window) }
            for name in [NSApplication.didHideNotification, NSApplication.didUnhideNotification,
                         .NSProcessInfoPowerStateDidChange] {
                observe(center, name, object: nil)
            }
            let workspace = NSWorkspace.shared.notificationCenter
            observe(workspace, NSWorkspace.activeSpaceDidChangeNotification, object: nil)
            for name in [NSWorkspace.screensDidSleepNotification, NSWorkspace.sessionDidResignActiveNotification] {
                observe(workspace, name, object: nil) { [weak self] in self?.screensAsleep = true }
            }
            for name in [NSWorkspace.screensDidWakeNotification, NSWorkspace.sessionDidBecomeActiveNotification] {
                observe(workspace, name, object: nil) { [weak self] in self?.screensAsleep = false }
            }
            report()
        }

        /// Ordering in and out has no window notification; re-check when the view's visibility changes.
        override func viewDidUnhide() { super.viewDidUnhide(); report() }
        override func viewDidHide() { super.viewDidHide(); report() }

        private func observe(_ center: NotificationCenter, _ name: Notification.Name, object: AnyObject?,
                             before: (() -> Void)? = nil) {
            let token = center.addObserver(forName: name, object: object, queue: .main) { [weak self] _ in
                before?()
                self?.report()
            }
            tokens.append((center, token))
        }

        private func removeObservers() {
            tokens.forEach { center, token in center.removeObserver(token) }
            tokens = []
        }

        private func signals() -> AmbientSignals {
            AmbientSignals(
                orderedIn: window?.isVisible ?? true,
                miniaturized: window?.isMiniaturized ?? false,
                appHidden: NSApp.isHidden,
                onActiveSpace: window?.isOnActiveSpace ?? true,
                screensAsleep: screensAsleep,
                occlusionVisible: window?.occlusionState.contains(.visible) ?? true,
                windowOpaque: window?.isOpaque ?? true,
                lowPower: ProcessInfo.processInfo.isLowPowerModeEnabled)
        }

        private func report() {
            let decision = AmbientPolicy.decide(signals())
            guard decision != last else { return }
            last = decision
            // Deferred: this can fire during a SwiftUI update, and the callback writes @State.
            DispatchQueue.main.async { [onChange] in onChange(decision) }
        }

        deinit { tokens.forEach { center, token in center.removeObserver(token) } }
    }
}
