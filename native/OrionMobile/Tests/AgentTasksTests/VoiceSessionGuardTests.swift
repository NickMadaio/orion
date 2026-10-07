import XCTest
@testable import MobileCore

/// Regression for the 6 Oct 2026 runaway: the phone kept listening and sending
/// background speech as messages until microphone access was revoked.
final class VoiceSessionGuardTests: XCTestCase {
    let t0 = Date(timeIntervalSince1970: 1_000_000)

    func test_idle_after_the_idle_window_with_no_activity() {
        let g = VoiceSessionGuard(startedAt: t0)
        XCTAssertNil(g.check(now: t0.addingTimeInterval(44)))
        XCTAssertEqual(g.check(now: t0.addingTimeInterval(45)), .idle)
    }

    func test_activity_resets_the_idle_clock() {
        let g = VoiceSessionGuard(startedAt: t0).markingActivity(at: t0.addingTimeInterval(40))
        XCTAssertNil(g.check(now: t0.addingTimeInterval(80)))
        XCTAssertEqual(g.check(now: t0.addingTimeInterval(85)), .idle)
    }

    func test_lifetime_wins_over_idle() {
        XCTAssertEqual(VoiceSessionGuard(startedAt: t0).check(now: t0.addingTimeInterval(901)), .lifetime)
    }

    func test_filler_only_is_discarded_and_the_third_discard_stops_as_stray_audio() {
        var g = VoiceSessionGuard(startedAt: t0)
        var verdict: VoiceTurnVerdict
        (g, verdict) = g.judging("Um.", at: t0.addingTimeInterval(1)); XCTAssertEqual(verdict, .discard)
        (g, verdict) = g.judging("yeah okay", at: t0.addingTimeInterval(2)); XCTAssertEqual(verdict, .discard)
        (g, verdict) = g.judging("hmm", at: t0.addingTimeInterval(3)); XCTAssertEqual(verdict, .stop(.strayAudio))
    }

    func test_a_real_sentence_is_sent_and_clears_the_discard_count() {
        var g = VoiceSessionGuard(startedAt: t0)
        (g, _) = g.judging("uh", at: t0.addingTimeInterval(1))
        let (next, verdict) = g.judging(" Move the gym to six ", at: t0.addingTimeInterval(2))
        XCTAssertEqual(verdict, .send("Move the gym to six"))
        XCTAssertEqual(next.consecutiveDiscards, 0)
        XCTAssertEqual(next.turnsSent, 1)
    }

    func test_a_one_word_answer_is_sent() {
        XCTAssertEqual(VoiceSessionGuard(startedAt: t0).judging("Yes.", at: t0.addingTimeInterval(1)).1, .send("Yes."))
        XCTAssertEqual(VoiceSessionGuard(startedAt: t0).judging("Friday", at: t0.addingTimeInterval(1)).1, .send("Friday"))
    }

    func test_stop_alone_ends_the_conversation() {
        XCTAssertEqual(VoiceSessionGuard(startedAt: t0).judging("Stop.", at: t0).1, .stop(.user))
    }

    func test_the_turn_limit_stops_instead_of_sending() {
        var g = VoiceSessionGuard(startedAt: t0, limits: VoiceSessionLimits(maxTurns: 1))
        (g, _) = g.judging("first real message", at: t0.addingTimeInterval(1))
        XCTAssertEqual(g.judging("second real message", at: t0.addingTimeInterval(2)).1, .stop(.turnLimit))
    }

    func test_a_stopped_session_never_sends() {
        XCTAssertEqual(VoiceSessionGuard(startedAt: t0).judging("schedule my afternoon please", at: t0.addingTimeInterval(1000)).1, .stop(.lifetime))
    }
}
