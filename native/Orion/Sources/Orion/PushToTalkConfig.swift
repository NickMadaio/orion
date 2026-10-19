import AppKit
import Carbon.HIToolbox
import Foundation

/*
 Push-to-talk settings: which key, how it behaves, and whether it exists at all.

 Everything here is a pure value so the matching rules can be tested without a
 keyboard. The default is the old behaviour, Right Option held to talk, plus a
 short hold delay so a tap of Option while typing never starts a turn.
 */

enum PTTMode: String, CaseIterable, Identifiable {
    case hold, toggle
    var id: String { rawValue }
    var label: String { self == .hold ? "Hold to talk" : "Press to start, press to stop" }
}

enum PTTKeyChoice: String, CaseIterable, Identifiable {
    case rightOption, rightCommand, rightControl, fn
    case f13, f14, f15, f16, f17, f18, f19
    case custom

    var id: String { rawValue }

    var label: String {
        switch self {
        case .rightOption: return "Right Option"
        case .rightCommand: return "Right Command"
        case .rightControl: return "Right Control"
        case .fn: return "Fn / Globe"
        case .custom: return "Custom shortcut"
        default: return rawValue.uppercased()
        }
    }

    /// F13 to F19 key codes. They are not contiguous.
    var functionKeyCode: UInt16? {
        switch self {
        case .f13: return 105
        case .f14: return 107
        case .f15: return 113
        case .f16: return 106
        case .f17: return 64
        case .f18: return 79
        case .f19: return 80
        default: return nil
        }
    }
}

/// What a choice listens for.
enum PTTBinding: Equatable {
    /// A modifier on its own. Either key code starts it (Right Option also
    /// accepts Left Option held alone, as it always has).
    case modifier(flag: NSEvent.ModifierFlags, keyCodes: [UInt16])
    /// A real key, with the exact modifiers that must be held.
    case key(keyCode: UInt16, modifiers: NSEvent.ModifierFlags)

    var isModifierOnly: Bool {
        if case .modifier = self { return true }
        return false
    }
}

/// A recorded modifier+key combination.
struct PTTCustomShortcut: Equatable {
    var keyCode: UInt16
    var modifiersRaw: UInt

    var modifiers: NSEvent.ModifierFlags { NSEvent.ModifierFlags(rawValue: modifiersRaw) }

    static let shortcutMask: NSEvent.ModifierFlags = [.command, .option, .control, .shift]
    private static let modifierKeyCodes: Set<UInt16> = [54, 55, 56, 57, 58, 59, 60, 61, 62, 63]

    enum Rejection: Error, Equatable {
        case modifierOnly, escape, needsModifier

        var message: String {
            switch self {
            case .modifierOnly: return "Press a key together with the modifiers."
            case .escape: return "Escape is reserved for stopping Orion."
            case .needsModifier: return "Include at least one of ⌘, ⌥ or ⌃."
            }
        }
    }

    /// Validates what the recorder saw. Shift alone is not enough: Shift+letter
    /// is just typing.
    static func make(keyCode: UInt16, flags: NSEvent.ModifierFlags) -> Result<PTTCustomShortcut, Rejection> {
        guard !modifierKeyCodes.contains(keyCode) else { return .failure(.modifierOnly) }
        guard keyCode != UInt16(kVK_Escape) else { return .failure(.escape) }
        let mods = flags.intersection(shortcutMask)
        guard !mods.isDisjoint(with: [.command, .option, .control]) else { return .failure(.needsModifier) }
        return .success(PTTCustomShortcut(keyCode: keyCode, modifiersRaw: mods.rawValue))
    }

    var label: String {
        var text = ""
        if modifiers.contains(.control) { text += "⌃" }
        if modifiers.contains(.option) { text += "⌥" }
        if modifiers.contains(.shift) { text += "⇧" }
        if modifiers.contains(.command) { text += "⌘" }
        return text + PTTKeyNames.name(for: keyCode)
    }
}

