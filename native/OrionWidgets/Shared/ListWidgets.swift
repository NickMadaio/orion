import AppIntents
import SwiftUI
import WidgetKit
import MobileCore

// MARK: - To-dos

struct TodoLine: View {
    let todo: OrionGlance.Todo
    var body: some View {
        HStack(spacing: 7) {
            Circle().stroke(todo.priority == 1 ? W.orange : W.dim, lineWidth: 1.3).frame(width: 10, height: 10)
            Text(todo.title).font(.system(size: 12, weight: todo.priority == 1 ? .semibold : .regular)).foregroundStyle(W.text).lineLimit(1)
            Spacer(minLength: 0)
            if let due = todo.due {
                Text(Calendar.current.isDateInToday(due) ? W.clock(due) : due.formatted(.dateTime.day().month(.abbreviated)))
                    .font(W.mono(9)).foregroundStyle(due < Date() ? W.red : W.dim)
            }
        }
    }
}

struct TodoWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "orion.todo", provider: GlanceProvider()) { entry in
            TodoView(entry: entry)
        }
        .configurationDisplayName("To-dos")
        .description("Your Orion list in Reminders, most important first.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    }
}

struct TodoView: View {
    let entry: GlanceEntry
    @Environment(\.widgetFamily) private var family

    var body: some View {
        let limit = family == .systemSmall ? 4 : family == .systemMedium ? 5 : 11
        let todos = entry.glance?.openTodos(limit: limit) ?? []
        let open = entry.glance?.todos.filter { !$0.done }.count ?? 0
        VStack(alignment: .leading, spacing: family == .systemSmall ? 6 : 7) {
            HStack(alignment: .firstTextBaseline) {
                Eyebrow("To-do", tint: W.green, rule: false)
                Spacer()
                Text("\(open)").font(W.mono(family == .systemSmall ? 16 : 18, .bold)).foregroundStyle(W.text)
            }
            if entry.glance == nil {
                NotConnected()
            } else if todos.isEmpty {
                Spacer(minLength: 0)
                Text("List is clear.").font(W.display(15, .bold)).foregroundStyle(W.text)
                Text("Nothing's waiting on you.").font(.system(size: 11)).foregroundStyle(W.soft)
            } else {
                ForEach(todos) { TodoLine(todo: $0) }
            }
            Spacer(minLength: 0)
        }
        .orionBackground(W.green)
        .widgetURL(W.link("tasks"))
    }
}

// MARK: - Projects: ORION's agent runs

struct ProjectLine: View {
    let project: OrionGlance.Project
    var compact = false

    static func tint(_ status: String) -> Color {
        switch status {
        case "working": return W.green
        case "needsYou": return W.orange
        case "paused": return W.gold
        case "complete": return W.accent
        default: return W.dim
        }
    }
    static func label(_ status: String) -> String {
        switch status {
        case "working": return "Working"
        case "needsYou": return "Needs you"
        case "paused": return "Paused"
        case "complete": return "Complete"
        default: return "Stopped"
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline) {
                Text(project.name).font(.system(size: compact ? 12 : 14, weight: .semibold)).foregroundStyle(W.text).lineLimit(1)
                Spacer(minLength: 4)
                Text("\(project.percent)%").font(W.mono(compact ? 11 : 13, .bold)).foregroundStyle(Self.tint(project.status))
            }
            GeometryReader { proxy in
                ZStack(alignment: .leading) {
                    Capsule().fill(W.hairline)
                    Capsule().fill(Self.tint(project.status)).frame(width: proxy.size.width * CGFloat(project.percent) / 100)
                }
            }
            .frame(height: 4)
            HStack(spacing: 5) {
                Circle().fill(Self.tint(project.status)).frame(width: 5, height: 5).opacity(project.live ? 1 : 0.5)
                Text(project.step ?? project.activeTask ?? Self.label(project.status))
                    .font(W.mono(9, .medium)).foregroundStyle(W.soft).lineLimit(1)
                Spacer(minLength: 0)
                if !compact { Text("\(project.accepted)/\(project.total)").font(W.mono(9)).foregroundStyle(W.dim) }
            }
        }
    }
}

struct ProjectWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "orion.projects", provider: GlanceProvider()) { entry in
            ProjectView(entry: entry)
        }
        .configurationDisplayName("Projects")
        .description("What ORION's agents are building, how far along, and whether they need you.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    }
}

struct ProjectView: View {
    let entry: GlanceEntry
    @Environment(\.widgetFamily) private var family

