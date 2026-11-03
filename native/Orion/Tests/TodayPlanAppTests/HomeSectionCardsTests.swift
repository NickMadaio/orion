import MobileCore
import XCTest
@testable import Orion

/// Wave 12 U5: Home borrows from Projects, Finances and Health. These pin data → card and data → glance item,
/// including stale and missing data, plus the parsers for the files those sections write.
@MainActor
final class HomeSectionCardsTests: XCTestCase {
    private let zone = TimeZone(identifier: "Europe/London")!

    private func at(_ hour: Int, _ minute: Int = 0, day: Int = 2, month: Int = 11) -> Date {
        var calendar = Calendar(identifier: .gregorian); calendar.timeZone = zone
        return calendar.date(from: DateComponents(year: 2026, month: month, day: day, hour: hour, minute: minute))!
    }

    private func signals(now: Date) -> HomeSignals { HomeSignals(now: now) }

    private func project(_ id: String, _ phase: HomeProject.Phase, since: Date?, active: String? = "Wire the parser") -> HomeProject {
        HomeProject(id: id, name: "Deadline radar", phase: phase, accepted: 3, total: 9, activeTask: active, since: since)
    }

    private func finance(week: Double, month: Double, written: Date, recurring: [HomeFinance.Recurring] = [],
                         category: String? = "FOOD_AND_DRINK") -> HomeFinance {
        HomeFinance(currency: "USD", spentThisWeek: week, spentThisMonth: month, topCategory: category, recurring: recurring, writtenAt: written)
    }

    private func cards(_ signals: HomeSignals, brief: BriefFacts? = nil) -> [HomeCard] {
        HomeCardBuilder.cards(brief: brief, signals: signals)
    }

    // MARK: Projects

    func testAFreshEscalationIsANeedsYouCardThatOpensThatProject() {
        var input = signals(now: at(10))
        input.projects = [project("p-1", .needsYou("Which calendar should deadlines go to?"), since: at(9, 20))]
        let card = cards(input).first { $0.kind == .project }
        XCTAssertEqual(card?.kickerText, "PROJECT · NEEDS YOU · 40 MIN AGO")
        XCTAssertEqual(card?.title, "“Deadline radar” is waiting on you.")
        XCTAssertEqual(card?.body.first, "Which calendar should deadlines go to?")
        XCTAssertEqual(card?.primary.action, .openProject(id: "p-1"))
        XCTAssertEqual(card?.rank, 2)
    }

    func testAMonthOldEscalationAndALongDeadRunMakeNoCard() {
        var input = signals(now: at(10))
        input.projects = [project("old", .needsYou("?"), since: at(22, day: 29, month: 9)),
                          project("dead", .stalled, since: at(9, day: 30, month: 10)),
                          project("done", .idle, since: nil)]
        XCTAssertNil(cards(input).first { $0.kind == .project })
        XCTAssertEqual(HomeGlance.items(brief: nil, signals: input).first?.value, "none running")
    }

    func testARunningProjectSaysWhatItIsOnAndCountsTheOthers() {
        var input = signals(now: at(10))
        input.projects = [project("a", .running, since: at(9, 59)), project("b", .running, since: at(9, 59), active: nil)]
        let card = cards(input).first { $0.kind == .project }
        XCTAssertEqual(card?.kickerText, "PROJECT AGENT · RUNNING · 3/9")
        XCTAssertEqual(card?.body, ["On “Wire the parser”. One more running."])
        XCTAssertEqual(card?.primary.action, .openProject(id: "a"))
        XCTAssertEqual(HomeGlance.items(brief: nil, signals: input).first, HomeGlanceItem(label: "PROJECTS", value: "2 running", action: .openProject(id: nil)))
    }

    func testAStalledRunOutranksARunningOne() {
        var input = signals(now: at(10))
        input.projects = [project("a", .running, since: at(9, 59)), project("s", .stalled, since: at(8))]
        let card = cards(input).first { $0.kind == .project }
        XCTAssertEqual(card?.kickerText, "PROJECT AGENT · STALLED · QUIET 2H")
        XCTAssertEqual(card?.primary.action, .openProject(id: "s"))
    }

