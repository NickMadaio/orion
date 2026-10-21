import AppKit
import Combine
import SwiftUI

/// The pop-out: the to-do list as its own small panel, always on top like the
/// session float, movable and resizable, remembering where he left it. Works
/// with no session running -- opened from the menu bar or the Tasks tab.
final class TodoFloatController {
    private let state: AppState
    private var panel: NSPanel?
    private var watch: AnyCancellable?
    private var syncWatch: [AnyCancellable] = []
    private var latest: TodoFloatState
    private var minimized: Bool
    private static let frameName = "OrionTodoFloat"

    init(state: AppState) {
        self.state = state
        self.latest = state.todoFloat.state
        self.minimized = state.sessionMinimized
        // Restored from last launch: keep the sync going only if Reminders is
        // already allowed. Only a change he makes (chevron, pop out, menu) may
        // raise the permission prompt.
        syncSurfaces(prompt: false)
        syncWatch = [
            state.todoFloat.$state.dropFirst().sink { [weak self] next in
                self?.latest = next
                self?.syncSurfaces(prompt: true)
            },
            state.$sessionMinimized.dropFirst().sink { [weak self] next in
                self?.minimized = next
                self?.syncSurfaces(prompt: false)
            }
        ]
        watch = state.todoFloat.$state
            .map(\.poppedOut)
            .removeDuplicates()
            .receive(on: RunLoop.main)
            .sink { [weak self] popped in popped ? self?.show() : self?.hide() }
    }

    /// The sync runs only while a to-do surface is on screen.
    private func syncSurfaces(prompt: Bool) {
        let sync = state.todoSync
        if latest.expanded && !latest.poppedOut && minimized { sync.acquire("dropdown", prompt: prompt) } else { sync.release("dropdown") }
        if latest.poppedOut { sync.acquire("popout", prompt: prompt) } else { sync.release("popout") }
    }

    private func show() {
        if panel == nil { panel = makePanel() }
        panel?.orderFrontRegardless()
    }

    private func hide() { panel?.orderOut(nil) }

    private func makePanel() -> NSPanel {
        let panel = SessionFloatPanel(contentRect: NSRect(x: 0, y: 0, width: 300, height: 280),
                                      styleMask: [.nonactivatingPanel, .borderless, .resizable],
                                      backing: .buffered, defer: false)
        panel.isFloatingPanel = true
        panel.level = .floating
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false
        panel.hidesOnDeactivate = false
        panel.isMovableByWindowBackground = true
        panel.becomesKeyOnlyIfNeeded = true
        panel.isReleasedWhenClosed = false
        panel.minSize = NSSize(width: 220, height: 120)
        let model = state.todoFloat
        let view = TodoFloatWindowView(
            sync: state.todoSync,
            appState: state,
            onDock: { model.dock() },
            onClose: { model.closePopOut() })
        panel.contentView = FirstClickHostingView(rootView: view)
        panel.setFrameAutosaveName(Self.frameName)
        if !panel.setFrameUsingName(Self.frameName), let screen = NSScreen.main {
            let v = screen.visibleFrame
            panel.setFrameOrigin(NSPoint(x: v.maxX - panel.frame.width - 24, y: v.maxY - panel.frame.height - 24))
        }
        // A frame saved on a display that is no longer connected would restore
        // off screen: bring it back to the middle of the main one.
        let screens = NSScreen.screens.map(\.visibleFrame)
        if let main = NSScreen.main, !FrameRecovery.visibleEnough(panel.frame, screens: screens) {
            panel.setFrame(FrameRecovery.centered(size: panel.frame.size, on: main.visibleFrame), display: false)
        }
        return panel
    }
}

/// Fills the panel: translucent black, hairline edge, no slab -- the same surface
/// as the session float.
struct TodoFloatWindowView: View {
    @ObservedObject var sync: AppleRemindersSync
    @ObservedObject var appState: AppState
    let onDock: () -> Void
    let onClose: () -> Void

    var body: some View {
        TodoFloatList(sync: sync, standalone: true, onDock: appState.sessionMinimized ? onDock : nil, onClose: onClose)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Color.black.opacity(0.42)))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Color.white.opacity(0.14), lineWidth: 0.5))
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
    }
}
