import AppKit
import Foundation

/*
 Global push-to-talk on Right Option, and on Left Option held alone (6 Oct 2026).

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
    static let leftOptionKeyCode: UInt16 = 58
    /// Left Option is half of every ⌥-shortcut, so it only counts as
    /// push-to-talk when held on its own this long with no other key pressed
    /// (6 Oct 2026: "while pressing option can we make that push to talk").
    static let leftOptionHold: TimeInterval = 0.3
    static let escapeKeyCode: UInt16 = 53

    var onPressed: (() -> Void)?
    var onReleased: (() -> Void)?
    var onEscape: (() -> Void)?

    private var globalFlagsMonitor: Any?
    private var localFlagsMonitor: Any?
    private var globalEscapeMonitor: Any?
    private var isHeld = false
    /// Which Option key started the current hold, so the other one cannot end it.
    private var heldKeyCode: UInt16?
    private var leftPending: DispatchWorkItem?
    /// Installed only while Left Option is down, to spot a ⌥-shortcut.
    private var shortcutWatch: Any?
    private var localShortcutWatch: Any?

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
        cancelLeftPending()
        isHeld = false
        heldKeyCode = nil
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
        if event.keyCode == PushToTalkMonitor.leftOptionKeyCode {
            handleLeftOption(event)
            return
        }
        guard event.keyCode == PushToTalkMonitor.rightOptionKeyCode else { return }
        let down = event.modifierFlags.contains(.option)
        if heldKeyCode == PushToTalkMonitor.leftOptionKeyCode { return }

        // Monitors can double-report when Orion is frontmost (the local and
        // global monitor both fire), so transitions are edge-triggered.
        if down {
            guard !isHeld else { return }
            isHeld = true
            heldKeyCode = PushToTalkMonitor.rightOptionKeyCode
            onPressed?()
        } else {
            guard isHeld else { return }
            isHeld = false
            heldKeyCode = nil
            onReleased?()
        }
    }

    // MARK: Left Option — hold alone, then talk

    private func handleLeftOption(_ event: NSEvent) {
        let flags = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
        let down = flags.contains(.option)
        if down {
            // ⌥ with ⌘/⌃/⇧ already held is a shortcut, never a turn.
            guard !isHeld, leftPending == nil,
                  flags.isDisjoint(with: [.command, .control, .shift]) else { return }
            watchForShortcut()
            let pending = DispatchWorkItem { [weak self] in
                guard let self, self.leftPending != nil else { return }
                self.leftPending = nil
                self.isHeld = true
                self.heldKeyCode = PushToTalkMonitor.leftOptionKeyCode
                self.onPressed?()
            }
            leftPending = pending
            DispatchQueue.main.asyncAfter(deadline: .now() + PushToTalkMonitor.leftOptionHold, execute: pending)
        } else {
            let wasHeld = isHeld && heldKeyCode == PushToTalkMonitor.leftOptionKeyCode
            cancelLeftPending()
            guard wasHeld else { return }
            isHeld = false
            heldKeyCode = nil
            onReleased?()
        }
    }

    /// Any key or another modifier while Left Option waits means a shortcut.
    private func watchForShortcut() {
        let cancel: (NSEvent) -> Void = { [weak self] event in
            guard let self, self.leftPending != nil else { return }
            if event.type == .keyDown || event.keyCode != PushToTalkMonitor.leftOptionKeyCode {
                self.cancelLeftPending()
            }
        }
        shortcutWatch = NSEvent.addGlobalMonitorForEvents(matching: [.keyDown, .flagsChanged], handler: cancel)
        localShortcutWatch = NSEvent.addLocalMonitorForEvents(matching: [.keyDown, .flagsChanged]) { event in
            cancel(event); return event
        }
    }

    private func cancelLeftPending() {
        leftPending?.cancel()
        leftPending = nil
        if let monitor = shortcutWatch { NSEvent.removeMonitor(monitor) }
        if let monitor = localShortcutWatch { NSEvent.removeMonitor(monitor) }
        shortcutWatch = nil
        localShortcutWatch = nil
    }
}
