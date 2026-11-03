import AppKit
import MobileCore
import SwiftUI
import XCTest
@testable import Orion

/// Wave 12 U5: Home with the hologram back, the section cards and the glance row, from fixtures (a two-card day
/// like the live one, a five-card day, nothing at all, the hologram at two moments) and the header with every link
/// at two window widths. PNGs are written only when ORION_UI_RENDER_DIR is set; the blank-render check always runs.
@MainActor
final class Wave12U5HomeRenderTests: XCTestCase {
    private let size = CGSize(width: 1440, height: 900)
    private let zone = UIRender.zone

    private func at(_ hour: Int, _ minute: Int = 0, day: Int = 2, month: Int = 11) -> Date {
        var calendar = Calendar(identifier: .gregorian); calendar.timeZone = zone
        return calendar.date(from: DateComponents(year: 2026, month: month, day: day, hour: hour, minute: minute))!
    }

    private func event(_ id: String, _ title: String, _ start: Date, _ end: Date) -> AgendaEvent {
        AgendaEvent(id: id, title: title, start: start, end: end, isAllDay: false, calendarName: "Classes", colorHex: "5BB8FF")
    }

    private func task(_ id: String, _ title: String, due: Date) -> SyncedTask {
        SyncedTask(id: id, title: title, isComplete: false, dueDate: due, hasAlarm: false)
    }

    /// Like the live screen on 11-02: a class in 8 minutes and three overdue things; quiet sections.
    private func twoCardDay() -> (BriefFacts, HomeSignals) {
        var facts = BriefFacts(day: LogicalDay(start: at(7), fromWakeTime: true), clock: BriefClock(now: at(10, 52), timeZone: zone),
                               events: [event("e1", "CS1800 Discrete Structures — Lecture", at(11), at(12, 30)),
                                        event("e2", "CS2101 Lab for Program Design & Implementation 1", at(15, 30), at(17))])
        facts.overdue = [task("t1", "finish resume", due: at(17, day: 31, month: 10)), task("t2", "Go over Orion learning plan", due: at(12, day: 1)),
                         task("t3", "DS Lab 05", due: at(9, day: 1))]
        var signals = HomeSignals()
        signals.knowledgeCount = 48
        signals.selfName = "Nick"
        signals.projects = [HomeProject(id: "p", name: "Deadline radar", phase: .idle, accepted: 9, total: 9, activeTask: nil, since: nil)]
        signals.finance = HomeFinance(currency: "USD", spentThisWeek: 0, spentThisMonth: 0, topCategory: nil,
                                      recurring: [HomeFinance.Recurring(name: "Elevenlabs.io", amount: 6, lastSeen: at(12, day: 31, month: 10))],
                                      writtenAt: at(10, 54))
        signals.focusMinutesToday = 0
        return (facts, signals)
    }

    private func fiveCardDay() -> (BriefFacts, HomeSignals) {
        var facts = BriefFacts(day: LogicalDay(start: at(7), fromWakeTime: true), clock: BriefClock(now: at(8, 5), timeZone: zone),
                               events: [event("e1", "CS2100 Program Design — Lecture", at(9), at(10, 30)),
                                        event("e2", "MKTG2201 seminar", at(15), at(16))])
        facts.overdue = [task("t1", "Send Priya the problem set", due: at(17, day: 31, month: 10))]
        facts.readings = BriefFacts.Readings(recovery: 71, sleepPerformance: 84, sleepHours: 7.6, hrvDelta: "+6",
                                             restingHeartRate: 52, strainTarget: StrainTarget.forRecovery(71))
        var signals = HomeSignals()
        signals.knowledgeCount = 214
        signals.selfName = "Nick"
        signals.projects = [HomeProject(id: "a", name: "Deadline radar", phase: .running, accepted: 4, total: 9,
                                        activeTask: "Parse Canvas due dates", since: at(8, 4))]
        signals.finance = HomeFinance(currency: "USD", spentThisWeek: 214, spentThisMonth: 486, topCategory: "FOOD_AND_DRINK",
                                      recurring: [HomeFinance.Recurring(name: "Spotify", amount: 11.99, lastSeen: at(12, day: 3, month: 10)),
                                                  HomeFinance.Recurring(name: "Elevenlabs.io", amount: 6, lastSeen: at(12, day: 31, month: 10))],
                                      writtenAt: at(7))
        signals.focusMinutesToday = 80
        return (facts, signals)
    }

