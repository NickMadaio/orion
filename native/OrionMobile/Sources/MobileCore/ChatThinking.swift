import Foundation
public enum ChatThinking {
    /// The session's transcript, only from inside the sessions folder.
    public static func transcript(home: URL, session: String) -> String? {
        let base = home.appendingPathComponent(".openclaw/agents/main/sessions")
        guard let data = try? Data(contentsOf: base.appendingPathComponent("sessions.json")),
              let index = try? JSONSerialization.jsonObject(with: data) as? [String: [String: Any]],
              let entry = index[("agent:main:" + session).lowercased()], let file = entry["sessionFile"] as? String,
              URL(fileURLWithPath: file).standardizedFileURL.deletingLastPathComponent() == base.standardizedFileURL else { return nil }
        return try? String(contentsOfFile: file, encoding: .utf8)
    }

    public static func read(home: URL, session: String, since: Date) -> String? {
        guard let text = transcript(home: home, session: session) else { return nil }
        let iso = ISO8601DateFormatter(); iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let plain = ISO8601DateFormatter()
        let thoughts = text.split(separator: "\n").compactMap { line -> String? in
            guard let row = try? JSONSerialization.jsonObject(with: Data(line.utf8)) as? [String: Any],
                  let timestamp = row["timestamp"] as? String, let at = iso.date(from: timestamp) ?? plain.date(from: timestamp), at >= since,
                  let message = row["message"] as? [String: Any], message["role"] as? String == "assistant",
                  let content = message["content"] as? [[String: Any]] else { return nil }
            let values = content.filter { $0["type"] as? String == "thinking" }.compactMap { $0["thinking"] as? String }
            return values.isEmpty ? nil : values.joined(separator: "\n")
        }
        return thoughts.isEmpty ? nil : thoughts.joined(separator: "\n\n")
    }
}
