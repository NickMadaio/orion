import Foundation

/// The pure parts of the setup popup: suggested defaults, row titles, the confirmation line, and the outreach tail.
public enum MouseSetupPlan {
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
        default: return "Button \(button + 1)"
        }
    }

    /// What each row shows: what is saved, else the suggestion.
    public static func effective(_ button: Int, in bindings: BindingsFile) -> MouseAction? {
        bindings.default[String(button)] ?? suggested(button)
    }

    /// Done writes every row's effective action, so the suggestions the user accepted are saved.
    public static func finalized(_ bindings: BindingsFile, buttons: [Int]) -> BindingsFile {
        buttons.reduce(bindings) { acc, b in
            acc.default[String(b)] == nil ? acc.settingDefault(b, suggested(b)) : acc
        }
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

    public static func isSetupOpen(_ line: String) -> Bool {
        guard let row = (try? JSONSerialization.jsonObject(with: Data(line.utf8))) as? [String: Any] else { return false }
        return row["kind"] as? String == "mouse" && row["event"] as? String == "setup-open"
    }
}
