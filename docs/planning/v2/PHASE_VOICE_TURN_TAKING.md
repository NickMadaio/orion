# Voice turn-taking — item 4, revamped

Item 4 of `HANDOFF.md`: *"speaking software — he STILL cuts me
off; revamp it."* Blocked on item 3 (A3) because both touch the same files;
A3's watchdog/progress work (`StallWatchdog`, `RunProgressModel`,
`RunTimeouts`) is now committed, so this pass is unblocked. Nick's own
follow-up, verbatim: *"update the speaking software to acomodate
interuptions, because he STILL cuts me off. infact just revamp that entire
software."*

Two faults, opposite in direction, both fixed in this pass:

- **Fault 1 — Orion cuts Nick off.** He had already raised
  `OrionVoiceEndpointingMs` from 900ms to 1400ms by hand and it did not help.
- **Fault 2 — Nick cannot cut Orion off by voice.** Only Escape and
  push-to-talk worked; there was no spoken barge-in at all.

Owned files touched: `Sources/Orion/AdaptiveEndpointModel.swift` (new),
`Sources/Orion/TurnTakingState.swift` (new), `Sources/Orion/BargeInMonitor.swift`
(new), `Sources/Orion/VoiceTuning.swift` (extended), `Sources/Orion/DeepgramSpeech.swift`
(confidence parsing), `Sources/Orion/SpeechInput.swift` (confidence pass-through),
`Sources/Orion/SpeechOutput.swift` (`currentText` exposed read-only),
`Sources/Orion/AppState.swift` (the bulk of the wiring), `Tests/TurnTakingHarness/`
(new), `Tests/run-turntaking-test.sh` (new). `AppDelegate.swift` was read and
needed no changes — see §6. `AudioRoute.swift`, `AudioDucking.swift`, and
`Sources/SessionService/AudioCoordinator.swift` were read (their public surface
is used) but not edited; they belong to the audio-coexistence pass
(`3e14200`) and are explicitly out of scope for this one.

---

## 1. The finding that settles Fault 1

`defaults read com.nickmadaio.orion.app` showed `OrionVoiceEndpointingMs =
1400`, up from the shipped default of 900. Nick had already tried the obvious
fix and it did not work. Reading `AppState.checkHandsFree` (the function that
decides when a hands-free — wake-word-initiated — turn is over) found why:

```swift
// AppState.swift, before this pass
private static let handsFreeHangover: TimeInterval = 1.3   // hardcoded, own constant

if now.timeIntervalSince(lastVoiceAt) >= AppState.handsFreeHangover {
    stopHandsFree()
    endListening()
}
```

`VoiceTuning.endpointingMs` (the setting Nick raised) is only ever consulted by
`DeepgramConfig.url()`, which controls Deepgram's OWN server-side
`speech_final`/`UtteranceEnd` signal — and that signal is only acted on inside
`DeepgramStream.onEndOfSpeech`, which is a no-op unless `SpeechInput
.awaitingFinal` is already `true`. For a hands-free turn, `awaitingFinal`
only becomes `true` once `SpeechInput.stop()` is called — which only happens
once `checkHandsFree`'s own 1.3-second timer decides to call it. Deepgram's
endpointing was never in the loop for the decision that actually mattered.
Raising `OrionVoiceEndpointingMs` from 900 to 1400 changed a number that
literally could not touch the number ending his turns. That is the whole bug,
and it explains the "1400ms shipped, still cuts me off" report exactly —
there was never a scenario in which raising it further would have helped.

It is also worth naming the SECOND bug the same code had: the hangover clock
only reset when the interim transcript got LONGER
(`evidence.count > lastSpeechEvidence.count`). A self-correction — the
recogniser revising "I want to go to the—" down to "I want to go to the
market" — produces a text that is briefly SHORTER, which the old check read
as silence. A self-correction could trip the hangover mid-correction.

### The fix

