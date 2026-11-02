import MobileCore
import XCTest
@testable import Orion

/// Wave 12 U4: the new Home turns ORION's real data into a few proactive cards. These pin the data → card rules
/// (kicker, title, action), including partial and empty data, without a window.
@MainActor
final class HomeCardsTests: XCTestCase {
    private let zone = TimeZone(identifier: "Europe/London")!

    private func at(_ hour: Int, _ minute: Int = 0, day: Int = 30) -> Date {
        var calendar = Calendar(identifier: .gregorian); calendar.timeZone = zone
        return calendar.date(from: DateComponents(year: 2026, month: 10, day: day, hour: hour, minute: minute))!
    }

    private func facts(now: Date, events: [AgendaEvent] = [], due: [SyncedTask] = [], overdue: [SyncedTask] = [],
                       recovery: Int? = nil) -> BriefFacts {
        var facts = BriefFacts(day: LogicalDay(start: at(7), fromWakeTime: true), clock: BriefClock(now: now, timeZone: zone), events: events)
        facts.dueToday = due
        facts.overdue = overdue
        if let recovery {
            facts.readings = BriefFacts.Readings(recovery: recovery, sleepPerformance: 84, sleepHours: 7.6, hrvDelta: "+6",
                                                 restingHeartRate: 52, strainTarget: StrainTarget.forRecovery(recovery))
        }
        return facts
    }

    private func event(_ id: String, _ title: String, _ start: Date, _ end: Date) -> AgendaEvent {
        AgendaEvent(id: id, title: title, start: start, end: end, isAllDay: false, calendarName: "Classes", colorHex: "5BB8FF")
    }

    private func task(_ id: String, _ title: String, due: Date) -> SyncedTask {
        SyncedTask(id: id, title: title, isComplete: false, dueDate: due, hasAlarm: false)
    }

    // MARK: Empty and partial

    func testNoDataMakesNoCards() {
        XCTAssertEqual(HomeCardBuilder.cards(brief: nil, signals: HomeSignals()), [])
        // A quiet evening with nothing scheduled, nothing due and no readings: still nothing to say.
        XCTAssertEqual(HomeCardBuilder.cards(brief: facts(now: at(22, 30)), signals: HomeSignals()), [])
    }

    func testOnlyAPendingQuestionMakesOneAnswerCard() {
        let question = PendingQuestion(id: "reach-1", text: "Quick one for tonight's review - what was 1:11 to 3:11?", at: at(20, 48))
        let cards = HomeCardBuilder.cards(brief: nil, signals: HomeSignals(question: question, now: at(21, 0)))
        XCTAssertEqual(cards.count, 1)
        XCTAssertEqual(cards[0].kind, .question)
        XCTAssertEqual(cards[0].kickerText, "ORION ASKED · 12 MIN AGO")
        XCTAssertEqual(cards[0].title, question.text)
        XCTAssertEqual(cards[0].primary.action, .answer(outreachID: "reach-1"))
    }

    // MARK: Event

    func testNextClassCarriesCountdownShortNameAndLeaveBy() {
        let brief = facts(now: at(8, 20), events: [event("e1", "CS2100 Program Design — Lecture", at(9), at(10, 30)),
                                                   event("e2", "Lunch with Priya", at(12, 30), at(13, 30))])
        var signals = HomeSignals()
        signals.leaveBy = at(8, 45)
        let card = try! XCTUnwrap(HomeCardBuilder.cards(brief: brief, signals: signals).first { $0.kind == .event })
        XCTAssertEqual(card.kickerText, "IN 40 MIN · CS2100 · LEAVE BY 8:45 AM")
        XCTAssertEqual(card.title, "Leave by 8:45 AM for CS2100.")
        XCTAssertTrue(card.body.contains { $0.contains("Lunch with Priya") })
        XCTAssertEqual(card.primary.action, .openPlan)
    }

    func testEventInProgressSaysUntil() {
        let brief = facts(now: at(9, 30), events: [event("e1", "Lunch with Priya", at(9), at(10, 30))])
        let card = try! XCTUnwrap(HomeCardBuilder.cards(brief: brief, signals: HomeSignals()).first { $0.kind == .event })
        XCTAssertEqual(card.kicker.first, "NOW")
        XCTAssertTrue(card.title.contains("until 10:30 AM"))
    }

