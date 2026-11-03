import MobileCore
import SwiftUI
import XCTest
@testable import Orion

/// Wave 17: Home cards ranked by priority and laid out by it (centre = most important), finance gone from the spread.
@MainActor
final class HomePriorityTests: XCTestCase {
    private let zone = UIRender.zone

    private func at(_ hour: Int, _ minute: Int = 0, day: Int = 2, month: Int = 11) -> Date {
        var calendar = Calendar(identifier: .gregorian); calendar.timeZone = zone
        return calendar.date(from: DateComponents(year: 2026, month: month, day: day, hour: hour, minute: minute))!
    }

    private func card(_ kind: HomeCardKind, rank: Int = 3, title: String? = nil) -> HomeCard {
        HomeCard(kind: kind, kicker: [kind.rawValue], title: title ?? kind.rawValue, body: [],
                 primary: HomeCardButton(title: "go", action: .openPlan), details: nil, rank: rank)
    }

    // MARK: The table

    func testTheRankedTableIsTheSpecifiedOrder() {
        XCTAssertEqual(HomeCardPriority.order, [.question, .event, .tasks, .sleep, .focus, .project, .health])
        XCTAssertEqual(HomeCardPriority.tier(.question), 1)
        XCTAssertEqual(HomeCardPriority.tier(.health), 7)
    }

    func testEveryKindIsRankedAndNoFinanceKindExists() {
        XCTAssertEqual(Set(HomeCardKind.allCases), Set(HomeCardPriority.order))
        XCTAssertFalse(HomeCardKind.allCases.map(\.rawValue).contains("finance"))
    }

    func testKindBeatsUrgencyAndUrgencyBreaksTiesWithinAKind() {
        // A health card with the lowest rank number still sits behind a question with a high one.
        let ordered = HomeCardPriority.ordered([card(.health, rank: 0), card(.question, rank: 9), card(.tasks, rank: 4),
                                                card(.event, rank: 3), card(.tasks, rank: 2, title: "sooner")])
        XCTAssertEqual(ordered.map(\.kind), [.question, .event, .tasks, .tasks, .health])
        XCTAssertEqual(ordered[2].title, "sooner", "the more urgent of two same-kind cards leads")
    }

    func testIsEveningOnlyFromLateAfternoonThroughTheSmallHours() {
        XCTAssertFalse(HomeCardPriority.isEvening(hour: 10))
        XCTAssertFalse(HomeCardPriority.isEvening(hour: 16))
        XCTAssertTrue(HomeCardPriority.isEvening(hour: 17))
        XCTAssertTrue(HomeCardPriority.isEvening(hour: 1))
    }

    // MARK: Built cards

    private func busyFacts(now: Date) -> BriefFacts {
        var facts = BriefFacts(day: LogicalDay(start: at(7), fromWakeTime: true), clock: BriefClock(now: now, timeZone: zone),
                               events: [AgendaEvent(id: "e", title: "CS2100 Program Design", start: at(9, 30), end: at(10, 30),
                                                    isAllDay: false, calendarName: "Classes", colorHex: "5BB8FF")])
        facts.overdue = [SyncedTask(id: "t", title: "Send the problem set", isComplete: false, dueDate: at(17, day: 1), hasAlarm: false)]
        facts.readings = BriefFacts.Readings(recovery: 71, sleepPerformance: 84, sleepHours: 7.6, hrvDelta: "+6",
                                             restingHeartRate: 52, strainTarget: StrainTarget.forRecovery(71))
        return facts
    }

    private func busySignals(now: Date) -> HomeSignals {
        var signals = HomeSignals(question: PendingQuestion(id: "q", text: "Gym tonight?", at: at(8)), now: now)
        signals.projects = [HomeProject(id: "p", name: "Deadline radar", phase: .running, accepted: 4, total: 9, activeTask: "Parse dates", since: at(8))]
        signals.finance = HomeFinance(currency: "USD", spentThisWeek: 214, spentThisMonth: 486, topCategory: nil, recurring: [], writtenAt: at(7))
        signals.bedtime = at(23)
        return signals
    }