`AdaptiveEndpointModel` (new, pure, clock-injected — see its file header for
the full reasoning) replaces the hardcoded hangover. It is seeded from
`VoiceTuning.endpointingSeconds` (the number Nick actually controls) and
combines four signals instead of trusting a fixed timer:

1. **Transcript stability**, fixed to reset on ANY change, growing or
   shrinking — this is what fixes the self-correction bug.
2. **Terminal punctuation** (`.`/`?`/`!`) — corroborating evidence only.
3. **Last-word confidence**, when Deepgram supplies one. `DeepgramStream`
   now parses `alternatives[0].confidence` and fires a new `onConfidence`
   callback, threaded through `SpeechInput.onTranscriptConfidence` to
   `AppState`. A confidence below `AdaptiveEndpointModel.lowConfidenceFloor`
   (0.55) extends the window — an uncertain ending is exactly the case where
   cutting in costs the most.
4. **Continuation vocabulary** — explicit phrases ("hold on", "wait", "I'm
   not done", "one sec", "hang on") and a trailing conjunction ("and", "but",
   "because", "so") EXTEND the silence window required before finalizing,
   rather than ending it.

`AppState.checkHandsFree` now reads `handsFreeEndpoint.verdict(at:)` instead
of the fixed comparison. `handsFreeHangover` was removed rather than left
dead (see the comment left in its place in `AppState.swift`).

### The test that proves it — named, and run by mutation

`Tests/run-turntaking-test.sh`, section "self-correction: a shrinking
interim is evidence too, not silence". Reverting `noteTranscript` to the old
"only counts if longer" rule (`text.count > lastText.count`) makes this named
check fail:

```
  FAIL  0.85s after the correction (1.35s total) is still within the base window
        expected keepListening
        actual   finalize
```

Restored, and the harness returns to 118/118 (see §7 for all four mutation
proofs run this pass).

### The highest-value item — partial-transcript preservation and append

Even with adaptive endpointing, something can still force an utterance to end
early — the hard `handsFreeLimit` ceiling (12s), a spoken barge-in that
itself carried real words, or the watchdog recovering a stuck phase.
`AppState.handleFinalTranscript` (new; the ONE place both push-to-talk and
hands-free final transcripts now funnel through) checks whether the
delivered text looks cut off — a continuation cue with no terminal
punctuation — and if so:

- preserves it in `preservedTranscript` instead of sending it,
- reopens listening for a short follow-up window (reusing the existing
  "Go ahead…" follow-up machinery `AppState` already had for post-reply
  conversations),
- and once the continuation is finalized, **appends** it to the preserved
  text (`AdaptiveEndpointModel.appendContinuation`) and sends the two as ONE
  message — never as a disconnected second request.

A chain of at most two continuations is allowed
(`AppState.maxContinuationChain`) before Orion just sends what he actually
has, so a person who keeps trailing off is still owed an answer. If the
follow-up window times out with nothing said, `endConversation` now flushes
the preserved text instead of silently discarding it — the old code went
straight to `.idle` and said nothing.

**Mutation proof:** breaking `appendContinuation` to drop the preserved half
entirely —

```
  FAIL  a preserved fragment plus what followed reads as one sentence
        expected we got there late and then we left
        actual   then we left
```

— is the literal shape of "he cut me off and lost the first half of my
sentence". Restored; harness back to 118/118.

---

## 2. Spoken barge-in (Fault 2) — works, gated by output route

Before this pass, `AppState.setPhase` suspends the wake word for every phase
except `.idle` (`wakeWord.setSuspended(next != .idle)`), deliberately, so
Orion's own voice is never transcribed while he is speaking. That guard is
correct and is untouched. What was missing was ANY second listener for a
deliberate interruption.

`BargeInMonitor` (new) is that second listener — same shape as
`WakeWordListener` (short on-device `SFSpeechRecognizer` windows gated by
energy, no engine of its own, fed by the same `SpeechInput.onMonitor` tap),
but judging "is this an interruption" instead of "did someone say the wake
word". The judgment itself is `BargeInPolicy` (in `TurnTakingState.swift`),
and it is route-gated, per the measured finding in
`PHASE_AUDIO_COEXISTENCE.md` §1-3:

