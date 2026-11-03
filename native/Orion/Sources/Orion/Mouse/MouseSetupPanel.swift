import AppKit
import SwiftUI

/// A key-capable floating panel: the shortcut and app fields need typing, but it never steals app activation.
private final class MouseSetupNSPanel: NSPanel {
    override var canBecomeKey: Bool { true }
}

/// Shows the setup popup beside ORION's bubble (or in the bottom-right corner when there is no bubble panel).
final class MouseSetupPanelController {
    private var panel: NSPanel?
    var isOpen: Bool { panel?.isVisible == true }

    func show(mouse: MouseController, beside anchor: NSRect?, onDone: @escaping () -> Void, onNotNow: @escaping () -> Void) {
        close()
        let host = NSHostingView(rootView: MouseSetupView(mouse: mouse, onDone: onDone, onNotNow: onNotNow))
        host.layer?.backgroundColor = .clear
        let size = host.fittingSize
        let panel = MouseSetupNSPanel(contentRect: NSRect(origin: .zero, size: size),
                                      styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        panel.contentView = host
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = true
        panel.level = .floating
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        panel.isReleasedWhenClosed = false
        panel.setFrameOrigin(Self.origin(for: size, anchor: anchor))
        panel.orderFrontRegardless()
        self.panel = panel
    }

    func close() {
        panel?.orderOut(nil)
        panel = nil
    }

    /// Left of the bubble when there is room, else right of it; bottom-aligned with it, and kept on screen.
    static func origin(for size: NSSize, anchor: NSRect?) -> NSPoint {
        let screen = NSScreen.screens.first { anchor.map($0.frame.intersects) ?? false } ?? NSScreen.main
        let bounds = screen?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        guard let anchor else { return NSPoint(x: bounds.maxX - size.width - 24, y: bounds.minY + 24) }
        let gap: CGFloat = 12
        var x = anchor.minX - gap - size.width
        if x < bounds.minX + 8 { x = anchor.maxX + gap }
        x = min(max(x, bounds.minX + 8), bounds.maxX - size.width - 8)
        let y = min(max(anchor.minY, bounds.minY + 8), bounds.maxY - size.height - 8)
        return NSPoint(x: x, y: y)
    }
}
