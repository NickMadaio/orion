import Foundation

/// The `focus` object, read from focus-state.json. Tolerant: the allow-lists arrive with the focus-task work and may be absent.
public enum FocusReader {
    public static func focus(fromStateJSON data: Data) -> ActivitySnapshot.Focus? {
        guard let root = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              let session = root["session"] as? [String: Any] else { return nil }
        let events = (session["events"] as? [[String: Any]]) ?? []
        let kinds = events.compactMap { ($0["kind"] as? [String: Any])?.keys.first ?? ($0["kind"] as? String) }.filter { $0 != "processAlive" }
        guard let last = kinds.last, last != "finished" else { return nil }
        let plan = session["plan"] as? [String: Any]
        func strings(_ key: String) -> [String] { (session[key] as? [String]) ?? (plan?[key] as? [String]) ?? [] }
        let task = (session["task"] as? String) ?? (plan?["task"] as? String)
        return .init(active: true, task: task, allowedApps: strings("allowedApps"), allowedDomains: strings("allowedDomains"))
    }
}
