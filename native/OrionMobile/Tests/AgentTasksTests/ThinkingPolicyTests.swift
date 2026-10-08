import XCTest
@testable import MobileCore

final class ThinkingPolicyTests: XCTestCase {
    let now = Date(timeIntervalSince1970: 1_800_000_000)

    func test_ordinary_talk_does_not_think() {
        XCTAssertEqual(ThinkingPolicy.level(for: "how's it going", model: nil, boostedUntil: nil, now: now), "off")
        XCTAssertEqual(ThinkingPolicy.level(for: "tell me a joke", model: nil, boostedUntil: nil, now: now), "off")
    }

    func test_one_step_commands_do_not_think() {
        for text in ["end my focus session", "remind me at 6:55 for the drop", "move the gym to 6pm", "what's on tomorrow"] {
            XCTAssertEqual(ThinkingPolicy.level(for: text, model: nil, boostedUntil: nil, now: now), "off", text)
        }
    }

    func test_multi_part_changes_think() {
        for text in ["can you start organize safari directly after CS lab, same end conditions",
                     "get rid of send internship applications and push study back half an hour", "plan my day from my to-do list"] {
            XCTAssertEqual(ThinkingPolicy.level(for: text, model: nil, boostedUntil: nil, now: now), "low", text)
        }
    }

    func test_local_models_never_think() {
        XCTAssertEqual(ThinkingPolicy.level(for: "plan my day", model: "ollama/qwen3.5:9b", boostedUntil: nil, now: now), "off")
    }

    func test_a_struggle_keeps_thinking_on_for_a_while() {
        let until = now.addingTimeInterval(ThinkingPolicy.boostSeconds)
        XCTAssertEqual(ThinkingPolicy.level(for: "ok thanks", model: nil, boostedUntil: until, now: now), "low")
        XCTAssertEqual(ThinkingPolicy.level(for: "ok thanks", model: nil, boostedUntil: until, now: until.addingTimeInterval(1)), "off")
    }

    func test_two_failed_tool_calls_in_the_turn_is_a_struggle() {
        func row(_ at: String, _ text: String, exit: Int = 1) -> String {
            #"{"type":"message","timestamp":"\#(at)","message":{"role":"toolResult","content":[{"type":"text","text":"\#(text)"}],"details":{"exitCode":\#(exit)}}}"#
        }
        let since = ISO8601DateFormatter().date(from: "2026-10-07T08:24:36Z")!
        let failed = [row("2026-10-07T08:24:40.000Z", "NOTHING WAS CHANGED: overlaps"),
                      row("2026-10-07T08:24:45.000Z", "NOTHING WAS CHANGED: overlaps")].joined(separator: "\n")
        XCTAssertTrue(ThinkingPolicy.struggled(transcript: failed, since: since))
        let once = [row("2026-10-07T08:24:40.000Z", "NOTHING WAS CHANGED: overlaps"),
                    row("2026-10-07T08:24:45.000Z", "Changed Wednesday", exit: 0)].joined(separator: "\n")
        XCTAssertFalse(ThinkingPolicy.struggled(transcript: once, since: since))
        let earlier = [row("2026-10-07T08:00:00.000Z", "NOTHING WAS CHANGED"), row("2026-10-07T08:00:01.000Z", "NOTHING WAS CHANGED")].joined(separator: "\n")
        XCTAssertFalse(ThinkingPolicy.struggled(transcript: earlier, since: since), "an earlier turn's failures don't count")
    }
}