    func testLeaveByInThePastOrAfterTheEventIsIgnored() {
        let brief = facts(now: at(8, 20), events: [event("e1", "CS2100 lecture", at(9), at(10))])
        var signals = HomeSignals()
        signals.leaveBy = at(8, 0)
        let card = try! XCTUnwrap(HomeCardBuilder.cards(brief: brief, signals: signals).first { $0.kind == .event })
        XCTAssertFalse(card.kickerText.contains("LEAVE BY"))
    }

    // MARK: Tasks

    func testOneOverdueTaskOffersMarkDone() {
        let brief = facts(now: at(10), overdue: [task("t1", "Send Priya the problem set", due: at(9, day: 28))])
        let card = try! XCTUnwrap(HomeCardBuilder.cards(brief: brief, signals: HomeSignals()).first { $0.kind == .tasks })
        XCTAssertEqual(card.kickerText, "OVERDUE · 2 DAYS · REMINDERS")
        XCTAssertTrue(card.title.contains("Send Priya the problem set"))
        XCTAssertEqual(card.primary.action, .markDone(taskID: "t1"))
    }

    func testSeveralDueTodayOpensThePlan() {
        let brief = facts(now: at(10), due: [task("a", "Slides", due: at(23)), task("b", "Problem set", due: at(23)),
                                             task("c", "Email Sam", due: at(23))])
        let card = try! XCTUnwrap(HomeCardBuilder.cards(brief: brief, signals: HomeSignals()).first { $0.kind == .tasks })
        XCTAssertEqual(card.kickerText, "DUE TODAY · 3 TASKS")
        XCTAssertEqual(card.title, "Three things are due by tonight.")
        XCTAssertEqual(card.primary.action, .openPlan)
        XCTAssertEqual(card.body.count, 1)
    }

    // MARK: Focus

    func testFreeStretchSuggestsFocusOnTheTopTask() {
        let brief = facts(now: at(10), events: [event("e1", "Lunch with Priya", at(12, 30), at(13, 30))],
                          due: [task("a", "Final pass on the AE1 slides", due: at(23))])
        let card = try! XCTUnwrap(HomeCardBuilder.cards(brief: brief, signals: HomeSignals()).first { $0.kind == .focus })
        XCTAssertEqual(card.kickerText, "FREE UNTIL 12:30 PM · 2H 30M")
        XCTAssertTrue(card.title.contains("Final pass on the AE1 slides"))
        XCTAssertEqual(card.primary.action, .startFocus(task: "Final pass on the AE1 slides"))
    }

    func testNoFocusSuggestionWhenTheGapIsShortOrLate() {
        let short = facts(now: at(12), events: [event("e1", "Lunch", at(12, 30), at(13, 30))])
        XCTAssertNil(HomeCardBuilder.cards(brief: short, signals: HomeSignals()).first { $0.kind == .focus })
        let late = facts(now: at(22, 30))
        XCTAssertNil(HomeCardBuilder.cards(brief: late, signals: HomeSignals()).first { $0.kind == .focus })
    }

    func testFreeTimeEndsWhenHeHasToLeave() {
        let brief = facts(now: at(9), events: [event("e1", "CS2100 lecture", at(11, 30), at(13))])
        var signals = HomeSignals()
        signals.leaveBy = at(11)
        let card = try! XCTUnwrap(HomeCardBuilder.cards(brief: brief, signals: signals).first { $0.kind == .focus })
        XCTAssertEqual(card.kickerText, "FREE UNTIL 11:00 AM · 2H")
        XCTAssertEqual(card.body, ["A 50-minute block fits before you leave."])
        signals.leaveBy = at(9, 30)
        let tight = facts(now: at(9), events: [event("e1", "CS2100 lecture", at(10), at(11))])
        XCTAssertNil(HomeCardBuilder.cards(brief: tight, signals: signals).first { $0.kind == .focus })
    }

    func testMinimisedSessionOffersToGoBack() {
        var signals = HomeSignals()
        signals.focus = HomeFocus(live: true, minimized: true, headline: "Focus", remaining: "18 min left")
        let card = try! XCTUnwrap(HomeCardBuilder.cards(brief: facts(now: at(10)), signals: signals).first { $0.kind == .focus })
        XCTAssertEqual(card.kickerText, "FOCUS · 18 MIN LEFT")
        XCTAssertEqual(card.primary.action, .resumeFocus)
    }