    func testBuiltCardsFollowThePriorityTableCapAtFiveAndNeverIncludeFinance() {
        let now = at(8, 30)
        let cards = HomeCardBuilder.cards(brief: busyFacts(now: now), signals: busySignals(now: now))
        XCTAssertEqual(cards.count, 5)
        XCTAssertEqual(cards.map(\.kind), [.question, .event, .tasks, .focus, .project], "health is cut by the cap, not finance by luck")
        XCTAssertEqual(HomeCardBuilder.maxCards, 5)
    }

    func testBedtimeOnlyAppearsInTheEvening() {
        let morning = at(8, 30)
        var signals = busySignals(now: morning)
        signals.bedtime = at(9, 30)
        XCTAssertFalse(HomeCardBuilder.cards(brief: busyFacts(now: morning), signals: signals).contains { $0.kind == .sleep })
        let evening = at(21, 30)
        signals.now = evening
        signals.bedtime = at(23)
        let cards = HomeCardBuilder.cards(brief: busyFacts(now: evening), signals: signals)
        XCTAssertTrue(cards.contains { $0.kind == .sleep })
        let kinds = cards.map(\.kind)
        if let sleep = kinds.firstIndex(of: .sleep), let focus = kinds.firstIndex(of: .focus) { XCTAssertLessThan(sleep, focus) }
    }

    // MARK: Layout

    private func frames(count: Int, width: CGFloat, heights: [CGFloat]? = nil) -> [CGRect] {
        let widths = HomePriorityPlan.widths(count: count, width: width)
        let heights = heights ?? (0..<count).map { 240 + CGFloat($0 * 17) }
        return HomePriorityPlan.frames(widths: widths, heights: heights, width: width)
    }

    func testTheTopPriorityCardIsTheCentreAndTheWidest() {
        for width in [1_148.0, 1_260, 1_280, 1_728] {
            for count in 3...5 {
                let f = frames(count: count, width: width)
                let centre = width / 2
                let nearest = f.indices.min { abs(f[$0].midX - centre) < abs(f[$1].midX - centre) }
                XCTAssertEqual(nearest, 0, "rank 0 is in the middle at \(width) pt, \(count) cards")
                XCTAssertEqual(f.indices.max { f[$0].width < f[$1].width }, 0)
                XCTAssertEqual(f[0].width / f[1].width, 1.25, accuracy: 0.001, "1.25x the next card")
            }
        }
    }

    func testRanksFanLeftRightFarLeftFarRightEachStepSmaller() {
        let f = frames(count: 5, width: 1_260)
        XCTAssertLessThan(f[1].midX, f[0].midX, "2nd on the left")
        XCTAssertGreaterThan(f[2].midX, f[0].midX, "3rd on the right")
        XCTAssertLessThan(f[3].midX, f[1].midX, "4th far left")
        XCTAssertGreaterThan(f[4].midX, f[2].midX, "5th far right")
        XCTAssertGreaterThan(f[1].width, f[3].width, "left side narrows outward")
        XCTAssertGreaterThan(f[2].width, f[4].width, "right side narrows outward")
        XCTAssertEqual(f[0].minY, 0)
        XCTAssertTrue(f[1...].allSatisfy { $0.minY > 0 }, "lower priority hangs slightly down")
        XCTAssertLessThan(f[1].minY, f[3].minY)
    }

    func testNoOverlapAndNoClippingAtTheSupportedWidths() {
        for width in [1_148.0, 1_260, 1_280, 1_728] {
            for count in 1...5 {
                let f = frames(count: count, width: width, heights: Array(repeating: 420, count: count))
                for (i, a) in f.enumerated() {
                    XCTAssertGreaterThanOrEqual(a.minX, 0, "clipped left, \(count) cards at \(width)")
                    XCTAssertLessThanOrEqual(a.maxX, width + 0.001, "clipped right, \(count) cards at \(width)")
                    for b in f[(i + 1)...] {
                        // Tilts are under 1 degree: 6 pt of corner swing at most on the tallest card.
                        XCTAssertFalse(a.insetBy(dx: -3, dy: -3).intersects(b.insetBy(dx: -3, dy: -3)), "\(a) overlaps \(b) at \(width)")
                    }
                }
            }
        }
    }

