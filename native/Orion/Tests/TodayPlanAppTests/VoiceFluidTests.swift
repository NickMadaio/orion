import AVFoundation
import XCTest
@testable import Orion

/// 2026-10-23 voice latency (docs/audits/2026-10-23-voice-latency.md): the cue, the spoken progress and the 45 s handoff.
final class VoiceFluidTests: XCTestCase {
    private let t0 = Date(timeIntervalSince1970: 1_800_000_000)

    private func stage(_ id: String, _ label: String, _ detail: String? = nil) -> ProgressStage {
        ProgressStage(id: id, label: label, detail: detail)
    }

    // MARK: Cue timing

    func testNoCueWhenTheReplyArrivesWithinTheHold() {
        XCTAssertEqual(VoiceCuePolicy.decide(elapsed: 0.5, replyReady: false, alreadyPlayed: false, heardSpeechAgo: nil), .wait)
        XCTAssertEqual(VoiceCuePolicy.decide(elapsed: 1.1, replyReady: true, alreadyPlayed: false, heardSpeechAgo: nil), .skip)
        XCTAssertEqual(VoiceCuePolicy.decide(elapsed: 1.19, replyReady: false, alreadyPlayed: false, heardSpeechAgo: nil), .wait)
    }

    func testCuePlaysOnceAtTheHoldWhenNoReply() {
        XCTAssertEqual(VoiceCuePolicy.hold, 1.2)
        XCTAssertEqual(VoiceCuePolicy.decide(elapsed: 1.2, replyReady: false, alreadyPlayed: false, heardSpeechAgo: nil), .play)
        XCTAssertEqual(VoiceCuePolicy.decide(elapsed: 1.5, replyReady: false, alreadyPlayed: true, heardSpeechAgo: nil), .skip)
    }

    func testCueNeverTalksOverHimAndGoesStale() {
        XCTAssertEqual(VoiceCuePolicy.decide(elapsed: 1.5, replyReady: false, alreadyPlayed: false, heardSpeechAgo: 0.2), .wait)
        XCTAssertEqual(VoiceCuePolicy.decide(elapsed: 1.5, replyReady: false, alreadyPlayed: false, heardSpeechAgo: 1.0), .play)
        XCTAssertEqual(VoiceCuePolicy.decide(elapsed: 4.0, replyReady: false, alreadyPlayed: false, heardSpeechAgo: 0.1), .skip)
    }

    func testCueKindMatchesTheRequest() {
        XCTAssertEqual(VoiceCuePolicy.kind(for: "what's on tomorrow"), .lookup)
        XCTAssertEqual(VoiceCuePolicy.kind(for: "do I have anything at 3"), .lookup)
        XCTAssertEqual(VoiceCuePolicy.kind(for: "move gym to 6"), .change)
        XCTAssertEqual(VoiceCuePolicy.kind(for: "reschedule my day after marketing, gym first"), .change)
        XCTAssertEqual(VoiceCuePolicy.kind(for: "should I skip the lecture to finish my resume"), .think)
        XCTAssertEqual(VoiceCuePolicy.kind(for: "help me plan my week"), .think)
        XCTAssertEqual(VoiceCuePolicy.kind(for: "I'm meal prepping"), .generic)
    }

    func testCuePhrasesVaryAndNeverRepeatBackToBack() {
        var last: String?
        var seen = Set<String>()
        for seed in 0..<12 {
            let phrase = VoiceCuePolicy.phrase(for: .lookup, avoiding: last, seed: seed)
            XCTAssertNotEqual(phrase, last)
            XCTAssertTrue(VoiceCuePolicy.phrases[.lookup]!.contains(phrase))
            seen.insert(phrase)
            last = phrase
        }
        XCTAssertGreaterThan(seen.count, 2)
        XCTAssertTrue(VoiceCuePolicy.phrases[.think]!.contains("Hmm, let me think about that."))
        XCTAssertTrue(VoiceCuePolicy.phrases[.change]!.contains("On it."))
    }