struct PushToTalkConfig: Equatable {
    static let delayRange: ClosedRange<TimeInterval> = 0.1...0.6
    static let defaultDelay: TimeInterval = 0.28

    var enabled = true
    var choice: PTTKeyChoice = .rightOption
    var custom: PTTCustomShortcut?
    var mode: PTTMode = .hold
    var holdDelayEnabled = true
    var holdDelay: TimeInterval = PushToTalkConfig.defaultDelay

    static let `default` = PushToTalkConfig()

    var binding: PTTBinding? {
        switch choice {
        case .rightOption: return .modifier(flag: .option, keyCodes: [61, 58])
        case .rightCommand: return .modifier(flag: .command, keyCodes: [54])
        case .rightControl: return .modifier(flag: .control, keyCodes: [62])
        case .fn: return .modifier(flag: .function, keyCodes: [63])
        case .custom:
            guard let custom else { return nil }
            return .key(keyCode: custom.keyCode, modifiers: custom.modifiers)
        default:
            return choice.functionKeyCode.map { .key(keyCode: $0, modifiers: []) }
        }
    }

    /// Toggle only applies to keys. A bare modifier is always hold-to-talk.
    var effectiveMode: PTTMode {
        (binding?.isModifierOnly ?? true) ? .hold : mode
    }

    /// The delay only guards bare modifiers; a combo is already deliberate.
    var effectiveHoldDelay: TimeInterval {
        guard holdDelayEnabled, binding?.isModifierOnly == true else { return 0 }
        return min(Self.delayRange.upperBound, max(Self.delayRange.lowerBound, holdDelay))
    }

    var keyLabel: String {
        choice == .custom ? (custom?.label ?? "not set") : choice.label
    }

    /// Words for the idle status line.
    var idleHint: String {
        guard enabled, binding != nil else { return "Push-to-talk is off" }
        return effectiveMode == .toggle ? "Press \(keyLabel) to talk" : "Hold \(keyLabel) to talk"
    }

    var isActive: Bool { enabled && binding != nil }
}

// MARK: - Persistence

enum PushToTalkSettings {
    static let enabledKey = "OrionPTTEnabled"
    static let choiceKey = "OrionPTTKey"
    static let customKeyCodeKey = "OrionPTTCustomKeyCode"
    static let customModifiersKey = "OrionPTTCustomModifiers"
    static let modeKey = "OrionPTTMode"
    static let delayEnabledKey = "OrionPTTHoldDelayEnabled"
    static let delayKey = "OrionPTTHoldDelaySeconds"

    static func load(_ defaults: UserDefaults = .standard) -> PushToTalkConfig {
        var config = PushToTalkConfig.default
        if defaults.object(forKey: enabledKey) != nil { config.enabled = defaults.bool(forKey: enabledKey) }
        if let raw = defaults.string(forKey: choiceKey), let choice = PTTKeyChoice(rawValue: raw) {
            config.choice = choice
        }
        if defaults.object(forKey: customKeyCodeKey) != nil {
            let code = defaults.integer(forKey: customKeyCodeKey)
            let mods = UInt(max(0, defaults.integer(forKey: customModifiersKey)))
            if code >= 0, code <= Int(UInt16.max) {
                config.custom = PTTCustomShortcut(keyCode: UInt16(code), modifiersRaw: mods)
            }
        }
        if let raw = defaults.string(forKey: modeKey), let mode = PTTMode(rawValue: raw) { config.mode = mode }
        if defaults.object(forKey: delayEnabledKey) != nil {
            config.holdDelayEnabled = defaults.bool(forKey: delayEnabledKey)
        }
        if defaults.object(forKey: delayKey) != nil {
            let stored = defaults.double(forKey: delayKey)
            config.holdDelay = min(PushToTalkConfig.delayRange.upperBound,
                                   max(PushToTalkConfig.delayRange.lowerBound, stored))
        }
        return config
    }

