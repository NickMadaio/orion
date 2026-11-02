import MobileCore
import SwiftUI
import XCTest
@testable import OrionViews
@testable import Orion

/// Wave 12 (2026-11-02): the rules behind the motion, tested as plain functions so no window is needed.
@MainActor
final class Wave12MotionTests: XCTestCase {

    // MARK: Ambient clock

    func testAmbientPausesWhenHiddenMinimisedAppHiddenOrLowPower() {
        XCTAssertFalse(AmbientPolicy.shouldPause(windowVisible: true, miniaturized: false, appHidden: false, lowPower: false))
        XCTAssertTrue(AmbientPolicy.shouldPause(windowVisible: false, miniaturized: false, appHidden: false, lowPower: false))
        XCTAssertTrue(AmbientPolicy.shouldPause(windowVisible: true, miniaturized: true, appHidden: false, lowPower: false))
        XCTAssertTrue(AmbientPolicy.shouldPause(windowVisible: true, miniaturized: false, appHidden: true, lowPower: false))
        XCTAssertTrue(AmbientPolicy.shouldPause(windowVisible: true, miniaturized: false, appHidden: false, lowPower: true))
    }

    func testAmbientPhaseResumesWhereItStoppedAndIgnoresLongGaps() {
        let phase = AmbientPhase()
        let t0 = Date(timeIntervalSinceReferenceDate: 1000)
        XCTAssertEqual(phase.advance(to: t0), 0)
        XCTAssertEqual(phase.advance(to: t0.addingTimeInterval(0.1)), 0.1, accuracy: 1e-9)
        phase.pause()
        // An hour later: the first tick after a pause adds nothing, so the phase does not jump.
        XCTAssertEqual(phase.advance(to: t0.addingTimeInterval(3600)), 0.1, accuracy: 1e-9)
        XCTAssertEqual(phase.advance(to: t0.addingTimeInterval(3600.1)), 0.2, accuracy: 1e-9)
        // A stall without a pause is capped, not counted in full.
        XCTAssertEqual(phase.advance(to: t0.addingTimeInterval(4000)), 0.45, accuracy: 1e-9)
    }

    // MARK: Page travel

    func testPageTravelFollowsNavOrder() {
        XCTAssertTrue(PageTravel.isForward(from: .home, to: .knowledge))
        XCTAssertFalse(PageTravel.isForward(from: .settings, to: .tasks))
        XCTAssertTrue(PageTravel.isForward(from: .home, to: .home))
    }

    func testPageAnchorIsClampedAlongTheTopEdge() {
        XCTAssertEqual(PageTravel.anchor(centerFraction: 0.25), UnitPoint(x: 0.25, y: 0))
        XCTAssertEqual(PageTravel.anchor(centerFraction: 4), UnitPoint(x: 1, y: 0))
        XCTAssertEqual(PageTravel.anchor(centerFraction: nil), UnitPoint(x: 0.5, y: 0))
    }

    // MARK: Deal and chat

    func testDealBeatsAreElevenHundredthsApartAfterAQuarterSecond() {
        XCTAssertEqual(ViewMotion.dealDelay(order: 0), 0.25, accuracy: 1e-9)
        XCTAssertEqual(ViewMotion.dealDelay(order: 3), 0.58, accuracy: 1e-9)
        XCTAssertEqual(ViewMotion.dealDelay(order: 99), ViewMotion.dealDelay(order: 12), accuracy: 1e-9)
    }

    func testTimeDividerOnlyAfterMoreThanThirtyMinutes() {
        let base = Date(timeIntervalSinceReferenceDate: 0)
        func message(_ id: String, _ offset: TimeInterval) -> ChatMessage {
            ChatMessage(id: id, role: .user, text: id, at: base.addingTimeInterval(offset), device: "mac")
        }
        XCTAssertFalse(ChatTime.needsDivider(after: nil, message("a", 0)))
        XCTAssertFalse(ChatTime.needsDivider(after: message("a", 0), message("b", 30 * 60)))
        XCTAssertTrue(ChatTime.needsDivider(after: message("a", 0), message("b", 30 * 60 + 1)))
    }

    func testTimeLabelNamesTodayAndYesterday() {
        var calendar = Calendar(identifier: .gregorian); calendar.timeZone = TimeZone(identifier: "UTC")!
        let now = Date(timeIntervalSinceReferenceDate: 800_000_000)
        XCTAssertTrue(ChatTime.label(now, now: now, calendar: calendar).hasPrefix("Today"))
        XCTAssertTrue(ChatTime.label(now.addingTimeInterval(-86_400), now: now, calendar: calendar).hasPrefix("Yesterday"))
        XCTAssertFalse(ChatTime.label(now.addingTimeInterval(-5 * 86_400), now: now, calendar: calendar).hasPrefix("Yesterday"))
    }
}
