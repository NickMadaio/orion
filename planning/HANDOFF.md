# Orion — handoff, 2026-08-11

> Historical focus/session handoff. For current ORION v2 work, start with
> root `AGENTS.md` and `planning/v2/HANDOFF.md`, then the Phase 32.5 charter and
> `planning/v2/ROADMAP_AMENDMENTS.json`. This older record does not supersede
> current phase gates or authorize running its historical installation commands.

Written so somebody with no memory of this session can pick it up cleanly.
Read this first, then `GATE-0-BASELINE.md` and `GATE-1-AUDIO.md` for the two
gates whose findings changed the plan.

The work: a focus-session engine (50/10/50/10/50), guided breaks, a factual
calendar, and a keyboard Console. Built as eleven gates from
`~/.claude/plans/alright-this-is-going-eager-blanket.md`. **All eleven are
done**, plus a UI restructure Nick asked for afterwards.

---

## 1. Where things live

```
native/Orion/
  Sources/SessionDomain/     PURE. No AppKit, no I/O, no network. 
                             Reducer, reconcile(now:), clocks, enforcement
                             policy, exit policy, day scoring, calendar maths.
  Sources/SessionService/     I/O. Store, history journal, IPC socket, clip
                             library + player, sensors, enforcer, camera,
                             quittable apps, DND/Music, FileLock.
  Sources/Orion/             The app. SwiftUI, AppState wiring.
  Tests/SessionDomainTests/  ) 218 tests
  Tests/SessionServiceTests/ )
  Tests/run-domain-test.sh   everything (swift test, via DEVELOPER_DIR)
  Tests/run-layout-test.sh   real NSHostingView: nested-scroll + break surface
  Tests/run-race-test.sh     two real processes racing health-log.json
  Tests/run-audio-matrix.sh  CoreAudio observation matrix
scripts/orion-session        the session CLI (a client, never an engine)
scripts/orion-messages       iMessage reading for the agent
```

`SessionDomain` is a separate SwiftPM target **so purity is a compiler
constraint rather than a convention**. That is what makes DST, sleep, a dragged
clock and a crash-mid-phase testable as data.

### Build, test, install

```bash
cd native/Orion
./Tests/run-domain-test.sh          # 218 tests
./make_app_bundle.sh                # builds + signs
pkill -9 -f "Orion.app/Contents/MacOS/Orion"
rm -rf /Applications/Orion.app && cp -R .build/Orion.app /Applications/
open /Applications/Orion.app
```

---

## 2. Traps a fresh context will walk into

These cost real hours. Every one is a fact about this machine or this codebase.

**`swift test` fails with "no such module XCTest".** `xcode-select` points at
CommandLineTools, which has no XCTest, while Xcode is installed at
/Applications. `Tests/run-domain-test.sh` sets `DEVELOPER_DIR` per invocation.
Do not `sudo xcode-select -s`.

**A shell-launched instance has a dead main run loop.** Launch it with
`/Applications/Orion.app/Contents/MacOS/Orion &` and `DispatchQueue.main` work
never executes — no speech, no windows, no timers — while the socket on its own
thread and the session's dispatch timer keep working perfectly. It looks like a
product bug and is not. Use `open`. To point a test run at scratch files:

```bash
open -n /Applications/Orion.app \
  --env "ORION_FOCUS_STATE=/tmp/x/state.json" \
  --env "ORION_FOCUS_HISTORY=/tmp/x/h.jsonl" \
  --env "ORION_SESSION_SOCKET=/tmp/x/s.sock"
```

This is also flaky — it intermittently produces the dead-run-loop instance
anyway. Prefer the layout harness for anything window-related.

**Never write Nick's real `focus-history.jsonl` from a test.** It is append-only
and never pruned. Use the env overrides above. As of this handoff it has **zero
records**, which is correct.

