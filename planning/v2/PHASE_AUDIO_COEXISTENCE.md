# Audio coexistence — measured, not reasoned

Item 6 of `NIGHT_RUN_2026-09-05.md`: *"music sounds terrible the second I talk
to him; duck and restore instead."* Nick assumed the quality loss was
unavoidable and asked for masking. It is not unavoidable. This note records
what was measured, what was built, and what still needs a two-line diff in
`AppState.swift` — a file this pass does not own.

Owned files touched: `Sources/Orion/AudioDucking.swift` (rewritten),
`Sources/Orion/AudioRoute.swift` (new), `Sources/Orion/SpeechInput.swift`
(audio-route parts only), `Sources/SessionService/AudioCoordinator.swift`
(extended), `Tests/AudioMatrix/HALDevice.swift` + `main.swift` (extended),
`Tests/run-audio-matrix.sh` (usage doc), `Tests/SessionServiceTests/AudioCoordinatorMusicTests.swift` (new).
`AppState.swift` was not edited — see "The remaining diff" below.

---

## 1. The root cause, measured

`system_profiler SPAudioDataType`, run at the start of this pass (2026-09-05,
~02:46 EDT):

```
Nick's Sony WH-1000XM4 Headphones   Default INPUT : Yes   1 ch @ 16000 Hz   Bluetooth
Nick's Sony WH-1000XM4 Headphones   Default OUTPUT: Yes   2 ch @ 44100 Hz   Bluetooth
MacBook Pro Microphone                                    1 ch @ 44100 Hz   Built-in
MacBook Pro Speakers                                      2 ch                       Built-in
```

The headset is both default input and default output — the precondition Apple
documents at <https://support.apple.com/en-us/102217>: opening a Bluetooth
headset's microphone switches the whole link out of A2DP (high-quality,
stereo, 44100 Hz) into HFP (bidirectional voice, mono, 16000 Hz), and *playback
degrades with it*, on the same shared link. That is "the second I start
talking to Orion the audio is terrible" — a profile switch, not a level Orion
was ducking badly.

Proven live with `Tests/run-audio-matrix.sh --candidate A --seconds 3
--input-route default` (today's behaviour: capture opens on whatever the
system default input already is):

```
stage               OUTPUT device          INPUT device
0 baseline           44100 Hz 2 ch             16000 Hz 1 ch
1 stereo playing     44100 Hz 2 ch             16000 Hz 1 ch   (music still healthy)
2 capture live       16000 Hz 1 ch <-- MOVED   16000 Hz 1 ch   (mic just opened)
3 engine started     16000 Hz 1 ch <-- MOVED   16000 Hz 1 ch
4 speech playing     16000 Hz 1 ch <-- MOVED   16000 Hz 1 ch
5 speech done        16000 Hz 1 ch <-- MOVED   16000 Hz 1 ch
6 engine stopped     16000 Hz 1 ch <-- MOVED   16000 Hz 1 ch
7 all stopped        16000 Hz 1 ch <-- MOVED   16000 Hz 1 ch
device at the end : STILL DEGRADED
```

The instant the mic opens — stage 2 — the OUTPUT device (the same physical
headset) collapses from 44100/2ch to 16000/1ch, and it is still degraded four
seconds later with nothing further running. This is the headline defect: not
a volume level, a hardware profile.

## 2. The fix that measured out: capture from the built-in mic

Same run, `--input-route builtin-hold` (forces the system default *input*
device to the built-in mic before capture opens, leaving the headset as
default *output* untouched), three consecutive candidates run back-to-back in
one process — modelling three consecutive Orion turns in one session:

```
=== CANDIDATE A ===  (2s speech)
stage               OUTPUT device          INPUT device
0 baseline           44100 Hz 2 ch             16000 Hz 1 ch
1 stereo playing     44100 Hz 2 ch             16000 Hz 1 ch
2 capture live       44100 Hz 2 ch             44100 Hz 1 ch   <- built-in mic, healthy
3 engine started     44100 Hz 2 ch             44100 Hz 1 ch
4 speech playing     44100 Hz 2 ch             44100 Hz 1 ch
5 speech done        44100 Hz 2 ch             44100 Hz 1 ch
6 engine stopped     44100 Hz 2 ch             44100 Hz 1 ch
7 all stopped        44100 Hz 2 ch             44100 Hz 1 ch
wake-word capture : kept delivering — 44 buffers, peak 0.012
device during run : held steady
device at the end : back to baseline

=== CANDIDATE B ===  (same result, all stages 44100/2ch output, 44100/1ch input)
=== CANDIDATE C ===  (same result, all stages 44100/2ch output, 44100/1ch input)

--- simulating quit: releasing the held input-route override ---
restored default input to 89
output immediately after restoring at quit: 44100 Hz, 2 ch
```

Confirmed with a REAL, live microphone tap delivering real buffers (44
buffers/run, peak 0.012 — not a silent/failed capture), not just a format
query. Output held 44100 Hz / 2 ch through every stage of three consecutive
turns. `system_profiler` immediately after the run confirms the machine is
back to exactly its starting state — headset default in/out, output healthy.

**This is the proof asked for: with Bluetooth output and built-in input, the
output device holds 44100 stereo through a full turn — and through three.**

## 3. A second thing was measured, and it is the reason the design is not
   "duck on begin, restore on end" for the input route

Restoring the system default input back to the Bluetooth headset **right
after** a capture session — the naive, obviously-correct-looking policy —
was tested and **re-triggers the same degradation**, every time, for as long
as the process that captured keeps its `AVAudioEngine` object alive (which
`SpeechInput`'s single, reused engine always does — it is never deallocated
between utterances, only stopped).

Isolated with four progressively narrower scratch harnesses (not shipped;
summarised here because the finding is load-bearing):

| What was live when default input was flipped back to the headset | Output after |
|---|---|
| A **stopped** `AVAudioEngine` whose `.inputNode` had been read at least once | degraded (16000/1ch), for 4.5s+ observed, no sign of self-healing while the process ran |
| The **same** engine, but **deallocated** before the flip | stayed healthy (44100/2ch) for the full 3s observed |
| A **bare, un-touched** `AVAudioEngine()` (`.inputNode` never read) | stayed healthy — flipping input back and forth had zero effect |
| The moment `.inputNode` is read for the first time, with no `prepare()`/`start()` ever called | degraded IMMEDIATELY — reading the property alone is enough to bind to and open the current default |

Two mechanisms, stacked:

1. The FIRST read of `AVAudioEngine.inputNode` eagerly opens the CURRENT
   default input device, whether or not you ever call `start()`.
2. After that, the (allocated) node keeps tracking the system default and
   re-syncs to it on every subsequent change — stopped or running — for as
   long as the engine object exists.

Consequence for `SpeechInput`, whose `engine` is a single `private let`
instance reused for the app's whole run: restoring the route after every
utterance would spend most of the fix's benefit undoing itself a moment
later, every single turn. **The policy that survives measurement**: apply the
override once (first time output is Bluetooth and the mic is about to open),
hold it for the rest of Orion's run, and only give it back in
`releaseAtQuit()` — called from `SpeechInput.abort()`, itself called from
`AppState.shutDown()` — where the engine is torn down and the process exits
shortly after, so any final resync has nothing left running to sustain it.

The honest cost, stated rather than hidden: from the first time Orion listens
in a run until Orion quits, any OTHER app that opens a fresh audio session
relying on "whatever the system default input is" gets the built-in mic
instead of the headset. An app that lets Nick choose its input device
explicitly (most conferencing apps do) is unaffected. This is documented in
`AudioRoute.swift`'s header, at the point `AudioInputRouteLease` is defined.

## 4. The design: three cooperating pieces, not one merged type