    private func page(_ facts: BriefFacts?, _ signals: HomeSignals, hologramAt time: Double = 6, width: CGFloat = 1440) -> some View {
        let clock = facts?.clock ?? BriefClock(now: at(16), timeZone: zone)
        let cards = HomeCardBuilder.cards(brief: facts, signals: signals)
        return VStack(spacing: 0) {
            DashboardHeader(selected: .home, issues: [], onSelect: { _ in })
            HomeScene(greeting: HomeGreeting.line(clock: clock, name: signals.selfName),
                      subline: HomeGreeting.subline(knowledgeCount: signals.knowledgeCount, cardCount: cards.count, clock: clock),
                      cards: cards, glance: HomeGlance.items(brief: facts, signals: signals),
                      hologram: HomeHologram.advanced(by: time), hologramFrozenTime: time,
                      availableHeight: size.height - 94, onAction: { _ in }) {
                ComposerStub()
            }
            .padding(.horizontal, 22).padding(.top, 6).padding(.bottom, 18)
        }
    }

    func testRendersTwoCardDay() throws {
        let (facts, signals) = twoCardDay()
        XCTAssertEqual(HomeCardBuilder.cards(brief: facts, signals: signals).count, 2)
        try UIRender.write("u5-home-2-cards", UIRender.onDesktop(page(facts, signals), light: false, size: size), size: size)
    }

    func testRendersFiveCardDay() throws {
        let (facts, signals) = fiveCardDay()
        let cards = HomeCardBuilder.cards(brief: facts, signals: signals)
        XCTAssertEqual(cards.count, HomeCardBuilder.maxCards)
        XCTAssertTrue(cards.contains { $0.kind == .project } && cards.contains { $0.kind == .health })
        try UIRender.write("u5-home-5-cards", UIRender.onDesktop(page(facts, signals), light: false, size: size), size: size)
    }

    func testRendersEmpty() throws {
        var signals = HomeSignals()
        signals.selfName = "Nick"
        try UIRender.write("u5-home-empty", UIRender.onDesktop(page(nil, signals), light: false, size: size), size: size)
    }

    func testRendersTheHologramAtTwoPhases() throws {
        let orb = CGSize(width: 520, height: 520)
        for (name, time) in [("u5-hologram-phase-a", 2.0), ("u5-hologram-phase-b", 14.0)] {
            let view = HomeHologram(model: HomeHologram.advanced(by: time), frozenTime: time).padding(30)
            try UIRender.write(name, UIRender.onDesktop(view, light: false, size: orb), size: orb)
        }
        let (facts, signals) = twoCardDay()
        try UIRender.write("u5-home-2-cards-phase-b", UIRender.onDesktop(page(facts, signals, hologramAt: 14), light: false, size: size), size: size)
    }

    func testHeaderFitsEveryLinkAtTwoWidths() throws {
        for width in [1440.0, 1728.0] {
            let header = CGSize(width: width, height: 80)
            try UIRender.write("u5-header-\(Int(width))", UIRender.onDesktop(
                DashboardHeader(selected: .finance, issues: [HomeStatus.Issue(text: "3 OVERDUE", severe: false)], onSelect: { _ in }),
                light: false, size: header), size: header)
        }
    }
}

private struct ComposerStub: View {
    @State private var text = ""
    @FocusState private var focused: Bool

    var body: some View {
        HomeComposerBar(text: $text, focus: $focused, listening: false, line: HomeComposerLine(),
                        onVoice: {}, onChat: {}, onSend: {}, animated: false)
    }
}