**`.completeFileProtection` on a shared file makes it unreadable to other
processes.** It only bites once the path leaves the home directory, so it
"works" until it doesn't. Removed from `SessionStore`; `HealthLog` had the same
line and a separate task was spun off for it.

**Day keys are local with a 4am cutoff** (`OrionDay.current.key`). Never
`toISOString()` — that has already shipped as a real bug in `orion-daily`.

**A vertical ScrollView inside the dashboard's own ScrollView sizes to its
content and silently stops scrolling.** Guarded by `run-layout-test.sh` and by
source-level tests in `LayoutRuleTests`.

**The hardened runtime needs an entitlement, not just an Info.plist string.**
Four permissions have now been broken this way (mic, calendars, contacts,
camera): without the entitlement macOS reports `.denied` for something the user
was never asked about. See `Resources/Orion.entitlements`.

**`SessionService` is the ONLY writer** of session state and history. Scripts
are clients over the socket with request IDs. If the app is not running they
fail loudly. Never add a second writer.

**The heartbeat must not move to a main-runloop Timer.** It is a
`DispatchSourceTimer` deliberately — see §4.

---

## 3. What was built, gate by gate

| Gate | Outcome |
|---|---|
| 0 baseline | 36 uncommitted files preserved in 8 themed commits, tagged `baseline/pre-focus-2026-08-11` |
| 1 audio | **Hypothesis refuted.** No change made. See below. |
| 2 domain | Pure reducer + `reconcile(now:)`, two clocks, effects with stable IDs |
| 3 service | Single writer, atomic store, JSONL history, unix-socket IPC, `orion-session` |
| 4 clips | Convention directory, double validation, looping playback, clock owns boundaries |
| 5 enforcement | Sensors behind protocols, Gentle/Firm, six-nudge cap, unconditional escape |
| 6 voice | Deterministic exit policy first, model second; real TTS; AudioCoordinator ducking |
| 7 UI | Session surface, break window with the escape trade stated |
| 8 calendar | Visible-interval fetching with real padding, month/week/day |
| 9 Console | ⌥Tab via Carbon `RegisterEventHotKey`, AUTO/NOTIFY only |
| 10 extras | Day score, quittable apps, DND, Music, reverse lockdown, full-bleed, camera |

### Gate 1 is the one to read before touching audio

The plan asserted that a missing `mainMixerNode → outputNode` connection pinned
the output device to 24 kHz mono. **Both halves were wrong.** The connection is
explicit and hardcoded at 24 kHz mono (`SpeechOutput.swift:244`), and
`outputNode` is never referenced anywhere in the app. More decisively: the
built-in output device accepts **44100/48000/88200/96000 and not 24000**, so it
cannot be pinned there by anything.

All three candidate graphs held the device steady with stereo playing and the
microphone live. Candidate C was measurably *worse* — its `nil` connect resolved
to 44100 rather than tracking the device, adding a resample. **No change was
made.** `releaseDevice()`'s 1.5s timer is left in place; its comment is known to
be wrong and should be corrected when something next touches that file.

**Still unmeasured: the Bluetooth route.** The prediction, written down in
`GATE-1-AUDIO.md` so the eventual run confirms or kills it: opening the mic on a
headset that is also the output forces A2DP → HFP, which is mono at a low rate —
the exact symptom, and something no output graph can fix. If it holds, the answer
is split devices (Bluetooth out, built-in mic in).

---

## 4. Bugs found by running it, not by reading it

Worth knowing because several were invisible to the compiler and to unit tests.

1. **The heartbeat never fired.** It was a `Timer` on `RunLoop.main`. A full
   five-minute session ran with zero heartbeats, no phase announcements, no
   history — while the socket kept answering. Now a `DispatchSourceTimer` that
   cannot be starved.
2. **SIGPIPE killed the app.** Any script client that timed out or was killed
   took Orion down. Now ignored process-wide and per-socket.
3. **`.completeFileProtection`** made a 0600 file the user owns unreadable.
4. **The enforcement grace clock reset every observation**, so a wrong app was
   never reported at all.