    var body: some View {
        let projects = Array((entry.glance?.projects ?? []).prefix(family == .systemLarge ? 5 : family == .systemMedium ? 2 : 1))
        Group {
            if family == .systemSmall, let project = projects.first {
                VStack(alignment: .leading, spacing: 6) {
                    Eyebrow("Project", tint: ProjectLine.tint(project.status))
                    Spacer(minLength: 0)
                    ZStack {
                        Ring(value: Double(project.percent) / 100, tint: ProjectLine.tint(project.status), width: 6)
                        VStack(spacing: 0) {
                            Text("\(project.percent)%").font(W.mono(17, .bold)).foregroundStyle(W.text)
                            Text(ProjectLine.label(project.status)).font(W.mono(7)).foregroundStyle(W.soft)
                        }
                    }
                    .frame(width: 74, height: 74)
                    Text(project.name).font(W.display(13, .bold)).foregroundStyle(W.text).lineLimit(1)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            } else if projects.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    Eyebrow("Projects", tint: W.green)
                    Spacer(minLength: 0)
                    Text("No agent runs.").font(W.display(15, .bold)).foregroundStyle(W.text)
                    Text("Start one from the Projects tab.").font(.system(size: 11)).foregroundStyle(W.soft)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                VStack(alignment: .leading, spacing: 10) {
                    Eyebrow("Projects", tint: W.green)
                    ForEach(projects) { ProjectLine(project: $0) }
                    Spacer(minLength: 0)
                    if family == .systemLarge, let checkin = entry.glance?.checkin, checkin.phase == "active" {
                        Text("You: \(checkin.what)").font(W.mono(10)).foregroundStyle(W.violet).lineLimit(1)
                    }
                }
            }
        }
        .orionBackground(W.green)
        .widgetURL(W.link("projects"))
    }
}

// MARK: - Check-in: the follow-up ORION is running, with the answers

struct CheckinWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "orion.checkin", provider: GlanceProvider()) { entry in
            CheckinView(entry: entry)
        }
        .configurationDisplayName("Check-in")
        .description("What ORION is holding you to right now. Tap Started or Done without opening anything.")
        .supportedFamilies(Self.families)
    }
    #if os(iOS)
    static let families: [WidgetFamily] = [.systemSmall, .systemMedium, .accessoryRectangular]
    #else
    static let families: [WidgetFamily] = [.systemSmall, .systemMedium]
    #endif
}

struct CheckinView: View {
    let entry: GlanceEntry
    @Environment(\.widgetFamily) private var family

    var body: some View {
        let checkin = entry.glance?.checkin
        let tint = checkin.map { $0.level >= 2 ? W.red : $0.phase == "active" ? W.violet : W.accent } ?? W.gold
        Group {
            switch family {
            #if os(iOS)
            case .accessoryRectangular:
                VStack(alignment: .leading, spacing: 1) {
                    Text(checkin == nil ? "ORION" : checkin!.phase == "active" ? "On it" : "Check-in").font(.system(size: 11, weight: .bold)).widgetAccentable()
                    Text(checkin?.what ?? entry.line).font(.system(size: 13, weight: .semibold)).lineLimit(2)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            #endif
            default:
                if let checkin { active(checkin, tint) } else { idle }
            }
        }
        .orionBackground(tint)
        .widgetURL(W.link("home"))
    }

    private func active(_ checkin: OrionGlance.Checkin, _ tint: Color) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                HologramArt(mood: checkin.level >= 2 ? .alert : checkin.phase == "active" ? .focus : .asking)
                    .frame(width: 34, height: 34).padding(-6)
                Eyebrow(checkin.phase == "active" ? "On it" : checkin.level >= 2 ? (family == .systemSmall ? "Waiting" : "Still waiting") : "Check-in", tint: tint)
            }
            Text(checkin.what).font(W.display(family == .systemSmall ? 14 : 17, .bold)).foregroundStyle(W.text).lineLimit(2)
                .minimumScaleFactor(0.8)
            if let due = checkin.due, checkin.phase != "active" {
                Text(due < entry.date ? "due \(W.duration(entry.date.timeIntervalSince(due))) ago" : "at \(W.clock(due))")
                    .font(W.mono(10)).foregroundStyle(W.soft)
            }
            Spacer(minLength: 0)
            HStack(spacing: 6) {
                if checkin.phase != "active" {
                    Button(intent: OrionWidgetIntent(.started)) { Text("Started") }.buttonStyle(PillStyle(tint: tint, filled: true))
                }
                Button(intent: OrionWidgetIntent(.done)) { Text("Done") }.buttonStyle(PillStyle(tint: tint, filled: checkin.phase == "active"))
                if family != .systemSmall && checkin.phase != "active" {
                    Button(intent: OrionWidgetIntent(.snooze)) { Text("10 min") }.buttonStyle(PillStyle(tint: W.soft, filled: false))
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var idle: some View {
        VStack(alignment: .leading, spacing: 6) {
            Eyebrow("Check-in", tint: W.gold)
            Spacer(minLength: 0)
            Text("Nothing to chase.").font(W.display(15, .bold)).foregroundStyle(W.text)
            Text(entry.line).font(.system(size: 11)).foregroundStyle(W.soft).lineLimit(3)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct PillStyle: ButtonStyle {
    let tint: Color
    var filled: Bool
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 11, weight: .semibold))
            .foregroundStyle(filled ? W.ink : tint)
            .padding(.horizontal, 10).padding(.vertical, 5)
            .background(Capsule().fill(filled ? tint : tint.opacity(0.12)))
            .opacity(configuration.isPressed ? 0.6 : 1)
    }
}

// MARK: - Day Rings: water, food, protein

struct RingsWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "orion.rings", provider: GlanceProvider()) { entry in
            RingsView(entry: entry)
        }
        .configurationDisplayName("Day Rings")
        .description("Water, calories and protein against today's goals. Tap + for a bottle of water.")
        .supportedFamilies(Self.families)
    }
    #if os(iOS)
    static let families: [WidgetFamily] = [.systemSmall, .systemMedium, .accessoryCircular]
    #else
    static let families: [WidgetFamily] = [.systemSmall, .systemMedium]
    #endif
}