    func testCueFileNamesAreStableAcrossLaunches() {
        XCTAssertEqual(VoiceCuePlayer.stableHash("On it."), VoiceCuePlayer.stableHash("On it."))
        XCTAssertNotEqual(VoiceCuePlayer.stableHash("On it."), VoiceCuePlayer.stableHash("Let me look."))
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("cue-test-\(UUID().uuidString)")
        let player = VoiceCuePlayer(cacheDir: dir, provider: { "elevenlabs" })
        XCTAssertTrue(player.fileURL(for: "On it.").lastPathComponent.hasPrefix("elevenlabs-"))
        XCTAssertFalse(player.isRendered("On it."))
        XCTAssertFalse(player.play("On it."), "an unrendered cue is skipped, never played late")
    }

    // MARK: Progress scheduling

    func testFirstUpdateBetweenEightAndTenSeconds() {
        let stages = [stage("understanding", "working out what you need"), stage("reading-calendar", "checking your calendar")]
        let plan = VoiceProgressPlan.start
        XCTAssertEqual(plan.next(elapsed: 8.9, stages: stages, replyReady: false, busy: false).0, .none)
        let (action, _) = plan.next(elapsed: 9.0, stages: stages, replyReady: false, busy: false)
        XCTAssertEqual(action, .update(text: "Still on it — checking your calendar.", stageKey: "reading-calendar"))
        XCTAssertGreaterThanOrEqual(VoiceProgressPlan.firstAfter, 8)
        XCTAssertLessThanOrEqual(VoiceProgressPlan.firstAfter, 10)
    }

    func testUpdatesAreSpacedCappedAndNeverRepeatAStage() {
        var stages = [stage("understanding", "u"), stage("reading-calendar", "checking your calendar")]
        var plan = VoiceProgressPlan.start
        var spoken: [String] = []
        var t: TimeInterval = 0
        while t < 44 {
            if t >= 15 && stages.count == 2 { stages.append(stage("checking-todos", "checking your to-dos")) }
            if t >= 25 && stages.count == 3 { stages.append(stage("changing-calendar", "making the change on your calendar", "Gym")) }
            let (action, next) = plan.next(elapsed: t, stages: stages, replyReady: false, busy: false)
            if case .update(let text, _) = action { spoken.append(text); XCTAssertTrue(t >= 9) }
            plan = next
            t += 0.5
        }
        XCTAssertEqual(spoken, [
            "Still on it — checking your calendar.",
            "Still going — checking your to-dos.",
            "Bear with me — making the change to Gym.",
        ])
        XCTAssertLessThanOrEqual(spoken.count, VoiceProgressPlan.maxUpdates)
        XCTAssertEqual(plan.spokenKeys, ["reading-calendar", "checking-todos", "changing-calendar:gym"])
        // Spacing: the second no sooner than interval after the first.
        XCTAssertGreaterThanOrEqual(VoiceProgressPlan.interval, 12)
        XCTAssertLessThanOrEqual(VoiceProgressPlan.interval, 15)
    }

    func testNoNewStageMeansOnePlainLineThenSilence() {
        let stages = [stage("reading-calendar", "checking your calendar")]
        var plan = VoiceProgressPlan.start
        var lines: [String] = []
        for step in 0..<88 {
            let (action, next) = plan.next(elapsed: Double(step) * 0.5, stages: stages, replyReady: false, busy: false)
            if case .update(let text, _) = action { lines.append(text) }
            plan = next
        }
        XCTAssertEqual(lines, ["Still on it — checking your calendar.", VoiceProgressPhrases.plain])
    }

    func testOnlyUnderstandingGivesThePlainLineNotAnInventedStage() {
        let (action, _) = VoiceProgressPlan.start.next(elapsed: 9, stages: [stage("understanding", "working out what you need")], replyReady: false, busy: false)
        XCTAssertEqual(action, .update(text: "Still working on it.", stageKey: nil))
    }

    func testUpdatesWaitWhileBusyAndStopWhenTheReplyIsReady() {
        let stages = [stage("reading-calendar", "checking your calendar")]
        XCTAssertEqual(VoiceProgressPlan.start.next(elapsed: 10, stages: stages, replyReady: false, busy: true).0, .none)
        XCTAssertEqual(VoiceProgressPlan.start.next(elapsed: 10, stages: stages, replyReady: true, busy: false).0, .none)
    }