    func testProjectPhaseFromTheControllersState() throws {
        let now = WakeAlarmPlan.parseISO("2026-11-02T10:00:30.000Z")!
        let running = try state(status: "running", escalations: "[]")
        let live = ProjectAgentHeartbeat(at: "2026-11-02T10:00:20.000Z", phase: "running", pid: 1, iterations: 3)
        let dead = ProjectAgentHeartbeat(at: "2026-11-02T08:00:00.000Z", phase: "running", pid: 1, iterations: 3)
        XCTAssertEqual(HomeProject.make(id: "x", name: "X", state: running, heartbeat: live, now: now).phase, .running)
        XCTAssertEqual(HomeProject.make(id: "x", name: "X", state: running, heartbeat: dead, now: now).phase, .stalled)
        XCTAssertEqual(HomeProject.make(id: "x", name: "X", state: running, heartbeat: nil, now: now).activeTask, "Parse dates")

        let escalated = try state(status: "escalated", escalations: """
        [{"id":"e1","at":"2026-11-02T09:00:00.000Z","kind":"judgement","reason":"reviewer declined","taskId":null,
          "question":"Ship without tests?","recommendAstra":false,"notified":true,"resolvedAt":null}]
        """)
        let asked = HomeProject.make(id: "x", name: "X", state: escalated, heartbeat: nil, now: now)
        XCTAssertEqual(asked.phase, .needsYou("Ship without tests?"))
        XCTAssertEqual(asked.since, WakeAlarmPlan.parseISO("2026-11-02T09:00:00.000Z"))
    }

    private func state(status: String, escalations: String) throws -> ProjectAgentStatus {
        try ProjectAgentStatus.decode(Data("""
        {"version":3,"revision":1,"runId":"r1","status":"\(status)","activeTask":"t2",
         "tasks":[{"id":"t1","title":"Read plan","weight":1,"status":"accepted","stage":"accepted","attempts":1},
                  {"id":"t2","title":"Parse dates","weight":2,"status":"running","stage":"implement","attempts":1}],
         "events":[],"steering":[],"finalReview":false,"escalations":\(escalations)}
        """.utf8))
    }

    // MARK: Finance

    func testFinanceIsNeverACardOnlyAGlanceItem() {
        var input = signals(now: at(10))
        input.finance = finance(week: 214.4, month: 486, written: at(9), recurring: [
            HomeFinance.Recurring(name: "Spotify", amount: 11.99, lastSeen: at(12, day: 4, month: 10)),
        ])
        XCTAssertTrue(cards(input).isEmpty, "a renewal and a spend headline used to be cards; finance is glance-only now")
        XCTAssertEqual(HomeGlance.items(brief: nil, signals: input).first { $0.label == "FINANCE" }?.value, "$214 this week")

        input.finance = finance(week: 214, month: 486, written: at(9, day: 27, month: 10))
        XCTAssertFalse(HomeGlance.items(brief: nil, signals: input).contains { $0.label == "FINANCE" })
    }

    // MARK: Health

    func testHealthLogStandsInWhenTheBriefHasNoWhoopReading() {
        var input = signals(now: at(8))
        input.healthDay = HomeHealthDay(recovery: 57, sleepHours: 4.3, sleepPerformance: 52)
        let card = cards(input).first { $0.kind == .health }
        XCTAssertEqual(card?.kickerText, "RECOVERY 57 · SLEEP 52% · HEALTH LOG")
        XCTAssertEqual(card?.title, "Middling recovery. Front-load the hard work.")
        XCTAssertEqual(HomeGlance.items(brief: nil, signals: input).first { $0.label == "SLEEP" }?.value, "4.3h")
    }

    func testAShortNightWithNoBedtimeSuggestsAnEarlyOne() {
        var input = signals(now: at(21))
        input.healthDay = HomeHealthDay(recovery: 57, sleepHours: 4.3, sleepPerformance: 52)
        let card = cards(input).first { $0.kind == .sleep }
        XCTAssertEqual(card?.kickerText, "SLEEP · 4.3H LAST NIGHT")
        XCTAssertEqual(card?.primary.action, .ask(prefill: "Plan me an early night around tomorrow."))

        input.bedtime = at(23, 15)
        let bedtime = cards(input).first { $0.kind == .sleep }
        XCTAssertEqual(bedtime?.title, "Lights out by 11:15 PM tonight.")
        XCTAssertEqual(bedtime?.body.first, "Last night was 4.3 hours, so don't push it.")

        input.bedtime = nil
        input.healthDay = HomeHealthDay(recovery: 70, sleepHours: 7.8, sleepPerformance: 90)
        XCTAssertNil(cards(input).first { $0.kind == .sleep })
    }

    // MARK: Glance row

    func testGlanceRowWithEverything() {
        var input = signals(now: at(15))
        input.projects = [project("a", .running, since: at(14, 59)), project("q", .needsYou("?"), since: at(13))]
        input.finance = finance(week: 214, month: 486, written: at(9))
        input.healthDay = HomeHealthDay(recovery: 71, sleepHours: 7.6, sleepPerformance: 84)
        input.focusMinutesToday = 80
        XCTAssertEqual(HomeGlance.items(brief: nil, signals: input), [
            HomeGlanceItem(label: "PROJECTS", value: "1 running, 1 waiting", action: .openProject(id: nil)),
            HomeGlanceItem(label: "FINANCE", value: "$214 this week", action: .openFinance),
            HomeGlanceItem(label: "SLEEP", value: "7.6h", action: .openHealth),
            HomeGlanceItem(label: "FOCUS", value: "1h20 today", action: .openPlan),
        ])
    }