    static func save(_ config: PushToTalkConfig, to defaults: UserDefaults = .standard) {
        defaults.set(config.enabled, forKey: enabledKey)
        defaults.set(config.choice.rawValue, forKey: choiceKey)
        if let custom = config.custom {
            defaults.set(Int(custom.keyCode), forKey: customKeyCodeKey)
            defaults.set(Int(custom.modifiersRaw), forKey: customModifiersKey)
        } else {
            defaults.removeObject(forKey: customKeyCodeKey)
            defaults.removeObject(forKey: customModifiersKey)
        }
        defaults.set(config.mode.rawValue, forKey: modeKey)
        defaults.set(config.holdDelayEnabled, forKey: delayEnabledKey)
        defaults.set(config.holdDelay, forKey: delayKey)
    }
}

// MARK: - Clash warnings

enum PTTClash {
    private struct Known { let keyCode: Int; let mods: NSEvent.ModifierFlags; let name: String }

    private static let known: [Known] = [
        Known(keyCode: kVK_Space, mods: .command, name: "Spotlight"),
        Known(keyCode: kVK_Space, mods: .control, name: "input source switching"),
        Known(keyCode: kVK_Space, mods: [.command, .option], name: "Finder search"),
        Known(keyCode: kVK_Space, mods: [.command, .control], name: "the emoji picker"),
        Known(keyCode: kVK_Tab, mods: .command, name: "the app switcher"),
        Known(keyCode: kVK_Tab, mods: .option, name: "Orion's own console shortcut"),
        Known(keyCode: kVK_ANSI_Grave, mods: .command, name: "window switching"),
        Known(keyCode: kVK_ANSI_Q, mods: .command, name: "Quit"),
        Known(keyCode: kVK_ANSI_W, mods: .command, name: "Close window"),
        Known(keyCode: kVK_ANSI_H, mods: .command, name: "Hide"),
        Known(keyCode: kVK_ANSI_M, mods: .command, name: "Minimize"),
        Known(keyCode: kVK_ANSI_C, mods: .command, name: "Copy"),
        Known(keyCode: kVK_ANSI_V, mods: .command, name: "Paste"),
        Known(keyCode: kVK_ANSI_X, mods: .command, name: "Cut"),
        Known(keyCode: kVK_ANSI_Z, mods: .command, name: "Undo"),
        Known(keyCode: kVK_ANSI_A, mods: .command, name: "Select All"),
        Known(keyCode: kVK_ANSI_S, mods: .command, name: "Save"),
        Known(keyCode: kVK_ANSI_N, mods: .command, name: "New"),
        Known(keyCode: kVK_ANSI_T, mods: .command, name: "New tab"),
        Known(keyCode: kVK_ANSI_Comma, mods: .command, name: "Settings"),
        Known(keyCode: kVK_ANSI_3, mods: [.command, .shift], name: "screenshot"),
        Known(keyCode: kVK_ANSI_4, mods: [.command, .shift], name: "screenshot"),
        Known(keyCode: kVK_ANSI_5, mods: [.command, .shift], name: "screenshot"),
        Known(keyCode: kVK_ANSI_Q, mods: [.command, .control], name: "Lock Screen"),
        Known(keyCode: kVK_Escape, mods: [.command, .option], name: "Force Quit"),
        Known(keyCode: kVK_LeftArrow, mods: .control, name: "Spaces"),
        Known(keyCode: kVK_RightArrow, mods: .control, name: "Spaces"),
        Known(keyCode: kVK_UpArrow, mods: .control, name: "Mission Control"),
        Known(keyCode: kVK_DownArrow, mods: .control, name: "App Exposé")
    ]

    /// Name of the system shortcut this combination collides with, if any.
    static func systemShortcut(keyCode: UInt16, modifiers: NSEvent.ModifierFlags) -> String? {
        let mods = modifiers.intersection(PTTCustomShortcut.shortcutMask)
        return known.first { $0.keyCode == Int(keyCode) && $0.mods == mods }?.name
    }

