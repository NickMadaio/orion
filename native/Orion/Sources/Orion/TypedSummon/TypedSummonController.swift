import AppKit
import Combine
import SwiftUI

/*
 The typed summon: ORION's "I only want to message, not talk" surface.

 A full-screen, transparent, borderless panel over the screen Nick is looking at. Unlike the voice summon's orb it
 DOES take key status, because it exists to be typed into; it is non-activating, so the app he was in keeps its
 place and gets it back when this closes. Esc or a click outside dismisses it, and so does losing key status.

 Sending goes through AppState.submitTyped, the same path the Home composer and the orb's reply box use, so
 tools, first-person finalize and chat history all apply. The answer is read off AppState.turns.
*/

final class TypedSummonPanel: NSPanel {
    var onEscape: (() -> Void)?
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }
    override func constrainFrameRect(_ frameRect: NSRect, to screen: NSScreen?) -> NSRect { frameRect }

    override func sendEvent(_ event: NSEvent) {
        if event.type == .keyDown, event.keyCode == PushToTalkMonitor.escapeKeyCode {
            onEscape?()
            return
        }
        super.sendEvent(event)
    }
}

final class TypedSummonModel: ObservableObject {
    @Published private(set) var flow = TypedSummonFlow()
    @Published var focusToken = 0
    private let state: AppState
    private var bag: Set<AnyCancellable> = []
    private var baseline = 0

    init(state: AppState) {
        self.state = state
        state.$turns.sink { [weak self] turns in self?.turnsChanged(turns) }.store(in: &bag)
        state.$phase.sink { [weak self] phase in self?.phaseChanged(phase) }.store(in: &bag)
    }

    func present() {
        var next = flow
        next.present()
        flow = next
        focusToken &+= 1
    }

    func dismiss() {
        var next = flow
        next.dismiss()
        flow = next
    }

    func send() {
        let typed = state.composer.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !typed.isEmpty, state.phase != .thinking else { return }
        beginTurn()
        state.submitTyped()
        focusToken &+= 1
    }

    func toggleVoice() {
        if state.phase == .listening { state.endListening() } else { state.beginListening(handsFree: true) }
    }

    /// Idempotent: a typed send marks the turn before the phase flips, a voice turn is marked by the phase.
    private func beginTurn() {
        guard flow.stage != .thinking else { return }
        baseline = state.turns.count
        var next = flow
        next.sent()
        flow = next
    }

    private func turnsChanged(_ turns: [Turn]) {
        guard flow.stage == .thinking, turns.count > baseline,
              let reply = turns[baseline...].last(where: { $0.role == .orion }) else { return }
        var next = flow
        next.answered(reply.text)
        flow = next
    }

    private func phaseChanged(_ phase: OrionPhase) {
        guard flow.isVisible else { return }
        switch phase {
        case .thinking:
            beginTurn()
        case .error:
            guard flow.stage == .thinking else { return }
            let said = state.turns[min(baseline, state.turns.count)...].last(where: { $0.role == .system })?.text
            var next = flow
            next.answered(said ?? "That did not go through.")
            flow = next
        case .idle:
            // Cancelled with no answer: give the layout back once the dust settles (an answer may be a beat behind).
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) { [weak self] in
                guard let self, self.state.phase == .idle, self.flow.stage == .thinking else { return }
                var next = self.flow
                next.abandoned()
                self.flow = next
            }
        default:
            break
        }
    }
}

final class TypedSummonController: NSObject, NSWindowDelegate {
    private let state: AppState
    private let model: TypedSummonModel
    private var panel: TypedSummonPanel?

    /// Opened or closed, so the app can keep the orb panel and the menu in step.
    var onVisibilityChanged: ((Bool) -> Void)?
    /// The chat button: leave the overlay and open the dashboard chat.
    var onOpenChat: (() -> Void)?

    var isVisible: Bool { model.flow.isVisible }

    init(state: AppState) {
        self.state = state
        self.model = TypedSummonModel(state: state)
        super.init()
    }

    func toggle() { isVisible ? dismiss() : show() }

    func show() {
        guard let screen = activeScreen() else { return }
        let panel = self.panel ?? makePanel()
        self.panel = panel
        panel.setFrame(screen.frame, display: true)
        if let host = panel.contentView as? NSHostingView<TypedSummonRoot> {
            host.rootView = TypedSummonRoot(state: state, model: model, bottomInset: Self.bottomInset(for: screen),
                                            onChat: { [weak self] in self?.openChat() }, onDismiss: { [weak self] in self?.dismiss() })
        }
        model.present()
        panel.alphaValue = 1
        panel.makeKeyAndOrderFront(nil)
        onVisibilityChanged?(true)
    }

    func dismiss() {
        guard isVisible else { return }
        model.dismiss()
        panel?.orderOut(nil)
        onVisibilityChanged?(false)
    }

    private func openChat() {
        dismiss()
        onOpenChat?()
    }

    /// Dock plus breathing room, so the composer sits where Home's does.
    static func bottomInset(for screen: NSScreen) -> CGFloat {
        screen.visibleFrame.minY - screen.frame.minY + 40
    }

    private func activeScreen() -> NSScreen? {
        let mouse = NSEvent.mouseLocation
        return NSScreen.screens.first { NSMouseInRect(mouse, $0.frame, false) } ?? NSScreen.main ?? NSScreen.screens.first
    }

    private func makePanel() -> TypedSummonPanel {
        let panel = TypedSummonPanel(contentRect: .zero, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        panel.level = .floating
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false
        panel.isFloatingPanel = true
        panel.hidesOnDeactivate = false
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
        panel.animationBehavior = .none
        panel.delegate = self
        panel.onEscape = { [weak self] in self?.dismiss() }
        let host = NSHostingView(rootView: TypedSummonRoot(state: state, model: model, bottomInset: 40, onChat: {}, onDismiss: {}))
        host.autoresizingMask = [.width, .height]
        panel.contentView = host
        return panel
    }

    /// Clicking another window or app ends it, like any popover.
    func windowDidResignKey(_ notification: Notification) { dismiss() }
}

/// Binds the plain-value view to the live state.
struct TypedSummonRoot: View {
    @ObservedObject var state: AppState
    @ObservedObject var model: TypedSummonModel
    let bottomInset: CGFloat
    var onChat: () -> Void
    var onDismiss: () -> Void
    @FocusState private var focused: Bool

    var body: some View {
        TypedSummonView(flow: model.flow, text: $state.composer, focus: $focused, hologram: state.hologram,
                        listening: state.phase == .listening, bottomInset: bottomInset,
                        onVoice: model.toggleVoice, onChat: onChat, onSend: model.send, onDismiss: onDismiss)
            .onAppear { focus() }
            .onChange(of: model.focusToken) { _, _ in focus() }
    }

    /// The window has to be key before a field can take focus; one runloop turn is enough.
    private func focus() { DispatchQueue.main.async { focused = true } }
}
