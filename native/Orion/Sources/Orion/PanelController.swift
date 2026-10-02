import AppKit
import QuartzCore
import SwiftUI

/// A transparent, non-activating panel that holds nothing but the hologram.
///
/// Titled — with the titlebar made invisible and its buttons hidden — rather
/// than borderless. That is not cosmetic: borderless plus non-activating plus
/// refusing key status stacked up into a window AppKit would not deliver mouse
/// events to at all, so the orb could not be dragged or scrolled by any means.
/// A titled window with hidden chrome is the ordinary configuration for custom
/// window furniture, and it behaves.
///
/// **`canBecomeKey` must be true, and that is not a relaxation.**
///
/// It used to return `false`, reasoning that the panel has nothing to type into
/// so refusing focus outright was a stronger version of refusing to activate.
/// That conflated two separate things and broke every form of direct
/// manipulation: a window that can never become key does not get a mouse-drag
/// session, because AppKit runs drag tracking through the key window. `mouseDown`
/// arrived (thanks to `acceptsFirstMouse`), `mouseDragged` and `mouseUp` never
/// did. The orb could be clicked and could not be moved, and no amount of
/// handling events in the view was going to fix it — the events were not coming.
///
/// The property that actually matters — Orion arriving mid-sentence without
/// stealing the caret — is provided by two other things, both untouched:
/// `.nonactivatingPanel`, which means clicking this panel never activates the
/// owning app, and `orderFrontRegardless()`, which shows it without making it
/// key. Arriving still steals nothing. Clicking it now does what clicking a
/// window does, which is what was asked for.
///
/// `canBecomeMain` stays false: this is an accessory surface, never the app's
/// main window.
final class HologramPanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }

    /// Let it go anywhere, including over the menu bar.
    ///
    /// `NSWindow` constrains a **titled** window so its titlebar can never end
    /// up under the menu bar — sensible for a document window, since a titlebar
    /// you cannot reach is a window you cannot move. This window has no visible
    /// titlebar at all, so the rule protects nothing and instead stops the orb
    /// a titlebar's height short of the top of the screen.
    ///
    /// That constraint arrived as a side effect of making the panel titled to
    /// fix dragging; it was not a deliberate choice, and returning the frame
    /// untouched restores what a borderless panel did for free.
    ///
    /// Safe because the orb cannot become unreachable: it floats above the menu
    /// bar rather than behind it, Escape dismisses it from anywhere, and the
    /// menu bar item summons it back to a known corner.
    override func constrainFrameRect(_ frameRect: NSRect, to screen: NSScreen?) -> NSRect {
        frameRect
    }
}

/// Hosts the orb and decides what the mouse is allowed to touch.
///
/// The panel covers a square but only ever draws inside the disc inscribed in
/// it, so the corners are fully transparent and macOS routes clicks there
/// straight through to whatever is underneath. `hitTest` mirrors that same
/// shape, so the two can never disagree: inside the disc a press drags the orb,
/// outside it Orion is not there at all.
private final class OrbContainerView: NSView {

    /// Drag ended somewhere new — persist the position.
    var onMoved: (() -> Void)?
    /// Scrolled over the orb: a signed step to grow or shrink by.
    var onResize: ((CGFloat) -> Void)?
    /// Asked to go away.
    var onHide: (() -> Void)?

    /// Where the drag started, in screen coordinates, plus the window origin at
    /// that moment. Tracking both means the orb never jumps: the new origin is
    /// always `startOrigin + (now - startMouse)`, so accumulated rounding cannot
    /// drift the way a per-event delta does.
    private var dragStartMouse: NSPoint?
    private var dragStartOrigin: NSPoint?

    override func hitTest(_ point: NSPoint) -> NSView? {
        // `point` arrives in the superview's coordinates.
        let local = convert(point, from: superview)
        if local.y < 100 { return super.hitTest(point) }
        let radius = min(bounds.width, bounds.height - 100) / 2
        let dx = local.x - bounds.midX
        let dy = local.y - (100 + (bounds.height - 100) / 2)
        let inside = dx * dx + dy * dy <= radius * radius
        // Deliberately never descends into the hosting view: nothing in the
        // SwiftUI tree is interactive, and claiming the hit here is what makes
        // the press below a drag on the orb rather than a click on the desktop.
        return inside ? self : nil
    }

