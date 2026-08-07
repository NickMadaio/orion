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
        // Home is deliberately a fixed desktop surface. A drag on its
        // wallpaper should never move the hub a few pixels out of place.
        window.isMovableByWindowBackground = false
        window.isMovable = false
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

        window.setFrameAutosaveName(TextWindowController.frameAutosaveName)
        // Home acts as the desktop hub, so it is fixed flush to the display's
        // top-left corner. This is not a separate macOS full-screen Space.
        if let screen = NSScreen.main {
            window.setFrame(screen.frame, display: true)
        } else {
            window.center()
        }
        return window
    }

    // MARK: Show / hide

    func show() {
        let window = self.window ?? makeWindow()
        self.window = window

        // `.accessory` apps do not come forward on their own; without this the
        // window appears behind whatever is frontmost and looks like nothing
        // happened.
        NSApp.activate(ignoringOtherApps: true)
        window.makeKeyAndOrderFront(nil)
        state.focusComposerToken &+= 1
        onShown?()
    }

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