    // MARK: The 45 s handoff

    func testHandoffAtFortyFiveSecondsOnce() {
        var plan = VoiceProgressPlan.start
        XCTAssertNotEqual(plan.next(elapsed: 44.9, stages: [], replyReady: false, busy: false).0, .handoff(text: VoiceProgressPhrases.handoff))
        let (action, after) = plan.next(elapsed: 45, stages: [], replyReady: false, busy: false)
        XCTAssertEqual(action, .handoff(text: "This is taking longer than it should — I'll text you the answer when it's done."))
        plan = after
        XCTAssertTrue(plan.handedOff)
        XCTAssertEqual(plan.next(elapsed: 60, stages: [], replyReady: false, busy: false).0, .none)
    }

    func testHandoffWaitsForHimToFinishTalking() {
        XCTAssertEqual(VoiceProgressPlan.start.next(elapsed: 46, stages: [], replyReady: false, busy: true).0, .none)
    }

    func testNoHandoffWhenTheReplyCameFirst() {
        XCTAssertEqual(VoiceProgressPlan.start.next(elapsed: 50, stages: [], replyReady: true, busy: false).0, .none)
    }

    // MARK: The companion end to end (fake hooks, pinned clock)

    private final class Recorder {
        var cues: [String] = []
        var updates: [String] = []
        var shown: [String] = []
        var handoffs: [String] = []
        var stages: [ProgressStage] = []
        var done = false
        var now: TimeInterval = 0
        var heardSpeechAgo: (Date) -> TimeInterval? = { _ in nil }
    }

    private func companion(_ message: String, _ r: Recorder) -> VoiceTurnCompanion {
        VoiceTurnCompanion(message: message, startedAt: t0, hooks: .init(
            progress: { r.stages.isEmpty && !r.done ? nil : ProgressSnapshot(startedAt: self.t0, stages: r.stages, done: r.done) },
            heardSpeechAgo: { r.heardSpeechAgo(self.t0.addingTimeInterval(r.now)) },
            isPlaying: { false },
            playCue: { r.cues.append($0); return true },
            sayUpdate: { r.updates.append($0) },
            show: { r.shown.append($0) },
            handOff: { r.handoffs.append($0) }
        ))
    }

    func testCompanionSkipsTheCueForAQuickReply() {
        let r = Recorder()
        let c = companion("what's next", r)
        c.tick(now: t0.addingTimeInterval(0.6))
        c.stop()                                   // reply in at 0.8 s
        c.tick(now: t0.addingTimeInterval(1.3))
        c.tick(now: t0.addingTimeInterval(50))
        XCTAssertEqual(r.cues, [])
        XCTAssertEqual(r.updates, [])
        XCTAssertEqual(r.handoffs, [])
    }

    func testCompanionCueThenRealUpdatesThenHandoff() {
        let r = Recorder()
        let c = companion("move gym to after class", r)
        var t: TimeInterval = 0
        while t <= 46 {
            if t >= 3 && r.stages.isEmpty { r.stages = [stage("understanding", "u"), stage("reading-calendar", "checking your calendar")] }
            r.now = t
            c.tick(now: t0.addingTimeInterval(t))
            t += 0.25
        }
        XCTAssertEqual(r.cues.count, 1)
        XCTAssertTrue(VoiceCuePolicy.phrases[.change]!.contains(r.cues[0]))
        XCTAssertEqual(r.updates.first, "Still on it — checking your calendar.")
        XCTAssertEqual(r.updates, r.shown)
        XCTAssertLessThanOrEqual(r.updates.count, VoiceProgressPlan.maxUpdates)
        XCTAssertEqual(r.handoffs, [VoiceProgressPhrases.handoff])
        XCTAssertTrue(c.replyReady, "after the handoff the companion is finished")
    }

    // MARK: The plugin's file

