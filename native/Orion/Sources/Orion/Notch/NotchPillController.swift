import AppKit
import Combine
import SwiftUI

/// What the SwiftUI pill reads. Reduced from `NotchPillState` plus where it sits.
final class NotchPillModel: ObservableObject {
    @Published var pill = NotchPillState()
    @Published var docked = false
    @Published var metrics = NotchScreenMetrics(frame: .zero, visibleFrame: .zero, safeAreaTop: 0, auxLeft: nil, auxRight: nil)
    @Published var flyOffset = CGSize.zero
    var onCancel: () -> Void = {}
    var onClick: () -> Void = {}
}

private struct NotchPillHost: View {
    @ObservedObject var model: NotchPillModel
    let hologram: AppState

    @AppStorage(HologramStyle.storageKey) private var coreStyle = HologramStyle.thinkingOrion.rawValue

    var body: some View {
        let size = model.pill.size
        let frame = NotchGeometry.pillFrame(model.metrics, size: size)
        let notch = NotchGeometry.notch(model.metrics)
        NotchPillView(state: model.pill, notchGap: NotchGeometry.notchGap(model.metrics), hasNotch: notch != nil,
                      pillSize: frame.size, bandHeight: notch?.height ?? NotchGeometry.flatHeight,
                      hologram: hologram.hologram, orbStyle: HologramStyle(stored: coreStyle),
                      docked: model.docked, flyOffset: model.flyOffset, onCancel: model.onCancel)
            .onTapGesture(perform: model.onClick)
            .gesture(DragGesture(minimumDistance: 14).onEnded { value in
                if value.translation.height < -22, abs(value.translation.width) < 60 { model.onCancel() }
            })
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    }
}

/// The hosting view: takes the first click, watches the pointer for hover, and turns a two-finger swipe up into cancel.
private final class NotchHostingView<Content: View>: NSHostingView<Content> {
    var pillRect: () -> CGRect = { .zero }   // in top-left coordinates
    var onHover: ((Bool) -> Void)?
    var onSwipeUp: (() -> Void)?
    private var hoverInside = false
    private var swipeTotal: CGFloat = 0
    private var swipeFired = false

    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        trackingAreas.forEach(removeTrackingArea)
        addTrackingArea(NSTrackingArea(rect: .zero, options: [.mouseEnteredAndExited, .mouseMoved, .activeAlways, .inVisibleRect],
                                       owner: self, userInfo: nil))
    }

    private func topLeft(_ event: NSEvent) -> CGPoint {
        let p = convert(event.locationInWindow, from: nil)
        return CGPoint(x: p.x, y: isFlipped ? p.y : bounds.height - p.y)
    }

    private func update(_ event: NSEvent) {
        let inside = pillRect().contains(topLeft(event))
        guard inside != hoverInside else { return }
        hoverInside = inside
        onHover?(inside)
    }

    override func mouseMoved(with event: NSEvent) { update(event) }
    override func mouseEntered(with event: NSEvent) { update(event) }
    override func mouseExited(with event: NSEvent) {
        guard hoverInside else { return }
        hoverInside = false
        onHover?(false)
    }

    override func scrollWheel(with event: NSEvent) {
        guard pillRect().contains(topLeft(event)) else { super.scrollWheel(with: event); return }
        if event.phase == .began || event.phase == .mayBegin { swipeTotal = 0; swipeFired = false }
        // Positive means the fingers moved up, whichever way natural scrolling is set.
        let up = event.isDirectionInvertedFromDevice ? -event.scrollingDeltaY : event.scrollingDeltaY
        swipeTotal += up
        if !swipeFired, swipeTotal > 36 {
            swipeFired = true
            onSwipeUp?()
        }
    }
}

private final class NotchPillPanel: NSPanel {
    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
    override func constrainFrameRect(_ frameRect: NSRect, to screen: NSScreen?) -> NSRect { frameRect }
}

/// Docks the voice panel's turn into a pill at the top of the screen when he clicks away mid-turn.
///
/// The state machine is `NotchPillState`; this class owns the window, the timer, and what each effect does to the
/// rest of the app. It never cancels a turn on its own: only the x, a swipe up, or Esc while docked.
final class NotchPillController {

    private let state: AppState
    private let panelController: PanelController
    private let model = NotchPillModel()
    private var window: NotchPillPanel?
    private var previewTimer: DispatchWorkItem?
    private var bag: Set<AnyCancellable> = []

    /// The panel closed or came back: the menu bar item and the Esc watch need to catch up.
    var onPanelVisibilityChanged: (() -> Void)?
    /// The pill appeared or went away: the Esc watch needs to catch up.
    var onPillVisibilityChanged: (() -> Void)?

    var isShowing: Bool { model.pill.mode != .hidden }

    init(state: AppState, panelController: PanelController) {
        self.state = state
        self.panelController = panelController
        model.onCancel = { [weak self] in self?.send(.cancelRequested) }
        model.onClick = { [weak self] in self?.send(.clicked) }
        state.$phase.dropFirst().sink { [weak self] phase in
            self?.send(.phaseChanged(NotchTurnPhase(phase)))
        }.store(in: &bag)
        state.$turns.sink { [weak self] turns in
            guard let self, self.isShowing else { return }
            self.send(.answerChanged(Self.answer(in: turns)))
        }.store(in: &bag)
    }