An existing, already-passing test —
`Tests/SessionServiceTests/AudioCoordinatorTests.swift::testItNeverReachesForSystemVolume`
— reads `Sources/SessionService/AudioCoordinator.swift`'s own source and fails
if it contains `osascript`, `set volume output`, or the string `AudioDucking`.
That is a real, already-enforced architectural boundary: the SessionService
target must never touch global system volume. A single merged coordinator
type spanning both targets would have had to violate it. So "one coordinator"
is realized as one POLICY, split across three cooperating, single-purpose
pieces that each own exactly what their target is allowed to touch:

- **`AudioInputRouteLease`** (`Sources/Orion/AudioRoute.swift`, new) — owns
  input route and microphone lifetime. `SpeechInput.startMicrophone()` calls
  `.begin()` before reading the engine's input format; `SpeechInput.stopEngine()`
  calls `.end()` (bookkeeping only, per §3); `SpeechInput.abort()` calls
  `.releaseAtQuit()`. Crash-safe: persists a marker to
  `~/.openclaw/orion-audio-route-state.json` while the override is held, and a
  fresh launch's `AudioInputRouteLease.init()` checks it before `.inputNode`
  has ever been touched (proven safe in §3's table) — restoring if nothing
  else changed the input since, clearing the marker either way.

- **`AudioCoordinator`** (`Sources/SessionService/AudioCoordinator.swift`,
  extended, never touches system volume) — owns Orion's own clip (unchanged:
  `beginSpeaking()`/`endSpeaking()`, ducks only while a sentence is actually
  playing) AND now Apple Music, via the new `beginConversation()` /
  `endConversation()` pair, which spans listening + thinking + speaking and
  releases only at idle — this is the literal fix for Nick's "lower it, talk
  to me, once we're done it gets raised back to normal." Manual-override-wins
  is enforced (`endConversation` will not restore Music if its volume no
  longer matches what was ducked to); `reset()` is the unconditional half,
  used both for crash safety and as one half of "restore audio now." Apple
  Music access goes through the EXISTING `AppleMusicControl`
  (`ExternalActions.swift`, not owned by this pass, not edited) via a
  retroactive `MusicDucking` conformance added in `AudioCoordinator.swift`
  itself — no dependency added in the wrong direction.

- **`AudioDucking`** (`Sources/Orion/AudioDucking.swift`, rewritten) — the
  ONE narrow, deliberate, opt-in exception to "never touch system volume":
  the last-resort fallback for a media source with no scriptable API at all
  (a browser tab). Scoped to `.listening` ONLY — it cannot span into
  `.thinking`/`.speaking` the way the Music duck can, because Orion's own TTS
  plays through the same shared output hardware a system-volume change
  attenuates; ducking it while Orion talks would duck Orion too. Off by
  default (`systemVolumeFallbackEnabled = false` — nothing flips this yet, see
  §6). Crash-safe the same way as the route lease
  (`~/.openclaw/orion-system-volume-duck-state.json`). Also carries
  `restoreSystemVolumeNow()`, the system-volume half of the emergency panic
  button; `AudioCoordinator.reset()` is the other half.

## 5. What was deleted

`AudioDucking.duck()` / `.restore()` — the code that dropped GLOBAL system
volume for the entire `.listening` phase and restored it the instant that
phase ended, meaning music came back to full **while Orion was still
speaking**, the worst possible moment. This directly contradicted
`AudioCoordinator`'s own header, which has said "never touch global system
volume" the whole time. Both were live simultaneously before this pass;
`AppState.swift` called both.

## 6. What the platform genuinely cannot do (not promised)

- **No per-app volume API on macOS.** Apple Music is scriptable
  (`AppleMusicControl`, already existed); an arbitrary browser tab or
  unscriptable app is not. There is no way to lower "whatever Nick happens to
  be listening to" in general — only a system-wide duck (see `AudioDucking`)
  or nothing.
