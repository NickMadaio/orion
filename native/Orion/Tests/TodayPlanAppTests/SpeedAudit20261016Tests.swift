import XCTest
@testable import Orion

/// 2026-10-16 speed audit, app side (docs/audits/2026-10-16-local-speed.md).
/// Narratives must not evict the voice models; local scheduling turns must not
/// carry the 12k-char SCHEDULING.md block the plugin already covers.
final class SpeedAudit20261016Tests: XCTestCase {

    // MARK: narrative model

    func testNarrativeModelIsTheResidentVoiceModelNotGptOss() {
        XCTAssertEqual(LocalModel.fallbackModel, "qwen3.5:9b")
        XCTAssertFalse(LocalModel.defaultModel.contains("gpt-oss"))
    }

    func testResidentModelRequestMatchesPluginSoOllamaDoesNotReload() {
        let body = LocalModel.requestBody(prompt: "p", model: "qwen3.5:9b", maxTokens: 400, temperature: 0.4)
        let options = body["options"] as? [String: Any]
        XCTAssertEqual(options?["num_ctx"] as? Int, 32768, "FORM_OPTIONS.num_ctx in plugin schedule-flow.ts")
        XCTAssertEqual(options?["num_predict"] as? Int, 400)
        XCTAssertEqual(body["think"] as? Bool, false)
        XCTAssertEqual(body["keep_alive"] as? String, "24h")
    }

    func testAnyOtherModelIsUnloadedAtOnceAndGetsScratchpadRoom() {
        let body = LocalModel.requestBody(prompt: "p", model: "gpt-oss:20b", maxTokens: 400, temperature: 0.4)
        XCTAssertEqual(body["keep_alive"] as? String, "0")
        XCTAssertNil(body["think"])
        XCTAssertEqual((body["options"] as? [String: Any])?["num_predict"] as? Int, 1600)
        XCTAssertNil((body["options"] as? [String: Any])?["num_ctx"])
    }

    // MARK: direction of a health summary (strain 8.4 against band 14-18)

    func testDirectionCheckAcceptsBelowAndRejectsTheOldInversion() {
        XCTAssertTrue(HealthDirectionCheck.isCorrect(
            "Nick's strain of 8.4 is well below the suggested band of 14-18, so he has room to do more."))
        XCTAssertFalse(HealthDirectionCheck.isCorrect("You may be pushing yourself too hard today."))
        XCTAssertFalse(HealthDirectionCheck.isCorrect("Your strain is within the band."))
        XCTAssertFalse(HealthDirectionCheck.isCorrect("He is above the suggested band."))
    }

    // MARK: routing mode and scheduling context

    private func config(_ mode: String, toCloud: Bool) -> Data {
        Data("""
        {"plugins":{"entries":{"orion-control":{"config":{"localRouting":"\(mode)","localRoutingScheduleToCloud":\(toCloud)}}}}}
        """.utf8)
    }

    func testRoutingModeParsing() {
        XCTAssertTrue(LocalRoutingMode.parse(config("on", toCloud: false)).servesSchedulingLocally)
        XCTAssertFalse(LocalRoutingMode.parse(config("on", toCloud: true)).servesSchedulingLocally)
        XCTAssertFalse(LocalRoutingMode.parse(config("shadow", toCloud: false)).servesSchedulingLocally)
        XCTAssertEqual(LocalRoutingMode.parse(Data("nope".utf8)), .off)
        XCTAssertEqual(LocalRoutingMode.current(path: "/nonexistent/openclaw.json"), .off)
    }

    private let rules = """
    # Scheduling memory

    preamble.

    ## To-dos with due dates

    Use `orion-tasks add`, `orion-tasks set`, `orion-tasks list`, `orion-tasks plan`.

    ## Protected time and transitions

    - Keep five minutes between activities. A transition is separate from travel.
    - Naps are at least 75 minutes. Protect at least one hour of side-project time daily.
    - \(String(repeating: "Filler sentence that is long. ", count: 60))

    ## Priority scale

    - **fixed**: real classes. Never moved.
    - **high**: sleep, the gym. Protected.

    ## The class wrapper

    45 minutes before his FIRST class is travel. Nothing goes into travel time.
    (Why this is written down: a nap was booked at 12:30.)
    """

    private let schedulingText = "plan my day around class"

    func testNoSchedulingWordMeansNoContext() {
        XCTAssertEqual(SchedulingMemory.context(for: "what's the weather", localRouting: .off, rules: { self.rules }), "")
    }

    func testCloudTurnsKeepTheFullFile() {
        let out = SchedulingMemory.context(for: schedulingText, localRouting: .off, rules: { self.rules })
        XCTAssertTrue(out.contains("orion-tasks add"))
        XCTAssertTrue(out.hasSuffix("[Current user request]\n"))
    }

