import SwiftUI
import WidgetKit
import MobileCore

// MARK: - ORION: the hologram, and what he'd say

struct HologramWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "orion.hologram", provider: GlanceProvider()) { entry in
            HologramWidgetView(entry: entry)
        }
        .configurationDisplayName("ORION")
        .description("The hologram, in the mood of your day, and the one thing he'd tell you now.")
        .supportedFamilies(Self.families)
    }
    #if os(iOS)
    static let families: [WidgetFamily] = [.systemSmall, .systemMedium, .systemLarge]
    #else
    static let families: [WidgetFamily] = [.systemSmall, .systemMedium, .systemLarge, .systemExtraLarge]
    #endif
}

struct HologramWidgetView: View {
    let entry: GlanceEntry
    @Environment(\.widgetFamily) private var family

    var body: some View {
        let mood = entry.mood
        Group {
            switch family {
            case .systemSmall: small(mood)
            case .systemMedium: medium(mood)
            default: large(mood)
            }
        }
        .orionBackground(W.tint(mood))
        // Tap the hologram to talk to him: the Mac starts listening; the phone opens the ORION tab.
        .widgetURL(URL(string: "orion://listen")!)
    }

    private func small(_ mood: OrionGlance.Mood) -> some View {
        ZStack(alignment: .bottomLeading) {
            HologramArt(mood: mood).frame(width: 150, height: 150).offset(x: 18, y: -22)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topTrailing)
            VStack(alignment: .leading, spacing: 3) {
                Text(W.moodLabel(mood)).textCase(.uppercase).font(W.mono(8)).tracking(1.3).foregroundStyle(W.tint(mood))
                Text(entry.line).font(W.display(13, .semibold)).foregroundStyle(W.text).lineLimit(3)
                    .minimumScaleFactor(0.8)
            }
        }
    }

    private func medium(_ mood: OrionGlance.Mood) -> some View {
        HStack(spacing: 10) {
            HologramArt(mood: mood).frame(width: 130, height: 130).padding(.leading, -14)
            VStack(alignment: .leading, spacing: 7) {
                Eyebrow(W.moodLabel(mood), tint: W.tint(mood))
                Text(entry.line).font(W.display(15, .semibold)).foregroundStyle(W.text).lineLimit(3).minimumScaleFactor(0.85)
                Spacer(minLength: 0)
                if let glance = entry.glance {
                    ForEach(glance.remaining(at: entry.date, limit: 2)) { BlockRow(block: $0, now: entry.date, compact: true) }
                }
            }
        }
    }

    private func large(_ mood: OrionGlance.Mood) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            VStack(alignment: .leading, spacing: 4) {
                Text(W.moodLabel(mood)).textCase(.uppercase).font(W.mono(9)).tracking(1.4).foregroundStyle(W.tint(mood))
                Text(entry.line).font(W.display(19, .bold)).foregroundStyle(W.text).lineLimit(2).minimumScaleFactor(0.8)
            }
            .frame(maxWidth: .infinity, minHeight: family == .systemExtraLarge ? 190 : 165, alignment: .bottomLeading)
            .background(alignment: .top) {
                HologramArt(mood: mood).frame(width: 200, height: 200).offset(y: -30)
            }
            if let glance = entry.glance {
                Eyebrow("Rest of today")
                let rows = glance.remaining(at: entry.date, limit: family == .systemExtraLarge ? 7 : 4)
                if rows.isEmpty {
                    Text("Nothing else booked.").font(.system(size: 12)).foregroundStyle(W.soft)
                }
                ForEach(rows) { BlockRow(block: $0, now: entry.date) }
                Spacer(minLength: 0)
                StatStrip(glance: glance)
            }
        }
    }
}

/// Water, food, recovery, and what's waiting: one quiet line of numbers.
struct StatStrip: View {
    let glance: OrionGlance
    var body: some View {
        HStack(spacing: 14) {
            if let t = glance.tracking {
                stat("Water", "\(t.water)/\(t.waterGoal)", W.accent)
                stat("Kcal", "\(t.calories)", W.orange)
                stat("Protein", "\(t.protein)g", W.green)
            }
            if let recovery = glance.recovery { stat("Recovery", "\(recovery)%", recovery >= 67 ? W.green : recovery >= 34 ? W.gold : W.red) }
            if glance.approvals > 0 { stat("Waiting", "\(glance.approvals)", W.accent) }
            Spacer(minLength: 0)
        }
    }
    private func stat(_ label: String, _ value: String, _ tint: Color) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(value).font(W.mono(13, .bold)).foregroundStyle(tint)
            Text(label).textCase(.uppercase).font(W.mono(7)).tracking(1).foregroundStyle(W.dim)
        }
    }
}

// MARK: - Event Horizon: the black-hole study, with a countdown