- **No per-source "Never touch / Duck / Pause" picker shipped tonight.** The
  mechanism exists (`AudioCoordinator` for Music, `AudioDucking` for the
  system fallback, both independently toggleable in code), but there is no
  Preferences UI surfacing them, and `systemVolumeFallbackEnabled` has no
  toggle wired to it — it is `false` and stays `false` until one is built.
  That is a real gap, not a hidden default-on reach for system volume.
- **The input-route fix is machine-wide while held, not per-process** (§3).
  There is no per-process input-device override that survives
  `AVAudioEngine`'s own re-assertion; this was tried and measured to fail
  (see `AudioRoute.swift` header for the two mechanisms that did not hold).
- **A cleaner fix — bypassing `AVAudioEngine` for a raw AudioUnit graph the
  OS cannot silently override — was not attempted.** It would very likely
  avoid the machine-wide default-input side effect entirely, but it means
  replacing the core of `SpeechInput`'s 769-line audio graph (Deepgram
  routing, Apple STT, the hologram level tap, the replay buffer, wake-word
  monitoring all currently hang off one `AVAudioEngine`). That is its own
  phase, not a tonight-budget change.

## 7. The remaining diff — `AppState.swift`, not owned by this pass

Current state (confirmed by reading the file, not edited by this pass): the
LISTENING-ONLY system-volume-fallback call sites already match this pass's
API —

```swift
// shutDown():
AudioDucking.restoreSystemVolumeNow()
...
audioCoordinator.reset()

// setPhase():
if next == .listening {
    AudioDucking.beginListeningFallback()
} else if phaseWasListening {
    AudioDucking.endListeningFallback()
}
phaseWasListening = next == .listening
```

What is NOT yet wired in is the whole-exchange Music duck — the actual "lower
it, talk to me, once we're done it gets raised back to normal" fix. Two
small changes:

**1. Pass Music into the coordinator** (around line 194):

```diff
     private lazy var audioCoordinator = AudioCoordinator(
         clips: clipPlayer,
         setClipVolume: { [weak self] value in self?.clipPlayer.volume = value },
-        currentClipVolume: { [weak self] in self?.clipPlayer.volume ?? 0 }
+        currentClipVolume: { [weak self] in self?.clipPlayer.volume ?? 0 },
+        music: musicControl
     )
```

**2. Span the duck across listening + thinking + speaking, in `setPhase()`**
(immediately after the existing `phaseWasListening = next == .listening`
line):

```diff
     phaseWasListening = next == .listening
+    // Media duck: spans the WHOLE exchange -- listening, thinking, and
+    // speaking -- releasing only when the conversation returns to idle or
+    // errors out. This is the fix for "the music comes back while he's
+    // still replying". See AudioCoordinator.beginConversation().
+    let phaseIsActive = next == .listening || next == .thinking || next == .speaking
+    if phaseIsActive, !phaseWasActive {
+        audioCoordinator.beginConversation()
+    } else if !phaseIsActive, phaseWasActive {
+        audioCoordinator.endConversation()
+    }
+    phaseWasActive = phaseIsActive
```

And one new stored property, next to `phaseWasListening` (around line 347):

```diff
     private var phaseWasListening = false
+    /// Whether the phase we are leaving counted as "in an exchange" —
+    /// listening, thinking, or speaking — so the Music duck spans all three
+    /// and releases exactly once, back at idle.
+    private var phaseWasActive = false
```

No other files need changes for this. `swift build` already succeeds today
(see §8) with `audioCoordinator`'s `music:` parameter defaulted to `nil`, so
Music ducking is simply inactive until this diff lands — the app is not
broken by its absence, it just does not yet have the headline fix wired to a
call site.

## 8. Build and test — actual output

```
$ swift build
Building for debugging...
[6/9] Write Objects.LinkFileList
[7/9] Linking Orion
[8/9] Applying Orion
Build complete! (2.58s)
```

