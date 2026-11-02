import AppKit
import MobileCore
import SessionService
import SwiftUI
import XCTest
@testable import Orion

/// Wave 13: fixtures and framing for the per-tab renders. Each page is drawn the way DashboardView draws it (the
/// header above, the same page padding) over the shared desktop wallpaper, so a before/after pair compares like
/// with like. Fixtures are shaped like the live data on 2026-11-02 (a short night, a quiet month, nine projects).
@MainActor
enum TabRender {
    static let size = CGSize(width: 1440, height: 1100)

    /// The page as DashboardView lays it out for `tab`, header included.
    static func page<Content: View>(_ tab: DashboardTab, @ViewBuilder content: () -> Content) -> some View {
        let wide = tab == .project || tab == .knowledge || tab == .tasks
        return VStack(spacing: 0) {
            DashboardHeader(selected: tab, issues: [], onSelect: { _ in })
            content()
                .padding(.horizontal, wide ? (tab == .tasks ? 46 : 32) : 46)
                .padding(.top, wide && tab != .tasks ? 18 : 26)
                .frame(maxWidth: wide ? .infinity : 1_180, alignment: .leading)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
    }

    static func write<Content: View>(_ name: String, _ view: Content) throws {
        try UIRender.write(name, UIRender.onDesktop(view, light: false, size: size), size: size)
    }

    static var contentHeight: CGFloat { size.height - 86 - 94 }

    // MARK: Health

    static func whoop() -> WhoopClient {
        let client = WhoopClient()
        let today = Calendar.current.startOfDay(for: Date())
        let points = (0..<7).map { offset -> WhoopDayPoint in
            let date = Calendar.current.date(byAdding: .day, value: offset - 6, to: today) ?? today
            let recovery = [64, 71, 48, 82, 66, 59, 57][offset]
            let sleep = [6.9, 7.4, 5.8, 8.1, 7.0, 6.2, 4.3][offset]
            return WhoopDayPoint(date: date, recovery: recovery, sleepPerformance: Int(sleep / 8 * 100), sleepHours: sleep,
                                 hrv: [58, 62, 49, 71, 60, 55, 52][offset], restingHeartRate: [54, 52, 58, 50, 53, 55, 56][offset],
                                 strain: [11.2, 9.8, 14.6, 8.1, 12.4, 10.9, 6.3][offset])
        }
        let snapshot = WhoopSnapshot(recovery: 57, restingHeartRate: 56, hrvMilliseconds: 52, sleepPerformance: 52, sleepHours: 4.3,
                                     strain: 6.3, recordedOn: today, recoverySleepEndedAt: today.addingTimeInterval(7 * 3600),
                                     sleepRecordedOn: today, strainRecordedOn: today, wokeAt: today.addingTimeInterval(7 * 3600),
                                     capturedAt: today.addingTimeInterval(8 * 3600))
        client.seedForRender(snapshot: snapshot, week: WhoopWeek(points: points))
        return client
    }

    // MARK: Finance

    static func plaid() -> PlaidClient {
        let client = PlaidClient()
        let now = Date()
        func day(_ ago: Int) -> Date { Calendar.current.date(byAdding: .day, value: -ago, to: now) ?? now }
        let accounts = [
            PlaidAccount(id: "a1", name: "Checking", officialName: "Everyday Checking", mask: "4021", type: "depository",
                         subtype: "checking", available: 2_140, current: 2_186.42, currency: "USD", institutionName: "Chase"),
            PlaidAccount(id: "a2", name: "Savings", officialName: "", mask: "8810", type: "depository", subtype: "savings",
                         available: 6_400, current: 6_400, currency: "USD", institutionName: "Chase"),
            PlaidAccount(id: "a3", name: "Freedom", officialName: "Freedom Unlimited", mask: "1177", type: "credit", subtype: "credit card",
                         available: nil, current: 412.18, currency: "USD", institutionName: "Chase"),
        ]
        let rows: [(String, Double, Int, String)] = [
            ("Elevenlabs.io", 6, 2, "GENERAL_SERVICES"), ("Trader Joe's", 48.20, 1, "FOOD_AND_DRINK"),
            ("Blue Bottle", 6.75, 1, "FOOD_AND_DRINK"), ("MBTA", 22.40, 3, "TRANSPORTATION"),
            ("Spotify", 11.99, 4, "ENTERTAINMENT"), ("Payroll — Northeastern", -640, 5, "INCOME"),
            ("Chipotle", 14.85, 6, "FOOD_AND_DRINK"), ("Amazon", 36.12, 8, "GENERAL_MERCHANDISE"),
            ("Elevenlabs.io", 6, 32, "GENERAL_SERVICES"), ("Spotify", 11.99, 34, "ENTERTAINMENT"),
            ("Elevenlabs.io", 6, 62, "GENERAL_SERVICES"), ("Spotify", 11.99, 64, "ENTERTAINMENT"),
        ]
        let transactions = rows.enumerated().map { index, row in
            PlaidTransaction(id: "t\(index)", accountID: "a1", name: row.0, merchant: row.0, amount: row.1, date: day(row.2),
                             category: row.3, isPending: false)
        }
        client.seedForRender(accounts: accounts, transactions: transactions,
                             items: [PlaidItem(itemID: "i1", accessToken: "fixture", institutionName: "Chase")], syncedAt: now)
        return client
    }

    // MARK: Plan

    /// A plan already accepted for today, made by the real scheduler from a class and three tasks placed around
    /// the current time, so the "now" card has something in front of it.
    static func plan(at now: Date = Date()) throws -> TodayPlanModel {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let model = TodayPlanModel(store: TodayPlanStore(url: dir.appendingPathComponent("today-plan.json")))
        model.load()
        settle { model.loaded }
        let minute = 60.0
        let events = [AgendaEvent(id: "cs1800", title: "CS1800 Discrete Structures", start: now.addingTimeInterval(70 * minute),
                                  end: now.addingTimeInterval(160 * minute), isAllDay: false, calendarName: "Classes", colorHex: nil)]
        let tasks = [SyncedTask(id: "resume", title: "Finish resume", isComplete: false, dueDate: nil, hasAlarm: false),
                     SyncedTask(id: "lab", title: "DS Lab 05", isComplete: false, dueDate: nil, hasAlarm: false),
                     SyncedTask(id: "gym", title: "Gym", isComplete: false, dueDate: nil, hasAlarm: false)]
        model.receive(try TodayPlanInputs.make(events: events, tasks: tasks, calendarReadAt: now, tasksReadAt: now, now: now,
                                               defaultMinutes: 45))
        model.preview(.plan, now: now)
        model.accept(now: now)
        settle { !model.isSaving }
        return model
    }

    private static func settle(_ condition: () -> Bool) {
        let deadline = Date().addingTimeInterval(5)
        while !condition(), Date() < deadline { RunLoop.main.run(until: Date().addingTimeInterval(0.01)) }
    }

    // MARK: Knowledge

    static func knowledge() throws -> KnowledgeStore {
        let url = KnowledgeModelTests.fixtures.appendingPathComponent("sample-graph.json")
        return KnowledgeStore(graph: try JSONDecoder().decode(KnowledgeGraph.self, from: Data(contentsOf: url)))
    }
}
