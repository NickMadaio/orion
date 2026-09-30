import SwiftUI
import WidgetKit
import MobileCore

// MARK: - Now & Next (and the lock screen)

struct NowNextWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "orion.now", provider: GlanceProvider()) { entry in
            NowNextView(entry: entry)
        }
        .configurationDisplayName("Now & Next")
        .description("What's on, how long is left, and what comes after.")
        .supportedFamilies(Self.families)
    }
    #if os(iOS)
    static let families: [WidgetFamily] = [.systemSmall, .systemMedium, .accessoryRectangular, .accessoryCircular, .accessoryInline]
    #else
    static let families: [WidgetFamily] = [.systemSmall, .systemMedium]
    #endif
}

struct NowNextView: View {
    let entry: GlanceEntry
    @Environment(\.widgetFamily) private var family

    var body: some View {
        let glance = entry.glance
        let now = glance?.current(at: entry.date)
        let next = glance?.upcoming(after: entry.date, limit: 2) ?? []
        Group {
            switch family {
            #if os(iOS)
            case .accessoryInline: inline(now, next.first)
            case .accessoryCircular: circular(now, next.first)
            case .accessoryRectangular: rectangular(now, next.first)
            #endif
            case .systemMedium: medium(now, next)
            default: small(now, next.first)
            }
        }
        .orionBackground(W.tint(now?.kind ?? next.first?.kind ?? "event"))
        .widgetURL(W.link("tasks"))
    }