    func testProgressFileNameMatchesThePlugin() {
        XCTAssertEqual(VoiceProgressFile.fileName(session: "orion-chat-9311FB49-DD4C"), "agent_main_orion-chat-9311fb49-dd4c.json", "the gateway lowercases session keys")
        XCTAssertEqual(VoiceProgressFile.fileName(session: "orion-app-v2"), "agent_main_orion-app-v2.json")
        XCTAssertEqual(VoiceProgressFile.fileName(session: "agent:main:x"), "agent_main_x.json")
    }

    func testProgressFileParsesAndIgnoresAnEarlierTurn() throws {
        let json = """
        {"v":1,"sessionKey":"agent:main:orion-chat-x","runId":"r","startedAt":"2027-01-15T08:00:01.000Z","updatedAt":"2027-01-15T08:00:05.000Z",
         "stages":[{"stage":"understanding","label":"working out what you need","at":"2027-01-15T08:00:01.000Z"},
                   {"stage":"changing-calendar","label":"making the change on your calendar","at":"2027-01-15T08:00:05.000Z","detail":"Gym"}],
         "done":false}
        """
        let data = Data(json.utf8)
        let turnStart = ISO8601DateFormatter().date(from: "2027-01-15T08:00:00Z")!
        let snap = try XCTUnwrap(VoiceProgressFile.parse(data, notBefore: turnStart))
        XCTAssertEqual(snap.stages.map(\.id), ["understanding", "changing-calendar"])
        XCTAssertEqual(snap.stages[1].detail, "Gym")
        XCTAssertEqual(VoiceProgressPhrases.line(for: snap.stages[1], index: 0), "Still on it — making the change to Gym.")
        XCTAssertNil(VoiceProgressFile.parse(data, notBefore: turnStart.addingTimeInterval(60)), "a file from an earlier turn is never read as this one's")
        XCTAssertNil(VoiceProgressFile.parse(Data("not json".utf8), notBefore: turnStart))
    }

    func testEveryFixedUpdateIsRenderableAhead() {
        XCTAssertTrue(VoiceProgressPhrases.renderable.contains("Still on it — checking your calendar."))
        XCTAssertTrue(VoiceProgressPhrases.renderable.contains(VoiceProgressPhrases.handoff))
        XCTAssertEqual(VoiceProgressPhrases.knownLabels.count, 12)
        XCTAssertTrue(VoiceProgressPhrases.knownLabels.contains("checking your focus session"))
    }
}

final class VoiceHandoffTests: XCTestCase {
    func testHandedOffAnswerExpiresAfterTwoHours() throws {
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        let command = try XCTUnwrap(VoiceHandoff.phoneCommand(answer: "Done.", node: "/n", scriptsDir: "/s", now: now, exists: { _ in true }))
        let value = command.arguments[try XCTUnwrap(command.arguments.firstIndex(of: "--valid-until")) + 1]
        XCTAssertEqual(ISO8601DateFormatter().date(from: value), now.addingTimeInterval(2 * 60 * 60))
    }

    func testTheAppShowsItsOwnBubbleOnlyWhenThePhoneSendDidNotGoOut() {
        XCTAssertEqual(VoiceHandoff.outcome(exitCode: 0, stdout: "Sent to phone — the answer…"), .sent)
        XCTAssertEqual(VoiceHandoff.outcome(exitCode: 0, stdout: "Held — he is inside his sleep window"), .notSent)
        XCTAssertEqual(VoiceHandoff.outcome(exitCode: 3, stdout: "NOT SENT: expired"), .notSent)
        XCTAssertEqual(VoiceHandoff.outcome(exitCode: 4, stdout: "NOT SENT: delivery failed"), .notSent)
        XCTAssertEqual(VoiceHandoff.outcome(exitCode: nil, stdout: ""), .notSent)
    }

    func testRunReadsAFakeReachScript() throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("reach-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let script = dir.appendingPathComponent("orion-reach")
        try "echo \"Held — quiet time\"\nexit 0\n".write(to: script, atomically: true, encoding: .utf8)
        let command = try XCTUnwrap(VoiceHandoff.phoneCommand(answer: "Gym is at 6.", node: "/bin/sh", scriptsDir: dir.path, exists: { FileManager.default.fileExists(atPath: $0) }))
        let (code, out) = VoiceHandoff.run(command)
        XCTAssertEqual(code, 0)
        XCTAssertEqual(VoiceHandoff.outcome(exitCode: code, stdout: out), .notSent, "held: the app shows the bubble itself")
        try "echo \"Sent.\"\n".write(to: script, atomically: true, encoding: .utf8)
        let (code2, out2) = VoiceHandoff.run(command)
        XCTAssertEqual(VoiceHandoff.outcome(exitCode: code2, stdout: out2), .sent, "sent: orion://reach shows it, the app does not")
    }