struct HorizonWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "orion.horizon", provider: GlanceProvider()) { entry in
            HorizonWidgetView(entry: entry)
        }
        .configurationDisplayName("Event Horizon")
        .description("ORION's black-hole form, counting down to what's next.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

struct HorizonWidgetView: View {
    let entry: GlanceEntry
    @Environment(\.widgetFamily) private var family

    var body: some View {
        let mood = entry.mood
        let small = family == .systemSmall
        Group {
            if small {
                VStack(spacing: 4) {
                    HologramArt(mood: mood, style: .horizon).frame(width: 112, height: 112).padding(.top, -6)
                    caption(center: true)
                }
            } else {
                HStack(spacing: 8) {
                    HologramArt(mood: mood, style: .horizon).frame(width: 150, height: 150).padding(.leading, -18)
                    VStack(alignment: .leading, spacing: 4) {
                        Eyebrow(W.moodLabel(mood), tint: W.tint(mood))
                        caption(center: false)
                        Spacer(minLength: 0)
                        Text(entry.line).font(.system(size: 11)).foregroundStyle(W.soft).lineLimit(2)
                    }
                }
            }
        }
        .orionBackground(W.tint(mood).opacity(0.6))
        .widgetURL(W.link("home"))
    }

    /// What is on and the time left, else what is next and when.
    @ViewBuilder
    private func caption(center: Bool) -> some View {
        let now = entry.glance?.current(at: entry.date)
        let next = entry.glance?.upcoming(after: entry.date, limit: 1).first
        let align: HorizontalAlignment = center ? .center : .leading
        VStack(alignment: align, spacing: 1) {
            if let block = now ?? next {
                Text(block.title).font(W.display(center ? 13 : 16, .bold)).foregroundStyle(W.text).lineLimit(1)
                if let now {
                    Text(timerInterval: entry.date...max(entry.date, now.end), countsDown: true)
                        .font(W.mono(center ? 12 : 22, .bold)).foregroundStyle(W.tint(now.kind))
                        .multilineTextAlignment(center ? .center : .leading)
                } else if let next {
                    Text("\(W.clock(next.start)) · in \(W.duration(next.start.timeIntervalSince(entry.date)))")
                        .font(W.mono(center ? 11 : 14, .bold)).foregroundStyle(W.tint(next.kind))
                }
            } else {
                Text(entry.line).font(W.display(12, .semibold)).foregroundStyle(W.text).lineLimit(2)
                    .multilineTextAlignment(center ? .center : .leading)
            }
        }
        .frame(maxWidth: .infinity, alignment: center ? .center : .leading)
    }
}

// MARK: - Command Center: everything at once

struct CommandWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "orion.command", provider: GlanceProvider()) { entry in
            CommandWidgetView(entry: entry)
        }
        .configurationDisplayName("Command Center")
        .description("Hologram, schedule, to-dos, your project and today's numbers together.")
        .supportedFamilies(Self.families)
    }
    #if os(iOS)
    static let families: [WidgetFamily] = [.systemLarge]
    #else
    static let families: [WidgetFamily] = [.systemLarge, .systemExtraLarge]
    #endif
}

struct CommandWidgetView: View {
    let entry: GlanceEntry
    @Environment(\.widgetFamily) private var family

    var body: some View {
        let mood = entry.mood
        Group {
            if let glance = entry.glance {
                if family == .systemExtraLarge { wide(glance, mood) } else { tall(glance, mood) }
            } else {
                NotConnected()
            }
        }
        .orionBackground(W.tint(mood))
        .widgetURL(W.link("home"))
    }

    private func header(_ mood: OrionGlance.Mood, size: CGFloat) -> some View {
        HStack(spacing: 8) {
            HologramArt(mood: mood).frame(width: size, height: size).padding(-10)
            VStack(alignment: .leading, spacing: 3) {
                Text(W.moodLabel(mood)).textCase(.uppercase).font(W.mono(8)).tracking(1.3).foregroundStyle(W.tint(mood))
                Text(entry.line).font(W.display(14, .semibold)).foregroundStyle(W.text).lineLimit(2).minimumScaleFactor(0.85)
            }
        }
    }

    private func tall(_ glance: OrionGlance, _ mood: OrionGlance.Mood) -> some View {
        VStack(alignment: .leading, spacing: 9) {
            header(mood, size: 70)
            Eyebrow("Schedule")
            ForEach(glance.remaining(at: entry.date, limit: 3)) { BlockRow(block: $0, now: entry.date, compact: true) }
            HStack(alignment: .top, spacing: 14) {
                VStack(alignment: .leading, spacing: 5) {
                    Eyebrow("To-do")
                    ForEach(glance.openTodos(limit: 3)) { TodoLine(todo: $0) }
                }
                if let project = glance.projects.first {
                    VStack(alignment: .leading, spacing: 5) {
                        Eyebrow("Project")
                        ProjectLine(project: project, compact: true)
                    }
                }
            }
            Spacer(minLength: 0)
            StatStrip(glance: glance)
        }
    }

    private func wide(_ glance: OrionGlance, _ mood: OrionGlance.Mood) -> some View {
        HStack(alignment: .top, spacing: 18) {
            VStack(alignment: .leading, spacing: 10) {
                HologramArt(mood: mood).frame(width: 190, height: 190).frame(maxWidth: .infinity)
                Text(W.moodLabel(mood)).textCase(.uppercase).font(W.mono(9)).tracking(1.4).foregroundStyle(W.tint(mood))
                Text(entry.line).font(W.display(17, .bold)).foregroundStyle(W.text).lineLimit(3)
                Spacer(minLength: 0)
                StatStrip(glance: glance)
            }
            .frame(width: 230)
            VStack(alignment: .leading, spacing: 8) {
                Eyebrow("Schedule")
                ForEach(glance.remaining(at: entry.date, limit: 7)) { BlockRow(block: $0, now: entry.date) }
                Spacer(minLength: 0)
                if let deadline = glance.upcomingDeadlines(after: entry.date, limit: 1).first {
                    Eyebrow("Next deadline", tint: W.orange)
                    DeadlineLine(deadline: deadline, now: entry.date)
                }
            }
            VStack(alignment: .leading, spacing: 8) {
                Eyebrow("To-do")
                ForEach(glance.openTodos(limit: 5)) { TodoLine(todo: $0) }
                Spacer(minLength: 0)
                Eyebrow("Projects")
                ForEach(glance.projects.prefix(2)) { ProjectLine(project: $0, compact: true) }
            }
        }
    }
}