    // MARK: Health and sleep

    func testMorningRecoveryCardOpensTheBrief() {
        let card = try! XCTUnwrap(HomeCardBuilder.cards(brief: facts(now: at(8), recovery: 71), signals: HomeSignals())
            .first { $0.kind == .health })
        XCTAssertEqual(card.kickerText, "RECOVERY 71 · SLEEP 84% · WHOOP")
        XCTAssertEqual(card.primary.action, .openBrief)
        XCTAssertEqual(card.details?.action, .openHealth)
    }

    func testHealthCardStepsAsideInTheAfternoonUnlessRecoveryIsLow() {
        XCTAssertNil(HomeCardBuilder.cards(brief: facts(now: at(16), recovery: 71), signals: HomeSignals()).first { $0.kind == .health })
        XCTAssertNotNil(HomeCardBuilder.cards(brief: facts(now: at(16), recovery: 20), signals: HomeSignals()).first { $0.kind == .health })
    }

    func testEveningBedtimeCard() {
        var signals = HomeSignals()
        signals.bedtime = at(0, day: 31)
        signals.nextWake = at(9, day: 31)
        let card = try! XCTUnwrap(HomeCardBuilder.cards(brief: facts(now: at(21)), signals: signals).first { $0.kind == .sleep })
        XCTAssertEqual(card.kickerText, "BED BY MIDNIGHT · IN 3H")
        XCTAssertEqual(card.title, "Lights out by midnight tonight.")
        XCTAssertTrue(card.body.contains { $0.contains("9:00 AM") })
        if case .ask = card.primary.action {} else { XCTFail("bedtime card should open chat prefilled") }
    }

    func testNoBedtimeCardInTheMorning() {
        var signals = HomeSignals()
        signals.bedtime = at(0, day: 31)
        XCTAssertNil(HomeCardBuilder.cards(brief: facts(now: at(9)), signals: signals).first { $0.kind == .sleep })
    }

    // MARK: Order, cap, greeting

    func testABusyMorningIsCappedAndAskedQuestionLeads() {
        let brief = facts(now: at(8, 20),
                          events: [event("e1", "CS2100 lecture", at(9), at(10)), event("e2", "Lunch", at(12, 30), at(13))],
                          due: [task("a", "Slides", due: at(23))],
                          overdue: [task("b", "Problem set", due: at(9, day: 29))], recovery: 40)
        var signals = HomeSignals(question: PendingQuestion(id: "q", text: "Gym tonight?", at: at(8)), now: at(8, 20))
        signals.focus = HomeFocus(live: true, minimized: true, headline: "Focus", remaining: "18 min left")
        signals.bedtime = at(23)
        let cards = HomeCardBuilder.cards(brief: brief, signals: signals)
        XCTAssertLessThanOrEqual(cards.count, HomeCardBuilder.maxCards)
        XCTAssertEqual(cards.first?.kind, .question)
        XCTAssertEqual(Set(cards.map(\.id)).count, cards.count, "card ids must be unique for the deal")
    }

    func testGreetingUsesTheNameAndTheKnowledgeCount() {
        XCTAssertEqual(HomeGreeting.line(clock: BriefClock(now: at(8), timeZone: zone), name: "Nick"), "Good morning, Nick.")
        XCTAssertEqual(HomeGreeting.line(clock: BriefClock(now: at(8), timeZone: zone), name: nil), "Good morning.")
        XCTAssertEqual(HomeGreeting.subline(knowledgeCount: 214, cardCount: 3, clock: BriefClock(now: at(8), timeZone: zone)),
                       "I'VE LEARNED 214 THINGS ABOUT YOU")
        XCTAssertEqual(HomeGreeting.subline(knowledgeCount: nil, cardCount: 3, clock: BriefClock(now: at(8), timeZone: zone)),
                       "3 THINGS NEED YOU TODAY")
        XCTAssertEqual(HomeGreeting.subline(knowledgeCount: 0, cardCount: 1, clock: BriefClock(now: at(8), timeZone: zone)),
                       "ONE THING NEEDS YOU TODAY")
        XCTAssertEqual(HomeGreeting.subline(knowledgeCount: nil, cardCount: 0, clock: BriefClock(now: at(8), timeZone: zone)),
                       "FRIDAY OCTOBER 30")
    }
}
