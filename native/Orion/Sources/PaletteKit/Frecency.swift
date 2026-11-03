import Foundation

/// What Nick picks, remembered: how often and how recently each row was chosen, and which rows he chose for which typed
/// text. Value type; every change returns a new value. Persisted as a small JSON by `FrecencyFile`.
public struct Frecency: Codable, Equatable {
    public static let maxBoost = 24.0
    public static let maxQueryBoost = 30.0
    public static let maxItems = 300
    private static let stampsKept = 12

    private var items: [String: [Double]] = [:]
    private var queries: [String: [String: Int]] = [:]
    public var version = 1

    public init() {}

    public var itemCount: Int { items.count }

    public func recording(_ id: String, query: String, now: Date) -> Frecency {
        var copy = self
        var stamps = items[id] ?? []
        stamps.append(now.timeIntervalSince1970)
        copy.items[id] = Array(stamps.suffix(Self.stampsKept))
        let key = Self.key(query)
        if !key.isEmpty {
            var picks = copy.queries[key] ?? [:]
            picks[id, default: 0] += 1
            copy.queries[key] = picks
        }
        return copy.trimmed()
    }

    /// Added to a row's match score. Zero for a row never picked.
    public func boost(for id: String, query: String, now: Date) -> Double {
        var boost = 0.0
        if let stamps = items[id], !stamps.isEmpty {
            let points = stamps.reduce(0.0) { $0 + Self.weight(age: now.timeIntervalSince1970 - $1) }
            boost += min(Self.maxBoost, 6 * log2(1 + points / 20))
        }
        let typed = Self.key(query)
        if !typed.isEmpty {
            let count = queries.reduce(0) { sum, entry in entry.key.hasPrefix(typed) ? sum + (entry.value[id] ?? 0) : sum }
            if count > 0 { boost += min(Self.maxQueryBoost, 10 + 6 * Double(count - 1)) }
        }
        return boost
    }

    private static func weight(age: TimeInterval) -> Double {
        switch age {
        case ..<3600: return 100
        case ..<86_400: return 70
        case ..<(3 * 86_400): return 50
        case ..<(7 * 86_400): return 30
        case ..<(30 * 86_400): return 15
        default: return 5
        }
    }

    private static func key(_ query: String) -> String {
        let trimmed = query.trimmingCharacters(in: .whitespaces).lowercased()
        return trimmed.count <= 16 ? trimmed : ""
    }

    private func trimmed() -> Frecency {
        guard items.count > Self.maxItems || queries.count > Self.maxItems else { return self }
        var copy = self
        if items.count > Self.maxItems {
            let doomed = items.sorted { ($0.value.last ?? 0) < ($1.value.last ?? 0) }.prefix(items.count - Self.maxItems).map(\.key)
            doomed.forEach { copy.items.removeValue(forKey: $0) }
        }
        if queries.count > Self.maxItems {
            let live = Set(copy.items.keys)
            copy.queries = copy.queries.filter { entry in entry.value.keys.contains(where: { live.contains($0) }) }
            while copy.queries.count > Self.maxItems, let drop = copy.queries.keys.sorted().first { copy.queries.removeValue(forKey: drop) }
        }
        return copy
    }

    // MARK: JSON

    public func encoded() throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        return try encoder.encode(self)
    }

    /// A damaged file is an empty history, never a crash.
    public static func decode(_ data: Data) -> Frecency { (try? JSONDecoder().decode(Frecency.self, from: data)) ?? Frecency() }
}

/// ~/.openclaw/orion-controlled/palette-frecency.json (ORION_CONTROLLED_DIR redirects it for tests).
public struct FrecencyFile {
    public let url: URL

    public init(url: URL) { self.url = url }

    public static var standard: FrecencyFile {
        let dir = ProcessInfo.processInfo.environment["ORION_CONTROLLED_DIR"].map { URL(fileURLWithPath: $0) }
            ?? FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".openclaw/orion-controlled")
        return FrecencyFile(url: dir.appendingPathComponent("palette-frecency.json"))
    }

    public func load() -> Frecency {
        (try? Data(contentsOf: url)).map(Frecency.decode) ?? Frecency()
    }

    public func save(_ value: Frecency) throws {
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        let temporary = url.deletingLastPathComponent().appendingPathComponent(".\(url.lastPathComponent).tmp")
        try value.encoded().write(to: temporary, options: .atomic)
        _ = try FileManager.default.replaceItemAt(url, withItemAt: temporary)
    }
}