    /// A click on an inactive window is normally spent bringing it forward, and
    /// the second click is the one that does anything. Nobody wants to click an
    /// orb twice to start dragging it, so the first click counts.
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

    // MARK: Move
    //
    // Explicit rather than relying on `isMovableByWindowBackground`, so the
    // behaviour does not depend on what AppKit decides to do for a window in
    // this configuration.
    //
    // Worth recording why this took three attempts: these handlers were written
    // first and fixed nothing, because the window was borderless, non-activating
    // and refused key status, and a window like that is simply not sent mouse
    // events. Two rounds were spent improving code that was never called. What
    // settled it was logging whether `mouseDown` fired at all — the answer was
    // no, which pointed at the window rather than the handlers.

    override func mouseDown(with event: NSEvent) {
        guard let window else { return }
        dragStartMouse = NSEvent.mouseLocation
        dragStartOrigin = window.frame.origin
        OrionLog.write("[orb] mouseDown — drag armed at \(window.frame.origin)")
    }

    override func mouseDragged(with event: NSEvent) {
        guard let window,
              let startMouse = dragStartMouse,
              let startOrigin = dragStartOrigin else { return }
        let now = NSEvent.mouseLocation
        window.setFrameOrigin(NSPoint(
            x: startOrigin.x + (now.x - startMouse.x),
            y: startOrigin.y + (now.y - startMouse.y)
        ))
    }

    override func mouseUp(with event: NSEvent) {
        let moved = dragStartMouse != nil
        dragStartMouse = nil
        dragStartOrigin = nil
        if moved, let window {
            OrionLog.write("[orb] mouseUp — settled at \(window.frame.origin)")
        }
        onMoved?()
    }

    // MARK: Resize

    /// Scroll over the orb to resize it.
    ///
    /// Direct manipulation, because "resize it" means grabbing the thing and
    /// changing it, not opening Preferences and finding a slider. The slider
    /// still exists for precision; this is the one that will actually get used.
    override func scrollWheel(with event: NSEvent) {
        // Trackpads deliver many small precise deltas; a mouse wheel delivers
        // few large ones. Scaling them differently keeps the feel similar.
        let step = event.hasPreciseScrollingDeltas
            ? event.scrollingDeltaY * 0.7
            : event.scrollingDeltaY * 6
        guard abs(step) > 0.01 else { return }
        OrionLog.write("[orb] scroll — resize step \(String(format: "%.1f", step))")
        onResize?(step)
    }

    // MARK: Dismiss

    /// Right-click the orb to send it away.
    ///
    /// It needed a way out that is on the orb itself. Hiding it used to live
    /// only in the menu-bar menu, and Escape only worked while Orion happened to
    /// be speaking — so an idle orb sitting in the corner had, in practice, no
    /// close button at all.
    override func rightMouseDown(with event: NSEvent) {
        let menu = NSMenu()
        let hide = NSMenuItem(
            title: "Hide Orion",
            action: #selector(hideFromMenu),
            keyEquivalent: ""
        )
        hide.target = self
        menu.addItem(hide)
        menu.addItem(.separator())
        let hint = NSMenuItem(
            title: "Drag to move · scroll to resize",
            action: nil,
            keyEquivalent: ""
        )
        hint.isEnabled = false
        menu.addItem(hint)
        NSMenu.popUpContextMenu(menu, with: event, for: self)
    }

    @objc private func hideFromMenu() {
        onHide?()
    }
}

final class PanelController {

    private(set) var panel: HologramPanel?
    private let state: AppState

    /// The orb was resized by scrolling on it. The delegate mirrors this back
    /// into `AppState.orbSize`, so the Preferences slider and the orb never
    /// disagree about how big it is.
    var onSizeChangedByGesture: ((Double) -> Void)?
    /// Hidden from its own context menu; lets the menu-bar title stay honest.
    var onHiddenByGesture: (() -> Void)?

