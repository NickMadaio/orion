import CoreGraphics
import XCTest
@testable import Orion

final class TypedSummonFlowTests: XCTestCase {
    func testWholeConversationWalk() {
        var flow = TypedSummonFlow()
        XCTAssertFalse(flow.isVisible)
        flow.present()
        XCTAssertEqual(flow.stage, .idle)
        XCTAssertFalse(flow.hologramLeft)

        flow.sent()
        XCTAssertEqual(flow.stage, .thinking)
        XCTAssertFalse(flow.hologramLeft, "the hologram stays centred while he thinks")

        flow.answered("you have two things today")
        XCTAssertEqual(flow.stage, .answered)
        XCTAssertTrue(flow.hologramLeft)
        XCTAssertEqual(flow.answer, "you have two things today")
        XCTAssertFalse(flow.answerDimmed)

        flow.sent()
        XCTAssertEqual(flow.stage, .thinking)
        XCTAssertTrue(flow.hologramLeft, "a follow-up does not move the hologram back")
        XCTAssertTrue(flow.answerDimmed)
        XCTAssertEqual(flow.answer, "you have two things today")

        flow.answered("moved it to four")
        XCTAssertEqual(flow.answer, "moved it to four")
        XCTAssertFalse(flow.answerDimmed)

        flow.dismiss()
        XCTAssertEqual(flow, TypedSummonFlow())
    }

    func testLateReplyAfterDismissDoesNothing() {
        var flow = TypedSummonFlow()
        flow.present(); flow.sent(); flow.dismiss()
        flow.answered("too late")
        XCTAssertEqual(flow.stage, .dismissed)
        XCTAssertNil(flow.answer)
        flow.sent()
        XCTAssertEqual(flow.stage, .dismissed)
    }

    func testAnswerNeedsASend() {
        var flow = TypedSummonFlow()
        flow.present()
        flow.answered("unprompted")
        XCTAssertEqual(flow.stage, .idle)
        XCTAssertNil(flow.answer)
    }

    func testCancelledTurnRestoresThePreviousLayout() {
        var flow = TypedSummonFlow()
        flow.present(); flow.sent(); flow.abandoned()
        XCTAssertEqual(flow.stage, .idle)
        flow.sent(); flow.answered("a"); flow.sent(); flow.abandoned()
        XCTAssertEqual(flow.stage, .answered)
        XCTAssertEqual(flow.answer, "a")
    }

    func testPresentingAgainStartsClean() {
        var flow = TypedSummonFlow()
        flow.present(); flow.sent(); flow.answered("old"); flow.dismiss(); flow.present()
        XCTAssertEqual(flow.stage, .idle)
        XCTAssertNil(flow.answer)
    }
}

final class TypedSummonGeometryTests: XCTestCase {
    private let screens = [CGSize(width: 1440, height: 900), CGSize(width: 1728, height: 1117)]
    private let inset: CGFloat = 110

    private func layout(_ screen: CGSize, left: Bool, answerHeight: CGFloat = 200) -> TypedSummonGeometry {
        TypedSummonGeometry.layout(screen: screen, bottomInset: inset, hologramLeft: left, answerHeight: answerHeight)
    }

    func testComposerIsBottomCentreAndWide() {
        for screen in screens {
            let frames = layout(screen, left: false)
            XCTAssertEqual(frames.composer.midX, screen.width / 2, accuracy: 0.5)
            XCTAssertEqual(screen.height - frames.composer.maxY, inset, accuracy: 0.5)
            XCTAssertGreaterThan(frames.composer.width, 600)
            XCTAssertLessThanOrEqual(frames.composer.width, 860)
            XCTAssertGreaterThan(frames.composer.minY, screen.height * 0.6, "it sits low, like Home's")
        }
    }

    func testIdleHologramIsCentredAboveTheComposer() {
        for screen in screens {
            let frames = layout(screen, left: false)
            XCTAssertEqual(frames.hologram.midX, screen.width / 2, accuracy: 0.5)
            XCTAssertLessThanOrEqual(frames.hologram.maxY, frames.composer.minY - 10)
            XCTAssertGreaterThanOrEqual(frames.hologram.minY, 0)
            XCTAssertFalse(frames.hologram.intersects(frames.composer))
        }
    }

    func testAnsweredHologramIsLeftOfTheTextAndNothingOverlaps() {
        for screen in screens {
            for height in [24, 90, 200, 320, 5_000] as [CGFloat] {
                let frames = layout(screen, left: true, answerHeight: height)
                XCTAssertLessThan(frames.hologram.maxX, frames.answer.minX, "hologram left of the text at \(height)")
                XCTAssertLessThan(frames.hologram.midX, screen.width / 2)
                XCTAssertFalse(frames.hologram.intersects(frames.answer))
                XCTAssertFalse(frames.hologram.intersects(frames.composer))
                XCTAssertFalse(frames.answer.intersects(frames.composer))
                XCTAssertLessThanOrEqual(frames.answer.maxY, frames.composer.minY - 10)
                XCTAssertLessThanOrEqual(frames.answer.height, TypedSummonGeometry.answerMaxHeight, "long answers scroll")
                XCTAssertGreaterThanOrEqual(frames.hologram.minY, 0)
                XCTAssertGreaterThanOrEqual(frames.answer.minY, 0)
                XCTAssertLessThanOrEqual(frames.answer.maxX, frames.composer.maxX + 0.5)
                XCTAssertGreaterThanOrEqual(frames.hologram.minX, frames.composer.minX - 0.5)
            }
        }
    }

    func testHologramShrinksWhenAnswered() {
        let idle = layout(screens[0], left: false).hologram
        let answered = layout(screens[0], left: true).hologram
        XCTAssertLessThan(answered.width, idle.width)
        XCTAssertGreaterThan(answered.width, idle.width * 0.5, "a bit smaller, not tiny")
    }

    func testTallComposerPushesTheContentUp() {
        let one = TypedSummonGeometry.layout(screen: screens[0], bottomInset: inset, hologramLeft: false, answerHeight: 0)
        let four = TypedSummonGeometry.layout(screen: screens[0], bottomInset: inset, hologramLeft: false, answerHeight: 0, composerHeight: 130)
        XCTAssertLessThan(four.hologram.maxY, one.hologram.maxY)
        XCTAssertFalse(four.hologram.intersects(four.composer))
    }
}
