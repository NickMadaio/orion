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

    /// Wide, short cards: about this tall at 300 pt wide (title 2 lines, body 2 lines, tight padding).
    private func frames(count: Int, width: CGFloat, maxHeight: CGFloat? = nil, height: CGFloat = 165) -> [CGRect] {
        HomePriorityPlan.fitted(count: count, width: width, maxHeight: maxHeight) { _, _ in height }
    }

    func testTheSunIsCentredLevelAndTheLargest() {
        for width in [1_148.0, 1_260, 1_280, 1_728] {
            for count in 1...5 {
                let f = frames(count: count, width: width)
                XCTAssertEqual(f[0].midX, width / 2, accuracy: 0.5, "\(count) cards at \(width)")
                XCTAssertEqual(f.indices.max { f[$0].width < f[$1].width }, 0)
                XCTAssertEqual(f[0].minY, 0, accuracy: 0.5, "the sun is in the top band")
            }
        }
        XCTAssertEqual(HomePriorityPlan.tilt(0), 0)
    }

    func testRanksTwoAndThreeFlankTheSunInTheSameBandMirrored() {
        for width in [1_280.0, 1_728] {
            let f = frames(count: 3, width: width)
            XCTAssertLessThan(f[1].midX, f[0].midX, "rank 2 on the left")
            XCTAssertGreaterThan(f[2].midX, f[0].midX, "rank 3 on the right")
            XCTAssertEqual(f[0].midX - f[1].midX, f[2].midX - f[0].midX, accuracy: 0.5, "mirrored")
            XCTAssertEqual(f[0].minX - f[1].maxX, HomePriorityPlan.gap, accuracy: 0.5)
            XCTAssertEqual(f[2].minX - f[0].maxX, HomePriorityPlan.gap, accuracy: 0.5)
            XCTAssertEqual(f[1].midY, f[2].midY, accuracy: 0.5)
            XCTAssertEqual(f[1].midY, f[0].midY, accuracy: 12, "the same band as the sun")
        }
        XCTAssertEqual(HomePriorityPlan.tilt(1), -HomePriorityPlan.tilt(2), "tilts mirror")
        XCTAssertEqual(HomePriorityPlan.tilt(3), -HomePriorityPlan.tilt(4))
    }

    func testRanksFourAndFiveSitAtTheOuterEdgesOneStepLowerNotUnderTheSun() {
        for width in [1_148.0, 1_260, 1_728] {
            let f = frames(count: 5, width: width)
            XCTAssertLessThan(f[3].midX, f[1].midX, "rank 4 outer left")
            XCTAssertGreaterThan(f[4].midX, f[2].midX, "rank 5 outer right")
            XCTAssertEqual(f[0].midX - f[3].midX, f[4].midX - f[0].midX, accuracy: 0.5, "mirrored")
            XCTAssertEqual(f[3].minY, f[4].minY, accuracy: 0.5)
            XCTAssertGreaterThan(f[3].minY, f[1].maxY, "one step lower than ranks 2 and 3")
            XCTAssertLessThanOrEqual(f[3].maxX, f[0].minX, "not under the sun")
            XCTAssertGreaterThanOrEqual(f[4].minX, f[0].maxX)
        }
        let four = frames(count: 4, width: 1_440)
        XCTAssertLessThan(four[3].midX, four[0].midX)
    }

    func testNoOverlapNoClippingAndShrinksOnAShortWindow() {
        // 366 is roughly what HomeScene gives the cluster in a 760-pt-tall window.
        let room: [CGFloat?] = [nil, 366]
        for width in [1_148.0, 1_260, 1_280, 1_728] {
            for maxHeight in room {
                for count in 1...5 {
                    let f = frames(count: count, width: width, maxHeight: maxHeight)
                    for (i, a) in f.enumerated() {
                        XCTAssertGreaterThanOrEqual(a.minX, -0.001, "clipped left")
                        XCTAssertLessThanOrEqual(a.maxX, width + 0.001, "clipped right")
                        for b in f[(i + 1)...] {
                            XCTAssertFalse(a.insetBy(dx: -3, dy: -3).intersects(b.insetBy(dx: -3, dy: -3)),
                                           "\(a) overlaps \(b): \(count) cards, width \(width), room \(String(describing: maxHeight))")
                        }
                    }
                    if let maxHeight { XCTAssertLessThanOrEqual(f.map(\.maxY).max()!, maxHeight + 0.5, "\(count) cards fit a short window") }
                }
            }
        }
    }

    func testCardsStayLandscape() {
        let f = frames(count: 5, width: 1_440)
        XCTAssertGreaterThanOrEqual(f[0].width / f[0].height, 2.0, "the sun is wide and short")
        XCTAssertGreaterThanOrEqual(f[1].width / f[1].height, 1.7)
    }

    /// Area of `rect` inside `circle`, by sampling.
    private func overlap(_ rect: CGRect, _ circle: CGRect) -> CGFloat {
        let n = 60
        var inside = 0
        for i in 0..<n { for j in 0..<n {
            let p = CGPoint(x: rect.minX + rect.width * (CGFloat(i) + 0.5) / CGFloat(n), y: rect.minY + rect.height * (CGFloat(j) + 0.5) / CGFloat(n))
            let dx = p.x - circle.midX, dy = p.y - circle.midY
            if dx * dx + dy * dy <= circle.width * circle.width / 4 { inside += 1 }
        } }
        return CGFloat(inside) / CGFloat(n * n)
    }

    func testNoCardCoversMoreThanATenthOfTheHologramAt1440x900() {
        // HomeScene at 1440x900: the scene is 1396 wide and 806 tall; the spread is 1260 wide, ~100 pt down
        // (greeting block plus the 30 pt step).
        let scene = CGSize(width: 1_396, height: 806)
        let originX = (scene.width - 1_260) / 2, originY: CGFloat = 100
        for count in 3...5 {
            let circle = HomeHologramPlacement.forCards(count).frame(in: scene)
            let f = frames(count: count, width: 1_260, maxHeight: scene.height - 300)
            for (rank, frame) in f.enumerated() {
                let placed = frame.offsetBy(dx: originX, dy: originY)
                XCTAssertLessThanOrEqual(overlap(placed, circle), 0.10, "rank \(rank + 1) of \(count) covers too much of the hologram")
            }
        }
    }

    func testTheHologramIsWhereItWasBeforeTheOrbit() {
        XCTAssertEqual(HomeHologramPlacement.forCards(2), HomeHologramPlacement(centre: UnitPoint(x: 0.5, y: 0.58), diameter: 0.52, opacity: 0.92))
        XCTAssertEqual(HomeHologramPlacement.forCards(3).opacity, 0.7)
    }

    func testTheArrangementIsDeterministicAndTitlesStayReadable() {
        XCTAssertEqual(frames(count: 5, width: 1_260), frames(count: 5, width: 1_260))
        let sizes = (0..<5).map { HomeCardStyle.titleSize(rank: $0) }
        XCTAssertEqual(sizes, sizes.sorted(by: >))
        XCTAssertGreaterThan(sizes[0], sizes[1])
        XCTAssertGreaterThanOrEqual(sizes.min()!, 18)
        XCTAssertEqual(HomePriorityPlan.dims, HomePriorityPlan.dims.sorted(by: >), "dimmer outward")
    }

    // MARK: Renders

    private func page(_ facts: BriefFacts, _ signals: HomeSignals, size: CGSize, limit: Int = 5) -> some View {
        let cards = Array(HomeCardBuilder.cards(brief: facts, signals: signals).prefix(limit))
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

    func testRendersThreeFourAndFiveCardDays() throws {
        let size = CGSize(width: 1_440, height: 900)
        let now = at(8, 30)
        let facts = busyFacts(now: now), signals = busySignals(now: now)
        XCTAssertEqual(HomeCardBuilder.cards(brief: facts, signals: signals).count, 5)
        for count in [3, 4, 5] {
            try UIRender.write("w17b3-home-\(count)-1440", UIRender.onDesktop(page(facts, signals, size: size, limit: count), light: false, size: size), size: size)
        }
        let short = CGSize(width: 1_440, height: 760)
        try UIRender.write("w17b3-home-5-1440x760", UIRender.onDesktop(page(facts, signals, size: short, limit: 5), light: false, size: short), size: short)
    }
}