    // A new name rather than the old panel's: the saved frame from the version
    // with a transcript and a composer in it describes a window that no longer
    // exists, and restoring its size would be restoring the wrong idea.
    private static let frameAutosaveName = "OrionOrbPanel"

    /// Square, because the hologram is round and the corners are only there to
    /// be transparent. The edge length is a preference now, not a constant —
    /// see `SummonSettings.orbSize`.
    private static var currentSize: NSSize {
        let edge = CGFloat(SummonSettings.orbSize)
        return NSSize(width: max(280, edge), height: edge + 100)
    }

    /// Intent, not the window's own `isVisible`: hiding fades first and orders
    /// out afterwards, and callers need the answer immediately.
    private(set) var isVisible = false

    init(state: AppState) {
        self.state = state
        state.hideSummon = { [weak self] in self?.hide() }
    }

    // MARK: Build

    private func makePanel() -> HologramPanel {
        let panel = HologramPanel(
            contentRect: NSRect(origin: .zero, size: PanelController.currentSize),
            styleMask: [
                .titled, .closable, .resizable,
                .fullSizeContentView, .nonactivatingPanel,
            ],
            backing: .buffered,
            defer: false
        )
        // Hide every part of the titlebar while keeping the window titled, which
        // is what buys standard drag and resize behaviour.
        panel.titlebarAppearsTransparent = true
        panel.titleVisibility = .hidden
        panel.standardWindowButton(.closeButton)?.isHidden = true
        panel.standardWindowButton(.miniaturizeButton)?.isHidden = true
        panel.standardWindowButton(.zoomButton)?.isHidden = true
        panel.level = .floating
        panel.isOpaque = false
        panel.backgroundColor = .clear
        // No shadow. A window shadow is derived from the shape of what is drawn,
        // and a soft additive glow produces a grey smear around it that reads as
        // dirt on the screen rather than as light.
        panel.hasShadow = false
        panel.isFloatingPanel = true
        panel.hidesOnDeactivate = false
        // Key status is now possible, so say plainly when it may happen: only
        // when the user clicks the orb. `becomesKeyOnlyIfNeeded` stops AppKit
        // handing it key status merely for being ordered front, which is the
        // exact moment Orion must not interrupt what he is typing.
        panel.becomesKeyOnlyIfNeeded = true
        panel.isMovableByWindowBackground = true
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
        panel.animationBehavior = .none
        panel.alphaValue = 0

        let container = OrbContainerView(
            frame: NSRect(origin: .zero, size: PanelController.currentSize)
        )
        container.autoresizingMask = [.width, .height]
        container.onMoved = { [weak self] in
            guard let panel = self?.panel else { return }
            panel.saveFrame(usingName: PanelController.frameAutosaveName)
        }
        container.onResize = { [weak self] step in
            guard let self else { return }
            let next = SummonSettings.orbSize + Double(step)
            let clamped = min(SummonSettings.orbSizeRange.upperBound,
                              max(SummonSettings.orbSizeRange.lowerBound, next))
            guard clamped != SummonSettings.orbSize else { return }
            SummonSettings.orbSize = clamped
            self.applySize()
            self.onSizeChangedByGesture?(clamped)
        }
        container.onHide = { [weak self] in
            self?.hide()
            self?.onHiddenByGesture?()
        }

        let hosting = NSHostingView(rootView: PanelView(state: state))
        hosting.frame = container.bounds
        hosting.autoresizingMask = [.width, .height]
        container.addSubview(hosting)
        panel.contentView = container

        _ = panel.setFrameAutosaveName(PanelController.frameAutosaveName)
        if panel.setFrameUsingName(PanelController.frameAutosaveName) {
            // Position restored from where he dragged it; SIZE comes from the
            // preference, not from the saved frame. Those are two different
            // pieces of state and the preference is the one he set on purpose.
            // (This used to force a constant here, which is what made the orb
            // unresizable by any means at all.)
            panel.setContentSize(PanelController.currentSize)
        } else {
            moveToConfiguredCorner(panel)
        }
        return panel
    }

