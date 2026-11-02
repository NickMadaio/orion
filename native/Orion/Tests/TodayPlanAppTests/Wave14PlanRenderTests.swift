import AppKit
import MobileCore
import SessionService
import SwiftUI
import XCTest
@testable import Orion

/// Wave 14 (Plan tab): the page drawn whole in snapshot mode (columns without their ScrollViews), plus the month
/// and week with sample events. The blank-render check always runs; PNGs are written only when
/// ORION_UI_RENDER_DIR is set.
@MainActor
final class Wave14PlanRenderTests: XCTestCase {
    private static let app = AppState()

    /// A month with the shape of a real one: classes twice a week, gym, a deadline colour, a long weekend event.
    private static func sampleFetch() -> CalendarModel.Fetch {
        { interval, completion in
            let calendar = Calendar.current
            let days = stride(from: interval.start, to: interval.end, by: 86_400).map { $0 }
            let events: [AgendaEvent] = days.enumerated().flatMap { index, day -> [AgendaEvent] in
                let weekday = calendar.component(.weekday, from: day)
                func at(_ hour: Int, _ minutes: Int, _ id: String, _ title: String, _ hex: String) -> AgendaEvent {
                    let start = calendar.date(bySettingHour: hour, minute: 0, second: 0, of: day) ?? day
                    return AgendaEvent(id: "\(id)-\(index)", title: title, start: start, end: start.addingTimeInterval(Double(minutes) * 60),
                                       isAllDay: false, calendarName: "Sample", colorHex: hex)
                }
                var today: [AgendaEvent] = []
                if weekday == 2 || weekday == 4 { today.append(at(13, 90, "cs", "CS1800 Discrete Structures", "#A78BFA")) }
                if weekday == 3 || weekday == 5 { today.append(at(10, 65, "mktg", "MKTG2201", "#60A5FA")) }
                if weekday == 3 || weekday == 6 { today.append(at(17, 60, "gym", "Gym", "#FB923C")) }
                if index % 9 == 4 { today.append(at(19, 120, "social", "Dinner with friends", "#34D399")) }
                return today
            }
            completion(events, nil)
        }
    }

    private func model(fetch: CalendarModel.Fetch? = nil) -> (AppleRemindersSync, AppleCalendarSync, CalendarModel) {
        let reminders = AppleRemindersSync(), agenda = AppleCalendarSync()
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let calendar = CalendarModel(agenda: agenda, reminders: reminders, history: SessionHistory(url: url.appendingPathExtension("jsonl")),
                                     health: HealthLog(), fetch: fetch)
        return (reminders, agenda, calendar)
    }

    private func page(_ name: String, reminders: AppleRemindersSync, agenda: AppleCalendarSync, calendar: CalendarModel) throws {
        let plan = try TabRender.plan()
        let width = TabRender.size.width - 92
        try TabRender.write(name, TabRender.page(.tasks) {
            TasksTab(state: Self.app, reminders: reminders, agenda: agenda, dayProgress: 0.45, hoursLeft: 11,
                     energyTitle: "A steady day", availableHeight: TabRender.size.height - 94 - 44, availableWidth: width,
                     calendar: calendar, todayPlan: plan, refreshPlanSources: {}, onOpenChat: {}, snapshot: true)
        })
    }

    private func settle() { RunLoop.main.run(until: Date().addingTimeInterval(0.2)) }

    func testRendersPlanPage() throws {
        let (reminders, agenda, calendar) = model()
        settle()
        try page("w14-b-plan-after", reminders: reminders, agenda: agenda, calendar: calendar)
    }

    func testRendersMonthWithEvents() throws {
        let (reminders, agenda, calendar) = model(fetch: Self.sampleFetch())
        settle()
        XCTAssertFalse(calendar.entries(on: calendar.weeks.flatMap { $0 }.first { calendar.range.isInMonth($0, as: calendar.focusDate) && Calendar.current.component(.weekday, from: $0) == 2 } ?? Date()).isEmpty,
                       "the sample month should put a class on a Monday")
        try page("w14-b-plan-month-events", reminders: reminders, agenda: agenda, calendar: calendar)
    }

    func testRendersWeekWithEvents() throws {
        let (reminders, agenda, calendar) = model(fetch: Self.sampleFetch())
        calendar.show(.week)
        settle()
        try page("w14-b-plan-week-events", reminders: reminders, agenda: agenda, calendar: calendar)
    }
}
