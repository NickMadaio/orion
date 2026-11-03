import Foundation

/// A key the palette acts on. Everything else is left to the text field.
public enum PaletteKey: Equatable {
    case up, down, enter, escape, tab, backTab
    case askTyped, actionsMenu, quitApp
    case quickPick(Int)

    public static func from(keyCode: UInt16, characters: String, command: Bool, shift: Bool, option: Bool, control: Bool) -> PaletteKey? {
        switch keyCode {
        case 126: return .up
        case 125: return .down
        case 36, 76: return command ? .askTyped : .enter
        case 53: return .escape
        case 48: return shift ? .backTab : .tab
        default: break
        }
        let char = characters.lowercased()
        if control, !command, !option {
            if char == "n" { return .down }
            if char == "p" { return .up }
        }
        guard command, !option, !control else { return nil }
        if char == "k" { return .actionsMenu }
        if char == "q" { return .quitApp }
        if let digit = Int(char), (1...9).contains(digit) { return .quickPick(digit) }
        return nil
    }
}
