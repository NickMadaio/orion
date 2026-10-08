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
    /// Open AND what he is looking at: ORION is the active app and the dashboard
    /// is its key window, not minimised or behind something else (2026-10-08:
    /// "not just when hes closed but rather when he isnt the focus").
    var isInFocus: Bool {
        guard let window, window.isVisible, !window.isMiniaturized, window.isOnActiveSpace else { return false }
        return NSApp.isActive && (window.isKeyWindow || window.isMainWindow)
    }
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
        // A normal Mac window (Nick, 2026-10-06: "just make it like a normal app"):
        // a real title bar to drag it by, the three standard buttons, resizable,
        // and it stays on the desktop it was opened on. It used to move when any
        // part of its background was dragged — in SwiftUI that is most of the
        // window, sliders included — so it jumped around under ordinary clicks.
        let window = NSWindow(
            contentRect: NSRect(origin: .zero, size: TextWindowController.size),
            styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        window.title = "ORION"
        window.appearance = NSAppearance(named: .darkAqua)
        // No grey title bar: the dashboard runs to the top edge and the standard
        // buttons sit on it; a thin strip along the top drags the window (Nick:
        // "I hate the top bar thing", 2026-10-06).
        window.titlebarAppearsTransparent = true
        window.titleVisibility = .hidden
        window.isMovableByWindowBackground = false
        window.isMovable = true
        // The dashboard still paints its own tinted translucency below the title bar.
        window.isOpaque = false
        window.backgroundColor = .clear
        window.isReleasedWhenClosed = false
        window.delegate = self
        window.minSize = NSSize(width: 760, height: 520)
        window.collectionBehavior = [.fullScreenPrimary]

        let root = ZStack(alignment: .top) {
            DashboardView(state: state) { [weak self] in
                self?.hide()
            }
            WindowDragStrip().frame(height: 14).padding(.leading, 80)   // thin: the session header's buttons sit just below
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

    /// Switching back to the dashboard: its own hologram takes over, so the
    /// small pop-up (shown while he was elsewhere) goes away.
    func windowDidBecomeKey(_ notification: Notification) {
        onShown?()
    }

    func windowShouldClose(_ sender: NSWindow) -> Bool {
        // Hide rather than close: keeping the instance keeps the transcript
        // scroll position and anything half-typed.
        hide()
        return false
    }
}


/// The top 26 points of the window: drag to move, double-click to zoom, like
/// the title bar it replaces. Everything below it belongs to the dashboard.
struct WindowDragStrip: NSViewRepresentable {
    final class StripView: NSView {
        override func mouseDown(with event: NSEvent) {
            if event.clickCount == 2 { window?.zoom(nil) } else { window?.performDrag(with: event) }
        }
        override var mouseDownCanMoveWindow: Bool { true }
    }
    func makeNSView(context: Context) -> NSView { StripView() }
    func updateNSView(_ nsView: NSView, context: Context) {}
}