    // MARK: Entry points

    /// He clicked away from the panel, or pressed Esc while it was open.
    func requestDismiss() {
        OrionLog.write("[notch] dismiss requested — hasInput=\(state.turnHasUserInput) phase=\(state.phase)")
        send(.dismissRequested(hasSpeech: state.turnHasUserInput, phase: NotchTurnPhase(state.phase)))
    }

    /// Something else took over the turn (the dashboard opened): drop the pill but leave the turn running.
    func dismissWithoutCancelling() {
        guard isShowing else { return }
        OrionLog.write("[notch] pill dropped — another surface took over; the turn keeps running")
        previewTimer?.cancel()
        previewTimer = nil
        model.pill = NotchPillState()
        retractWindow()
        onPillVisibilityChanged?()
    }

    /// Esc while docked: the same as the x.
    func cancel() { send(.cancelRequested) }

    // MARK: Machine

    private func send(_ event: NotchPillEvent) {
        let (next, effects) = NotchPillState.reduce(model.pill, event)
        let wasShowing = isShowing
        model.pill = next
        effects.forEach(run)
        if wasShowing != isShowing { onPillVisibilityChanged?() }
    }

    private func run(_ effect: NotchPillEffect) {
        switch effect {
        case .dismissPanel:
            OrionLog.write("[notch] panel dismissed — nothing in flight to dock")
            panelController.hide()
            onPanelVisibilityChanged?()
        case .dockPanel:
            OrionLog.write("[notch] docked — turn in flight, pill shown")
            dock()
        case let .reopenPanel(answer):
            OrionLog.write("[notch] pill clicked — panel reopened (\(answer.count) chars of answer)")
            state.dockedAnswer = answer.isEmpty ? nil : answer
            retractWindow()
            panelController.show()
            onPanelVisibilityChanged?()
        case .cancelTurn:
            OrionLog.write("[notch] cancelled from the pill (x, swipe up or Esc)")
            state.bargeIn()
        case .retract:
            OrionLog.write("[notch] pill retracted")
            retractWindow()
        case let .schedulePreviewEnd(seconds):
            previewTimer?.cancel()
            let item = DispatchWorkItem { [weak self] in self?.send(.previewElapsed) }
            previewTimer = item
            DispatchQueue.main.asyncAfter(deadline: .now() + seconds, execute: item)
        case .cancelPreviewTimer:
            previewTimer?.cancel()
            previewTimer = nil
        }
    }

    // MARK: Window

    private func dock() {
        let orbPanel = panelController.panel
        let screen = orbPanel?.screen ?? NSScreen.main ?? NSScreen.screens.first
        guard let screen else { return }
        let metrics = NotchScreenMetrics(screen: screen)
        model.metrics = metrics
        model.docked = false
        if let frame = orbPanel?.frame {
            let orbCentre = CGPoint(x: frame.midX, y: frame.minY + 100 + (frame.height - 100) / 2)
            model.flyOffset = NotchGeometry.flyOffset(from: orbCentre, metrics: metrics)
        } else {
            model.flyOffset = .zero
        }
        let window = self.window ?? makeWindow()
        self.window = window
        window.setFrame(NotchGeometry.hostFrame(metrics), display: false)
        window.alphaValue = 1
        window.orderFrontRegardless()
        panelController.hide()
        onPanelVisibilityChanged?()
        // One run-loop turn later so the spring has a start frame to leave.
        DispatchQueue.main.async { [weak self] in self?.model.docked = true }
        // The answer may already be there if he clicked away mid-sentence.
        send(.answerChanged(Self.answer(in: state.turns)))
    }

    private func retractWindow() {
        model.docked = false
        guard let window else { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self, weak window] in
            guard let self, !self.isShowing, !self.model.docked else { return }
            window?.orderOut(nil)
        }
    }

    private func makeWindow() -> NotchPillPanel {
        let panel = NotchPillPanel(contentRect: .zero, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false
        // Above the menu bar, so on a notched screen the pill can sit in the band beside the notch.
        panel.level = NSWindow.Level(rawValue: NSWindow.Level.mainMenu.rawValue + 1)
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .ignoresCycle]
        panel.animationBehavior = .none
        panel.hidesOnDeactivate = false
        panel.isFloatingPanel = true
        let hosting = NotchHostingView(rootView: NotchPillHost(model: model, hologram: state))
        hosting.pillRect = { [weak self] in
            guard let self else { return .zero }
            let host = NotchGeometry.hostFrame(self.model.metrics)
            let pill = NotchGeometry.pillFrame(self.model.metrics, size: self.model.pill.size)
            return CGRect(x: pill.minX - host.minX, y: host.maxY - pill.maxY, width: pill.width, height: pill.height)
        }
        hosting.onHover = { [weak self] inside in self?.send(.hoverChanged(inside)) }
        hosting.onSwipeUp = { [weak self] in self?.send(.cancelRequested) }
        panel.contentView = hosting
        return panel
    }

    // MARK: Words

    /// ORION's reply to the latest thing he said, or empty if there is none yet.
    static func answer(in turns: [Turn]) -> String {
        guard let lastYou = turns.lastIndex(where: { $0.role == .you }) else { return "" }
        return turns[(lastYou + 1)...].last(where: { $0.role == .orion })?.text ?? ""
    }
}
