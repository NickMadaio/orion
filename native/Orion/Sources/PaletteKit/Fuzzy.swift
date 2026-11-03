import Foundation

/// Fuzzy scoring for the command palette: prefix, word prefix, acronym, substring, one-or-two-letter typos and a loose
/// in-order match, best first. Pure; scores are 0...100 and nil means "does not match".
public enum Fuzzy {

    /// `query` may have several words; every one must match the title (or, at a discount, the keywords).
    public static func score(query: String, title: String, keywords: String = "") -> Double? {
        let tokens = words(of: query)
        guard !tokens.isEmpty else { return nil }
        let titleWords = words(of: title)
        let keywordWords = words(of: keywords)
        var total = 0.0
        for token in tokens {
            let inTitle = tokenScore(token, in: titleWords, whole: normalize(title), allowLoose: true)
            let inKeywords = tokenScore(token, in: keywordWords, whole: normalize(keywords), allowLoose: false).map { $0 * 0.85 }
            guard let best = [inTitle, inKeywords].compactMap({ $0 }).max() else { return nil }
            total += best
        }
        var result = total / Double(tokens.count)
        if tokens.count > 1, normalize(title).hasPrefix(tokens.joined(separator: " ")) { result += 4 }
        return min(100, result)
    }

    // MARK: One token

    private static func tokenScore(_ token: String, in words: [String], whole: String, allowLoose: Bool) -> Double? {
        guard !words.isEmpty else { return nil }
        if words.count == 1, words[0] == token { return 100 }
        if whole == token { return 100 }
        if whole.hasPrefix(token) { return 92 }
        if let index = words.firstIndex(where: { $0.hasPrefix(token) }) { return 84 - Double(min(index * 2, 8)) }
        if allowLoose, token.count >= 2, words.count >= 2,
           String(words.compactMap(\.first)).hasPrefix(token) { return 80 }
        if token.count >= 3, whole.contains(token) { return 66 }
        if token.count >= 4, let typo = typoScore(token, words) { return typo }
        if allowLoose, token.count >= 2, token.count <= 8, let loose = subsequenceScore(token, whole) { return loose }
        return nil
    }

    private static func typoScore(_ token: String, _ words: [String]) -> Double? {
        let allowed = token.count >= 8 ? 2 : 1
        let chars = Array(token)
        var best: Double?
        for (index, word) in words.enumerated() {
            let letters = Array(word)
            for length in Set([chars.count - 1, chars.count, chars.count + 1]) where length >= 3 && length <= letters.count {
                let d = distance(chars, Array(letters[0..<length]))
                guard d >= 1, d <= allowed else { continue }
                let score = 58 - 10 * Double(d) - Double(min(index, 4))
                best = max(best ?? 0, score)
            }
        }
        return best
    }

    /// Letters in order, rewarded for running together and starting early.
    private static func subsequenceScore(_ token: String, _ text: String) -> Double? {
        let hay = Array(text), needle = Array(token)
        var position = 0, run = 0, bestRun = 0, first: Int?
        for char in needle {
            guard let found = hay[position...].firstIndex(of: char) else { return nil }
            run = (found == position && first != nil) ? run + 1 : 1
            bestRun = max(bestRun, run)
            if first == nil { first = found }
            position = found + 1
        }
        return 26 + Double(bestRun) * 2 - Double(min(first ?? 0, 8)) * 0.5
    }

    // MARK: Edit distance

    public static func distance(_ a: String, _ b: String) -> Int { distance(Array(a), Array(b)) }

    /// Optimal string alignment: a swap of two neighbours costs one.
    static func distance(_ a: [Character], _ b: [Character]) -> Int {
        if a.isEmpty { return b.count }
        if b.isEmpty { return a.count }
        var rows = [[Int]](repeating: [Int](repeating: 0, count: b.count + 1), count: a.count + 1)
        for i in 0...a.count { rows[i][0] = i }
        for j in 0...b.count { rows[0][j] = j }
        for i in 1...a.count {
            for j in 1...b.count {
                let cost = a[i - 1] == b[j - 1] ? 0 : 1
                rows[i][j] = min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + cost)
                if i > 1, j > 1, a[i - 1] == b[j - 2], a[i - 2] == b[j - 1] {
                    rows[i][j] = min(rows[i][j], rows[i - 2][j - 2] + 1)
                }
            }
        }
        return rows[a.count][b.count]
    }

    // MARK: Text

    static func normalize(_ text: String) -> String {
        text.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: nil)
            .split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
    }

    static func words(of text: String) -> [String] {
        normalize(text).split(whereSeparator: { !$0.isLetter && !$0.isNumber && $0 != "+" && $0 != "'" }).map(String.init)
    }
}