    /// A one-line warning, or nil when the choice is safe.
    static func warning(for config: PushToTalkConfig) -> String? {
        guard config.enabled else { return nil }
        switch config.choice {
        case .fn:
            return "macOS may use Globe for emoji or dictation. Set Keyboard ▸ Press 🌐 to Do Nothing."
        case .rightOption, .rightCommand, .rightControl:
            return config.holdDelayEnabled ? nil
                : "Without the hold delay, tapping this key while using shortcuts can start a turn."
        case .custom:
            guard let custom = config.custom else { return nil }
            if let name = systemShortcut(keyCode: custom.keyCode, modifiers: custom.modifiers) {
                return "\(custom.label) is already \(name)."
            }
            if custom.modifiers.isDisjoint(with: [.command, .control]) {
                return "\(custom.label) types a special character in most apps."
            }
            return nil
        default:
            return nil
        }
    }
}

// MARK: - Key names

enum PTTKeyNames {
    private static let names: [Int: String] = [
        kVK_ANSI_A: "A", kVK_ANSI_B: "B", kVK_ANSI_C: "C", kVK_ANSI_D: "D", kVK_ANSI_E: "E",
        kVK_ANSI_F: "F", kVK_ANSI_G: "G", kVK_ANSI_H: "H", kVK_ANSI_I: "I", kVK_ANSI_J: "J",
        kVK_ANSI_K: "K", kVK_ANSI_L: "L", kVK_ANSI_M: "M", kVK_ANSI_N: "N", kVK_ANSI_O: "O",
        kVK_ANSI_P: "P", kVK_ANSI_Q: "Q", kVK_ANSI_R: "R", kVK_ANSI_S: "S", kVK_ANSI_T: "T",
        kVK_ANSI_U: "U", kVK_ANSI_V: "V", kVK_ANSI_W: "W", kVK_ANSI_X: "X", kVK_ANSI_Y: "Y",
        kVK_ANSI_Z: "Z", kVK_ANSI_0: "0", kVK_ANSI_1: "1", kVK_ANSI_2: "2", kVK_ANSI_3: "3",
        kVK_ANSI_4: "4", kVK_ANSI_5: "5", kVK_ANSI_6: "6", kVK_ANSI_7: "7", kVK_ANSI_8: "8",
        kVK_ANSI_9: "9", kVK_Space: "Space", kVK_Tab: "Tab", kVK_Return: "Return",
        kVK_Delete: "Delete", kVK_ANSI_Comma: ",", kVK_ANSI_Period: ".", kVK_ANSI_Slash: "/",
        kVK_ANSI_Semicolon: ";", kVK_ANSI_Quote: "'", kVK_ANSI_Grave: "`", kVK_ANSI_Minus: "-",
        kVK_ANSI_Equal: "=", kVK_ANSI_LeftBracket: "[", kVK_ANSI_RightBracket: "]",
        kVK_ANSI_Backslash: "\\", kVK_LeftArrow: "←", kVK_RightArrow: "→", kVK_UpArrow: "↑",
        kVK_DownArrow: "↓", kVK_F1: "F1", kVK_F2: "F2", kVK_F3: "F3", kVK_F4: "F4", kVK_F5: "F5",
        kVK_F6: "F6", kVK_F7: "F7", kVK_F8: "F8", kVK_F9: "F9", kVK_F10: "F10", kVK_F11: "F11",
        kVK_F12: "F12", kVK_F13: "F13", kVK_F14: "F14", kVK_F15: "F15", kVK_F16: "F16",
        kVK_F17: "F17", kVK_F18: "F18", kVK_F19: "F19"
    ]

    static func name(for keyCode: UInt16) -> String { names[Int(keyCode)] ?? "key \(keyCode)" }
}
