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
}
