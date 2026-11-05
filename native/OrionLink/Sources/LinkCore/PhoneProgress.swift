import Foundation

/// The running turn's progress line, for the phone (w20). The agent CLI has no delivery stage, so the front desk's "one moment"
/// never reached the phone. The plugin writes `turn-progress/<session>.json` (turn-progress.ts); the Mac's link reads it while a
/// command runs and puts the line in the command record, where the phone shows it until the reply lands.
public enum PhoneProgress {
    /// Same sanitising as the plugin's `progressFileName` and the Mac app's VoiceProgressFile.
    public static func fileName(session: String) -> String {
        let lowered = session.lowercased()
        let full = lowered.hasPrefix("agent:") ? lowered : "agent:main:\(lowered)"
        let safe = String(full.unicodeScalars.map { scalar -> Character in
            let ok = (scalar.isASCII && CharacterSet.alphanumerics.contains(scalar)) || scalar == "." || scalar == "_" || scalar == "-"
            return ok ? Character(scalar) : "_"
        }.prefix(160))
        return (safe.isEmpty ? "unknown" : safe) + ".json"
    }

    public static func url(home: URL, session: String) -> URL {
        home.appendingPathComponent(".openclaw/orion-controlled/turn-progress", isDirectory: true).appendingPathComponent(fileName(session: session))
    }

    /// The line to show, or nil: unreadable, from an earlier turn (started before `notBefore`, less half a second), or finished.
    public static func line(from data: Data, notBefore: Date, skew: TimeInterval = 0.5) -> String? {
        guard let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let startedText = root["startedAt"] as? String, let started = date(startedText),
              started.timeIntervalSince(notBefore) >= -skew, (root["done"] as? Bool) != true else { return nil }
        let say = (root["say"] as? String).flatMap { $0.isEmpty ? nil : $0 }
        let stages = root["stages"] as? [[String: Any]] ?? []
        guard let last = stages.last, let id = last["stage"] as? String else { return say }
        let label = (last["label"] as? String) ?? ""
        let detail = (last["detail"] as? String).flatMap { $0.isEmpty ? nil : $0 }
        if id == "understanding" || id == "thinking" { return say ?? capitalised(label) + (label.isEmpty ? "" : "…") }
        if id == "changing-calendar", let detail { return "Making the change to \(detail)…" }
        return label.isEmpty ? say : capitalised(label) + "…"
    }

    public static func read(home: URL, session: String, notBefore: Date) -> String? {
        (try? Data(contentsOf: url(home: home, session: session))).flatMap { line(from: $0, notBefore: notBefore) }
    }

    private static func capitalised(_ text: String) -> String { text.prefix(1).uppercased() + text.dropFirst() }

    private static func date(_ text: String) -> Date? {
        let fractional = ISO8601DateFormatter(); fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return fractional.date(from: text) ?? ISO8601DateFormatter().date(from: text)
    }
}
