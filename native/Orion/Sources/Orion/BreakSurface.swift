//
//  The break, as a place the machine goes rather than a window over it.
//
//  This used to be a small floating panel with a dismiss button, and the note
//  here used to argue for that: prove focus is handed back before taking the
//  screen. It was handed back correctly, every time, for weeks. So it takes the
//  screen now — every screen, because a break that covers one monitor of two is
//  a break you simply look to the left of.
//
//  What replaced the dismiss button is in BreakSanctuary: a control you HOLD for
//  three seconds. There is no Escape key handling here any more, and its removal
//  is the feature — Escape is the most reflexive key on the board, and a rest
//  phase that ends on reflex is not a rest phase.
//
//  Everything about focus restoration below is unchanged, because it was the
//  part that already worked.
//

import AppKit
import SwiftUI
import SessionDomain

final class BreakSurface {

    /// One window per display.
    ///
    /// A single full-screen window covers the display it is on and leaves every
    /// other monitor showing exactly what it was showing — which, on a desk with
    /// two screens, means the break is a suggestion again. The lock has to be
    /// total or it is decorative.
    private var panels: [NSPanel] = []
    private var refresh: Timer?

    /// Who was frontmost when the break began, so it can be put back.
    ///
    /// Focus restoration is what makes an interruption forgivable. A break that
    /// takes the frontmost app and does not give it back leaves Nick clicking
    /// his editor again every fifty minutes.
    private var previousApp: NSRunningApplication?

    var onDismiss: (() -> Void)?
    var onLog: ((String) -> Void)?
    /// Held the exit down. Ends the rest phase for real, not just the window.
    var onHoldExit: (() -> Void)?

    /// What plays underneath. Started with the surface and faded out with it.
    private let ambient = AmbientSound()
    var ambience: Ambience = .rain
    var guided = true
    var presence: String?

    /// State for the running clock, so the view can be rebuilt each second
    /// without the caller having to drive it.
    private var startedAt = Date()
    private var total: TimeInterval = 600
    private var prompt = ""

    var isVisible: Bool { !panels.isEmpty }

    // MARK: Showing

    func show(remaining: TimeInterval, total: TimeInterval, prompt: String) {
        self.total = max(1, total)
        self.prompt = prompt

        guard panels.isEmpty else {
            // Already up — just keep the clock honest.
            startedAt = Date().addingTimeInterval(-(self.total - remaining))
            return rebuild()
        }

        startedAt = Date().addingTimeInterval(-(self.total - remaining))
        previousApp = NSWorkspace.shared.frontmostApplication

        for screen in NSScreen.screens {
            let panel = NSPanel(
                contentRect: screen.frame,
                styleMask: [.borderless, .nonactivatingPanel],
                backing: .buffered,
                defer: false
            )
            panel.isOpaque = true
            panel.backgroundColor = .black
            panel.hasShadow = false
            panel.hidesOnDeactivate = false
            // `.screenSaver` covers the menu bar and the Dock, which is the
            // point. It deliberately does NOT capture the system: Command-Tab,
            // Force Quit and the power button all still work. Orion is not
            // allowed to be something a person has to fight — see BreakLock.
            panel.level = .screenSaver
            panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
            panel.contentView = NSHostingView(rootView: view())
            panel.setFrame(screen.frame, display: true)
            panel.orderFrontRegardless()
            panels.append(panel)
        }

        ambient.onLog = { [weak self] in self?.onLog?($0) }
        ambient.start(ambience)

        // One second is enough for a clock that shows minutes and seconds, and
        // the breathing animation drives itself from the render clock rather
        // than from this timer.
        refresh = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            self?.rebuild()
        }

        onLog?("[break] sanctuary shown on \(panels.count) display(s), "
               + "\(Int(total / 60))min, ambience \(ambience.rawValue)")
    }

    private func view() -> BreakSanctuaryView {
        let elapsed = Date().timeIntervalSince(startedAt)
        return BreakSanctuaryView(
            remaining: max(0, total - elapsed),
            progress: min(1, max(0, elapsed / total)),
            prompt: prompt,
            guided: guided,
            presence: presence,
            onHoldExit: { [weak self] in
                self?.onLog?("[break] held the exit — ending the rest phase early")
                self?.onHoldExit?()
                self?.dismiss()
            }
        )
    }

    private func rebuild() {
        let content = view()
        for panel in panels {
            (panel.contentView as? NSHostingView<BreakSanctuaryView>)?.rootView = content
        }
    }

    // MARK: Dismissing

    func dismiss() {
        refresh?.invalidate()
        refresh = nil
        ambient.stop()

        for panel in panels { panel.orderOut(nil) }
        panels.removeAll()

        if let previousApp, previousApp.bundleIdentifier != Bundle.main.bundleIdentifier {
            previousApp.activate()
        }
        previousApp = nil

        onLog?("[break] sanctuary dismissed")
        onDismiss?()
    }
}
