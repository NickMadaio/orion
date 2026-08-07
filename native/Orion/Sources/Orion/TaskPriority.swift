import SwiftUI

/*
 Priority and progress.

 Two fields with very different stories behind them, and the difference matters
 because one of them syncs to the iPhone and the other cannot.

 PRIORITY IS REAL. `EKReminder.priority` is a genuine CalDAV field, so a task
 marked High here is High in Reminders on the phone and on the web. The scale is
 the RFC 5545 one and it is not what anyone expects: 0 means unset, and 1 is the
 HIGHEST while 9 is the lowest. Apple's own UI collapses that into three bands,
 and so does this — a nine-point scale is a decision nobody wants to make about
 a chore.

 PROGRESS IS LOCAL. EventKit exposes no percent-complete. The underlying VTODO
 standard has PERCENT-COMPLETE and Apple simply does not surface it, so there is
 no honest way to sync it. It lives in a file beside the app instead, keyed by
 the reminder's stable identifier — which means it is this Mac's opinion about a
 task, and the task itself is still the shared one. Said plainly here so nobody
 later assumes a number is on the phone when it is not.
*/

enum TaskPriority: Int, CaseIterable, Identifiable, Codable {
    case none = 0
    case low = 9
    case medium = 5
    case high = 1

    var id: Int { rawValue }

    /// Apple stores any 1–9. Anything that arrives from another client is
    /// folded into the nearest band rather than dropped.
    static func from(_ raw: Int) -> TaskPriority {
        switch raw {
        case 1...4: return .high
        case 5: return .medium
        case 6...9: return .low
        default: return .none
        }
    }

    var label: String {
        switch self {
        case .none: "None"
        case .low: "Low"
        case .medium: "Medium"
        case .high: "High"
        }
    }

    /// One glyph, so a list can be read down the left edge without reading it.
    var mark: String {
        switch self {
        case .none: "minus"
        case .low: "chevron.down"
        case .medium: "equal"
        case .high: "chevron.up"
        }
    }

    var tint: Color {
        switch self {
        case .none: OrionTheme.textDim
        case .low: OrionTheme.blue
        case .medium: OrionTheme.orange
        case .high: OrionTheme.red
        }
    }

    /// Sort weight: high first, unset last. Deliberately not `rawValue`, which
    /// would put "none" (0) above "high" (1).
    var rank: Int {
        switch self {
        case .high: 0
        case .medium: 1
        case .low: 2
        case .none: 3
        }
    }

    var next: TaskPriority {
        switch self {
        case .none: .high
        case .high: .medium
        case .medium: .low
        case .low: .none
        }
    }
}

/// How far along a task is, 0...1, stored on this Mac.
///
/// A file rather than UserDefaults because it is a growing map that outlives
/// any one preference, and because it sits with the rest of Orion's own state
/// in `~/.openclaw/orion-controlled` where the ledger and the toolbox already
/// live.
final class TaskProgressStore {

    static let shared = TaskProgressStore()

    private let url: URL
    private var values: [String: Double]

    init() {
        let directory = URL(fileURLWithPath: NSHomeDirectory())
            .appendingPathComponent(".openclaw/orion-controlled", isDirectory: true)
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        url = directory.appendingPathComponent("task-progress.json")

        if let data = try? Data(contentsOf: url),
           let decoded = try? JSONDecoder().decode([String: Double].self, from: data) {
            values = decoded
        } else {
            values = [:]
        }
    }

    func progress(for id: String) -> Double { values[id] ?? 0 }

    func set(_ progress: Double, for id: String) {
        let clamped = min(1, max(0, progress))
        // Zero is the default, so storing it would grow the file forever with
        // rows that mean "nothing to say".
        if clamped <= 0.0001 {
            values.removeValue(forKey: id)
        } else {
            values[id] = clamped
        }
        persist()
    }

    /// Drop entries for tasks that no longer exist, so completing and deleting
    /// a hundred tasks does not leave a hundred orphans behind.
    func prune(keeping ids: Set<String>) {
        let before = values.count
        values = values.filter { ids.contains($0.key) }
        if values.count != before { persist() }
    }

    private func persist() {
        guard let data = try? JSONEncoder().encode(values) else { return }
        try? data.write(to: url, options: .atomic)
    }
}
