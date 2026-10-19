import AppKit
import Foundation

/*
 Global push-to-talk. Which key it listens for, and whether it listens at all,
 comes from `PushToTalkConfig`; the rules that turn key events into turns live
 in `PushToTalkEngine`, which has no AppKit state and is unit tested.

 This class owns the monitors. When push-to-talk is off it installs none of the
 key monitors, so no Option-key (or any other key) events reach Orion for it.
 A local Escape handler remains so Escape still dismisses Orion's own windows;
 it only sees keystrokes typed into Orion, never other apps.

 A global monitor sees keys while another app is frontmost, but never while
 Orion itself is focused; a local monitor covers that gap, and the engine is
 edge-triggered so the overlap cannot double-fire. Global monitors need
 Accessibility permission, without which macOS never calls us.
 */

/// Where key events come from. The live implementation wraps `NSEvent`; tests
/// substitute a fake and count what was installed.
protocol PTTEventSource: AnyObject {
    func addGlobal(_ kinds: Set<PTTEvent.Kind>, handler: @escaping (PTTEvent) -> Void) -> Any?
    /// The handler returns true to swallow the event.
    func addLocal(_ kinds: Set<PTTEvent.Kind>, handler: @escaping (PTTEvent) -> Bool) -> Any?
    func remove(_ token: Any)
}

final class LivePTTEventSource: PTTEventSource {

    private static func mask(_ kinds: Set<PTTEvent.Kind>) -> NSEvent.EventTypeMask {
        var mask: NSEvent.EventTypeMask = []
        if kinds.contains(.flagsChanged) { mask.insert(.flagsChanged) }
        if kinds.contains(.keyDown) { mask.insert(.keyDown) }
        if kinds.contains(.keyUp) { mask.insert(.keyUp) }
        return mask
    }

    private static func convert(_ event: NSEvent) -> PTTEvent? {
        let flags = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
        switch event.type {
        case .flagsChanged: return PTTEvent(kind: .flagsChanged, keyCode: event.keyCode, flags: flags)
        case .keyDown: return PTTEvent(kind: .keyDown, keyCode: event.keyCode, flags: flags, isRepeat: event.isARepeat)
        case .keyUp: return PTTEvent(kind: .keyUp, keyCode: event.keyCode, flags: flags)
        default: return nil
        }
    }

    func addGlobal(_ kinds: Set<PTTEvent.Kind>, handler: @escaping (PTTEvent) -> Void) -> Any? {
        NSEvent.addGlobalMonitorForEvents(matching: Self.mask(kinds)) { event in
            if let converted = Self.convert(event) { handler(converted) }
        }
    }

    func addLocal(_ kinds: Set<PTTEvent.Kind>, handler: @escaping (PTTEvent) -> Bool) -> Any? {
        NSEvent.addLocalMonitorForEvents(matching: Self.mask(kinds)) { event in
            guard let converted = Self.convert(event) else { return event }
            return handler(converted) ? nil : event
        }
    }

    func remove(_ token: Any) { NSEvent.removeMonitor(token) }
}

final class PushToTalkMonitor {

    static let escapeKeyCode: UInt16 = 53

    var onPressed: (() -> Void)?
    var onReleased: (() -> Void)?
    var onEscape: (() -> Void)?

    private let source: PTTEventSource
    private let schedule: (TimeInterval, @escaping () -> Void) -> () -> Void

    private var engine = PushToTalkEngine(config: .default)
    private var keyTokens: [Any] = []
    private var watchTokens: [Any] = []
    private var localEscapeToken: Any?
    private var globalEscapeToken: Any?
    private var cancelTimer: (() -> Void)?

    /// True only while the key monitors are installed.
    var isRunning: Bool { !keyTokens.isEmpty }

    /// `schedule` runs a closure after a delay and returns a cancel function.
    init(source: PTTEventSource = LivePTTEventSource(),
         schedule: @escaping (TimeInterval, @escaping () -> Void) -> () -> Void = PushToTalkMonitor.dispatchSchedule) {
        self.source = source
        self.schedule = schedule
    }

    static let dispatchSchedule: (TimeInterval, @escaping () -> Void) -> () -> Void = { delay, work in
        let item = DispatchWorkItem(block: work)
        DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: item)
        return { item.cancel() }
    }

    /// Applies settings live: tears down whatever was installed, then installs
    /// only what the new configuration needs. Disabled installs nothing.
    func apply(_ config: PushToTalkConfig) {
        let output = engine.reconfigure(config)
        removeKeyMonitors()
        dispatch(output)
        installLocalEscape()

        guard config.isActive, let binding = config.binding else { return }

        var kinds: Set<PTTEvent.Kind> = [.flagsChanged]
        if !binding.isModifierOnly { kinds.formUnion([.keyDown, .keyUp]) }

        if let token = source.addGlobal(kinds, handler: { [weak self] in self?.feed($0) }) {
            keyTokens.append(token)
        }
        if let token = source.addLocal(kinds, handler: { [weak self] event in
            self?.feed(event)
            return false
        }) {
            keyTokens.append(token)
        }
    }

    func stop() {
        dispatch(engine.reconfigure(PushToTalkConfig(enabled: false)))
        removeKeyMonitors()
        if let token = localEscapeToken { source.remove(token) }
        localEscapeToken = nil
        setGlobalEscapeWatch(false)
    }

    /// Only installed while Orion has something to dismiss, so the app is not
    /// watching every keystroke on the machine for the sake of one key.
    func setGlobalEscapeWatch(_ enabled: Bool) {
        if enabled {
            guard globalEscapeToken == nil else { return }
            globalEscapeToken = source.addGlobal([.keyDown]) { [weak self] event in
                guard event.keyCode == PushToTalkMonitor.escapeKeyCode else { return }
                self?.onEscape?()
            }
        } else {
            if let token = globalEscapeToken { source.remove(token) }
            globalEscapeToken = nil
        }
    }

    // MARK: Internals

    private func installLocalEscape() {
        guard localEscapeToken == nil else { return }
        localEscapeToken = source.addLocal([.keyDown]) { [weak self] event in
            guard event.keyCode == PushToTalkMonitor.escapeKeyCode else { return false }
            self?.onEscape?()
            return true
        }
    }

    private func feed(_ event: PTTEvent) {
        dispatch(engine.handle(event))
    }

    private func dispatch(_ output: PushToTalkEngine.Output) {
        switch output {
        case .none:
            break
        case .press:
            endPending()
            onPressed?()
        case .release:
            endPending()
            onReleased?()
        case .startPending(let delay):
            watchForShortcut()
            cancelTimer = schedule(delay) { [weak self] in
                guard let self else { return }
                self.cancelTimer = nil
                self.dispatch(self.engine.pendingElapsed())
            }
        case .cancelPending:
            endPending()
        }
    }

    /// Listens for ordinary keys only while a hold is pending, to spot Option+letter.
    private func watchForShortcut() {
        guard watchTokens.isEmpty else { return }
        if let token = source.addGlobal([.keyDown], handler: { [weak self] in self?.feed($0) }) {
            watchTokens.append(token)
        }
        if let token = source.addLocal([.keyDown], handler: { [weak self] event in
            self?.feed(event)
            return false
        }) {
            watchTokens.append(token)
        }
    }

    private func endPending() {
        cancelTimer?()
        cancelTimer = nil
        watchTokens.forEach(source.remove)
        watchTokens = []
    }

    private func removeKeyMonitors() {
        endPending()
        keyTokens.forEach(source.remove)
        keyTokens = []
    }
}
