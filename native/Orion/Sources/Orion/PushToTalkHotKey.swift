import AppKit
import Carbon.HIToolbox

/*
 Carbon hot keys for push-to-talk combos and function keys.

 `RegisterEventHotKey` delivers both press and release for one exact key
 combination, and it needs no Accessibility permission and no keystroke monitor:
 Orion is told about that combination and nothing else. That is why combos and
 F-keys use it instead of a global keyDown/keyUp monitor, which would have
 observed every key typed in every app. The side effect is that the combination
 is consumed rather than passed to the frontmost app, which is what a
 push-to-talk key should do anyway.

 If registration fails (another app owns the combination) the monitor falls
 back to the narrow NSEvent key monitors, so the key still works.
 */
final class CarbonPTTHotKeys {

    private struct Entry { let onPressed: () -> Void; let onReleased: () -> Void }

    private static var entries: [UInt32: Entry] = [:]
    private static var nextID: UInt32 = 1
    private static var handlerInstalled = false

    private var token: (ref: EventHotKeyRef, id: UInt32)?

    /// Registers one combination. Returns false when macOS refuses it.
    func register(keyCode: UInt16, modifiers: NSEvent.ModifierFlags,
                  onPressed: @escaping () -> Void, onReleased: @escaping () -> Void) -> Bool {
        unregister()
        Self.installHandlerIfNeeded()
        let id = Self.nextID
        Self.nextID += 1
        var ref: EventHotKeyRef?
        let status = RegisterEventHotKey(UInt32(keyCode), Self.carbonModifiers(modifiers),
                                         EventHotKeyID(signature: OSType(0x4F52_5054), id: id),  // 'ORPT'
                                         GetEventDispatcherTarget(), 0, &ref)
        guard status == noErr, let ref else { return false }
        Self.entries[id] = Entry(onPressed: onPressed, onReleased: onReleased)
        token = (ref, id)
        return true
    }

    func unregister() {
        guard let token else { return }
        UnregisterEventHotKey(token.ref)
        Self.entries[token.id] = nil
        self.token = nil
    }

    deinit { unregister() }

    static func carbonModifiers(_ flags: NSEvent.ModifierFlags) -> UInt32 {
        var out: UInt32 = 0
        if flags.contains(.command) { out |= UInt32(cmdKey) }
        if flags.contains(.option) { out |= UInt32(optionKey) }
        if flags.contains(.control) { out |= UInt32(controlKey) }
        if flags.contains(.shift) { out |= UInt32(shiftKey) }
        return out
    }

    private static func installHandlerIfNeeded() {
        guard !handlerInstalled else { return }
        handlerInstalled = true
        var specs = [
            EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed)),
            EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyReleased))
        ]
        InstallEventHandler(GetEventDispatcherTarget(), { _, event, _ -> OSStatus in
            guard let event else { return OSStatus(eventNotHandledErr) }
            var id = EventHotKeyID()
            let status = GetEventParameter(event, EventParamName(kEventParamDirectObject),
                                           EventParamType(typeEventHotKeyID), nil,
                                           MemoryLayout<EventHotKeyID>.size, nil, &id)
            guard status == noErr else { return status }
            let pressed = GetEventKind(event) == UInt32(kEventHotKeyPressed)
            DispatchQueue.main.async {
                guard let entry = CarbonPTTHotKeys.entries[id.id] else { return }
                pressed ? entry.onPressed() : entry.onReleased()
            }
            return noErr
        }, specs.count, &specs, nil, nil)
    }
}