    func testGlanceRowLeavesOutWhatItDoesNotKnow() {
        XCTAssertEqual(HomeGlance.items(brief: nil, signals: signals(now: at(15))), [])
        var input = signals(now: at(15))
        input.focusMinutesToday = 0
        input.finance = finance(week: 0, month: 0, written: at(9))
        XCTAssertEqual(HomeGlance.items(brief: nil, signals: input).map(\.value), ["$0 this week", "none yet today"])
    }

    // MARK: Parsers

    func testParsesTheFinanceSummary() throws {
        let json = """
        {"writtenAt":"2026-11-02T10:54:57Z","accounts":[{"currency":"GBP"}],"spentThisWeek":42.5,"spentThisMonth":120,
         "topCategoriesThisMonth":[{"category":"FOOD_AND_DRINK","total":80}],
         "recurring":[{"name":"Elevenlabs.io","amount":6,"lastSeen":"2026-10-31"},{"name":"Old","amount":3}]}
        """
        let parsed = try XCTUnwrap(HomeSectionReader.finance(Data(json.utf8)))
        XCTAssertEqual(parsed.currency, "GBP")
        XCTAssertEqual(parsed.spentThisWeek, 42.5)
        XCTAssertEqual(parsed.topCategory, "FOOD_AND_DRINK")
        XCTAssertEqual(parsed.recurring.count, 2)
        XCTAssertNotNil(parsed.recurring[0].lastSeen)
        XCTAssertNil(parsed.recurring[1].lastSeen)
        XCTAssertEqual(HomeFormat.money(214, currency: "GBP"), "£214")
        XCTAssertNil(HomeSectionReader.finance(Data("{}".utf8)))
        XCTAssertNil(HomeSectionReader.finance(Data("not json".utf8)))
    }

    func testParsesTodaysHealthLogRow() {
        let json = #"{"days":{"2026-11-02":{"recovery":57,"sleepHours":4.3,"sleepPerformance":52},"2026-11-01":{"calories":0}}}"#
        XCTAssertEqual(HomeSectionReader.healthDay(Data(json.utf8), dayKey: "2026-11-02"),
                       HomeHealthDay(recovery: 57, sleepHours: 4.3, sleepPerformance: 52))
        XCTAssertNil(HomeSectionReader.healthDay(Data(json.utf8), dayKey: "2026-11-01"), "a row with no readings is nothing")
        XCTAssertNil(HomeSectionReader.healthDay(Data(json.utf8), dayKey: "2026-11-03"))
    }

    func testSumsTodaysServedFocus() {
        let log = """
        {"dayKey":"2026-11-01","servedFocusSeconds":3000}
        {"dayKey":"2026-11-02","servedFocusSeconds":3000.4}
        {"dayKey":"2026-11-02","servedFocusSeconds":1830}
        not json
        """
        XCTAssertEqual(HomeSectionReader.focusMinutes(log, dayKey: "2026-11-02"), 80)
        XCTAssertEqual(HomeSectionReader.focusMinutes(log, dayKey: "2026-11-03"), 0)
        XCTAssertNil(HomeSectionReader.focusMinutes("", dayKey: "2026-11-02"))
        XCTAssertEqual(HomeFormat.hoursMinutes(80), "1h20")
        XCTAssertEqual(HomeFormat.hoursMinutes(45), "45m")
    }

    // MARK: Hologram placement

    func testHologramFillsTheFieldWhenEmptyAndHalosTheSunOtherwise() {
        let empty = HomeHologramPlacement.forCards(0)
        XCTAssertGreaterThan(empty.centre.y, 0.5, "below the calm line")
        let halo = HomeHologramPlacement.behindSun()
        XCTAssertLessThan(halo.opacity, empty.opacity, "dim behind card text")
        let sun = CGRect(x: 520, y: 120, width: 350, height: 260)
        let frame = halo.frame(around: sun, in: CGSize(width: 1440, height: 800))
        XCTAssertEqual(frame.width, frame.height)
        XCTAssertEqual(frame.midX, sun.midX, accuracy: 0.01)
        XCTAssertEqual(frame.midY, sun.midY, accuracy: 0.01)
        XCTAssertGreaterThan(frame.width, sun.width, "a glow shows past the card")
    }
}
