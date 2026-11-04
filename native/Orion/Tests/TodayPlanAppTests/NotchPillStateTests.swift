import XCTest
@testable import Orion

/// The pill's state machine, with no AppKit: who docks, what each click does, and when the preview ends.
final class NotchPillStateTests: XCTestCase {

    private func run(_ events: [NotchPillEvent], from start: NotchPillState = NotchPillState()) -> (NotchPillState, [NotchPillEffect]) {
        events.reduce((start, [NotchPillEffect]())) { acc, event in
            let (next, effects) = NotchPillState.reduce(acc.0, event)
            return (next, acc.1 + effects)
        }
    }

    func testNoSpeechClickAwayJustDismissesThePanel() {
        for phase in [NotchTurnPhase.idle, .listening, .thinking, .speaking] {
            let (state, effects) = run([.dismissRequested(hasSpeech: false, phase: phase)])
            XCTAssertEqual(state.mode, .hidden, "\(phase)")
            XCTAssertEqual(effects, [.dismissPanel], "\(phase)")
        }
    }

    func testSpeechButNothingInFlightJustDismisses() {
        let (state, effects) = run([.dismissRequested(hasSpeech: true, phase: .idle)])
        XCTAssertEqual(state.mode, .hidden)
        XCTAssertEqual(effects, [.dismissPanel])
    }

    func testSpeechAndATurnInFlightDocksInsteadOfCancelling() {
        let (thinking, a) = run([.dismissRequested(hasSpeech: true, phase: .thinking)])
        XCTAssertEqual(thinking.mode, .thinking)
        XCTAssertEqual(a, [.dockPanel])
        XCTAssertFalse(a.contains(.cancelTurn))
        let (speaking, b) = run([.dismissRequested(hasSpeech: true, phase: .speaking)])
        XCTAssertEqual(speaking.mode, .speaking)
        XCTAssertEqual(b, [.dockPanel])
    }

    func testDismissWhileAlreadyDockedDoesNothing() {
        let docked = run([.dismissRequested(hasSpeech: true, phase: .thinking)]).0
        let (state, effects) = run([.dismissRequested(hasSpeech: true, phase: .thinking)], from: docked)
        XCTAssertEqual(state, docked)
        XCTAssertTrue(effects.isEmpty)
    }

    func testThinkingBecomesSpeakingAndTheAnswerArrives() {
        let (state, _) = run([
            .dismissRequested(hasSpeech: true, phase: .thinking),
            .phaseChanged(.speaking),
            .answerChanged("Two things before six."),
        ])
        XCTAssertEqual(state.mode, .speaking)
        XCTAssertEqual(state.answer, "Two things before six.")
    }

    func testAnswerDoneShowsAPreviewForSixSecondsThenRetracts() {
        let (preview, effects) = run([
            .dismissRequested(hasSpeech: true, phase: .speaking),
            .answerChanged("Gym is at eight tomorrow."),
            .phaseChanged(.idle),
        ])
        XCTAssertEqual(preview.mode, .preview)
        XCTAssertEqual(effects.last, .schedulePreviewEnd(seconds: 6))
        XCTAssertEqual(NotchPillState.previewSeconds, 6)

        let (gone, after) = run([.previewElapsed], from: preview)
        XCTAssertEqual(gone.mode, .hidden)
        XCTAssertEqual(after, [.retract])
    }

    func testTurnEndingWithNoAnswerWhileThinkingRetractsAtOnce() {
        let (state, effects) = run([
            .dismissRequested(hasSpeech: true, phase: .thinking),
            .phaseChanged(.idle),
        ])
        XCTAssertEqual(state.mode, .hidden)
        XCTAssertTrue(effects.contains(.retract))
        XCTAssertFalse(effects.contains(.schedulePreviewEnd(seconds: 6)))
    }

    func testHoverHoldsTheRetractUntilTheMouseLeaves() {
        let preview = run([
            .dismissRequested(hasSpeech: true, phase: .speaking),
            .answerChanged("Done and dusted."), .phaseChanged(.idle),
        ]).0
        let (held, e1) = run([.hoverChanged(true), .previewElapsed], from: preview)
        XCTAssertEqual(held.mode, .preview, "still showing while hovered")
        XCTAssertTrue(e1.isEmpty)
        let (_, e2) = run([.hoverChanged(false)], from: held)
        XCTAssertEqual(e2, [.schedulePreviewEnd(seconds: NotchPillState.hoverGraceSeconds)])
    }

    func testClickReopensThePanelWithTheAnswerAndHidesThePill() {
        let docked = run([
            .dismissRequested(hasSpeech: true, phase: .speaking),
            .answerChanged("Here is the plan."),
        ]).0
        let (state, effects) = run([.clicked], from: docked)
        XCTAssertEqual(state.mode, .hidden)
        XCTAssertEqual(effects, [.cancelPreviewTimer, .reopenPanel(answer: "Here is the plan.")])
    }

    func testCrossCancelsTheTurnAndStopsSpeech() {
        let docked = run([.dismissRequested(hasSpeech: true, phase: .speaking)]).0
        let (state, effects) = run([.cancelRequested], from: docked)
        XCTAssertEqual(state.mode, .hidden)
        XCTAssertEqual(effects, [.cancelPreviewTimer, .cancelTurn, .retract])
    }

    func testCrossOnAFinishedPreviewOnlyRetracts() {
        let preview = run([
            .dismissRequested(hasSpeech: true, phase: .speaking),
            .answerChanged("ok"), .phaseChanged(.idle),
        ]).0
        let (_, effects) = run([.cancelRequested], from: preview)
        XCTAssertEqual(effects, [.cancelPreviewTimer, .retract])
    }

    func testANewListenWhileDockedBringsThePanelBackInsteadOfThePill() {
        let docked = run([.dismissRequested(hasSpeech: true, phase: .speaking)]).0
        let (state, effects) = run([.phaseChanged(.listening)], from: docked)
        XCTAssertEqual(state.mode, .hidden)
        XCTAssertEqual(effects, [.cancelPreviewTimer, .retract])
    }

    func testEventsWhileHiddenAreIgnored() {
        let (state, effects) = run([.phaseChanged(.speaking), .previewElapsed, .clicked, .cancelRequested, .hoverChanged(true)])
        XCTAssertEqual(state.mode, .hidden)
        XCTAssertTrue(effects.isEmpty)
    }

    // MARK: Words

    func testStatusLines() {
        var state = NotchPillState()
        state.mode = .thinking
        XCTAssertEqual(state.statusLine, "Thinking…")
        state.mode = .speaking
        XCTAssertEqual(state.statusLine, "Speaking…", "no answer text yet")
        state.answer = "Two things before six. The slides need a final pass."
        XCTAssertEqual(state.statusLine, "Two things before six. The slides…")
        state.mode = .preview
        XCTAssertEqual(state.statusLine, "Done")
        XCTAssertEqual(state.previewText, "Two things before six. The slides need a final pass.")
    }

    func testFirstWordsAreCapped() {
        XCTAssertEqual(NotchPillState.firstWords("one two three four five six seven eight", count: 6), "one two three four five six…")
        XCTAssertEqual(NotchPillState.firstWords("  short one  ", count: 6), "short one")
        XCTAssertEqual(NotchPillState.firstWords("", count: 6), "")
    }
}
