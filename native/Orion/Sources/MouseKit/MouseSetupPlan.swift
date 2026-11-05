import Foundation

/// The pure parts of the setup popup: suggested defaults, row titles, the confirmation line, and the outreach tail.
public enum MouseSetupPlan {
    /// The pill labels for "Normal mouse wheel".
    public static func wheelTitle(_ mode: ReverseWheelMode) -> String {
        switch mode { case .games: return "In games"; case .always: return "Always"; case .never: return "Never" }
    }

    public static let intro = "Okay, let me help. Tell me what you want the buttons to do, or set them here:"

    /// Side buttons by convention: 3 is back, 4 is front (forward). Back opens Mission Control, front toggles Stage Manager.
    public static func suggested(_ button: Int) -> MouseAction? {
        switch button {
        case 3: return .system("missionControl")
        case 4: return .system("stageManager")
        default: return nil
        }
    }

    public static func title(_ button: Int) -> String {
        switch button {
        case 3: return "Back button"
        case 4: return "Front button"
        case KeyButtons.defaultId: return "Top button"
        case _ where KeyButtons.isKeyButton(button): return "Key button F\(KeyButtons.fNumber(button))"
        default: return "Button \(button + 1)"
        }
    }

    /// What each row shows: what is saved. Suggestions appear only for a mouse with nothing saved yet; once he has any
    /// binding, an unset button shows as Nothing (w18 audit2: Done after reopening the mapper rewrote his buttons).
    public static func effective(_ button: Int, in bindings: BindingsFile) -> MouseAction? {
        bindings.default[String(button)] ?? (bindings.default.isEmpty ? suggested(button) : nil)
    }

    /// Done on a fresh mouse saves the suggestions it showed. With any binding already saved it changes nothing.
    public static func finalized(_ bindings: BindingsFile, buttons: [Int]) -> BindingsFile {
        guard bindings.default.isEmpty else { return bindings }
        return buttons.reduce(bindings) { acc, b in acc.settingDefault(b, suggested(b)) }
    }

    /// The line after Done: "Set." only when something actually changed since the popup opened.
    public static func doneLine(before: BindingsFile, after: BindingsFile, buttons: [Int]) -> String {
        let line = confirmation(after, buttons: buttons)
        guard before == after, line.hasPrefix("Set. ") else { return line }
        return "Okay, left as it is. " + line.dropFirst("Set. ".count)
    }

    public static func confirmation(_ bindings: BindingsFile, buttons: [Int]) -> String {
        let parts = buttons.compactMap { b -> String? in
            guard let action = effective(b, in: bindings), action != .passthrough else { return nil }
            let who = title(b).lowercased().replacingOccurrences(of: " button", with: "")
            return "\(who): \(MouseActionLabel.label(action))"
        }
        guard !parts.isEmpty else { return "Okay, nothing set. The buttons stay as they were." }
        let first = parts[0].prefix(1).uppercased() + parts[0].dropFirst()
        return "Set. " + ([first] + parts.dropFirst()).joined(separator: ", ") + "."
    }

    /// The inline question when the little remove control is tapped.
    public static func removeQuestion(_ button: Int, builtIn: Bool) -> String {
        let name = KeyButtons.isKeyButton(button) || button <= 4 ? title(button) : "Button \(button + 1)"
        let base = "Remove \(name)?"
        guard builtIn else { return base }
        return base + (KeyButtons.isKeyButton(button) ? " It comes back if you use Add a button." : " It comes back if you press it.")
    }

    public static func kicker(deviceName: String?) -> String {
        "MOUSE · " + (deviceName ?? "NEW MOUSE").uppercased()
    }
}

/// Tracks an append-only jsonl file: new complete lines since the last offset.
public enum OutreachTail {
    /// Returns the lines after `offset` and the new offset. A shrunk file restarts from zero.
    public static func newLines(in data: Data, after offset: Int) -> (lines: [String], offset: Int) {
        let start = data.count < offset ? 0 : offset
        guard data.count > start else { return ([], data.count) }
        let tail = data.subdata(in: start..<data.count)
        guard let end = tail.lastIndex(of: 0x0A) else { return ([], start) }   // partial line: wait for its newline
        let chunk = tail.subdata(in: tail.startIndex..<(end + 1))
        let lines = String(decoding: chunk, as: UTF8.self).split(separator: "\n").map(String.init)
        return (lines, start + chunk.count)
    }

    public static func isLearnOpen(_ line: String) -> Bool {
        guard let row = (try? JSONSerialization.jsonObject(with: Data(line.utf8))) as? [String: Any] else { return false }
        return row["kind"] as? String == "mouse" && row["event"] as? String == "learn-open"
    }

    public static func isSetupOpen(_ line: String) -> Bool {
        guard let row = (try? JSONSerialization.jsonObject(with: Data(line.utf8))) as? [String: Any] else { return false }
        return row["kind"] as? String == "mouse" && row["event"] as? String == "setup-open"
    }
}
