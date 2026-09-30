import Foundation
import WidgetKit
import MobileCore

struct GlanceEntry: TimelineEntry {
    let date: Date
    /// Nil until the app has written a glance on this device.
    let glance: OrionGlance?
    var mood: OrionGlance.Mood { glance?.mood(at: date) ?? .calm }
    var line: String { glance?.line(at: date) ?? "Open ORION once to connect." }
}

/// Every widget reads the same file. Entries are laid at each start and end in
/// the next six hours and every quarter hour, so countdowns and "now" stay true
/// without the app running; the app reloads the timelines when the day changes.
struct GlanceProvider: TimelineProvider {
    func placeholder(in context: Context) -> GlanceEntry { GlanceEntry(date: Date(), glance: .sample(Date())) }

    func getSnapshot(in context: Context, completion: @escaping (GlanceEntry) -> Void) {
        let now = Date()
        completion(GlanceEntry(date: now, glance: GlanceStore.load() ?? (context.isPreview ? .sample(now) : nil)))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<GlanceEntry>) -> Void) {
        let now = Date()
        guard let glance = GlanceStore.load() else {
            completion(Timeline(entries: [GlanceEntry(date: now, glance: nil)], policy: .after(now.addingTimeInterval(15 * 60))))
            return
        }
        let moments = Array(glance.timelineMoments(from: now, hours: 6).prefix(40))
        let entries = moments.map { GlanceEntry(date: $0, glance: glance) }
        completion(Timeline(entries: entries, policy: .after(moments.last ?? now.addingTimeInterval(15 * 60))))
    }
}

enum GlanceStore {
    static var directory: URL? {
        #if os(iOS)
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: GlanceFile.phoneGroup)
        #else
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: GlanceFile.macGroup)
        #endif
    }
    static func load() -> OrionGlance? { directory.flatMap { GlanceFile.read($0.appendingPathComponent(GlanceFile.fileName)) } }
}

extension OrionGlance {
    /// The widget gallery's example day. Never shown once a real glance exists.
    static func sample(_ now: Date) -> OrionGlance {
        let hour = { (h: Double) in now.addingTimeInterval(h * 3600) }
        return OrionGlance(
            generatedAt: now, source: "sample",
            blocks: [.init(id: "1", title: "ECON1115 Lecture", start: hour(-0.5), end: hour(1), kind: "class", fixed: true, location: "Bush House"),
                     .init(id: "2", title: "MKTG2201 Seminar", start: hour(1.5), end: hour(3), kind: "class", fixed: true),
                     .init(id: "3", title: "Side project", start: hour(3.25), end: hour(4.25), kind: "orion", fixed: false),
                     .init(id: "4", title: "Gym", start: hour(4.5), end: hour(5.5), kind: "orion", fixed: false),
                     .init(id: "5", title: "Dinner with friends", start: hour(6), end: hour(8), kind: "social", fixed: true)],
            tomorrow: [.init(id: "6", title: "Macro seminar", start: hour(20), end: hour(21.5), kind: "class", fixed: true)],
            todos: [.init(id: "a", title: "Macro problem set", due: hour(30), priority: 1),
                    .init(id: "b", title: "Book flights home", priority: 2),
                    .init(id: "c", title: "Groceries"), .init(id: "d", title: "Email tutor")],
            projects: [.init(id: "p1", name: "ORION", status: "working", percent: 64, accepted: 16, total: 25, live: true,
                             activeTask: "Widgets", step: "3/5 · lock screen"),
                       .init(id: "p2", name: "London vlog", status: "paused", percent: 30, accepted: 3, total: 10, live: false)],
            checkin: nil,
            deadlines: [.init(id: "q", title: "Macro quiz", at: hour(24 * 4)), .init(id: "m", title: "Marketing presentation", at: hour(24 * 16))],
            tracking: .init(water: 4, waterGoal: 9, calories: 1240, calorieGoal: 2200, protein: 86, proteinGoal: 150),
            night: .init(bed: hour(9), alarm: hour(17), reason: "Macro seminar"),
            recovery: 72)
    }
}