    private func small(_ now: OrionGlance.Block?, _ next: OrionGlance.Block?) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Eyebrow(now == nil ? "Next" : "Now", tint: W.tint(now?.kind ?? next?.kind ?? "event"))
            if let block = now ?? next {
                Text(block.title).font(W.display(17, .bold)).foregroundStyle(W.text).lineLimit(2).minimumScaleFactor(0.8)
                if let now {
                    TimeBar(value: entry.glance?.progress(of: now, at: entry.date) ?? 0, tint: W.tint(now.kind))
                    Text("until \(W.clock(now.end))").font(W.mono(10, .medium)).foregroundStyle(W.soft)
                } else {
                    Text(W.clock(block.start)).font(W.mono(22, .bold)).foregroundStyle(W.tint(block.kind))
                    Text("in \(W.duration(block.start.timeIntervalSince(entry.date)))").font(W.mono(10, .medium)).foregroundStyle(W.soft)
                }
                Spacer(minLength: 0)
                if let now, let next { Text("then \(next.title)").font(.system(size: 11)).foregroundStyle(W.dim).lineLimit(1) }
                if let place = block.location { Label(place, systemImage: "mappin").font(.system(size: 10)).foregroundStyle(W.dim).lineLimit(1) }
            } else {
                Spacer(minLength: 0)
                Text(entry.line).font(W.display(14, .semibold)).foregroundStyle(W.text).lineLimit(4)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private func medium(_ now: OrionGlance.Block?, _ next: [OrionGlance.Block]) -> some View {
        HStack(alignment: .top, spacing: 16) {
            VStack(alignment: .leading, spacing: 6) {
                Eyebrow("Now", tint: W.tint(now?.kind ?? "event"))
                if let now {
                    Text(now.title).font(W.display(18, .bold)).foregroundStyle(W.text).lineLimit(2)
                    Text(timerInterval: entry.date...max(entry.date, now.end), countsDown: true)
                        .font(W.mono(20, .bold)).foregroundStyle(W.tint(now.kind))
                    TimeBar(value: entry.glance?.progress(of: now, at: entry.date) ?? 0, tint: W.tint(now.kind))
                } else {
                    Text("Open time").font(W.display(18, .bold)).foregroundStyle(W.text)
                    Text(entry.line).font(.system(size: 12)).foregroundStyle(W.soft).lineLimit(3)
                }
                Spacer(minLength: 0)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            VStack(alignment: .leading, spacing: 8) {
                Eyebrow("Next")
                if next.isEmpty { Text("Nothing else today.").font(.system(size: 12)).foregroundStyle(W.soft) }
                ForEach(next) { block in
                    VStack(alignment: .leading, spacing: 1) {
                        Text(block.title).font(.system(size: 13, weight: .semibold)).foregroundStyle(W.text).lineLimit(1)
                        Text("\(W.clock(block.start)) · in \(W.duration(block.start.timeIntervalSince(entry.date)))")
                            .font(W.mono(10, .medium)).foregroundStyle(W.tint(block.kind))
                    }
                }
                Spacer(minLength: 0)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    #if os(iOS)
    private func inline(_ now: OrionGlance.Block?, _ next: OrionGlance.Block?) -> some View {
        if let now { return Text("\(now.title) · until \(W.clock(now.end))") }
        if let next { return Text("\(next.title) \(W.clock(next.start))") }
        return Text("ORION · nothing booked")
    }

    private func circular(_ now: OrionGlance.Block?, _ next: OrionGlance.Block?) -> some View {
        ZStack {
            AccessoryWidgetBackground()
            if let now, let glance = entry.glance {
                Ring(value: glance.progress(of: now, at: entry.date), tint: .white, width: 3).padding(3)
                VStack(spacing: 0) {
                    Text(W.duration(now.end.timeIntervalSince(entry.date)).replacingOccurrences(of: " min", with: "m"))
                        .font(.system(size: 13, weight: .bold, design: .rounded)).minimumScaleFactor(0.6)
                    Text("left").font(.system(size: 8, weight: .medium))
                }
            } else if let next {
                VStack(spacing: 0) {
                    Text(W.clock(next.start)).font(.system(size: 13, weight: .bold, design: .rounded)).minimumScaleFactor(0.6)
                    Text(String(next.title.prefix(6))).font(.system(size: 8, weight: .medium)).lineLimit(1)
                }
            } else {
                Image(systemName: "sparkle").font(.system(size: 18, weight: .semibold))
            }
        }
        .widgetAccentable()
    }

    private func rectangular(_ now: OrionGlance.Block?, _ next: OrionGlance.Block?) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            if let checkin = entry.glance?.checkin, checkin.chasing {
                Text("ORION").font(.system(size: 11, weight: .bold)).widgetAccentable()
                Text("Time for \(checkin.what)").font(.system(size: 13, weight: .semibold)).lineLimit(2)
            } else if let now {
                Text(now.title).font(.system(size: 13, weight: .bold)).lineLimit(1).widgetAccentable()
                Text(timerInterval: entry.date...max(entry.date, now.end), countsDown: true).font(.system(size: 12, design: .monospaced))
                if let next { Text("then \(next.title)").font(.system(size: 11)).lineLimit(1).foregroundStyle(.secondary) }
            } else if let next {
                Text(next.title).font(.system(size: 13, weight: .bold)).lineLimit(1).widgetAccentable()
                Text("\(W.clock(next.start)) · in \(W.duration(next.start.timeIntervalSince(entry.date)))").font(.system(size: 12))
            } else {
                Text("ORION").font(.system(size: 11, weight: .bold)).widgetAccentable()
                Text(entry.line).font(.system(size: 12)).lineLimit(2)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
    #endif
}

// MARK: - Today: the whole day as a rail

struct TodayWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "orion.today", provider: GlanceProvider()) { entry in
            TodayView(entry: entry)
        }
        .configurationDisplayName("Today")
        .description("Your day on a rail: classes, plans, and the blocks ORION filled in.")
        .supportedFamilies(Self.families)
    }
    #if os(iOS)
    static let families: [WidgetFamily] = [.systemMedium, .systemLarge]
    #else
    static let families: [WidgetFamily] = [.systemMedium, .systemLarge, .systemExtraLarge]
    #endif
}

struct TodayView: View {
    let entry: GlanceEntry
    @Environment(\.widgetFamily) private var family

    var body: some View {
        let limit = family == .systemMedium ? 4 : family == .systemLarge ? 9 : 10
        VStack(alignment: .leading, spacing: family == .systemMedium ? 5 : 8) {
            HStack(alignment: .firstTextBaseline) {
                Text(entry.date.formatted(.dateTime.weekday(.wide))).font(W.display(16, .bold)).foregroundStyle(W.text)
                Text(entry.date.formatted(.dateTime.day().month(.abbreviated))).font(W.mono(10)).foregroundStyle(W.dim)
                Spacer()
                if let glance = entry.glance { Text("\(glance.remaining(at: entry.date, limit: 50).count) left").font(W.mono(9)).foregroundStyle(W.soft) }
            }
            if let glance = entry.glance {
                let rows = glance.remaining(at: entry.date, limit: limit)
                if rows.isEmpty {
                    Spacer(minLength: 0)
                    Text(entry.line).font(W.display(14, .semibold)).foregroundStyle(W.text)
                    if let first = glance.tomorrow.first {
                        Text("Tomorrow: \(first.title) at \(W.clock(first.start))").font(W.mono(10)).foregroundStyle(W.soft)
                    }
                } else {
                    ForEach(rows) { BlockRow(block: $0, now: entry.date, compact: family == .systemMedium) }
                }
                Spacer(minLength: 0)
                if family != .systemMedium, let night = glance.night {
                    HStack {
                        Label("Bed \(W.clock(night.bed))", systemImage: "moon.stars").font(W.mono(10)).foregroundStyle(W.soft)
                        if let alarm = night.alarm { Label("Alarm \(W.clock(alarm))", systemImage: "alarm").font(W.mono(10)).foregroundStyle(W.soft) }
                    }
                }
            } else {
                NotConnected()
            }
        }
        .orionBackground(W.accent)
        .widgetURL(W.link("tasks"))
    }
}

// MARK: - Tonight: bed, alarm, sleep left

struct TonightWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "orion.tonight", provider: GlanceProvider()) { entry in
            TonightView(entry: entry)
        }
        .configurationDisplayName("Tonight")
        .description("When to be in bed, when the alarm goes, and why — it moves itself after a late night.")
        .supportedFamilies(Self.families)
    }
    #if os(iOS)
    static let families: [WidgetFamily] = [.systemSmall, .systemMedium, .accessoryRectangular]
    #else
    static let families: [WidgetFamily] = [.systemSmall, .systemMedium]
    #endif
}