- **Output is Bluetooth (headset route):** `AudioInputRouteLease` (from
  `3e14200`, untouched) already captures from the built-in Mac microphone in
  this case, so Nick's headphone audio never reaches the microphone at all.
  Any confident speech is trusted — `BargeInMode.voiceEnabled`.
- **Output is built-in speakers:** Orion's own voice IS on the microphone.
  `BargeInMode.voiceRestricted` demands an RMS floor
  (`BargeInPolicy.speakerEnergyFloor = 0.22`) AND rejects any heard text that
  is a substring of `SpeechOutput.currentText` (now exposed read-only) — an
  echo of Orion's own current sentence, not a deliberate interruption.
- **`.thinking` is unconditionally trusted on EITHER route** — nothing is
  being played, so there is nothing for the microphone to echo back. This is
  what makes "pause the thinking task by voice" safe to ship without waiting
  on a route measurement at all.

On a confirmed interruption during `.speaking`: `speechOutput.stop()` fires
immediately, the last Orion turn is marked `[interrupted]` in the transcript
and its text kept for "continue what you were saying", and Orion re-enters
listening with the words that triggered the interruption already seeded into
`preservedTranscript` (so they are not lost when the fresh recognition
session starts) — the same append mechanism as §1.

**Mutation proof:** collapsing `BargeInPolicy.mode` to always return
`.voiceEnabled` (ignoring the route) —

```
  FAIL  speaking + speakers: restricted
        expected voiceRestricted
        actual   voiceEnabled
```

— is exactly "Orion would interrupt himself hearing his own voice through the
speakers". Restored; harness back to 118/118.

### Separating stop / cancel / pause

