import Foundation

/*
 Water from anywhere on the phone (2026-11-02).

 Nick: "I should easily be able to add water from even the lock screen or from
 a widget." The home-screen widget, the lock-screen widget, the Control Center
 control and the Siri phrase all run one intent, and that intent does two
 things here, in the shared app group:

   · queues a `WaterEvent` with its own id in `water-outbox.json`, so a tap made
     with no signal is not lost: whoever runs next (the intent itself, or the
     app coming to the front) sends what is still pending;
   · adds one to the glance's water count, so the ring moves at once.

 The event id is the CloudKit record name of the LinkCommand that carries it.
 Sending it twice therefore cannot make two commands, and the Mac also skips an
 id it has already written into the health log (TrackingLog's phoneEventIDs).
 Values here are never mutated in place: each step returns a new outbox.
*/
public struct WaterEvent: Codable, Equatable, Sendable, Identifiable {
    public let id: String
    public let at: Date
    public let delta: Int

    public init(id: String, at: Date, delta: Int = 1) {
        self.id = id; self.at = at; self.delta = delta
    }

    /// The same `LinkLog` the app's own + button sends.
    public func commandText() throws -> String { try LinkLog.water(delta: delta).encoded() }
}

public struct WaterOutbox: Codable, Equatable, Sendable {
    public static let fileName = "water-outbox.json"
    /// A week of taps without a connection is still far below this.
    public static let limit = 200

    public let pending: [WaterEvent]

    public init(pending: [WaterEvent] = []) { self.pending = pending }

    /// A new outbox with one more bottle queued, and that event.
    public func adding(id: String = UUID().uuidString, at: Date, delta: Int = 1) -> (WaterOutbox, WaterEvent) {
        if let existing = pending.first(where: { $0.id == id }) { return (self, existing) }
        let event = WaterEvent(id: id, at: at, delta: delta)
        return (WaterOutbox(pending: Array((pending + [event]).suffix(Self.limit))), event)
    }

    /// A new outbox without the events the Mac now has.
    public func delivering(_ ids: Set<String>) -> WaterOutbox {
        WaterOutbox(pending: pending.filter { !ids.contains($0.id) })
    }

    public static func read(_ url: URL) -> WaterOutbox {
        guard let data = try? Data(contentsOf: url), data.count < 200_000 else { return WaterOutbox() }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return (try? decoder.decode(WaterOutbox.self, from: data)) ?? WaterOutbox()
    }

    public func write(to url: URL) throws {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.sortedKeys]
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try encoder.encode(self).write(to: url, options: .atomic)
    }
}

/// The intent's work on the app-group store, kept here so it is tested without
/// WidgetKit. `directory` is the app group container.
public enum WaterTap {
    public struct Today: Equatable, Sendable {
        public let water: Int
        public let goal: Int
    }

    @discardableResult
    public static func record(in directory: URL, id: String = UUID().uuidString, at: Date = Date()) throws -> WaterEvent {
        let outboxURL = directory.appendingPathComponent(WaterOutbox.fileName)
        let (outbox, event) = WaterOutbox.read(outboxURL).adding(id: id, at: at)
        try outbox.write(to: outboxURL)
        bumpGlance(in: directory, by: event.delta)
        return event
    }

    public static func pending(in directory: URL) -> [WaterEvent] {
        WaterOutbox.read(directory.appendingPathComponent(WaterOutbox.fileName)).pending
    }

    public static func delivered(_ ids: Set<String>, in directory: URL) throws {
        guard !ids.isEmpty else { return }
        let url = directory.appendingPathComponent(WaterOutbox.fileName)
        try WaterOutbox.read(url).delivering(ids).write(to: url)
    }

    /// Today's bottles as the widgets show them; nil before the app's first glance.
    public static func today(in directory: URL) -> Today? {
        guard let tracking = GlanceFile.read(directory.appendingPathComponent(GlanceFile.fileName))?.tracking else { return nil }
        return Today(water: tracking.water, goal: tracking.waterGoal)
    }

    /// Show a goal change on the widgets at once; the Mac's next snapshot confirms it. Returns whether a glance was there to change.
    @discardableResult
    public static func setGoal(_ bottles: Int, in directory: URL) -> Bool {
        let url = directory.appendingPathComponent(GlanceFile.fileName)
        guard let glance = GlanceFile.read(url), var tracking = glance.tracking else { return false }
        tracking.waterGoal = WaterGoal.clamped(bottles)
        var updated = glance
        updated.tracking = tracking
        return (try? GlanceFile.write(updated, to: url)) != nil
    }

    /// Show the tap at once; the next real glance from the Mac replaces it.
    private static func bumpGlance(in directory: URL, by delta: Int) {
        let url = directory.appendingPathComponent(GlanceFile.fileName)
        guard let glance = GlanceFile.read(url), let tracking = glance.tracking else { return }
        let bumped = OrionGlance.Tracking(water: max(0, tracking.water + delta), waterGoal: tracking.waterGoal,
                                          calories: tracking.calories, calorieGoal: tracking.calorieGoal,
                                          protein: tracking.protein, proteinGoal: tracking.proteinGoal)
        var updated = glance
        updated.tracking = bumped
        _ = try? GlanceFile.write(updated, to: url)
    }
}
