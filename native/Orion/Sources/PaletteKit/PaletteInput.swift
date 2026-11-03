import Foundation

/// What the field's text means. A prefix picks the mode; a question asks; anything else searches.
public enum PaletteInput: Equatable {
    case browse
    case search(String)
    case ask(String)
    case addTodo(String)
    case calc(String)
    case action(String)

    private static let interrogatives: Set<String> = [
        "what", "whats", "what's", "who", "when", "where", "why", "how", "which",
        "can", "could", "should", "is", "are", "does", "do", "did", "will", "would", "am",
    ]

    public static func parse(_ raw: String) -> PaletteInput {
        let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let first = text.first else { return .browse }
        let rest = String(text.dropFirst()).trimmingCharacters(in: .whitespaces)
        switch first {
        case "?": return rest.isEmpty ? .ask("") : .ask(rest)
        case "+": return .addTodo(rest)
        case "=": return .calc(rest)
        case ">": return .action(rest)
        default: break
        }
        if text.hasSuffix("?") { return .ask(text) }
        let words = text.lowercased().split(separator: " ")
        if words.count >= 3, let lead = words.first, interrogatives.contains(String(lead)) { return .ask(text) }
        return .search(text)
    }
}