5. **Preflight showed misaligned pairs** — "Claude (com.apple.MobileSMS)". Nick
   would have authorised apps unrelated to the names shown.
6. **A completed session ended in silence.**
7. **A crash at minute 49 voided a 50-minute block.** This is what forced the
   heartbeat design: the domain learns when the app came *back*, never when it
   died, so without a liveness watermark the whole gap is ambiguous. Loss is now
   bounded to one 30s interval.
8. **Calendar padding was four days short** of the next month's grid.
9. **Only the "Orion" reminders list was read**, so nothing ticked off elsewhere
   appeared. Reading widened to all lists; **writing stays scoped to Orion's**.
10. **`MessagesReader` was UI-only** — Orion could not read messages on request
    at all. `scripts/orion-messages` now provides it.

---

## 5. The UI as it stands

Tabs: **home · tasks · health · finance · brand · settings**.

- **Calendar folded into Tasks.** Right column switches day/week/month. Day
  cells show a tick count, focus minutes, and a tint that scales with the score.
  Unscored days stay **neutral** — "no score" and "a bad score" must not look
  alike when one is an accusation.
- **Session is a card on Home**, shown only when a session exists.
- **Messages tab removed**; the capability moved to `orion-messages`.
- **Settings is collapsible**, with a Focus section carrying every Gate 10
  switch. All off by default; each states its cost above the toggle.

---

## 6. What Nick has to do

Nothing below can be done for him.

| # | Thing | Why |
|---|---|---|
| 1 | **Press ⌥Tab** | Confirms the keystroke does not also reach the app underneath. Carbon guarantees it and a test locks the mechanism, but nobody has pressed the key. |
| 2 | **Full Disk Access** for whatever runs `orion-messages` (the OpenClaw gateway, and Terminal for manual runs) | Verified currently denied. Without it Orion cannot read texts. It reports the denial by name rather than showing an empty inbox. |
| 3 | **Drop 3 clips** into `~/.openclaw/orion-controlled/focus-clips/` | The folder does not exist yet. The app says so plainly rather than being silently quiet. |
| 4 | **Bluetooth audio run**, AirPods on: `./Tests/run-audio-matrix.sh --candidate A` | Closes Gate 1. ~30 seconds. |
| 5 | **"Does it sound right"** | The only question nobody else can answer. |
| 6 | Camera / Music / DND consents | Only if he wants those. Camera asks on toggle; Music asks on first pause; DND needs two Shortcuts named `Orion Focus On` / `Orion Focus Off`. |

---

## 7. Open, and what to do next

**Nothing is half-built.** Every gate is complete, committed and tested. These
are new decisions, not unfinished work.

- **No day will score yet.** Focus history is empty and per-day health is not
  stored — Whoop history is not persisted per day, hydration is today-only. So
  coverage sits under 50% and each day honestly reports "not scored" with the
  reason. **The fix is a daily health snapshot**, written once per logical day.
  That is the highest-value next piece if the score matters.
- **Permissions pass.** Nick flagged this as the next topic. Items 1–2 and 6
  above, plus `ORION_PERMISSION_ELEVATION.md`.
- **`HealthLog.publish` still has `.completeFileProtection`.** Spun off as a
  separate task; may already be done.
- **`SpeechOutput`'s device-pinning comment is known wrong.** Correct it when
  next touching that file; do not "fix" the graph on the strength of it.
- **Enforcement does not run while the app is quit.** Stated in the source, the
  CLI help and the UI. Not a bug; a limit.
- Open findings remain in `RISK_SWEEP.md`, `ORION_AUDIT_2026-08-08.md` and
  `learning-proposals.md`. Those were not re-verified this session.

---

## 8. Rules that were load-bearing

Break these and things get quietly worse rather than loudly broken.

1. **Every external dependency needs a visible unavailable/denied/stale state.**
   Silent empties have been this project's worst bugs. An empty list because
   permission was denied and an empty list because nothing happened are
   different facts and must read differently.
