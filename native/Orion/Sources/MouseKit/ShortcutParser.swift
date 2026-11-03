import Foundation

/// "cmd+shift+4" -> a virtual key code plus modifier bits. Flag values match CGEventFlags raw values.
public struct ParsedShortcut: Equatable {
    public var keyCode: UInt16
    public var flags: UInt64
    public init(keyCode: UInt16, flags: UInt64) { self.keyCode = keyCode; self.flags = flags }
}

public enum ShortcutParser {
    public static let cmd: UInt64 = 0x100000, shift: UInt64 = 0x20000, opt: UInt64 = 0x80000
    public static let ctrl: UInt64 = 0x40000, fn: UInt64 = 0x800000

    static let modifiers: [String: UInt64] = [
        "cmd": cmd, "command": cmd, "ctrl": ctrl, "control": ctrl, "opt": opt, "option": opt, "alt": opt,
        "shift": shift, "fn": fn
    ]

    static let keys: [String: UInt16] = [
        "a": 0, "s": 1, "d": 2, "f": 3, "h": 4, "g": 5, "z": 6, "x": 7, "c": 8, "v": 9, "b": 11, "q": 12, "w": 13,
        "e": 14, "r": 15, "y": 16, "t": 17, "1": 18, "2": 19, "3": 20, "4": 21, "6": 22, "5": 23, "=": 24, "9": 25,
        "7": 26, "-": 27, "8": 28, "0": 29, "]": 30, "o": 31, "u": 32, "[": 33, "i": 34, "p": 35, "l": 37, "j": 38,
        "'": 39, "k": 40, ";": 41, "\\": 42, ",": 43, "/": 44, "n": 45, "m": 46, ".": 47, "`": 50,
        "return": 36, "enter": 36, "tab": 48, "space": 49, "delete": 51, "backspace": 51, "escape": 53, "esc": 53,
        "left": 123, "right": 124, "down": 125, "up": 126, "home": 115, "end": 119, "pageup": 116, "pagedown": 121,
        "f1": 122, "f2": 120, "f3": 99, "f4": 118, "f5": 96, "f6": 97, "f7": 98, "f8": 100, "f9": 101, "f10": 109,
        "f11": 103, "f12": 111
    ]

    public static func parse(_ text: String) -> ParsedShortcut? {
        let parts = text.lowercased().split(separator: "+", omittingEmptySubsequences: false)
            .map { $0.trimmingCharacters(in: .whitespaces) }
        guard !parts.isEmpty, parts.allSatisfy({ !$0.isEmpty }) else { return nil }
        var flags: UInt64 = 0
        var code: UInt16?
        for part in parts {
            if let m = modifiers[part] { flags |= m }
            else if let k = keys[part], code == nil { code = k }
            else { return nil }
        }
        guard let code else { return nil }
        return ParsedShortcut(keyCode: code, flags: flags)
    }

    /// Carbon's modifier mask for RegisterEventHotKey (cmdKey 256, shiftKey 512, optionKey 2048, controlKey 4096). fn has none.
    public static func carbonModifiers(_ flags: UInt64) -> UInt32 {
        var mask: UInt32 = 0
        if flags & cmd != 0 { mask |= 256 }
        if flags & shift != 0 { mask |= 512 }
        if flags & opt != 0 { mask |= 2048 }
        if flags & ctrl != 0 { mask |= 4096 }
        return mask
    }

    private static let canonicalKeyNames: [UInt16: String] = {
        var names: [UInt16: String] = [:]
        for (name, code) in keys.sorted(by: { $0.key.count == $1.key.count ? $0.key < $1.key : $0.key.count > $1.key.count }) { names[code] = name }
        for (name, code) in [("return", 36), ("delete", 51), ("escape", 53)] { names[UInt16(code)] = name }
        return names
    }()

    /// A key press as "ctrl+opt+m", or nil when it is not a usable global shortcut (needs cmd, ctrl or opt; shift alone is just typing).
    public static func format(keyCode: UInt16, flags: UInt64) -> String? {
        guard flags & (cmd | ctrl | opt) != 0, let key = canonicalKeyNames[keyCode] else { return nil }
        let parts = [(ctrl, "ctrl"), (opt, "opt"), (shift, "shift"), (cmd, "cmd"), (fn, "fn")].filter { flags & $0.0 != 0 }.map(\.1)
        return (parts + [key]).joined(separator: "+")
    }

    /// "ctrl+opt+m" as "⌃⌥M", the way menus write it.
    public static func symbols(_ text: String) -> String {
        guard let s = parse(text) else { return text }
        var out = ""
        if s.flags & ctrl != 0 { out += "⌃" }
        if s.flags & opt != 0 { out += "⌥" }
        if s.flags & shift != 0 { out += "⇧" }
        if s.flags & cmd != 0 { out += "⌘" }
        let key = canonicalKeyNames[s.keyCode] ?? "?"
        return out + (key.count == 1 ? key.uppercased() : key.prefix(1).uppercased() + key.dropFirst())
    }
}

/// The quiet line shown (never spoken) when the hotkey flips the mouse shortcuts.
public enum MouseToggleWords {
    public static func line(enabled: Bool) -> String { enabled ? "Mouse shortcuts on" : "Mouse shortcuts off" }
}
