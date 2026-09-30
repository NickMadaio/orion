import Foundation

/// Is what the microphone heard just ORION's own voice coming back?
/// (2026-09-29)
///
/// On the Mac's built-in speakers the microphone hears every reply. With the
/// voice-ID filter not running, that echo woke the wake word and counted as
/// Nick interrupting — ORION cut himself off mid-sentence and started
/// listening to himself, in a loop, twice a minute. A transcript made mostly of
/// the words ORION is saying (or said in the last few seconds) is echo, not
/// Nick. Words are compared loosely (case, punctuation, contractions), because
/// the recogniser rarely gets his voice back word-perfect.
public enum SelfEcho {
    /// Share of the heard words that must appear in what ORION said.
    public static let threshold = 0.6

    public static func isEcho(heard: String, spoken: String) -> Bool {
        let heardWords = words(heard)
        guard !heardWords.isEmpty else { return false }
        let said = Set(words(spoken))
        guard !said.isEmpty else { return false }
        let matched = heardWords.filter { said.contains($0) }.count
        // One or two words ("stop", "wait") are Nick's to say even if ORION used them.
        guard heardWords.count >= 3 else { return false }
        return Double(matched) / Double(heardWords.count) >= threshold
    }

    /// Stricter, for the moments ORION is actually talking: a short fragment made
    /// only of his own words is echo too — unless it is one of the words Nick
    /// uses to cut him off.
    public static let interruptWords: Set<String> = ["stop", "wait", "hold", "orion", "no", "cancel", "shut"]

    public static func isEchoWhileSpeaking(heard: String, spoken: String) -> Bool {
        let heardWords = words(heard)
        guard !heardWords.isEmpty else { return true }
        let said = Set(words(spoken))
        // An interruption word he is saying himself ("I'm Orion…") is echo too.
        if !interruptions(in: heard, spoken: spoken).isEmpty { return false }
        if heardWords.count < 3 { return heardWords.allSatisfy(said.contains) }
        return isEcho(heard: heard, spoken: spoken)
    }

    /// Interruption words heard that are NOT in ORION's own sentence.
    public static func interruptions(in heard: String, spoken: String) -> [String] {
        let said = Set(words(spoken))
        return words(heard).filter { interruptWords.contains($0) && !said.contains($0) }
    }

    public static func words(_ text: String) -> [String] {
        text.lowercased()
            .replacingOccurrences(of: "’", with: "'")
            .components(separatedBy: CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "'")).inverted)
            .map { $0.replacingOccurrences(of: "'", with: "") }
            .filter { !$0.isEmpty }
    }
}
