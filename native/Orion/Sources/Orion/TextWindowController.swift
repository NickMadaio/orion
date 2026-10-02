import AppKit
import SwiftUI

/*
 The typing surface.

 Orion has two windows and they exist for opposite reasons, which is worth
 stating plainly because the difference is the whole design:

 - The hologram panel (`PanelController`) is a *non-activating* NSPanel. It
   appears over whatever you are doing and deliberately refuses focus, because
   it arrives unbidden — you said "Orion" while writing an email and you should
   still be writing that email.

 - This window is the opposite. You clicked the menu bar, which is an explicit
   request to type. It takes focus, puts the caret in the field, and lets you
   start writing immediately. A window that made you click twice would be
   worse than no window.

 Escape hides it. It is never destroyed, so the transcript and any half-typed
 thought survive being dismissed.
*/

final class TextWindowController: NSObject, NSWindowDelegate {

    private let state: AppState
    private var window: NSWindow?

    private static let size = NSSize(width: 1280, height: 820)
    private static let frameAutosaveName = "OrionDashboardWindow"

    var isVisible: Bool { window?.isVisible ?? false }
    /// The app delegate owns the floating hologram, so this controller reports
    /// dashboard visibility instead of reaching into that other window.
    var onShown: (() -> Void)?
    var onHidden: (() -> Void)?

    init(state: AppState) {
        self.state = state
        super.init()
        NotificationCenter.default.addObserver(self, selector: #selector(displaysChanged), name: NSApplication.didChangeScreenParametersNotification, object: nil)
    }

    // MARK: Window

    private func makeWindow() -> NSWindow {
        let window = NSWindow(
            contentRect: NSRect(origin: .zero, size: TextWindowController.size),
            styleMask: [.titled, .closable, .fullSizeContentView, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "Orion Command Center"
        window.titlebarAppearsTransparent = true
        window.titleVisibility = .hidden
        // Dragging the background moves the dashboard.
        window.isMovableByWindowBackground = true
        window.isMovable = true
        // The dashboard is a desktop overlay, not a black document window.
        // SwiftUI paints the tinted translucency; AppKit must leave the window
        // itself clear so the wallpaper can be felt underneath it.
        window.isOpaque = false
        window.backgroundColor = .clear
        window.isReleasedWhenClosed = false
        window.delegate = self
        window.minSize = NSSize(width: 980, height: 640)

        // The dashboard supplies its own controls, so document-window traffic
        // lights are visual noise on this desktop-like surface.
        window.standardWindowButton(.closeButton)?.isHidden = true
        window.standardWindowButton(.miniaturizeButton)?.isHidden = true
        window.standardWindowButton(.zoomButton)?.isHidden = true

        // Follow the user across Spaces rather than yanking them back to
        // whichever desktop Orion happened to be opened on.
        window.collectionBehavior = [.moveToActiveSpace, .fullScreenAuxiliary]

        let root = DashboardView(state: state) { [weak self] in
            self?.hide()
        }
        window.contentView = NSHostingView(rootView: root)

        _ = window.setFrameAutosaveName(TextWindowController.frameAutosaveName)
        // Restore the saved frame; first launch fits the usable display area.
        if !window.setFrameUsingName(TextWindowController.frameAutosaveName), let screen = NSScreen.main {
            let size = NSSize(width: min(Self.size.width, screen.visibleFrame.width), height: min(Self.size.height, screen.visibleFrame.height))
            window.setFrame(NSRect(x: screen.visibleFrame.midX - size.width / 2, y: screen.visibleFrame.midY - size.height / 2, width: size.width, height: size.height), display: true)
        }
        return window
    }

    // MARK: Show / hide

    func show() {
        let window = self.window ?? makeWindow()
        self.window = window

        recoverFrame(window)
        // `.accessory` apps do not come forward on their own; without this the
        // window appears behind whatever is frontmost and looks like nothing
        // happened.
        NSApp.activate(ignoringOtherApps: true)
        window.makeKeyAndOrderFront(nil)
        state.focusComposerToken &+= 1
        onShown?()
    }

    @objc private func displaysChanged() { if let window { recoverFrame(window) } }

    private func recoverFrame(_ window: NSWindow) {
        guard !NSScreen.screens.contains(where: { $0.visibleFrame.intersection(window.frame).width >= 120 && $0.visibleFrame.intersection(window.frame).height >= 80 }), let screen = NSScreen.main else { return }
        let visible = screen.visibleFrame
        let width = min(window.frame.width, visible.width), height = min(window.frame.height, visible.height)
        window.setFrame(NSRect(x: visible.midX - width / 2, y: visible.midY - height / 2, width: width, height: height), display: true)
    }
    func windowDidMove(_ notification: Notification) { window?.saveFrame(usingName: Self.frameAutosaveName) }
    func windowDidResize(_ notification: Notification) { window?.saveFrame(usingName: Self.frameAutosaveName) }

    func hide() {
        window?.orderOut(nil)
        onHidden?()
    }

    func toggle() {
        if isVisible { hide() } else { show() }
    }

    // MARK: NSWindowDelegate

    func windowShouldClose(_ sender: NSWindow) -> Bool {
        // Hide rather than close: keeping the instance keeps the transcript
        // scroll position and anything half-typed.
        hide()
        return false
    }
}
