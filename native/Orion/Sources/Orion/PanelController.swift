import AppKit
import QuartzCore
import SwiftUI

/// A borderless, non-activating floating panel.
///
/// `.nonactivatingPanel` is the whole trick: it lets the panel take keyboard
/// focus for the composer without pulling the user out of whatever app they
/// were in. Combined with `.floating` level and `canJoinAllSpaces`, Orion can
/// appear over anything, answer, and get out of the way.
final class HologramPanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }
}

final class PanelController {

    private(set) var panel: HologramPanel?
    private let state: AppState

    private static let frameAutosaveName = "OrionHologramPanel"
    // Tall enough for the hologram, the transcript and the composer with the
    // accessibility banner showing, which is the largest the content ever gets.
    private static let defaultSize = NSSize(width: 380, height: 610)

    /// Intent, not the window's own `isVisible`: hiding fades first and orders
    /// out afterwards, and callers need the answer immediately.
    private(set) var isVisible = false

    init(state: AppState) {
        self.state = state
    }

    // MARK: Build

    private func makePanel() -> HologramPanel {
        let panel = HologramPanel(
            contentRect: NSRect(origin: .zero, size: PanelController.defaultSize),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        panel.level = .floating
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = true
        panel.isFloatingPanel = true
        panel.becomesKeyOnlyIfNeeded = true
        panel.hidesOnDeactivate = false
        panel.isMovableByWindowBackground = true
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
        panel.animationBehavior = .none
        panel.alphaValue = 0

        let root = PanelView(state: state) { [weak self] in
            self?.hide()
        }
        let hosting = NSHostingView(rootView: root)
        hosting.frame = NSRect(origin: .zero, size: PanelController.defaultSize)
        panel.contentView = hosting

        _ = panel.setFrameAutosaveName(PanelController.frameAutosaveName)
        if !panel.setFrameUsingName(PanelController.frameAutosaveName) {
            positionBottomRight(panel)
        }
        return panel
    }

    private func positionBottomRight(_ panel: NSPanel) {
        guard let screen = NSScreen.main else { return }
        let visible = screen.visibleFrame
        let margin: CGFloat = 24
        let origin = NSPoint(
            x: visible.maxX - PanelController.defaultSize.width - margin,
            y: visible.minY + margin
        )
        panel.setFrameOrigin(origin)
    }

    // MARK: Show / hide

    func show(makeKey: Bool = true) {
        let panel = self.panel ?? makePanel()
        self.panel = panel
        isVisible = true

        if makeKey {
            // Deliberate: an explicit "show me" from the menu should put the
            // caret in the composer. The non-activating wake path below is the
            // one that must not disturb what the user is doing.
            NSApp.activate(ignoringOtherApps: true)
            panel.makeKeyAndOrderFront(nil)
        } else {
            // orderFrontRegardless shows the panel without any chance of
            // stealing focus — used when push-to-talk wakes a hidden Orion.
            panel.orderFrontRegardless()
        }

        fade(panel, to: 1)
        state.hologram.ping()
    }

    func hide() {
        guard let panel = panel, isVisible else { return }
        isVisible = false
        fade(panel, to: 0) { [weak self, weak panel] in
            // Only actually order out if nothing asked us back in mid-fade.
            guard let self, !self.isVisible else { return }
            panel?.orderOut(nil)
        }
    }

    func toggle() {
        if isVisible {
            hide()
        } else {
            show()
        }
    }

    private func fade(_ panel: NSPanel, to alpha: CGFloat, completion: (() -> Void)? = nil) {
        NSAnimationContext.runAnimationGroup({ context in
            context.duration = alpha > 0 ? 0.16 : 0.13
            context.timingFunction = CAMediaTimingFunction(name: .easeOut)
            panel.animator().alphaValue = alpha
        }, completionHandler: completion)
    }
}
