import Foundation

/// The "=" mode: a small local calculator. + - * / ^ %, brackets, "x" for times, "18% of 240", "2k", "1,200".
public enum Calculator {

    public static func evaluate(_ text: String) -> Double? {
        guard let tokens = tokenize(text), !tokens.isEmpty else { return nil }
        var parser = Parser(tokens: tokens)
        guard let value = parser.expression(), parser.atEnd, value.isFinite else { return nil }
        return value
    }

    /// 43.199999999999996 -> "43.2"; 1000000 -> "1,000,000".
    public static func format(_ value: Double) -> String {
        let rounded = (value * 1e10).rounded() / 1e10
        var text = String(format: "%.10f", abs(rounded))
        while text.hasSuffix("0") { text.removeLast() }
        if text.hasSuffix(".") { text.removeLast() }
        let parts = text.split(separator: ".", omittingEmptySubsequences: false)
        let whole = group(String(parts[0]))
        let body = parts.count > 1 ? "\(whole).\(parts[1])" : whole
        return rounded < 0 && body != "0" ? "-\(body)" : body
    }

    private static func group(_ digits: String) -> String {
        var out = "", count = 0
        for char in digits.reversed() {
            if count > 0, count % 3 == 0 { out.append(",") }
            out.append(char); count += 1
        }
        return String(out.reversed())
    }

    // MARK: Tokens

    enum Token: Equatable { case number(Double), op(Character), open, close, of }

    private static func tokenize(_ raw: String) -> [Token]? {
        var text = raw.lowercased()
            .replacingOccurrences(of: "×", with: "*").replacingOccurrences(of: "÷", with: "/")
        text = text.replacingOccurrences(of: #"(?<=\d),(?=\d{3})"#, with: "", options: .regularExpression)
        let chars = Array(text)
        var tokens: [Token] = [], i = 0
        while i < chars.count {
            let c = chars[i]
            if c.isWhitespace { i += 1; continue }
            if c.isNumber || c == "." {
                var j = i
                while j < chars.count, chars[j].isNumber || chars[j] == "." { j += 1 }
                guard var value = Double(String(chars[i..<j])) else { return nil }
                if j < chars.count, chars[j] == "k" || (chars[j] == "m" && !(j + 1 < chars.count && chars[j + 1].isLetter)) {
                    value *= chars[j] == "k" ? 1_000 : 1_000_000; j += 1
                }
                tokens.append(.number(value)); i = j; continue
            }
            if "+-*/^%".contains(c) { tokens.append(.op(c)); i += 1; continue }
            if c == "x" { tokens.append(.op("*")); i += 1; continue }
            if c == "(" { tokens.append(.open); i += 1; continue }
            if c == ")" { tokens.append(.close); i += 1; continue }
            if c == "o", i + 1 < chars.count, chars[i + 1] == "f" { tokens.append(.of); i += 2; continue }
            return nil
        }
        return tokens
    }

    // MARK: Grammar

    private struct Parser {
        let tokens: [Token]
        var index = 0

        init(tokens: [Token]) { self.tokens = tokens }

        var atEnd: Bool { index >= tokens.count }
        private var peek: Token? { index < tokens.count ? tokens[index] : nil }
        private func peek(at offset: Int) -> Token? { index + offset < tokens.count ? tokens[index + offset] : nil }

        mutating func expression() -> Double? {
            guard var left = term() else { return nil }
            while case .op(let o)? = peek, o == "+" || o == "-" {
                index += 1
                guard let right = term() else { return nil }
                left = o == "+" ? left + right : left - right
            }
            return left
        }

        mutating func term() -> Double? {
            guard var left = power() else { return nil }
            while let token = peek {
                switch token {
                case .op(let o) where o == "*" || o == "/" || o == "%":
                    index += 1
                    guard let right = power() else { return nil }
                    switch o {
                    case "*": left *= right
                    case "/": guard right != 0 else { return nil }; left /= right
                    default: guard right != 0 else { return nil }; left = left.truncatingRemainder(dividingBy: right)
                    }
                case .of:
                    index += 1
                    guard let right = power() else { return nil }
                    left *= right
                default: return left
                }
            }
            return left
        }

        mutating func power() -> Double? {
            guard let base = unary() else { return nil }
            if case .op("^")? = peek {
                index += 1
                guard let exponent = power() else { return nil }
                let result = pow(base, exponent)
                return result.isFinite ? result : nil
            }
            return base
        }

        mutating func unary() -> Double? {
            if case .op(let o)? = peek, o == "-" || o == "+" {
                index += 1
                guard let value = unary() else { return nil }
                return o == "-" ? -value : value
            }
            return postfix()
        }

        /// "50%" is a fraction when nothing that could be an operand follows; "7 % 4" is a remainder.
        mutating func postfix() -> Double? {
            guard let value = primary() else { return nil }
            if case .op("%")? = peek {
                switch peek(at: 1) {
                case nil, .of?, .close?: index += 1; return value / 100
                case .op(let next)? where next != "-" && next != "+" || peek(at: 2) == nil: index += 1; return value / 100
                default: break
                }
            }
            return value
        }

        mutating func primary() -> Double? {
            switch peek {
            case .number(let value)?: index += 1; return value
            case .open?:
                index += 1
                guard let value = expression(), case .close? = peek else { return nil }
                index += 1
                return value
            default: return nil
            }
        }
    }
}
