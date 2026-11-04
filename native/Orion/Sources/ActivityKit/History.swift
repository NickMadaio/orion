import Foundation

/// One line of activity-history.jsonl: when, which app, which category, which DOMAIN. Never a URL or a window title.
public struct HistoryLine: Equatable {
    public var at: String; public var bundleId: String?; public var category: ActivityCategory; public var domain: String?
    public init(at: String, bundleId: String?, category: ActivityCategory, domain: String?) {
        self.at = at; self.bundleId = bundleId; self.category = category; self.domain = domain
    }
    public init(snapshot s: ActivitySnapshot) { self.init(at: s.at, bundleId: s.app.bundleId, category: s.category, domain: s.domain) }

    public func encoded() throws -> Data {
        let o: [String: Any] = ["at": at, "bundleId": bundleId ?? NSNull(), "category": category.rawValue, "domain": domain ?? NSNull()]
        return try JSONSerialization.data(withJSONObject: o, options: [.sortedKeys, .withoutEscapingSlashes])
    }

    public static let retentionDays = 7

    public static func key(bundleId: String?, category: ActivityCategory, domain: String?) -> String {
        "\(bundleId ?? "-")|\(category.rawValue)|\(domain ?? "-")"
    }
    /// A line is appended only when the app, category or domain differs from the last one written.
    public static func isChange(previous: String?, bundleId: String?, category: ActivityCategory, domain: String?) -> Bool {
        previous != key(bundleId: bundleId, category: category, domain: domain)
    }

    /// The journal text without lines older than seven days or that do not parse.
    public static func prune(_ text: String, now: Date) -> String {
        let cutoff = now.addingTimeInterval(-Double(retentionDays) * 86_400)
        let formatter = ISO8601DateFormatter()
        let kept = text.split(separator: "\n").filter { line in
            guard let data = line.data(using: .utf8),
                  let o = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
                  let at = o["at"] as? String, let when = formatter.date(from: at) else { return false }
            return when >= cutoff
        }
        return kept.isEmpty ? "" : kept.joined(separator: "\n") + "\n"
    }
}
