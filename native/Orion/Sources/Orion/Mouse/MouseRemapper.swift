import AppKit
import CoreGraphics
import Foundation
import MouseKit

/*
 The event tap for extra mouse buttons and the mouse wheel. It listens to otherMouseDown/otherMouseUp and scrollWheel ONLY: never mouse-move, left or right.
 The callback does no file IO and no allocation-heavy work: bindings and the frontmost-app facts are cached in a
 lock-protected snapshot that the main thread refreshes (on file change, on app activation). A mapped down is swallowed
 and its action is dispatched to the main queue; the matching up is swallowed too, so the app never sees half a click.
 A press that resolved to pass-through (a game, a pass-through app, no binding) is passed on untouched, as is its up.
 Wheel events: when the cached decision says reverse, a discrete mouse-wheel event (not continuous, no scroll or momentum phase) has its
 delta fields negated in place; trackpad and Magic Mouse scrolls are never touched. The decision is one cached Bool: no IO, no allocation.
 */
final class MouseRemapper {
    struct Snapshot {
        var bindings = BindingsFile()
        var bundleId: String?
        var isGame = false
        /// A game session is running: nothing is remapped, in any app.
        var gameSession = false
    }

    var onAction: ((MouseAction, Int) -> Void)?
    /// Called on the main queue for every extra-button press, mapped or not (the "press it to identify" flow).
    var onObserved: ((Int) -> Void)?

    private var tap: CFMachPort?
    private var source: CFRunLoopSource?
    private let lock = NSLock()
    private var snapshot = Snapshot()
    private var wheel = WheelState()
    private var wheelInvert = false
    /// Buttons whose down was swallowed, so the up is too. Touched only inside the callback (one thread).
    private var swallowed = SwallowTracker()

    var isRunning: Bool { tap != nil }

    func update(_ change: (Snapshot) -> Snapshot) {
        lock.lock(); snapshot = change(snapshot); lock.unlock()
    }

    /// The wheel facts (mode, natural scrolling, game session); the callback only reads the resulting decision.
    func updateWheel(_ change: (WheelState) -> WheelState) {
        lock.lock(); wheel = change(wheel); wheelInvert = wheel.invert; lock.unlock()
    }

    private func shouldInvertWheel() -> Bool {
        lock.lock(); defer { lock.unlock() }
        return wheelInvert
    }

    private func current() -> Snapshot {
        lock.lock(); defer { lock.unlock() }
        return snapshot
    }

    /// False when Accessibility is not granted (or the tap could not be made): nothing is installed, nothing crashes.
    @discardableResult
    func start() -> Bool {
        guard tap == nil else { return true }
        swallowed.reset()
        guard Permissions.accessibilityTrusted else { return false }
        let mask = (CGEventMask(1) << CGEventType.otherMouseDown.rawValue) | (CGEventMask(1) << CGEventType.otherMouseUp.rawValue)
            | (CGEventMask(1) << CGEventType.scrollWheel.rawValue)
        let context = Unmanaged.passUnretained(self).toOpaque()
        guard let tap = CGEvent.tapCreate(tap: .cgSessionEventTap, place: .headInsertEventTap, options: .defaultTap,
                                          eventsOfInterest: mask, callback: { _, type, event, refcon in
            guard let refcon else { return Unmanaged.passUnretained(event) }
            return Unmanaged<MouseRemapper>.fromOpaque(refcon).takeUnretainedValue().handle(type, event)
        }, userInfo: context) else {
            OrionLog.write("[mouse] could not create the event tap")
            return false
        }
        let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
        CFRunLoopAddSource(CFRunLoopGetMain(), source, .commonModes)
        CGEvent.tapEnable(tap: tap, enable: true)
        self.tap = tap
        self.source = source
        return true
    }

    func stop() {
        if let tap { CGEvent.tapEnable(tap: tap, enable: false) }
        if let source { CFRunLoopRemoveSource(CFRunLoopGetMain(), source, .commonModes) }
        if let tap { CFMachPortInvalidate(tap) }
        tap = nil; source = nil; swallowed.reset()
    }

    private func handle(_ type: CGEventType, _ event: CGEvent) -> Unmanaged<CGEvent>? {
        if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
            // Downs swallowed before the stall have no matching up bookkeeping any more: start clean.
            swallowed.reset()
            if let tap { CGEvent.tapEnable(tap: tap, enable: true) }
            return Unmanaged.passUnretained(event)
        }
        if type == .scrollWheel { return reverseWheel(event) }
        let button = Int(event.getIntegerValueField(.mouseEventButtonNumber))
        guard button >= 3 else { return Unmanaged.passUnretained(event) }
        if type == .otherMouseUp {
            return swallowed.shouldSwallowUp(button) ? nil : Unmanaged.passUnretained(event)
        }
        guard type == .otherMouseDown else { return Unmanaged.passUnretained(event) }
        let snap = current()
        let action = MouseResolver.resolve(button: button, bundleId: snap.bundleId, isGame: snap.isGame, bindings: snap.bindings, gameSession: snap.gameSession)
        DispatchQueue.main.async { [weak self] in self?.onObserved?(button) }
        guard let action else { swallowed.passDown(button); return Unmanaged.passUnretained(event) }
        swallowed.swallowDown(button)
        DispatchQueue.main.async { [weak self] in self?.onAction?(action, button) }
        return nil
    }

    /// Negates a discrete mouse-wheel event in place. Cheapest checks first; anything continuous or phased is a trackpad.
    private func reverseWheel(_ event: CGEvent) -> Unmanaged<CGEvent>? {
        guard shouldInvertWheel(),
              ScrollWheelPolicy.isDiscreteWheel(isContinuous: event.getIntegerValueField(.scrollWheelEventIsContinuous),
                                                scrollPhase: event.getIntegerValueField(.scrollWheelEventScrollPhase),
                                                momentumPhase: event.getIntegerValueField(.scrollWheelEventMomentumPhase))
        else { return Unmanaged.passUnretained(event) }
        let flipped = ScrollDeltas(delta1: event.getIntegerValueField(.scrollWheelEventDeltaAxis1),
                                   delta2: event.getIntegerValueField(.scrollWheelEventDeltaAxis2),
                                   pointDelta1: event.getIntegerValueField(.scrollWheelEventPointDeltaAxis1),
                                   pointDelta2: event.getIntegerValueField(.scrollWheelEventPointDeltaAxis2),
                                   fixed1: event.getDoubleValueField(.scrollWheelEventFixedPtDeltaAxis1),
                                   fixed2: event.getDoubleValueField(.scrollWheelEventFixedPtDeltaAxis2)).negated()
        event.setIntegerValueField(.scrollWheelEventDeltaAxis1, value: flipped.delta1)
        event.setIntegerValueField(.scrollWheelEventDeltaAxis2, value: flipped.delta2)
        event.setIntegerValueField(.scrollWheelEventPointDeltaAxis1, value: flipped.pointDelta1)
        event.setIntegerValueField(.scrollWheelEventPointDeltaAxis2, value: flipped.pointDelta2)
        event.setDoubleValueField(.scrollWheelEventFixedPtDeltaAxis1, value: flipped.fixed1)
        event.setDoubleValueField(.scrollWheelEventFixedPtDeltaAxis2, value: flipped.fixed2)
        return Unmanaged.passUnretained(event)
    }
}
