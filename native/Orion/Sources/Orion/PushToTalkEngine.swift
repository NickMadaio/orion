import AppKit
import Foundation

/// One keyboard event, reduced to what push-to-talk needs, so the rules below
/// run without an `NSEvent`.
struct PTTEvent: Equatable {
    enum Kind: Hashable { case flagsChanged, keyDown, keyUp, mouseDown }

    var kind: Kind
    var keyCode: UInt16
    var flags: NSEvent.ModifierFlags = []
    var isRepeat = false
}

/// The pure state machine. It decides which events start and stop a turn; the
/// monitor only feeds it events and runs the timer it asks for.
struct PushToTalkEngine {

    enum Output: Equatable {
        case none
        case press
        case release
        /// Start a timer; call `pendingElapsed()` when it fires.
        case startPending(TimeInterval)
        case cancelPending
        /// A turn that already started turned out to be a shortcut (Option held
        /// a moment, then a letter or click). Drop it silently, no result.
        case cancelTurn
    }

    /// How long after a turn starts a key or click still means "that was a
    /// shortcut, not speech".
    static let graceWindow: TimeInterval = 0.4

    private(set) var config: PushToTalkConfig
    private(set) var isHeld = false
    private(set) var isPending = false
    /// True for `graceWindow` after a modifier-only turn starts.
    private(set) var inGrace = false
    /// The key that started the current hold, so a different one cannot end it.
    private var activeKeyCode: UInt16?
    /// The previous flags event, so the global and local monitors reporting the
    /// same transition (Orion frontmost) cannot read as press then release.
    private var lastFlags: PTTEvent?

    private static let allModifiers: NSEvent.ModifierFlags = [.command, .option, .control, .shift, .function]

    init(config: PushToTalkConfig = .default) { self.config = config }

    /// Applies new settings. Anything in flight is ended so Orion never keeps
    /// listening for a key that no longer means anything.
    mutating func reconfigure(_ new: PushToTalkConfig) -> Output {
        let wasHeld = isHeld
        let wasPending = isPending
        config = new
        isHeld = false
        isPending = false
        inGrace = false
        activeKeyCode = nil
        lastFlags = nil
        if wasHeld { return .release }
        return wasPending ? .cancelPending : .none
    }

    mutating func handle(_ event: PTTEvent) -> Output {
        guard config.isActive, let binding = config.binding else { return .none }
        switch binding {
        case let .modifier(flag, keyCodes):
            return handleModifier(event, flag: flag, keyCodes: keyCodes)
        case let .key(keyCode, modifiers):
            return handleKey(event, keyCode: keyCode, modifiers: modifiers)
        }
    }

    /// The hold delay elapsed with the key still down and nothing else pressed.
    mutating func pendingElapsed() -> Output {
        guard isPending else { return .none }
        isPending = false
        isHeld = true
        inGrace = true
        return .press
    }

    /// The grace window closed; later keys and clicks are ordinary speech-time input.
    mutating func graceElapsed() { inGrace = false }

    // MARK: Modifier alone

    private mutating func handleModifier(_ event: PTTEvent, flag: NSEvent.ModifierFlags,
                                         keyCodes: [UInt16]) -> Output {
        // Any ordinary key while waiting means a shortcut such as Option+letter.
        if event.kind == .keyDown || event.kind == .mouseDown {
            if isHeld, inGrace {
                // Held past the delay, then a letter or click: a shortcut after all.
                isHeld = false
                inGrace = false
                return .cancelTurn
            }
            return cancelPendingIfNeeded()
        }
        guard event.kind == .flagsChanged else { return .none }
        if event == lastFlags { return .none }
        lastFlags = event

        if let active = activeKeyCode, event.keyCode == active {
            // A second flags event for the key that started this is its release,
            // even if the flag stays set because its twin is still down.
            return endHold()
        }
        guard keyCodes.contains(event.keyCode) else {
            // Another modifier joining while we wait means a shortcut.
            return cancelPendingIfNeeded()
        }
        guard event.flags.contains(flag), !isHeld, !isPending else { return .none }

        let others = event.flags.intersection(Self.allModifiers).subtracting(flag)
        guard others.isEmpty else { return .none }

        activeKeyCode = event.keyCode
        let delay = config.effectiveHoldDelay
        if delay > 0 {
            isPending = true
            return .startPending(delay)
        }
        isHeld = true
        inGrace = true
        return .press
    }

    private mutating func endHold() -> Output {
        activeKeyCode = nil
        inGrace = false
        if isHeld {
            isHeld = false
            return .release
        }
        if isPending {
            isPending = false
            return .cancelPending
        }
        return .none
    }

    private mutating func cancelPendingIfNeeded() -> Output {
        guard isPending else { return .none }
        isPending = false
        activeKeyCode = nil
        return .cancelPending
    }

    // MARK: Key or combination

    private mutating func handleKey(_ event: PTTEvent, keyCode: UInt16,
                                    modifiers: NSEvent.ModifierFlags) -> Output {
        let toggle = config.effectiveMode == .toggle
        switch event.kind {
        case .keyDown:
            guard event.keyCode == keyCode, !event.isRepeat,
                  event.flags.intersection(PTTCustomShortcut.shortcutMask) == modifiers else { return .none }
            if toggle {
                isHeld.toggle()
                return isHeld ? .press : .release
            }
            guard !isHeld else { return .none }
            isHeld = true
            return .press
        case .keyUp:
            guard !toggle, isHeld, event.keyCode == keyCode else { return .none }
            isHeld = false
            return .release
        case .mouseDown:
            return .none
        case .flagsChanged:
            // Letting go of the modifiers before the key ends a hold.
            guard !toggle, isHeld,
                  event.flags.intersection(PTTCustomShortcut.shortcutMask) != modifiers else { return .none }
            isHeld = false
            return .release
        }
    }
}