2. **Missing is not zero.** A day with no Whoop sync is not a day with bad
   health. Absent components are excluded and weight redistributed; below half
   coverage the score refuses to exist.
3. **The model proposes; Nick authorises.** Enforcement allowlists are
   confirmed by him. The quittable-app list he writes entirely himself — that
   asymmetry is deliberate, because confirming what may be *closed while you are
   typing in it* is a different risk from confirming what not to interrupt.
4. **The escape always works.** `Enforcement.release` takes the state and
   returns the state — it cannot consult a model or a network, which is the
   guarantee expressed as a signature.
5. **Nothing derived is stored.** No `currentPhase`, no `phaseEndsAt`, no
   `servedMinutes` on disk. Two copies of one fact is how they come to disagree.
6. **Effects are acknowledged separately from being emitted.** A crash between
   the two re-emits; a crash after does not. That is what makes "exactly one
   history record per session, ever" true rather than hoped for.

---

## 9. Continuation update — 2026-08-11 afternoon

This section supersedes the "nothing is half-built" wording above for the
work completed after this handoff was written. These changes are **uncommitted**
at the time of this update; preserve the existing working tree and do not reset
or checkout over it.

### Verified since the original handoff

- `./Tests/run-domain-test.sh` passes: **218 tests**.
- `./Tests/run-layout-test.sh` passes.
- `./Tests/run-race-test.sh` passes.
- `./make_app_bundle.sh` builds and signs the app. The remaining compiler
  warnings are pre-existing selector/deprecation warnings, not build failures.
- The installed app previously crashed while rendering Settings because the Do
  Not Disturb Shortcut check synchronously launched work from SwiftUI's render
  path. `AppState` now refreshes that configuration asynchronously and stores a
  published result. The rebuilt app launched and remained running after install.

### Calendar and Settings changes

- Calendar completion markers are now visually stronger: completed task days
  get a calm green tint and a visible check-count capsule even without a health
  score. A missing score remains ungraded; completion is not presented as a
  grade.
- `CalendarModel` now reloads after asynchronous Reminders completion history
  arrives. This fixes the original race where historical completed days could
  remain absent from week/month views even though Reminders access was granted.
- Settings sections start collapsed. The always-expanded Calendar inventory and
  Connections list are nested behind their own sections.
- The above changes compiled and were installed once, but the final visual
  review of a real historical-completion month is still needed.

### Live focus awareness

- Every voice or typed request sent from the native Orion app now carries a
  compact, app-supplied snapshot: session state, phase, task, enforcement
  state, and the temporary **allowed work apps**. This is context supplied by
  `SessionService`/`Enforcer`, not inferred by the model.
- The temporary set is intentionally an allowlist, not a list of distractions.
  Do not claim an app was hidden, blocked, or quit unless the enforcement layer
  actually confirms the action.

### Session and break surface work in progress

- During a live focus block, Home now transforms into a session dashboard rather
  than showing the normal launcher: a smaller Orion visual, the active task,
  elapsed focus time, remaining block time, and next-break line are visible.
- The dashboard has a truthful sound card. It says that the session is quiet
  until clips are supplied, and does not pretend Apple Music playback controls
  or binaural audio exist yet.
- The existing domain already supported shortening a break. The break surface
  now exposes a **"Make this a 3-minute reset"** action during longer breaks;
  it uses `shortenRest`, not skip, so the session structure remains correct.
- The session tests passed after these changes.

### What is still not implemented — do not overclaim

Nick's desired focus ladder is:

1. Gentle: notice drift and speak once.
2. Guided: bring the allowed work app forward after repeated drift.
3. Firm: hide non-allowed apps without force-quitting or risking unsaved work.
4. Shield: a full-screen Orion focus reminder that returns to the work context
   while preserving an unconditional local escape.

