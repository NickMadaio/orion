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

    private static let size = NSSize(width: 460, height: 560)
    private static let frameAutosaveName = "OrionTextWindow"

    var isVisible: Bool { window?.isVisible ?? false }

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
        window.title = "Orion"
        window.titlebarAppearsTransparent = true
        window.titleVisibility = .hidden
        window.isMovableByWindowBackground = true
        window.backgroundColor = NSColor(calibratedRed: 0.02, green: 0.03, blue: 0.05, alpha: 1)
        window.isReleasedWhenClosed = false
        window.delegate = self
        window.minSize = NSSize(width: 380, height: 320)

        // Follow the user across Spaces rather than yanking them back to
        // whichever desktop Orion happened to be opened on.
        window.collectionBehavior = [.moveToActiveSpace, .fullScreenAuxiliary]

        let root = TextWindowView(state: state) { [weak self] in
            self?.hide()
        }
        window.contentView = NSHostingView(rootView: root)

        window.setFrameAutosaveName(TextWindowController.frameAutosaveName)
        if !window.setFrameUsingName(TextWindowController.frameAutosaveName) {
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
    }

    func hide() {
        window?.orderOut(nil)
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

// MARK: - View

private struct TextWindowView: View {

    @ObservedObject var state: AppState
    var onDismiss: () -> Void

    @FocusState private var composerFocused: Bool

    // Matches PanelView's palette. Kept as static constants rather than a
    // Color extension so this file adds no symbols to a shared namespace.
    static let gold = Color(.sRGB, red: 1.0, green: 0.72, blue: 0.28, opacity: 1)
    static let ink  = Color(.sRGB, red: 0.02, green: 0.03, blue: 0.05, opacity: 1)

    static func label(for role: Turn.Role) -> String {
        switch role {
        case .you:    return "you"
        case .orion:  return "orion"
        case .system: return "system"
        }
    }

    static func tint(for role: Turn.Role) -> Color {
        switch role {
        case .you:    return Color(.sRGB, red: 0.47, green: 0.69, blue: 1, opacity: 1)
        case .orion:  return gold
        case .system: return Color(.sRGB, red: 0.95, green: 0.42, blue: 0.32, opacity: 1)
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            header

            Divider().overlay(TextWindowView.gold.opacity(0.16))

            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 14) {
                        ForEach(state.turns) { turn in
                            TurnRow(turn: turn).id(turn.id)
                        }
                    }
                    .padding(16)
                }
                .onChange(of: state.turns.count) { _, _ in
                    guard let last = state.turns.last else { return }
                    withAnimation(.easeOut(duration: 0.2)) {
                        proxy.scrollTo(last.id, anchor: .bottom)
                    }
                }
            }

            Divider().overlay(TextWindowView.gold.opacity(0.16))

            composer
        }
        .background(TextWindowView.ink)
        .onAppear { composerFocused = true }
        // Bumped every time the window is summoned, so a second click on the
        // menu bar re-focuses the field instead of doing nothing visible.
        .onChange(of: state.focusComposerToken) { _, _ in composerFocused = true }
    }

    private var header: some View {
        HStack(spacing: 10) {
            Text("ORION")
                .font(.system(size: 11, weight: .semibold, design: .default))
                .tracking(4)
                .foregroundStyle(TextWindowView.gold)

            Spacer()

            Text(state.statusLine)
                .font(.system(size: 10))
                .tracking(1.2)
                .textCase(.uppercase)
                .foregroundStyle(Color.white.opacity(0.42))
                .lineLimit(1)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
    }

    private var composer: some View {
        HStack(spacing: 8) {
            TextField("Ask Orion…", text: $state.composer, axis: .vertical)
                .textFieldStyle(.plain)
                .lineLimit(1...5)
                .focused($composerFocused)
                .font(.system(size: 13))
                .foregroundStyle(Color.white.opacity(0.86))
                .onSubmit(submit)

            Button(action: submit) {
                Image(systemName: "arrow.up.circle.fill")
                    .font(.system(size: 18))
            }
            .buttonStyle(.plain)
            .foregroundStyle(canSend ? TextWindowView.gold : Color.white.opacity(0.42))
            .disabled(!canSend)
            .keyboardShortcut(.return, modifiers: [])
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        // Escape dismisses. `.keyboardShortcut` on a hidden button is the
        // reliable way to catch it inside a SwiftUI hierarchy.
        .background(
            Button("", action: onDismiss)
                .keyboardShortcut(.escape, modifiers: [])
                .opacity(0)
        )
    }

    private var canSend: Bool {
        !state.composer.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private func submit() {
        guard canSend else { return }
        state.submitTyped()
        composerFocused = true
    }
}

private struct TurnRow: View {
    let turn: Turn

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(TextWindowView.label(for: turn.role))
                .font(.system(size: 9, weight: .semibold))
                .tracking(2)
                .textCase(.uppercase)
                .foregroundStyle(TextWindowView.tint(for: turn.role))

            Text(turn.text)
                .font(.system(size: 13))
                .foregroundStyle(Color.white.opacity(0.86))
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.leading, 10)
        .overlay(alignment: .leading) {
            Rectangle()
                .fill(TextWindowView.tint(for: turn.role).opacity(0.5))
                .frame(width: 2)
        }
    }
}