    func testHandedOffAnswerGoesToThePhoneThread() throws {
        let command = try XCTUnwrap(VoiceHandoff.phoneCommand(answer: " Done: Gym 6-7:30 PM. ", node: "/fake/node", scriptsDir: "/fake/scripts", exists: { _ in true }))
        XCTAssertEqual(command.executable, "/fake/node")
        XCTAssertEqual(command.arguments.prefix(2), ["/fake/scripts/orion-reach", "Done: Gym 6-7:30 PM."])
        XCTAssertTrue(command.arguments.contains("--channel"))
        XCTAssertFalse(command.arguments.contains("--no-queue"), "a held text is queued (morning after sleep), never dropped")
        XCTAssertFalse(command.arguments.contains("--urgent"), "an answer never pings through his sleep window")
        XCTAssertEqual(command.arguments[command.arguments.firstIndex(of: "--channel")! + 1], "phone")
        XCTAssertEqual(command.arguments[command.arguments.firstIndex(of: "--kind")! + 1], "update")
    }

    func testNoPhoneCommandWithoutReachOrText() {
        XCTAssertNil(VoiceHandoff.phoneCommand(answer: "hi", node: "/n", scriptsDir: "/s", exists: { _ in false }))
        XCTAssertNil(VoiceHandoff.phoneCommand(answer: "  ", node: "/n", scriptsDir: "/s", exists: { _ in true }))
    }
}

/// The independent review of feat/voice-fluid: each fix reproduces its scenario.
final class VoiceFluidReviewTests: XCTestCase {
    private let t0 = Date(timeIntervalSince1970: 1_800_000_000)

    // MARK: HIGH 1 — stopping a cue never starts the answer

    func testInterruptingACueCancelsTheWaitingAnswer() {
        let waiters = CueWaiters()
        var spoken: [String] = []
        waiters.add { spoken.append("answer") }
        waiters.interrupted()                 // Nick speaks / presses Escape over the cue
        waiters.finishedNaturally()           // nothing left to fire
        XCTAssertEqual(spoken, [])
    }

    func testNaturalCueEndStartsTheAnswerOnce() {
        let waiters = CueWaiters()
        var spoken = 0
        let id = waiters.add { spoken += 1 }
        waiters.finishedNaturally()
        XCTAssertFalse(waiters.expire(id), "its time limit after a natural end does not fire it again")
        XCTAssertEqual(spoken, 1)
    }

    func testAnswerHeldBehindACueGoesToTheBubbleWhenInterrupted() {
        let (action, held) = VoiceReplyHold.empty.landed(generation: 7, text: "Gym is at 6.", cuePlaying: true)
        XCTAssertEqual(action, .waitForCue)
        let (bubbleOnly, after) = held.interrupted()
        XCTAssertEqual(bubbleOnly, "Gym is at 6.")
        XCTAssertNil(after.cueEnded().0, "a cue-end after the interruption speaks nothing")
        XCTAssertTrue(after.hasLanded(7))
    }

    func testAnswerHeldBehindACueIsSpokenWhenTheCueEnds() {
        let (_, held) = VoiceReplyHold.empty.landed(generation: 3, text: "Done.", cuePlaying: true)
        let (text, after) = held.cueEnded()
        XCTAssertEqual(text, "Done.")
        XCTAssertNil(after.interrupted().0)
        XCTAssertEqual(VoiceReplyHold.empty.landed(generation: 4, text: "x", cuePlaying: false).0, .speakNow)
    }