The current code still implements only Gentle/Firm **spoken nudge** semantics.
It does not yet hide applications, close applications, block relaunches, or
show the focus shield. Apple's Lockdown Mode is a security-hardening feature,
not a focus-control mechanism, and should not be used for this feature.

The existing break surface can already go full-screen, but it is still a sparse
utility panel. It needs the mindful, guided reset redesign: a full-screen calm
visual, mediation/guided-break choices, clip status, and the bounded
three-minute option. It must keep a reliable exit path and never pretend it can
capture macOS or prevent Force Quit.

### Audio and permissions: current truth

- The original 24 kHz mono concern remains disproved for built-in speakers. No
  user-reported audio defect was found. Bluetooth was only a future hypothesis,
  not an observed AirPods issue.
- There are no focus clips in the expected clip directory, so calming/binaural
  session sound is not currently usable. Build the visual/control surface around
  this honest unavailable state, then add an owned sound source or user clips.
- Music integration currently pauses/resumes Apple Music by opt-in; it has no
  now-playing metadata, artwork, seeking, skip, or volume controls. Those need
  a separate implementation and first-use macOS Automation consent.
- Live Settings previously reported Accessibility, Calendars, Reminders,
  Contacts, Microphone, Speech Recognition, and Full Disk Access granted.
  Camera presence was toggled on, but a fresh real camera-prompt check is still
  required. Do Not Disturb still depends on Shortcuts named `Orion Focus On`
  and `Orion Focus Off`.
- Messages bridge work exists in the working tree (`MessageBridge.swift` and
  `MessageAccess.swift`) and compiles with the app, but end-to-end agent use has
  not been proved yet.

### Immediate next order

1. Finish and visually review the full-screen break redesign and active-session
   dashboard together.
2. Implement the focus enforcement ladder as test-gated, non-forceful native
   behavior; retain the unconditional escape and protected-system-app boundary.
3. Add real music/clip status and controls only when the audio source exists;
   test on the user's normal output route.
4. Run a real month/week calendar check after Reminders sync, then verify the
   permission states through the installed app.
5. Test the uncommitted Messages bridge end to end before describing Messages
   access as complete.

### Aug 11 — durable daily health history

- Health is now persisted in the existing private, atomically-written
  `health-log.json` as one simple record per logical day. The records hold
  water, manually entered calories, supplement checkmarks, workout history,
  and only the wearable measurements actually received (recovery, sleep, HRV,
  resting heart rate, and strain).
- The former supplement and calorie fields remain readable for companion-plugin
  compatibility; on the next write, their historical values are copied into
  the day records. Nothing is discarded.
- Water no longer comes from a separate in-memory/UserDefaults counter in the
  Health UI or dashboard header. `HealthLog` resolves the logical day on its
  regular poll, so a new day reads as zero without requiring a restart or a
  water-button press.
- Calendar scoring now consumes saved historical health facts when available;
  it continues to show insufficient data rather than inventing missing values.
  Scores are derived from saved facts and the versioned score policy, so the
  score history remains explainable if the policy changes.
- `./Tests/run-domain-test.sh` passed (218 tests) and the production app bundle
  built, signed, installed, and launched after this change.

### Aug 11 — Nutrition tracker

- The former single manual calorie field is now a local-first food log. Each
  meal entry can record its meal slot, calories, protein, carbohydrates, fat,
  fiber, and notes. The food-log surface also exposes editable daily calorie
  and macro targets, a same-day total, removal controls, and recent-food
  shortcuts.
- Nutrition entries and goals live in the same private `health-log.json` day
  records. Existing manual totals migrate into a visible, removable imported
  entry instead of disappearing or being silently reinterpreted.
- Health's right rail has a compact at-a-glance grid plus a Food Log entry
  point; the main column retains a lightweight nutrition summary. Recovery,
  sleep, and strain cards were enlarged slightly.
- This is a manual local tracker. It does not yet search a food database,
  scan barcodes, infer portion sizes, or connect HealthKit; those require a
  separately chosen source and permission path.