`AppState.bargeIn()` already separated "stop speaking" from "cancel the
task" by phase (`.speaking` → `speechOutput.stop()`, `.thinking` →
`cancelThinking`, which SIGTERMs/SIGKILLs the agent subprocess). What did not
exist was a THIRD, non-destructive option: `pauseThinking` (new). A spoken
interruption during `.thinking` calls this instead of `cancelThinking` — the
turn generation is bumped (orphaning the completion the same way cancel
does) but `GatewayClient.cancelInFlight` is never called, so the subprocess
keeps running. If it later returns, `send(_:)`'s completion handler now
checks `pausedGeneration` and keeps the answer in `pausedReplacementText`
rather than discarding it. "Continue" (or "keep going", "go on", "what were
you saying" — `AdaptiveEndpointModel.isResumeRequest`) recovers it:
`pausedReplacementText` if it already arrived, "still working" if not, or
`interruptedReplyText` for a speaking-interruption. This check lives once, in
`send(_:)`, so it applies uniformly to hands-free, push-to-talk, and typed
input.

**Mutation proof:** making `TurnTakingModel.bargeIn`'s `.thinking` case
return `.cancelTask` instead of `.pauseTask` —

```
  FAIL  thinking + speakers: STILL pauses, never cancels — nothing to echo
        expected pauseTask
        actual   cancelTask
```

— is the regression to the old conflated behaviour where an interruption
destroyed the in-flight task. Restored; harness back to 118/118.

Escape and push-to-talk are unchanged: `AppDelegate.handleEscape` →
`AppState.bargeIn()` still never consults `BargeInMonitor`, `BargeInPolicy`,
or the adaptive model at all — they must work even if every signal above is
wrong, and they do not depend on the model or the gateway.

---

## 3. The substate value type

`TurnTakingState.swift` (new) is the pure, clock-injected value type the
brief asked for, in the shape of `StallWatchdog` and `RunProgressModel`:

```swift
enum ListeningSubstate { case capturing, possiblePause, finalizing }
enum SpeakingSubstate  { case playing, interrupted }
enum TurnPhase { case idle, listening(ListeningSubstate), thinking, speaking(SpeakingSubstate) }
```

`AppState.phase` (`OrionPhase`) was NOT replaced with this wholesale — see
§6. What is real and load-bearing today: `BargeInPolicy` (used live by
`BargeInMonitor`) and the separated `TurnAction` cases
(`.stopSpeaking`/`.pauseTask`/`.cancelTask`), which `handleSpokenBargeIn` and
`pauseThinking` implement directly. The FULL substate lifecycle
(`beginListening` → `transcriptUpdated`/`silenceTick` →
`possiblePause`/`finalizing` → `utteranceDelivered` → `thinking` →
`replyReady` → `speaking.playing` → `bargeIn`/`hardInterrupt` →
`speaking.interrupted`/`idle`) is exercised completely by
`Tests/TurnTakingHarness`, including the 100-simulated-turn run — but
`AppState` drives its OWN phase machine using `AdaptiveEndpointModel`
directly for listening and `BargeInPolicy` directly for interruptions,
rather than through this composed type. This was a deliberate scope
decision, not an oversight — see §6.

---

## 4. Acceptance, in the harness

`Tests/run-turntaking-test.sh`, 118 checks, all passed:

- Pauses of 0.5 / 1.0 / 1.5 / 2.5s, with and without a continuation cue.
- Fillers ("um", "uh") confirmed NOT to be continuation cues — an ordinary
  filler does not buy extra time on its own.
- Self-correction (a shrinking transcript) confirmed to reset the clock.
- Clauses ending in a conjunction ("and"/"but"/"because"/"so").
- The full continuation vocabulary and the resume-phrase vocabulary.
- Low-confidence vs. high-confidence endings.
- The full `TurnTakingModel` substate lifecycle, including
  `possiblePause` being reached even with no continuation cue at all (the
  "considering a pause" substate, distinct from acting on it).
- `BargeInPolicy` across every (phase, route) combination.
- Interruption at the start, middle, and end of a simulated reply — the SAME
  policy call, run at three different simulated moments, behaves identically
  (the model does not, and should not, care when in a reply the interruption
  lands).
- Barge-in during `.thinking` pauses rather than cancels, on both routes.
- `hardInterrupt` (Escape / push-to-talk) is unconditional.
- 100 randomised simulated turns (fixed-seed `SplitMix64` PRNG, reproducible
  byte-for-byte), each asserted to end back at `.idle`, with microphone
  open/close counts balanced across all 100 — the "no orphaned audio device"
  requirement, as far as a pure model without real hardware can prove it.

---

## 5. What needs Nick at a microphone

Everything above is proven against a clock and a fixed PRNG, not a real
room. Named, honestly, rather than glossed over:

1. **The actual numeric thresholds.** `AdaptiveEndpointModel.lowConfidenceFloor`
   (0.55), `BargeInPolicy.speakerEnergyFloor` (0.22), `BargeInMonitor`'s
   open/hold levels (0.14/0.09), and the extended-silence multiplier (1.8×)
   in `VoiceTuning.extendedEndpointingSeconds` are reasoned defaults, not
   measurements. `VoiceTuning.endpointingMs`'s own history (300 → 900 →
   1400, still not enough) says these numbers are found by talking to the
   app, not by guessing. They are live-tunable the same way; they have not
   yet been tuned.
2. **Whether Deepgram's `confidence` field is actually populated** on this
   account/model (`nova-3`) the way assumed. The parsing
   (`best["confidence"] as? Double`) fails closed — if it is absent, that
   signal simply never fires, which is safe but unverified live.
3. **Wired-headphone detection is not implemented.** `AudioRouteKind` is
   Bluetooth-vs-not; a wired headphone jack is not distinguished from the
   built-in speakers, so spoken barge-in would run in the STRICTER
   `voiceRestricted` mode even with wired headphones on, where it could
   safely be `voiceEnabled`. This needs either a live CoreAudio transport-type
   check on this Mac with wired headphones plugged in, or Nick's
   confirmation that speaker-mode barge-in feels fine anyway.