    /// The screen the user is actually looking at.
    ///
    /// Mouse position rather than `NSScreen.main`: on a multi-display Mac the
    /// "main" screen is the one with the menu bar, which is frequently not the
    /// one being worked on. Summoning Orion onto a different monitor than the
    /// one you are looking at reads as a bug even though it is documented
    /// behaviour. Falls back to main, then to whatever exists.
    private func activeScreen() -> NSScreen? {
        let mouse = NSEvent.mouseLocation
        return NSScreen.screens.first { NSMouseInRect(mouse, $0.frame, false) }
            ?? NSScreen.main
            ?? NSScreen.screens.first
    }

    /// Move the panel to the user's chosen corner on the active screen —
    /// top-right unless he has said otherwise.
    ///
    /// `visibleFrame` is already inset for the menu bar and the Dock, so a
    /// panel placed from it cannot land underneath either.
    private func moveToConfiguredCorner(_ panel: NSPanel) {
        guard let screen = activeScreen() else { return }
        let origin = SummonSettings.corner.origin(
            for: panel.frame.size,
            in: screen.visibleFrame
        )
        panel.setFrameOrigin(origin)
    }

    /// Summon: always arrive in the configured corner, on the active screen.
    ///
    /// Distinct from `show()` on purpose. `show()` honours wherever the panel
    /// was last dragged, because a position the user chose by hand should
    /// survive. A summon is Orion arriving unbidden — it belongs where the
    /// user said Orion should appear, not where it happened to be left.
    func summon() {
        let panel = self.panel ?? makePanel()
        self.panel = panel
        moveToConfiguredCorner(panel)
        show()
    }

    /// Resize in place, live.
    ///
    /// Anchored on the centre rather than the origin: a panel that grows from
    /// its bottom-left corner appears to lunge across the screen while you drag
    /// the slider, which makes it impossible to judge the size you are choosing.
    /// Growing about the centre keeps it where you are looking.
    ///
    /// The hit region needs no updating — `OrbContainerView.hitTest` computes
    /// its radius from `bounds` on every hit, so it follows automatically.
    func applySize() {
        guard let panel else { return }
        let target = PanelController.currentSize
        guard panel.frame.size != target else { return }
        // Anchor the top-left corner rather than the centre. Centre-anchoring
        // reads well for a slider, but while scrolling on the orb it slides the
        // artwork out from under the pointer, which feels like the orb is
        // running away from you. The top-left stays put, so it grows down and
        // right from where it is.
        let topLeft = NSPoint(x: panel.frame.minX, y: panel.frame.maxY)
        panel.setContentSize(target)
        panel.setFrameOrigin(NSPoint(x: topLeft.x, y: topLeft.y - target.height))
        // Keep it reachable, not tidy.
        //
        // This used to clamp to `visibleFrame`, which excludes the menu bar —
        // so resizing an orb he had deliberately dragged to the very top would
        // shove it back down, undoing the placement he chose. Clamped to the
        // full screen instead, and only enough to keep part of it on screen:
        // where he puts it is his business.
        if let screen = activeScreen() {
            var frame = panel.frame
            let bounds = screen.frame
            let margin: CGFloat = 40
            frame.origin.x = min(max(frame.minX, bounds.minX - frame.width + margin),
                                 bounds.maxX - margin)
            frame.origin.y = min(max(frame.minY, bounds.minY - frame.height + margin),
                                 bounds.maxY - margin)
            panel.setFrameOrigin(frame.origin)
        }
        panel.saveFrame(usingName: PanelController.frameAutosaveName)
    }

    // MARK: Show / hide

    /// Never takes focus, whoever asked.
    ///
    /// The old panel had a `makeKey` path for "show me" from the menu, because
    /// it contained the composer and an explicit request to show it was an
    /// implicit request to type. That request now opens the text window
    /// instead, so there is no longer any reason for the orb to activate Orion
    /// — and every reason for it not to.
    func show() {
        let panel = self.panel ?? makePanel()
        self.panel = panel
        isVisible = true

        // orderFrontRegardless shows the panel without any chance of stealing
        // focus, even when Orion is not the active app.
        panel.orderFrontRegardless()

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
