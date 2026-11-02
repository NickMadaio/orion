import OrionViews
import SwiftUI

/*
 The glance row (wave 12, U5): the old dashboard's numbers, in one quiet line under the hologram.
 "PROJECTS 2 running · FINANCE $214 this week · SLEEP 7.6h · FOCUS 1h20 today". Mono caps labels, hairline
 separators, no boxes. Each item opens its section. An item with no data is left out, not shown as a dash.
*/

struct HomeGlanceItem: Equatable, Identifiable {
    let label: String
    let value: String
    let action: HomeCardAction
    var id: String { label }
}

enum HomeGlance {
    static func items(brief: BriefFacts?, signals: HomeSignals) -> [HomeGlanceItem] {
        let now = brief?.clock.now ?? signals.now ?? Date()
        return [projects(signals.projects, now: now), finance(signals.finance, now: now),
                sleep(HomeCardBuilder.readings(brief: brief, day: signals.healthDay)), focus(signals.focusMinutesToday)]
            .compactMap { $0 }
    }

    private static func projects(_ projects: [HomeProject], now: Date) -> HomeGlanceItem? {
        guard !projects.isEmpty else { return nil }
        let current = projects.filter { $0.isCurrent(at: now) }
        let running = current.filter { $0.phase == .running }.count
        let waiting = current.filter { if case .needsYou = $0.phase { return true }; return $0.phase == .review }.count
        let value: String
        if running > 0 { value = "\(running) running" + (waiting > 0 ? ", \(waiting) waiting" : "") }
        else if waiting > 0 { value = waiting == 1 ? "1 needs you" : "\(waiting) need you" }
        else { value = "none running" }
        return HomeGlanceItem(label: "PROJECTS", value: value, action: .openProject(id: nil))
    }

    private static func finance(_ finance: HomeFinance?, now: Date) -> HomeGlanceItem? {
        guard let finance, finance.isFresh(at: now) else { return nil }
        let money = { HomeFormat.money($0, currency: finance.currency) }
        let value = finance.spentThisWeek > 0 || finance.spentThisMonth <= 0
            ? "\(money(finance.spentThisWeek)) this week" : "\(money(finance.spentThisMonth)) this month"
        return HomeGlanceItem(label: "FINANCE", value: value, action: .openFinance)
    }

    private static func sleep(_ health: HomeCardBuilder.HealthReadings?) -> HomeGlanceItem? {
        guard let health else { return nil }
        if let hours = health.readings.sleepHours {
            return HomeGlanceItem(label: "SLEEP", value: String(format: "%.1fh", hours), action: .openHealth)
        }
        return health.readings.recovery.map { HomeGlanceItem(label: "RECOVERY", value: "\($0)%", action: .openHealth) }
    }

    private static func focus(_ minutes: Int?) -> HomeGlanceItem? {
        guard let minutes else { return nil }
        return HomeGlanceItem(label: "FOCUS", value: minutes > 0 ? "\(HomeFormat.hoursMinutes(minutes)) today" : "none yet today",
                              action: .openPlan)
    }
}

/// The row itself: label dim, value brighter, a fading hairline between items.
struct HomeGlanceRow: View {
    let items: [HomeGlanceItem]
    let onAction: (HomeCardAction) -> Void

    var body: some View {
        HStack(spacing: 0) {
            ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
                if index > 0 { separator }
                GlanceLink(item: item) { onAction(item.action) }
            }
        }
        .fixedSize()
    }

    private var separator: some View {
        Rectangle()
            .fill(LinearGradient(colors: [.clear, Color.white.opacity(0.22), .clear], startPoint: .top, endPoint: .bottom))
            .frame(width: 1, height: 16)
            .padding(.horizontal, 20)
    }
}

private struct GlanceLink: View {
    let item: HomeGlanceItem
    let action: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: 9) {
                Text(item.label)
                    .font(OrionTheme.mono(9, .semibold))
                    .tracking(2.4)
                    .foregroundStyle(Color.white.opacity(hovering ? 0.62 : 0.36))
                Text(item.value)
                    .font(OrionTheme.mono(10.5))
                    .foregroundStyle(Color.white.opacity(hovering ? 0.95 : 0.72))
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .animation(OrionMotion.hover, value: hovering)
        .help("Open \(item.label.capitalized)")
    }
}
