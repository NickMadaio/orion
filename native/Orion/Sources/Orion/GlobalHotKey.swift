//
//  ⌥Tab, registered with Carbon, on purpose.
//
//  `NSEvent.addGlobalMonitorForEvents` is the obvious way to do this and it is
//  the wrong one. A global monitor is PASSIVE: it observes the event and cannot
//  consume it. So the Console would open AND the keystroke would go through to
//  whatever was frontmost — ⌥Tab typed into the sentence Nick was writing, every
//  single time he summoned it. A monitor also needs Accessibility, which this
//  does not.
//
//  `RegisterEventHotKey` is the API that actually claims a key combination
//  system-wide. It is old Carbon, and it is also what every serious launcher on
//  the platform uses, because it is the only thing macOS provides that consumes
//  the event.
//
//  Registration can FAIL, and the failure is the interesting case: another app
//  may already own the combination, and macOS will simply give the other app the
//  key with no error dialog anywhere. So the result is checked, reported, and
//  surfaced — a hotkey that silently does nothing is worse than one that was
//  never offered, because Nick would assume Orion was broken rather than that
//  the shortcut was taken.
//

import AppKit
import Carbon.HIToolbox

/// One system-wide key combination.
struct HotKeyCombination: Equatable, Codable {
    /// Virtual key code. `kVK_Tab` is 48.
    var keyCode: UInt32
    /// Carbon modifier mask — `optionKey`, `cmdKey`, `controlKey`, `shiftKey`.
    var modifiers: UInt32

    /// ⌥Tab, the default. Rebindable, because Nick was explicitly unsure
    /// ("⌥Tab or something"), which makes a recorder and conflict detection
    /// requirements rather than polish.
    static let optionTab = HotKeyCombination(keyCode: UInt32(kVK_Tab),
                                             modifiers: UInt32(optionKey))

    var describedForHumans: String {
        var parts: [String] = []
        if modifiers & UInt32(controlKey) != 0 { parts.append("⌃") }
        if modifiers & UInt32(optionKey) != 0 { parts.append("⌥") }
        if modifiers & UInt32(shiftKey) != 0 { parts.append("⇧") }
        if modifiers & UInt32(cmdKey) != 0 { parts.append("⌘") }
        parts.append(Self.keyName(keyCode))
        return parts.joined()
    }

    static func keyName(_ code: UInt32) -> String {
        switch Int(code) {
        case kVK_Tab: return "Tab"
        case kVK_Space: return "Space"
        case kVK_Escape: return "Esc"
        case kVK_Return: return "Return"
        default: return "key \(code)"
        }
    }
}

final class GlobalHotKey {

    enum Registration: Equatable {
        case registered(HotKeyCombination)

        /// Something else already owns it. macOS gives the other app the key and
        /// says nothing, so this has to be shown.
        case taken(HotKeyCombination)

        /// Carbon refused for another reason, with its status code.
        case failed(HotKeyCombination, OSStatus)

        var isRegistered: Bool {
            if case .registered = self { return true }
            return false
        }

        /// What to put in front of Nick. Never silence.
        var disclosure: String? {
            switch self {
            case .registered:
                return nil
            case .taken(let combination):
                return "\(combination.describedForHumans) is already taken by another app, "
                     + "so the Console cannot be opened with it. Pick a different shortcut."
            case .failed(let combination, let status):
                return "\(combination.describedForHumans) could not be registered "
                     + "(error \(status)). The Console can still be opened from the menu bar."
            }
        }
    }

    private var reference: EventHotKeyRef?
    private var handler: EventHandlerRef?
    private(set) var registration: Registration?

    /// Called on the main thread when the combination fires.
    var onFire: (() -> Void)?
    var onLog: ((String) -> Void)?

    /// Every live instance, keyed by the id Carbon hands back, so the C callback
    /// can find the right object.
    private static var instances: [UInt32: GlobalHotKey] = [:]
    private static var nextID: UInt32 = 1

    private let identifier: UInt32

    init() {
        identifier = Self.nextID
        Self.nextID += 1
    }

    deinit { unregister() }

    // MARK: Registering

    @discardableResult
    func register(_ combination: HotKeyCombination) -> Registration {
        unregister()

        installHandlerIfNeeded()

        var reference: EventHotKeyRef?
        let id = EventHotKeyID(signature: OSType(0x4F52_4E00), id: identifier)  // 'ORN\0'

        let status = RegisterEventHotKey(
            combination.keyCode, combination.modifiers, id,
            GetEventDispatcherTarget(), 0, &reference
        )

        let result: Registration
        if status == noErr, let reference {
            self.reference = reference
            Self.instances[identifier] = self
            result = .registered(combination)
        } else if status == OSStatus(eventHotKeyExistsErr) {
            // The case that must never be silent: another app owns it, macOS
            // routes the key there, and nothing anywhere reports it.
            result = .taken(combination)
        } else {
            result = .failed(combination, status)
        }

        registration = result
        if let disclosure = result.disclosure { onLog?("[console] \(disclosure)") }
        else { onLog?("[console] \(combination.describedForHumans) registered") }
        return result
    }

    func unregister() {
        if let reference { UnregisterEventHotKey(reference) }
        reference = nil
        Self.instances[identifier] = nil
        registration = nil
    }

    // MARK: The Carbon handler

    private static var handlerInstalled = false

    private func installHandlerIfNeeded() {
        guard !Self.handlerInstalled else { return }
        Self.handlerInstalled = true

        var spec = EventTypeSpec(eventClass: OSType(kEventClassKeyboard),
                                 eventKind: UInt32(kEventHotKeyPressed))

        InstallEventHandler(GetEventDispatcherTarget(), { _, event, _ -> OSStatus in
            var id = EventHotKeyID()
            let status = GetEventParameter(
                event, EventParamName(kEventParamDirectObject), EventParamType(typeEventHotKeyID),
                nil, MemoryLayout<EventHotKeyID>.size, nil, &id
            )
            guard status == noErr else { return status }

            // Straight to the main thread: everything it triggers is UI.
            DispatchQueue.main.async {
                GlobalHotKey.instances[id.id]?.onFire?()
            }
            return noErr
        }, 1, &spec, nil, nil)
    }
}