    func testAnUpdateRenderedLateNeverStartsAfterTheReplyLanded() {
        let (_, hold) = VoiceReplyHold.empty.landed(generation: 9, text: "Here it is.", cuePlaying: false)
        XCTAssertTrue(hold.hasLanded(9))
        XCTAssertFalse(hold.hasLanded(10), "the next turn's updates are unaffected")
        XCTAssertFalse(VoiceReplyHold.empty.hasLanded(9))
    }

    func testRealPlayerStopCancelsTheWaiterAndNaturalEndDoesNot() throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("cue-play-\(UUID().uuidString)")
        let player = VoiceCuePlayer(cacheDir: dir, socketPath: dir.appendingPathComponent("no.sock").path, provider: { "test" })
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        try Self.silentWAV(seconds: 0.6).write(to: player.fileURL(for: "One sec."))
        guard player.play("One sec.") else { throw XCTSkip("no audio output in this environment") }
        var fired = false
        player.whenQuiet(atMost: 5) { fired = true }
        player.stop()
        RunLoop.main.run(until: Date().addingTimeInterval(1.0))
        XCTAssertFalse(fired, "stop() must cancel the waiting answer, not start it")
        XCTAssertFalse(player.isPlaying)

        guard player.play("One sec.") else { throw XCTSkip("no audio output in this environment") }
        var natural = false
        player.whenQuiet(atMost: 5) { natural = true }
        RunLoop.main.run(until: Date().addingTimeInterval(1.5))
        XCTAssertTrue(natural, "a cue that ends on its own lets the answer go")
    }

    // MARK: HIGH 2 — back-to-back handoffs

    func testBackToBackHandoffsEachDeliverExactlyOnce() {
        var ledger = HandoffLedger.empty.adding(1)   // turn A handed off
        ledger = ledger.adding(2)                    // turn B handed off before A's answer
        var delivered: [Int] = []
        for generation in [1, 2, 1, 2, 3] {          // A lands, B lands, then duplicates and an unrelated turn
            let (claimed, next) = ledger.claiming(generation)
            ledger = next
            if claimed { delivered.append(generation) }
        }
        XCTAssertEqual(delivered, [1, 2])
        XCTAssertTrue(ledger.pending.isEmpty)
    }

    // MARK: HIGH 4 — noise is not speech; the handoff has a hard limit

    private func noisyKitchen(_ seconds: TimeInterval) -> [Double] {
        stride(from: 0.0, to: seconds, by: 0.25).enumerated().map { 0.4 + Double($0.offset % 10) * 0.052 }   // 0.40 ... 0.868
    }

    func testKitchenNoiseDoesNotHoldBackTheCueUpdatesOrHandoff() {
        // Only recognised words move VoiceActivity; levels never reach it.
        let activity = VoiceActivity.none
        let levels = noisyKitchen(50)
        XCTAssertEqual(levels.min()!, 0.4, accuracy: 0.001)
        XCTAssertGreaterThan(levels.max()!, 0.86)
        var cues = 0, updates = 0, handoffs: [TimeInterval] = []
        var now: TimeInterval = 0
        let companion = VoiceTurnCompanion(message: "what's on tomorrow", startedAt: t0, hooks: .init(
            progress: { ProgressSnapshot(startedAt: self.t0, stages: [ProgressStage(id: "reading-tomorrow", label: "looking at tomorrow", detail: nil)], done: false) },
            heardSpeechAgo: { activity.heardSpeechAgo(now: self.t0.addingTimeInterval(now)) },
            isPlaying: { false },
            playCue: { _ in cues += 1; return true },
            sayUpdate: { _ in updates += 1 },
            show: { _ in },
            handOff: { _ in handoffs.append(now) }))
        for (index, level) in levels.enumerated() {
            now = Double(index) * 0.25
            // The kitchen is loud (every reading is above the old 0.14 "speech" bar) but recognition hears no words,
            // so VoiceActivity is never fed: only `heardWords` moves it.
            XCTAssertGreaterThan(level, 0.14)
            companion.tick(now: t0.addingTimeInterval(now))
        }
        XCTAssertEqual(cues, 1)
        XCTAssertGreaterThanOrEqual(updates, 1)
        XCTAssertEqual(handoffs, [45])
    }

    func testOwnCueIsNotHimTalking() {
        let at = t0
        let during = VoiceActivity.none.heardWords(at: at, cuePlaying: true, cueEndedAt: .distantPast)
        XCTAssertNil(during.heardSpeechAgo(now: at))
        let tail = VoiceActivity.none.heardWords(at: at, cuePlaying: false, cueEndedAt: at.addingTimeInterval(-0.2))
        XCTAssertNil(tail.heardSpeechAgo(now: at))
        let him = VoiceActivity.none.heardWords(at: at, cuePlaying: false, cueEndedAt: at.addingTimeInterval(-3))
        XCTAssertEqual(him.heardSpeechAgo(now: at.addingTimeInterval(0.3))!, 0.3, accuracy: 0.001)
        XCTAssertNil(him.heardSpeechAgo(now: at.addingTimeInterval(6)))
    }

    func testHandoffComesByFiftySecondsEvenIfHeNeverStopsTalking() {
        var plan = VoiceProgressPlan.start
        var at: TimeInterval?
        for step in 0..<240 {
            let t = Double(step) * 0.25
            let (action, next) = plan.next(elapsed: t, stages: [], replyReady: false, busy: true)
            plan = next
            if case .handoff = action { at = t; break }
        }
        XCTAssertEqual(at, VoiceProgressPlan.handoffHardLimit)
        XCTAssertEqual(VoiceProgressPlan.handoffHardLimit, 50)
    }

    // MARK: MEDIUM 7 — the cue cache repairs itself

    func testDamagedCachedPhraseIsDeletedAndNotPlayed() throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("cue-bad-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        var renders = 0
        let player = VoiceCuePlayer(cacheDir: dir, provider: { "test" }, renderer: { _, url, _ in
            renders += 1
            return (try? Self.silentWAV(seconds: 0.2).write(to: url)) != nil
        })
        let url = player.fileURL(for: "On it.")
        try Data(repeating: 0, count: 2_000).write(to: url)          // right size, does not decode
        XCTAssertTrue(player.isRendered("On it."), "the main-thread check is only size: the decode check runs off main")
        let repaired = expectation(description: "checked and re-rendered off main")
        player.prepare(["On it."]) { _, ok in XCTAssertTrue(ok); repaired.fulfill() }
        wait(for: [repaired], timeout: 5)
        XCTAssertEqual(renders, 1, "the damaged file was deleted and rendered again")
        XCTAssertNotNil(try? AVAudioFile(forReading: url))
        // A good file is not rendered again.
        let kept = expectation(description: "good file kept")
        player.prepare(["On it."]) { _, ok in XCTAssertTrue(ok); kept.fulfill() }
        wait(for: [kept], timeout: 5)
        XCTAssertEqual(renders, 1)
    }

    func testPlayDeletesAFileThatWillNotOpen() throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("cue-open-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let player = VoiceCuePlayer(cacheDir: dir, provider: { "test" }, renderer: { _, _, _ in false })
        let url = player.fileURL(for: "Let me look.")
        try Data(repeating: 7, count: 2_000).write(to: url)
        XCTAssertFalse(player.play("Let me look."))
        XCTAssertFalse(FileManager.default.fileExists(atPath: url.path))
    }

    func testLaunchRenderRetriesWhileTheDaemonIsDown() {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("cue-retry-\(UUID().uuidString)")
        let player = VoiceCuePlayer(cacheDir: dir, socketPath: dir.appendingPathComponent("absent.sock").path, provider: { "test" })
        var attempts: [Int] = []
        let finished = expectation(description: "three attempts, then it stops")
        player.prepareUntilReady(["On it.", "Let me look."], retryEvery: 0.05, attempts: 3) { number, missing in
            attempts.append(number)
            XCTAssertEqual(missing, 2)
            if number == 4 { finished.fulfill() }   // the call after the last allowed attempt only checks, then stops
        }
        wait(for: [finished], timeout: 5)
        XCTAssertEqual(attempts, [1, 2, 3, 4])
    }

    func testLaunchRenderDoesNotStallBehindAnOnDemandRender() throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("cue-stall-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let gate = DispatchSemaphore(value: 0)
        let lock = NSLock()
        var callsForA = 0
        let player = VoiceCuePlayer(cacheDir: dir, provider: { "test" }, renderer: { text, url, _ in
            if text == "A" {
                lock.lock(); callsForA += 1; let first = callsForA == 1; lock.unlock()
                if first { gate.wait(); return false }      // the on-demand render of A is slow, then fails
            }
            return (try? Self.silentWAV(seconds: 0.1).write(to: url)) != nil
        })
        player.prepare(["A"])                                // on demand: A is now "being rendered"
        var attempts: [Int] = []
        player.prepareUntilReady(["A", "B"], retryEvery: 0.05, attempts: 5) { number, _ in attempts.append(number) }
        DispatchQueue.global().asyncAfter(deadline: .now() + 0.3) { gate.signal() }
        let deadline = Date().addingTimeInterval(5)
        while !(player.isRendered("A") && player.isRendered("B")) && Date() < deadline {
            RunLoop.main.run(until: Date().addingTimeInterval(0.05))
        }
        XCTAssertGreaterThanOrEqual(attempts.count, 2, "skipping A (busy) led to another attempt, which rendered it")
        XCTAssertEqual(callsForA, 2)
        XCTAssertTrue(player.isRendered("A"))
        XCTAssertTrue(player.isRendered("B"))
    }

    // MARK: LOW

    func testAPreviousTurnsFileIsRejected() {
        let json = #"{"startedAt":"2027-01-15T08:00:00.000Z","stages":[{"stage":"reading-calendar","label":"checking your calendar"}],"done":true}"#
        let turnStart = ISO8601DateFormatter().date(from: "2027-01-15T08:00:02Z")!
        XCTAssertNil(VoiceProgressFile.parse(Data(json.utf8), notBefore: turnStart), "a file begun 2 s before this turn is the last turn's")
        let snap = VoiceProgressFile.parse(Data(json.utf8), notBefore: turnStart.addingTimeInterval(-3))
        XCTAssertEqual(snap?.done, true)
    }

    func testDoneFileStartsNoUpdate() {
        var updates = 0
        let done = ProgressSnapshot(startedAt: t0, stages: [ProgressStage(id: "reading-calendar", label: "checking your calendar", detail: nil)], done: true)
        let companion = VoiceTurnCompanion(message: "what's next", startedAt: t0, hooks: .init(
            progress: { done }, heardSpeechAgo: { nil }, isPlaying: { false },
            playCue: { _ in true }, sayUpdate: { _ in updates += 1 }, show: { _ in }, handOff: { _ in }))
        for step in 0..<80 { companion.tick(now: t0.addingTimeInterval(Double(step) * 0.25)) }
        XCTAssertEqual(updates, 0, "the plugin finished the turn: the reply is on its way")
    }

    func testProgressReaderPollsOffTheMainThread() {
        let reader = VoiceProgressReader()
        let read = expectation(description: "read off main")
        read.assertForOverFulfill = false
        reader.start {
            XCTAssertFalse(Thread.isMainThread)
            read.fulfill()
            return ProgressSnapshot(startedAt: Date(), stages: [], done: false)
        }
        wait(for: [read], timeout: 3)
        reader.stop()
        XCTAssertNotNil(reader.snapshot)
    }

    // MARK: Fixture

    /// A valid 24 kHz mono 16-bit PCM WAV of silence.
    static func silentWAV(seconds: Double) -> Data {
        let rate = 24_000, samples = Int(Double(rate) * seconds), bytes = samples * 2
        var data = Data()
        func u32(_ v: Int) { var x = UInt32(v).littleEndian; data.append(Data(bytes: &x, count: 4)) }
        func u16(_ v: Int) { var x = UInt16(v).littleEndian; data.append(Data(bytes: &x, count: 2)) }
        data.append(Data("RIFF".utf8)); u32(36 + bytes); data.append(Data("WAVE".utf8))
        data.append(Data("fmt ".utf8)); u32(16); u16(1); u16(1); u32(rate); u32(rate * 2); u16(2); u16(16)
        data.append(Data("data".utf8)); u32(bytes); data.append(Data(count: bytes))
        return data
    }
}