    func testCardsStayWideEnoughToReadAtTheSmallestSupportedWidth() {
        let f = frames(count: 5, width: 1_148)
        XCTAssertGreaterThanOrEqual(f.map(\.width).min()!, HomePriorityPlan.minBase * HomePriorityPlan.scales[4] - 0.001)
        XCTAssertFalse(HomePriorityPlan.isStacked(count: 5, width: 1_148))
        XCTAssertTrue(HomePriorityPlan.isStacked(count: 5, width: 800), "too narrow for five across: stack by priority")
    }

    func testOneAndTwoCardsAreCentred() {
        for width in [1_148.0, 1_728] {
            let one = frames(count: 1, width: width)
            XCTAssertEqual(one[0].midX, width / 2, accuracy: 0.5)
            let two = frames(count: 2, width: width)
            XCTAssertEqual((two[0].minX + two[1].maxX) / 2, width / 2, accuracy: 0.5, "the pair is centred as a group")
            XCTAssertGreaterThan(two[0].width, two[1].width, "the top priority is still the larger")
            XCTAssertLessThanOrEqual(two[0].width, HomePriorityPlan.maxBase * 1.25 + 0.001)
        }
    }

    func testTheArrangementIsDeterministicAndTitleSizeShrinksWithRank() {
        XCTAssertEqual(frames(count: 5, width: 1_260), frames(count: 5, width: 1_260))
        let sizes = (0..<5).map { HomeCardStyle.titleSize(rank: $0) }
        XCTAssertEqual(sizes, sizes.sorted(by: >))
        XCTAssertGreaterThan(sizes[0], sizes[1])
        XCTAssertEqual(HomePriorityPlan.dims, HomePriorityPlan.dims.sorted(by: >), "dimmer outward")
        XCTAssertLessThan(abs(HomePriorityPlan.tilt(0)), 0.5, "the centre card is nearly level")
    }

    // MARK: Renders

    private func page(_ facts: BriefFacts, _ signals: HomeSignals, size: CGSize) -> some View {
        let cards = HomeCardBuilder.cards(brief: facts, signals: signals)
        return VStack(spacing: 0) {
            DashboardHeader(selected: .home, issues: [], onSelect: { _ in })
            HomeScene(greeting: HomeGreeting.line(clock: facts.clock, name: "Nick"),
                      subline: HomeGreeting.subline(knowledgeCount: 214, cardCount: cards.count, clock: facts.clock),
                      cards: cards, glance: HomeGlance.items(brief: facts, signals: signals),
                      hologram: HomeHologram.advanced(by: 6), hologramFrozenTime: 6,
                      availableHeight: size.height - 94, onAction: { _ in }) { Color.clear.frame(height: 56) }
                .padding(.horizontal, 22).padding(.top, 6).padding(.bottom, 18)
        }
    }

    func testRendersTwoAndFiveCardDaysAtTwoWidths() throws {
        let now = at(8, 30), soon = at(9, 15)
        let five = (busyFacts(now: now), busySignals(now: now))
        var twoFacts = busyFacts(now: soon); twoFacts.readings = BriefFacts.Readings()
        var twoSignals = HomeSignals(now: soon); twoSignals.selfName = "Nick"
        for (name, input) in [("five", five), ("two", (twoFacts, twoSignals))] {
            for width in [1_280.0, 1_728] {
                let size = CGSize(width: width, height: 900)
                try UIRender.write("w17b-home-\(name)-\(Int(width))", UIRender.onDesktop(page(input.0, input.1, size: size), light: false, size: size), size: size)
            }
        }
        XCTAssertEqual(HomeCardBuilder.cards(brief: twoFacts, signals: twoSignals).count, 2)
    }
}