```
$ DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer swift test
...
Test Suite 'All tests' passed at 2026-09-05 03:14:54.
	 Executed 402 tests, with 0 failures (0 unexpected) in 9.639 seconds
```

(`xcode-select -p` on this Mac points at the bare Command Line Tools, which
have no XCTest — `DEVELOPER_DIR` overrides it for one invocation, exactly as
`Tests/run-domain-test.sh` already documents. Nothing about the system
toolchain was changed.)

402 tests total, up from the pre-existing baseline: 8 of them are new
(`AudioCoordinatorMusicTests.swift`), proving by mutation rather than
reasoning — a fake `MusicDucking` conformer whose volume is set directly, so
each test asserts on what the coordinator ACTUALLY told it to do:

- duck-on-begin / restore-on-`endConversation`
- the duck survives across a listening → thinking → speaking sequence with no
  intervening `endConversation` (the literal defect being fixed)
- overlapping `beginConversation()` calls do not let an inner `endConversation()`
  restore the outer exchange
- a manual volume change mid-exchange beats the automatic restore
- below-floor and not-playing sources are left untouched
- `reset()` forces Music back even over an apparent manual change (the
  unconditional half, used for crash safety and "restore audio now")
- no Music source at all (`music: nil`) never crashes

All pre-existing tests, including the system-volume guardrail, still pass
unmodified.

`./Tests/run-audio-matrix.sh` builds and runs standalone (`swiftc`, not
SwiftPM — see the note in `Package.swift` on why the harnesses under `Tests/`
are separate from the unit-test targets) with three route modes now:
`--input-route default` (today's behaviour), `--input-route builtin` (applies
the fix but restores immediately per candidate — deliberately demonstrates
§3's finding), `--input-route builtin-hold` (applies once, holds across every
candidate, restores once at the end — the actual production policy). All
three were run live tonight; the transcripts are in §1–2 above.

## 9. Crash and disconnect recovery — how, concretely

Three independent duck/route mechanisms, three independent JSON markers under
`~/.openclaw/`, checked at the same point in each mechanism's lifecycle
(construction / first use, which for the route lease is proven safe to do
before any engine has ever touched `.inputNode` — §3's table, row 3):

| File | Written when | Checked | Restored if |
|---|---|---|---|
| `orion-audio-route-state.json` | route switched to built-in mic | `AudioInputRouteLease.init()`, i.e. app launch | current default input still equals what was applied |
| `orion-music-duck-state.json` | Music ducked for a conversation | `AudioCoordinator.init()` | Music's current volume still matches the ducked value |
| `orion-system-volume-duck-state.json` | system volume ducked (fallback, opt-in) | first call into `AudioDucking` this run | current volume still matches the ducked value |

In every case: if the value has since changed (Nick touched it, or enough
time passed that the state looks unrelated), the marker is cleared WITHOUT
touching the live value — recovering must never overwrite a deliberate choice
made in the meantime. A route change, a Bluetooth disconnect, or a force-quit
between the write and the next launch all resolve through this same path;
none of them require the user to notice or intervene, though a mid-run crash
does mean the built-in mic stays the machine default until the NEXT clean
launch's recovery check runs (not until the OS reboots, or anything drastic —
just until Orion is opened again).

## 10. Rollback

Every change is contained to the files listed at the top; nothing outside
`native/Orion` was touched except this note. To roll back: revert
`Sources/Orion/AudioDucking.swift`, `Sources/Orion/AudioRoute.swift` (delete),
`Sources/Orion/SpeechInput.swift`, `Sources/SessionService/AudioCoordinator.swift`,
`Tests/AudioMatrix/*`, `Tests/run-audio-matrix.sh`, and
`Tests/SessionServiceTests/AudioCoordinatorMusicTests.swift` (delete) to their
prior committed state; `AppState.swift` was never edited by this pass, so
nothing there needs reverting unless §7's diff has since been applied.
Nothing was committed by this pass — work is left uncommitted per the brief.