    func testLocalTurnsGetOnlyAShortDigestOfPreferences() {
        let local = LocalRoutingMode(mode: "on", scheduleToCloud: false)
        let out = SchedulingMemory.context(for: schedulingText, localRouting: local, rules: { self.rules })
        XCTAssertLessThan(out.count, SchedulingMemory.localDigestLimit + 120)
        XCTAssertTrue(out.contains("**high**: sleep, the gym. Protected."), out)
        XCTAssertTrue(out.contains("Naps are at least 75 minutes"), out)
        XCTAssertTrue(out.contains("Never moved"), out)
        XCTAssertTrue(out.contains("FIRST class"), out)
        XCTAssertFalse(out.contains("orion-tasks"), "tool usage is the plugin's job")
        XCTAssertFalse(out.contains("Why this is written down"))
    }

    func testDigestThatFindsTooLittleFailsOpenToTheFullFile() {
        let local = LocalRoutingMode(mode: "on", scheduleToCloud: false)
        let reorganised = "# Scheduling\n\n## Something else\n\nUse orion-tasks add.\n\n## Priority scale\n\n- **high**: sleep.\n"
        let out = SchedulingMemory.context(for: schedulingText, localRouting: local, rules: { reorganised })
        XCTAssertTrue(out.contains("orion-tasks add"), "only one section matched, so send everything")
        XCTAssertTrue(out.hasPrefix("[ORION scheduling preferences"))
    }

    private let wrapperFixture = """
    # Scheduling

    ## Priority scale

    - **high**: sleep, the gym. Protected.
    - **low**: breaks, optional items. Move first.
    His own words override the defaults; save them with `orion-life rank <thing> low`.

    ## Protected time

    - Naps are at least 75 minutes.

    ## The class wrapper

    Travel is 45 minutes before the FIRST class. Nothing (a nap) goes into travel time.
    The planner enforces them from life-config (`commuteMinutes`). Trust the tools.
    """

    func testSentenceLevelSkipKeepsTheRestOfAParagraphMentioningLifeConfig() {
        let digest = SchedulingMemory.localDigest(wrapperFixture, limit: SchedulingMemory.localDigestLimit)
        XCTAssertTrue(digest.contains("Nothing (a nap) goes into travel time"), digest)
        XCTAssertTrue(digest.contains("FIRST class"), digest)
        XCTAssertTrue(digest.contains("Trust the tools"), digest)
        XCTAssertFalse(digest.contains("life-config"), digest)
    }

    func testBulletFollowedDirectlyByProseKeepsTheBulletAndDropsTheProse() {
        let digest = SchedulingMemory.localDigest(wrapperFixture, limit: SchedulingMemory.localDigestLimit)
        XCTAssertTrue(digest.contains("**low**: breaks, optional items. Move first."), digest)
        XCTAssertFalse(digest.contains("His own words"), digest)
        XCTAssertFalse(digest.contains("orion-life"), digest)
    }

    func testEmptyRequiredSectionFailsOpenToTheFullFile() {
        let local = LocalRoutingMode(mode: "on", scheduleToCloud: false)
        // The class wrapper holds only a tool sentence, so it digests to nothing.
        let emptied = "## Priority scale\n\n- **high**: sleep.\n\n## Protected time\n\n- Naps are at least 75 minutes.\n\n"
            + "## The class wrapper\n\nSee `orion-reschedule day` and life-config.\n"
        XCTAssertEqual(SchedulingMemory.localDigest(emptied, limit: SchedulingMemory.localDigestLimit), "")
        let out = SchedulingMemory.context(for: schedulingText, localRouting: local, rules: { emptied })
        XCTAssertTrue(out.contains("orion-reschedule day"), "an empty section must send the whole file")
        XCTAssertTrue(out.hasPrefix("[ORION scheduling preferences"))
    }

    func testResidentContextIsExactPerModel() {
        XCTAssertEqual(LocalModel.profile(for: "qwen3.5:9b").numCtx, 32768)
        XCTAssertEqual(LocalModel.profile(for: "qwen3.5:4b-q4_K_M").numCtx, 16384)
        XCTAssertFalse(LocalModel.profile(for: "qwen3.5:27b").resident, "unknown qwen3.5 tag is not assumed resident")
    }

    func testLocalDigestOfTheRealFileKeepsTheRulesThatMatter() throws {
        guard let real = try? String(contentsOf: SchedulingMemory.rulesFile, encoding: .utf8) else { throw XCTSkip("no SCHEDULING.md here") }
        let digest = SchedulingMemory.localDigest(real, limit: SchedulingMemory.localDigestLimit)
        XCTAssertLessThanOrEqual(digest.count, SchedulingMemory.localDigestLimit)
        for needle in ["**fixed**", "**high**", "**medium**", "**low**", "Protected", "Nothing (a nap", "2.5 hours", "Naps are at least 75"] {
            XCTAssertTrue(digest.contains(needle), "digest lost \(needle):\n\(digest)")
        }
        XCTAssertFalse(digest.contains("orion-reschedule"))
        XCTAssertFalse(digest.contains("Why this is written down"))
    }
}
