import AppKit
import SwiftUI

/// The graph's AppKit side: trackpad and wheel input SwiftUI does not give a Canvas, plus whether the window can be
/// seen at all.
///
/// - Two-finger scroll pans. Pinch, ⌘-scroll and a plain mouse wheel zoom at the cursor.
/// - Window occlusion (hidden, minimised, fully covered) is reported so the graph's clock can stop.
///
/// It sits behind the Canvas and never takes a hit test, so clicks, drags and hover still reach SwiftUI. Scroll and
/// magnify arrive through a local event monitor filtered to this view's rect in its own window.
struct SkyEventCatcher: NSViewRepresentable {
    var onZoom: (CGFloat, CGPoint) -> Void
    var onPan: (CGSize) -> Void
    var onVisibility: (Bool) -> Void

    func makeNSView(context: Context) -> SkyCatcherView {
        let view = SkyCatcherView()
        update(view)
        return view
    }

    func updateNSView(_ view: SkyCatcherView, context: Context) { update(view) }

    private func update(_ view: SkyCatcherView) {
        view.onZoom = onZoom
        view.onPan = onPan
        view.onVisibility = onVisibility
    }

    static func dismantleNSView(_ view: SkyCatcherView, coordinator: ()) { view.stopListening() }
}

final class SkyCatcherView: NSView {
    var onZoom: ((CGFloat, CGPoint) -> Void)?
    var onPan: ((CGSize) -> Void)?
    var onVisibility: ((Bool) -> Void)?
    private var monitor: Any?
    private var occlusionObserver: NSObjectProtocol?

    override var isFlipped: Bool { true }
    override func hitTest(_ point: NSPoint) -> NSView? { nil }

    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        stopListening()
        guard let window else { return }
        monitor = NSEvent.addLocalMonitorForEvents(matching: [.scrollWheel, .magnify]) { [weak self] event in
            self?.handle(event) ?? event
        }
        occlusionObserver = NotificationCenter.default.addObserver(
            forName: NSWindow.didChangeOcclusionStateNotification, object: window, queue: .main
        ) { [weak self] _ in self?.reportVisibility() }
        reportVisibility()
    }

    func stopListening() {
        if let monitor { NSEvent.removeMonitor(monitor) }
        if let occlusionObserver { NotificationCenter.default.removeObserver(occlusionObserver) }
        monitor = nil
        occlusionObserver = nil
    }

    private func reportVisibility() {
        let seen = window.map { $0.occlusionState.contains(.visible) && $0.isVisible } ?? false
        onVisibility?(seen)
    }

    /// Returns nil when the event was the graph's (consumed), or the event untouched.
    private func handle(_ event: NSEvent) -> NSEvent? {
        guard let window, event.window === window, !isHiddenOrHasHiddenAncestor else { return event }
        let p = convert(event.locationInWindow, from: nil)
        guard bounds.contains(p) else { return event }
        switch event.type {
        case .magnify:
            onZoom?(1 + event.magnification, p)
        case .scrollWheel:
            let precise = event.hasPreciseScrollingDeltas
            if event.modifierFlags.contains(.command) || !precise {
                onZoom?(CGFloat(exp(Double(event.scrollingDeltaY) * (precise ? 0.01 : 0.06))), p)
            } else {
                onPan?(CGSize(width: event.scrollingDeltaX, height: event.scrollingDeltaY))
            }
        default:
            return event
        }
        return nil
    }
}
