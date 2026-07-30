import AppKit
import Foundation

/*
 Global push-to-talk on Right Option.

 Right Option specifically, because left and right Option share the `.option`
 modifier flag — the only way to tell them apart from an `NSEvent` is the key
 code, which is 61 for the right-hand key (58 is the left). So: keyCode 61 AND
 the `.option` flag rising means "held", keyCode 61 with the flag cleared means
 "released".

 A global monitor sees the key while another app is frontmost, but never while
 Orion itself is focused; a local monitor covers exactly that gap. Both are
 needed, and the down/up state machine de-duplicates the overlap.

 The global monitor requires Accessibility permission. Without it macOS simply
 never calls us, which is why `AppState` checks `AXIsProcessTrusted` and says so
 instead of leaving the user pressing a dead key.
 */
final class PushToTalkMonitor {

    static let rightOptionKeyCode: UInt16 = 61
    static let escapeKeyCode: UInt16 = 53

    var onPressed: (() -> Void)?
    var onReleased: (() -> Void)?
    var onEscape: (() -> Void)?

    private var globalFlagsMonitor: Any?
    private var localFlagsMonitor: Any?
    private var globalEscapeMonitor: Any?
    private var isHeld = false

    var isRunning: Bool { globalFlagsMonitor != nil || localFlagsMonitor != nil }

    func start() {
        stop()

        globalFlagsMonitor = NSEvent.addGlobalMonitorForEvents(matching: [.flagsChanged]) { [weak self] event in
            self?.handleFlags(event)
        }

        localFlagsMonitor = NSEvent.addLocalMonitorForEvents(matching: [.flagsChanged, .keyDown]) { [weak self] event in
            guard let self else { return event }
            if event.type == .flagsChanged {
                self.handleFlags(event)
            } else if event.type == .keyDown, event.keyCode == PushToTalkMonitor.escapeKeyCode {
                self.onEscape?()
                return nil
            }
            return event
        }
    }

    func stop() {
        if let monitor = globalFlagsMonitor { NSEvent.removeMonitor(monitor) }
        if let monitor = localFlagsMonitor { NSEvent.removeMonitor(monitor) }
        globalFlagsMonitor = nil
        localFlagsMonitor = nil
        setGlobalEscapeWatch(false)
        isHeld = false
    }

    /// Only installed while Orion is speaking, so the app is not watching every
    /// keystroke on the machine for the sake of one barge-in key.
    func setGlobalEscapeWatch(_ enabled: Bool) {
        if enabled {
            guard globalEscapeMonitor == nil else { return }
            globalEscapeMonitor = NSEvent.addGlobalMonitorForEvents(matching: [.keyDown]) { [weak self] event in
                guard event.keyCode == PushToTalkMonitor.escapeKeyCode else { return }
                self?.onEscape?()
            }
        } else {
            if let monitor = globalEscapeMonitor { NSEvent.removeMonitor(monitor) }
            globalEscapeMonitor = nil
        }
    }

    private func handleFlags(_ event: NSEvent) {
        guard event.keyCode == PushToTalkMonitor.rightOptionKeyCode else { return }
        let down = event.modifierFlags.contains(.option)

        // Monitors can double-report when Orion is frontmost (the local and
        // global monitor both fire), so transitions are edge-triggered.
        if down {
            guard !isHeld else { return }
            isHeld = true
            onPressed?()
        } else {
            guard isHeld else { return }
            isHeld = false
            onReleased?()
        }
    }
}
