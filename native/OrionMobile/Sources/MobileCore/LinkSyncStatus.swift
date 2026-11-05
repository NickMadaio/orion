import Foundation

/// What a Mac-backed screen says about its data: how old it is, and why it could not refresh.
/// A screen always renders what it has; this line tells him how far to trust it, never replaces it.
public enum LinkSyncStatus {
    public enum Tone: Equatable, Sendable { case fresh, stale, waiting, problem }

    public struct Line: Equatable, Sendable {
        public var text: String
        public var detail: String?
        public var tone: Tone
    }

    /// Data newer than this reads as current.
    public static let freshSeconds: TimeInterval = 5 * 60

    public static func line(snapshotAt: Date?, problem: String?, now: Date) -> Line {
        if let problem {
            return Line(text: problem, detail: snapshotAt.map { "Showing what I had from \(age($0, now: now))" }, tone: .problem)
        }
        guard let snapshotAt else {
            return Line(text: "Connecting to your Mac…", detail: nil, tone: .waiting)
        }
        if now.timeIntervalSince(snapshotAt) < freshSeconds {
            return Line(text: "Synced \(age(snapshotAt, now: now))", detail: nil, tone: .fresh)
        }
        return Line(text: "Last synced \(age(snapshotAt, now: now))", detail: nil, tone: .stale)
    }

    public static func age(_ date: Date, now: Date) -> String {
        let seconds = max(0, now.timeIntervalSince(date))
        if seconds < 60 { return "just now" }
        if seconds < 3600 { return "\(Int(seconds / 60)) min ago" }
        if seconds < 86_400 { return "\(Int(seconds / 3600)) h ago" }
        return "\(Int(seconds / 86_400)) d ago"
    }
}

/// The last snapshot from the Mac, kept on disk so a cold launch (or a slow or failing iCloud) shows
/// the last known data at once instead of an empty screen.
public enum LinkSnapshotCache {
    public static let maxAge: TimeInterval = 7 * 86_400

    public static func save(_ data: Data, to url: URL) {
        try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? data.write(to: url, options: .atomic)
    }

    public static func load(from url: URL, now: Date) -> LinkSnapshot? {
        guard let data = try? Data(contentsOf: url) else { return nil }
        guard let snapshot = try? LinkSnapshot.decode(data), now.timeIntervalSince(snapshot.generatedAt) < maxAge else {
            try? FileManager.default.removeItem(at: url)
            return nil
        }
        return snapshot
    }
}
