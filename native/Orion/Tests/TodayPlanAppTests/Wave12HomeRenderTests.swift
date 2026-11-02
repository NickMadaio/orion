import AppKit
import MobileCore
import SwiftUI
import XCTest
@testable import Orion

/// Wave 12 U4: the redesigned Home rendered from fixture data (a busy morning, a quiet evening, nothing at all) and
/// the header alone. PNGs are written only when ORION_UI_RENDER_DIR is set; the blank-render check always runs.
@MainActor
final class Wave12HomeRenderTests: XCTestCase {
    private let size = CGSize(width: 1440, height: 900)
    private let zone = UIRender.zone

    private func at(_ hour: Int, _ minute: Int = 0, day: Int = 30) -> Date {
        var calendar = Calendar(identifier: .gregorian); calendar.timeZone = zone
        return calendar.date(from: DateComponents(year: 2026, month: 10, day: day, hour: hour, minute: minute))!
    }

    private func event(_ id: String, _ title: String, _ start: Date, _ end: Date) -> AgendaEvent {
        AgendaEvent(id: id, title: title, start: start, end: end, isAllDay: false, calendarName: "Classes", colorHex: "5BB8FF")
    }

    private func busyMorning() -> (BriefFacts, HomeSignals) {
        var facts = BriefFacts(day: LogicalDay(start: at(7, 10), fromWakeTime: true), clock: BriefClock(now: at(7, 40), timeZone: zone),
                               events: [event("e1", "CS2100 Program Design — Lecture", at(9), at(10, 30)),
                                        event("e2", "Lunch with Priya", at(12, 30), at(13, 30)),
                                        event("e3", "MKTG2201 seminar", at(15), at(16))])
        facts.overdue = [SyncedTask(id: "t1", title: "Send Priya the problem set", isComplete: false, dueDate: at(17, day: 28), hasAlarm: false)]
        facts.dueToday = [SyncedTask(id: "t2", title: "Final pass on the AE1 slides", isComplete: false, dueDate: at(23), hasAlarm: false)]
        facts.readings = BriefFacts.Readings(recovery: 71, sleepPerformance: 84, sleepHours: 7.6, hrvDelta: "+6",
                                             restingHeartRate: 52, strainTarget: StrainTarget.forRecovery(71))
        var signals = HomeSignals(question: PendingQuestion(id: "q", text: "Gym didn't happen last night. Want 40 minutes after lunch, or is today off?",
                                                            at: at(7, 27)))
        signals.leaveBy = at(8, 40)
        signals.knowledgeCount = 214
        signals.selfName = "Nick"
        return (facts, signals)
    }

    private func quietEvening() -> (BriefFacts, HomeSignals) {
        var facts = BriefFacts(day: LogicalDay(start: at(7, 10), fromWakeTime: true), clock: BriefClock(now: at(21, 10), timeZone: zone))
        facts.dueToday = [SyncedTask(id: "t2", title: "Read chapter 4 for ECON1115", isComplete: false, dueDate: at(23, 59), hasAlarm: false)]
        var signals = HomeSignals()
        signals.bedtime = at(0, day: 31)
        signals.nextWake = at(8, 30, day: 31)
        signals.knowledgeCount = 48
        signals.selfName = "Nick"
        return (facts, signals)
    }

    private func page(_ facts: BriefFacts?, _ signals: HomeSignals, issues: [HomeStatus.Issue] = [], line: HomeComposerLine = HomeComposerLine()) -> some View {
        let clock = facts?.clock ?? BriefClock(now: at(16), timeZone: zone)
        let cards = HomeCardBuilder.cards(brief: facts, signals: signals)
        return VStack(spacing: 0) {
            DashboardHeader(selected: .home, issues: issues, onSelect: { _ in })
            HomeScene(greeting: HomeGreeting.line(clock: clock, name: signals.selfName),
                      subline: HomeGreeting.subline(knowledgeCount: signals.knowledgeCount, cardCount: cards.count, clock: clock),
                      cards: cards, availableHeight: size.height - 94, onAction: { _ in }) {
                ComposerHost(line: line)
            }
            .padding(.horizontal, 22).padding(.top, 6).padding(.bottom, 18)
        }
    }

    func testRendersBusyMorning() throws {
        let (facts, signals) = busyMorning()
        XCTAssertGreaterThanOrEqual(HomeCardBuilder.cards(brief: facts, signals: signals).count, 5)
        try UIRender.write("u4-home-busy-morning", UIRender.onDesktop(page(facts, signals, issues: [HomeStatus.Issue(text: "1 OVERDUE", severe: false)]),
                                                                      light: false, size: size), size: size)
    }

    func testRendersQuietEvening() throws {
        let (facts, signals) = quietEvening()
        let line = HomeComposerLine(phase: nil, focus: "FOCUS · BREAK · 6 MIN LEFT",
                                    controls: [HomeComposerLine.Control(title: "Skip break") {}])
        try UIRender.write("u4-home-quiet-evening", UIRender.onDesktop(page(facts, signals, line: line), light: false, size: size), size: size)
    }

    func testRendersEmpty() throws {
        var signals = HomeSignals()
        signals.selfName = "Nick"
        try UIRender.write("u4-home-empty", UIRender.onDesktop(page(nil, signals, issues: [HomeStatus.Issue(text: "GATEWAY DOWN", severe: true)]),
                                                               light: false, size: size), size: size)
    }

    func testRendersBusyMorningOnALightDesktop() throws {
        let (facts, signals) = busyMorning()
        try UIRender.write("u4-home-busy-light", UIRender.onDesktop(page(facts, signals), light: true, size: size), size: size)
    }

    func testRendersHeader() throws {
        let header = CGSize(width: 1440, height: 80)
        try UIRender.write("u4-header", UIRender.onDesktop(DashboardHeader(selected: .knowledge, issues: [], onSelect: { _ in }),
                                                           light: false, size: header), size: header)
        try UIRender.write("u4-header-alert", UIRender.onDesktop(
            DashboardHeader(selected: .home, issues: [HomeStatus.Issue(text: "GATEWAY DOWN", severe: true), HomeStatus.Issue(text: "3 OVERDUE", severe: false)],
                            onSelect: { _ in }), light: false, size: header), size: header)
    }
}

private struct ComposerHost: View {
    var line: HomeComposerLine
    @State private var text = ""
    @FocusState private var focused: Bool

    var body: some View {
        HomeComposerBar(text: $text, focus: $focused, listening: false, line: line,
                        onVoice: {}, onChat: {}, onSend: {}, animated: false)
    }
}
