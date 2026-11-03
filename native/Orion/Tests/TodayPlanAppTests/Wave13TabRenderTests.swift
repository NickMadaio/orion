import AppKit
import MobileCore
import SessionService
import SwiftUI
import XCTest
@testable import Orion

/// Wave 13: every tab page drawn whole, from fixtures, the way the dashboard draws it. The blank-render check always
/// runs; PNGs are written only when ORION_UI_RENDER_DIR is set. ORION_TAB_RENDER_SUFFIX names the set (before/after).
@MainActor
final class Wave13TabRenderTests: XCTestCase {
    private static let app = AppState()
    private var suffix: String { ProcessInfo.processInfo.environment["ORION_TAB_RENDER_SUFFIX"] ?? "after" }
    private func name(_ tab: String) -> String { "w13b-\(tab)-\(suffix)" }

    func testRendersPlan() throws {
        let reminders = AppleRemindersSync(), agenda = AppleCalendarSync()
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let calendar = CalendarModel(agenda: agenda, reminders: reminders, history: SessionHistory(url: url.appendingPathExtension("jsonl")),
                                     health: HealthLog())
        let plan = try TabRender.plan()
        let width = TabRender.size.width - 92
        try TabRender.write(name("plan"), TabRender.page(.tasks) {
            TasksTab(state: Self.app, reminders: reminders, agenda: agenda, dayProgress: 0.45, hoursLeft: 11,
                     energyTitle: "A steady day", availableHeight: TabRender.contentHeight, availableWidth: width,
                     calendar: calendar, todayPlan: plan, refreshPlanSources: {}, onOpenChat: {})
        })
    }

    func testRendersProjects() throws {
        try TabRender.write(name("projects"), TabRender.page(.project) { ProjectTab(agenda: AppleCalendarSync(), snapshot: true) })
    }

    func testRendersKnowledge() throws {
        let store = try TabRender.knowledge()
        try TabRender.write(name("knowledge"), TabRender.page(.knowledge) {
            KnowledgeView(store: store, availableHeight: TabRender.contentHeight, snapshot: true)
        })
    }

    func testRendersHealth() throws {
        let health = HealthLog()
        try TabRender.write(name("health"), TabRender.page(.health) {
            HealthTab(state: Self.app, whoop: TabRender.whoop(), health: health, connections: ConnectionsModel(),
                      day: LogicalDay(start: Calendar.current.startOfDay(for: Date()).addingTimeInterval(7 * 3600), fromWakeTime: true))
        })
    }

    func testRendersFinances() throws {
        try TabRender.write(name("finances"), TabRender.page(.finance) {
            FinanceTab(connections: ConnectionsModel(), plaid: TabRender.plaid(), writer: NarrativeWriter(),
                       day: LogicalDay(start: Calendar.current.startOfDay(for: Date()), fromWakeTime: false))
        })
    }

    func testRendersBrand() throws {
        try TabRender.write(name("brand"), TabRender.page(.brand) { BrandTab(connections: ConnectionsModel()) })
    }

    func testRendersSettings() throws {
        let app = Self.app
        try TabRender.write(name("settings"), TabRender.page(.settings) {
            SettingsTab(coreStyle: .constant("thinkingOrion"), iconScale: .constant(1), surfaceOpacity: .constant(SurfaceSettings.defaultOpacity),
                        surfaceBlur: .constant(false), connections: ConnectionsModel(), agenda: AppleCalendarSync(),
                        messagesAccess: .unknown, onRecheck: {}, state: app, focusExtras: app.focusExtras,
                        capabilities: CapabilitiesModel(), focusControl: app.focusControl, focusConfigured: true,
                        focusSetup: "", onRecheckFocus: {})
        })
    }
}

/// The page kit on its own: every piece once, entrances held settled, so a change to the shared look shows up here
/// before it shows up on seven pages.
@MainActor
final class Wave13PageKitRenderTests: XCTestCase {
    func testRendersTheKit() throws {
        let kit = VStack(alignment: .leading, spacing: 34) {
            PageHeader(title: "Kit", subline: PageSummary.line(["2 running", nil, "1 needs review"]))
            HStack(alignment: .top, spacing: 48) {
                VStack(alignment: .leading, spacing: 12) {
                    BigNumber(label: "Recovery", value: "57", unit: "%", note: "WHOOP recovery score", hue: OrionTheme.orange, countTo: 57)
                    LineMeter(progress: 0.57, hue: OrionTheme.orange, width: 150)
                }
                BigNumber(label: "Sleep", value: "4.3", unit: "h", hue: OrionTheme.lavender).padding(.top, 20)
            }
            GlanceRow(stats: [GlanceStat(label: "Projects", value: "2 running"), GlanceStat(label: "Sleep", value: "4.3h", action: {})])
            OutlineCard(hue: OrionTheme.violet, tilt: -1) {
                VStack(alignment: .leading, spacing: 10) {
                    Kicker(text: "Monthly · seen 3×", hue: OrionTheme.violet)
                    CardTitle("Spotify")
                    CardBody("$11.99 a month · last Oct 29")
                    HStack(spacing: 16) {
                        GlowPill(title: "Open the plan", hue: OrionTheme.violet) {}
                        CardDetailsLink {}
                    }
                }
            }
            .frame(width: 420)
            HairlineSection(title: "Accounts", trailing: "3 linked") {
                Text("Everyday Checking ··4021").foregroundStyle(OrionTheme.text)
            }
        }
        .padding(46)
        try UIRender.write("w13b-kit", UIRender.onDesktop(kit, light: false, size: CGSize(width: 900, height: 820)),
                           size: CGSize(width: 900, height: 820))
    }

    func testLineMeterClampsBadProgress() {
        // Non-finite and out-of-range progress must draw, not trap.
        for value in [Double.nan, -1, 2, .infinity] {
            let renderer = ImageRenderer(content: LineMeter(progress: value).frame(width: 100))
            XCTAssertNotNil(renderer.nsImage)
        }
    }
}