### Aug 11 — Focus-session visual alignment

- The active focus surface was rebuilt around the approved generated reference
  instead of the earlier loose card layout. It is now one proportional
  two-column scene: Orion identity and constellation over a full media console
  on the left; the gold ticked timer, elapsed/next-break clocks, and Focus Guard
  on the right. Window controls, typography, spacing, glow, and radial detail
  were matched in the real SwiftUI render rather than inferred from a build.
- Live sessions still use real session values. The reference track metadata is
  preview-only; when no source exists, the installed surface says that session
  audio is not connected and disables the pretend playback state.
- A 1512 x 944 isolated render of the production `FocusSessionHome` was visually
  compared with the reference after two sizing passes. The final production app
  then built and signed, `run-domain-test.sh` passed all 218 tests, and
  `run-layout-test.sh` passed.
- The signed bundle was installed at `/Applications/Orion.app`. A cold-launch
  verification paused in the pre-existing synchronous Keychain connector read
  before the command-center window appeared; no unexpected Keychain prompt was
  approved. The session surface itself was therefore visually verified through
  the isolated real-view harness, not claimed from the blocked full-app route.

### Aug 12 — Focus audio and Progressive Guard corrections

- The continuous ticked Focus Guard meter is back in the live session surface.
  Progressive is now the default app-allowlist mode and climbs on continued
  drift from Gentle to Guided, Firm, and finally Shield. Every fixed level is
  still available, and the unconditional release remains unchanged.
- Binaural's player pause is now separate from the session's pause state. A
  running-session heartbeat can no longer resume audio after the player itself
  was paused; the regression is covered by repeated-heartbeat tests.
- Selecting Apple Music now sends an explicit play command instead of toggling
  play/pause, so a delayed status refresh cannot turn an already-playing queue
  off. Choosing a different source from the active-player menu also activates
  that source rather than only relabelling the card. Music still requires the
  normal first-use macOS Automation consent.
- The real focus-view harness rendered the five-mode control and restored meter.
  The full domain/service suite passed all 234 tests, the native layout harness
  passed, and the release bundle was signed, installed, signature-verified, and
  relaunched from `/Applications/Orion.app`.

### Aug 12 — Apple Music artwork and Health-inspired session polish

- Apple Music status now carries the track's persistent ID. Orion fetches the
  current track artwork only when that ID changes, decodes it locally, and uses
  it in the session player. It no longer presents Orion's Binaural waveform as
  Apple Music cover art; a quiet Music placeholder is used only when a track
  has no embedded artwork or it has not arrived yet.
- The session audio surface now follows the Health tab's visual grammar:
  layered neutral panels, slim color rails, circular hover controls, a single
  emphasized play/pause action, and quieter status/source controls. Guard mode
  selection uses restrained underline states instead of five bordered boxes.
- Both the full player and silent chooser were rendered from the production
  SwiftUI view at 1600 x 1000 and visually reviewed. All 234 tests passed. The
  release bundle was signed, installed, verified, and reopened from
  `/Applications/Orion.app`. Real-track artwork retrieval still requires a
  normal user-selected Apple Music track and the already configured Automation
  approval; no music was started merely for an automated visual test.

### Aug 12 — Player hierarchy and single allowlist prompt

- The Apple Music source selector and playback state now live in a top strip
  above the artwork/metadata row. The song title owns the full metadata column,
  supports two lines, and is no longer squeezed out by the source control.
- The repeated app-allowlist prompt was a real duplicate-view bug: `HomeTab`
  created one live `FocusSessionHome` while `DashboardView` overlaid a second.
  Home no longer creates the hidden copy; the dashboard overlay is the sole
  session surface and sole sheet presenter. A source-level regression asserts
  exactly one production `FocusSessionHome` owner.
- The revised player was rendered at 1600 x 1000 and reviewed. All 234 tests
  passed; the signed bundle was installed, verified, and reopened.