struct TonightView: View {
    let entry: GlanceEntry
    @Environment(\.widgetFamily) private var family

    var body: some View {
        Group {
            if let night = entry.glance?.night {
                content(night)
            } else {
                VStack(alignment: .leading, spacing: 6) {
                    Eyebrow("Tonight")
                    Spacer(minLength: 0)
                    Text("No plan for tonight yet.").font(W.display(14, .semibold)).foregroundStyle(W.text)
                    Text("ORION sets it from tomorrow's first thing.").font(.system(size: 11)).foregroundStyle(W.soft)
                }
            }
        }
        .orionBackground(W.violet)
        .widgetURL(W.link("home"))
    }

    @ViewBuilder
    private func content(_ night: OrionGlance.Night) -> some View {
        let pastBed = entry.date >= night.bed
        let left = night.alarm.map { $0.timeIntervalSince(max(entry.date, night.bed)) }
        switch family {
        #if os(iOS)
        case .accessoryRectangular:
            VStack(alignment: .leading, spacing: 1) {
                Label(pastBed ? "Sleep now" : "Bed \(W.clock(night.bed))", systemImage: "moon.stars.fill")
                    .font(.system(size: 13, weight: .bold)).widgetAccentable()
                if let alarm = night.alarm { Text("Alarm \(W.clock(alarm))").font(.system(size: 12)) }
                if let left { Text("\(W.duration(left)) of sleep").font(.system(size: 11)).foregroundStyle(.secondary) }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        #endif
        case .systemMedium:
            HStack(spacing: 18) {
                VStack(alignment: .leading, spacing: 4) {
                    Eyebrow(pastBed ? "Past bedtime" : "Bed by", tint: pastBed ? W.red : W.violet)
                    Text(W.clock(night.bed)).font(W.mono(30, .bold)).foregroundStyle(W.text)
                    if let reason = night.reason { Text("for \(reason)").font(.system(size: 11)).foregroundStyle(W.soft).lineLimit(1) }
                    Spacer(minLength: 0)
                }
                VStack(alignment: .leading, spacing: 4) {
                    Eyebrow("Alarm", tint: W.accent)
                    Text(night.alarm.map(W.clock) ?? "Off").font(W.mono(30, .bold)).foregroundStyle(W.text)
                    if let left { Text("\(W.duration(left)) of sleep").font(.system(size: 11)).foregroundStyle(W.soft) }
                    if let note = night.note { Text(note).font(.system(size: 10)).foregroundStyle(W.gold).lineLimit(2) }
                    Spacer(minLength: 0)
                }
            }
        default:
            VStack(alignment: .leading, spacing: 4) {
                Eyebrow(pastBed ? "Sleep now" : "Tonight", tint: pastBed ? W.red : W.violet)
                Spacer(minLength: 0)
                Label(W.clock(night.bed), systemImage: "moon.stars.fill").font(W.mono(19, .bold)).foregroundStyle(W.text)
                if let alarm = night.alarm { Label(W.clock(alarm), systemImage: "alarm.fill").font(W.mono(19, .bold)).foregroundStyle(W.accent) }
                if let left { Text("\(W.duration(left)) of sleep").font(W.mono(10)).foregroundStyle(W.soft) }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

// MARK: - Countdown: deadlines ahead

struct DeadlineWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "orion.deadlines", provider: GlanceProvider()) { entry in
            DeadlineView(entry: entry)
        }
        .configurationDisplayName("Countdown")
        .description("Quizzes, presentations and due dates, counted down in days.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

struct DeadlineLine: View {
    let deadline: OrionGlance.Deadline
    let now: Date
    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(DeadlineView.days(until: deadline.at, from: now)).font(W.mono(13, .bold)).foregroundStyle(DeadlineView.tint(deadline.at, now))
                .frame(width: 34, alignment: .leading)
            Text(deadline.title).font(.system(size: 12, weight: .medium)).foregroundStyle(W.text).lineLimit(1)
            Spacer(minLength: 0)
            Text(deadline.at.formatted(.dateTime.day().month(.abbreviated))).font(W.mono(9)).foregroundStyle(W.dim)
        }
    }
}

struct DeadlineView: View {
    let entry: GlanceEntry
    @Environment(\.widgetFamily) private var family

    static func days(until date: Date, from now: Date) -> String {
        let days = Calendar.current.dateComponents([.day], from: Calendar.current.startOfDay(for: now), to: Calendar.current.startOfDay(for: date)).day ?? 0
        return days <= 0 ? "Today" : "\(days)d"
    }
    static func tint(_ date: Date, _ now: Date) -> Color {
        let days = date.timeIntervalSince(now) / 86_400
        return days < 2 ? W.red : days < 7 ? W.orange : W.green
    }

    var body: some View {
        let deadlines = entry.glance?.upcomingDeadlines(after: entry.date, limit: family == .systemSmall ? 1 : 4) ?? []
        Group {
            if family == .systemSmall, let first = deadlines.first {
                VStack(alignment: .leading, spacing: 4) {
                    Eyebrow("Countdown", tint: W.orange)
                    Spacer(minLength: 0)
                    Text(Self.days(until: first.at, from: entry.date)).font(W.mono(40, .bold)).foregroundStyle(Self.tint(first.at, entry.date))
                        .minimumScaleFactor(0.6)
                    Text(first.title).font(W.display(14, .bold)).foregroundStyle(W.text).lineLimit(2)
                    Text(first.at.formatted(.dateTime.weekday(.abbreviated).day().month(.abbreviated).hour().minute()))
                        .font(W.mono(9)).foregroundStyle(W.dim)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            } else if deadlines.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    Eyebrow("Countdown", tint: W.orange)
                    Spacer(minLength: 0)
                    Text("Nothing due soon.").font(W.display(15, .bold)).foregroundStyle(W.text)
                    Text("Quizzes and deadlines in your calendar land here.").font(.system(size: 11)).foregroundStyle(W.soft)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                VStack(alignment: .leading, spacing: 8) {
                    Eyebrow("Countdown", tint: W.orange)
                    ForEach(deadlines) { DeadlineLine(deadline: $0, now: entry.date) }
                    Spacer(minLength: 0)
                }
            }
        }
        .orionBackground(W.orange)
        .widgetURL(W.link("calendar"))
    }
}