4. **`BargeInMonitor`'s on-device recognition latency and false-positive
   rate in a real room** — a real television, a real second person talking,
   real HVAC noise. The energy floors and hangover timings are only checked
   against the policy logic, never against real audio.
5. **Whether reopening a brand-new recognition session after a spoken
   barge-in loses the tail of what was said between the trigger phrase and
   `SpeechInput.start()` actually opening.** The trigger text is seeded into
   `preservedTranscript`, but the gap between `BargeInMonitor` hearing it and
   the main recognizer coming up is real wall-clock time this pass did not
   measure.
6. **The continuation-chain heuristic's false-positive rate** — a sentence
   that legitimately ends in "and" as filler ("that's it, thanks, and-") will
   be (mis)read as a continuation and reopen the ear briefly. Acceptable in
   principle (worst case: one extra half-second of "Go ahead…"), unverified
   in practice.

---

## 6. What was deliberately NOT done

- **`AppState.phase` was not replaced with `TurnTakingModel`.** AppState is
  1,700+ lines with a great deal of interacting timer/generation bookkeeping
  (`handsFreeGeneration`, `askGeneration`, `auditPollGeneration`, the
  watchdog). Migrating its actual phase storage to the new substate type is
  real, valuable follow-up work, but attempting it in the same pass as the
  two behavioural fixes risked shipping neither correctly. The substate type
  exists, is fully tested, and is used live for the barge-in decision; the
  full migration is future work, named rather than silently dropped.
- **AppDelegate.swift needed no edits.** Escape and push-to-talk were
  already unconditional local interrupts (`AppDelegate.handleEscape` →
  `AppState.bargeIn()`, widened to cover `.thinking` in `a13ad45`); this pass
  preserves that and does not route them through any new decision logic.
- **`AudioRoute.swift`, `AudioDucking.swift`, `AudioCoordinator.swift` were
  not touched.** `AudioInputRouteLease`, `AudioCoordinator.beginConversation()`
  /`endConversation()`, and the narrowed `AudioDucking` from `3e14200` are
  read from (route queries, nothing more) and remain exactly as committed.

---

## 7. Build and test — actual output

```
$ swift build
...
[168/169] Applying Orion
Build complete! (10.08s)
```

```
$ DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer swift test
...
Test Suite 'All tests' passed at 2026-09-06 14:23:33.660.
	 Executed 402 tests, with 0 failures (0 unexpected) in 9.284 seconds
```

402/402 — the same count as before this pass started (`PHASE_AUDIO_COEXISTENCE.md`
§8 recorded 402/402 as the baseline on 2026-09-05; this pass added no new
`.testTarget` cases, only the new standalone harness below, so the count is
unchanged, not merely equal by coincidence).

```
$ ./Tests/run-watchdog-test.sh     → watchdog: 15 checks, all passed
$ ./Tests/run-progress-test.sh     → progress: 19 checks, all passed
$ ./Tests/run-runtimeouts-test.sh  → runtimeouts: 1 checks, all passed
$ ./Tests/run-turntaking-test.sh   → turntaking: 118 checks, all passed   (NEW)
```

Four separate mutation proofs were run this pass (break the named repair,
confirm the exact named check fails with the quoted message, restore, confirm
118/118 again) — reproduced in §1 and §2 above rather than duplicated here.

---

## 8. Rollback

Every change is contained to the files listed at the top. To roll back:
revert `Sources/Orion/VoiceTuning.swift`, `Sources/Orion/DeepgramSpeech.swift`,
`Sources/Orion/SpeechInput.swift`, `Sources/Orion/SpeechOutput.swift`, and
`Sources/Orion/AppState.swift` to their prior committed state, and delete
`Sources/Orion/AdaptiveEndpointModel.swift`, `Sources/Orion/TurnTakingState.swift`,
`Sources/Orion/BargeInMonitor.swift`, `Tests/TurnTakingHarness/`, and
`Tests/run-turntaking-test.sh`. Nothing outside `native/Orion` and this note
was touched. Nothing was committed by this pass — work is left uncommitted
per the brief.