struct RingsView: View {
    let entry: GlanceEntry
    @Environment(\.widgetFamily) private var family

    var body: some View {
        Group {
            if let t = entry.glance?.tracking {
                switch family {
                #if os(iOS)
                case .accessoryCircular:
                    Gauge(value: Double(min(t.water, t.waterGoal)), in: 0...Double(max(1, t.waterGoal))) {
                        Image(systemName: "drop.fill")
                    } currentValueLabel: { Text("\(t.water)") }
                    .gaugeStyle(.accessoryCircular)
                    .widgetAccentable()
                #endif
                case .systemMedium: medium(t)
                default: small(t)
                }
            } else {
                VStack(alignment: .leading, spacing: 6) {
                    Eyebrow("Today", tint: W.accent)
                    Spacer(minLength: 0)
                    Text("No tracking yet.").font(W.display(14, .bold)).foregroundStyle(W.text)
                    Text("Log water and food in ORION.").font(.system(size: 11)).foregroundStyle(W.soft)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .orionBackground(W.accent)
        .widgetURL(W.link("health"))
    }

    private func fraction(_ value: Int, _ goal: Int) -> Double { goal > 0 ? Double(value) / Double(goal) : 0 }

    private func small(_ t: OrionGlance.Tracking) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            ZStack {
                Ring(value: fraction(t.water, t.waterGoal), tint: W.accent, width: 7)
                Ring(value: fraction(t.calories, t.calorieGoal), tint: W.orange, width: 7).padding(10)
                Ring(value: fraction(t.protein, t.proteinGoal), tint: W.green, width: 7).padding(20)
            }
            .frame(width: 88, height: 88)
            .frame(maxWidth: .infinity)
            Spacer(minLength: 0)
            HStack {
                Text("\(t.water)/\(t.waterGoal)").font(W.mono(12, .bold)).foregroundStyle(W.accent)
                Spacer()
                Button(intent: OrionWidgetIntent(.water)) { Image(systemName: "plus") }.buttonStyle(PillStyle(tint: W.accent, filled: true))
            }
        }
    }

    private func medium(_ t: OrionGlance.Tracking) -> some View {
        HStack(spacing: 16) {
            ZStack {
                Ring(value: fraction(t.water, t.waterGoal), tint: W.accent, width: 8)
                Ring(value: fraction(t.calories, t.calorieGoal), tint: W.orange, width: 8).padding(11)
                Ring(value: fraction(t.protein, t.proteinGoal), tint: W.green, width: 8).padding(22)
            }
            .frame(width: 110, height: 110)
            VStack(alignment: .leading, spacing: 7) {
                metric("Water", "\(t.water) of \(t.waterGoal) bottles", W.accent)
                metric("Food", "\(t.calories) of \(t.calorieGoal) kcal", W.orange)
                metric("Protein", "\(t.protein) of \(t.proteinGoal) g", W.green)
                Button(intent: OrionWidgetIntent(.water)) { Label("Bottle", systemImage: "drop.fill") }
                    .buttonStyle(PillStyle(tint: W.accent, filled: true))
            }
            Spacer(minLength: 0)
        }
    }

    private func metric(_ label: String, _ value: String, _ tint: Color) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(label).textCase(.uppercase).font(W.mono(8)).tracking(1.2).foregroundStyle(tint)
            Text(value).font(.system(size: 12, weight: .medium)).foregroundStyle(W.text)
        }
    }
}
