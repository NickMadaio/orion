# ORION — handoff

The live state of the project. Newest entry first; add yours at the top of
"Log". The previous handoff (2026-07-28 → 2026-10-12, 273 KB) and the V3
continuation notes were archived on 2026-10-14 to
`~/Desktop/ORION-archive/2026-10-14/` (still in git history).

Read with: `AGENTS.md` (working rules), `NICK-TODO.md` (things only Nick can do),
`docs/planning/v2/` (the numbered phase program and gates),
`docs/planning/v3/ORION_V3_SPEC.md` (the local-model plan) and
`docs/evals/v3/REPORT.md` (its results).

---

## Current state (2026-10-14 22:30 BST)

### How a message is answered right now

- **All of ORION runs on local models** through the OpenClaw gateway
  (v2026.7.1-2, port 18789) and the `plugin/orion-control` plugin:
  `qwen3.5:4b-q4_K_M` is the front desk (decides answer / tool / ask / ignore),
  `qwen3.5:9b` does the work. Both run in Ollama on the Mac (M5 Pro, 48 GB).
- `localRouting: "on"` means **local always** (since 2026-10-16, 278d75e): no testing
  window and no acceptance gate. `localRoutingTestingUntil` is ignored. The cloud model is
  used only when `localRoutingScheduleToCloud` is true, for scheduling change requests.
- **Anthropic API is unusable** (credit balance too low / usage limit until
  2026-11-01). Only Nick can fix it (console.anthropic.com). The account-health
  alert tells his phone once when that happens.
- The phone never answers on-device: every message goes to the Mac
  (`RemoteViews.answerOnDevice = false`).

### The local route, in order (`plugin/orion-control/src/local-routing.ts`)

1. `before_model_resolve`: every turn goes to `ollama/qwen3.5:9b`; the 4B front
   desk decides in ~1.5 s (`front-desk.ts`, 8 s timeout).
2. `before_prompt_build`: a slim system prompt (not the 17k-token workspace).
   - "remind me / ping me / wake me…" → code extracts time + label and hands the
     9B the exact `orion_task_run` `alarm_set` call (never a to-do).
   - Schedule changes → `schedule-flow.ts`: `orion-reschedule show --json` →
     the 9B fills one form (temperature 0, block ids as enums) → code compiles
     it to exact argv (5-min buffers, invisible commutes from
     `~/.openclaw/orion-controlled/places.json`) → the scheduler runs it → a
     reply built by code. One correction round; anything else falls back.
   - Questions get the day read by code.
   - Between midnight and 05:00 "tomorrow" means today's date.
3. `before_agent_finalize`: the claims checker (`work-check.ts`) revises a reply
   that claims work no tool did, or asks instead of acting; after two tries the
   reply is replaced by an honest line. `reply_payload_sending` enforces exact
   replies.
4. Both models are kept loaded at the context they are called with (4B 16384,
   9B 32768), checked every 5 minutes (`keepWarm`).

Live 9B params (`models.providers.ollama.models[qwen3.5:9b]`):
`reasoning: false`, temperature 0.2, top_p 0.9, top_k 20, presence_penalty 0,
repeat_penalty 1.0, num_ctx 32768, keep_alive 24h, think false, num_predict
2048. Config backups: `~/.openclaw/backups/`.

Measured live on 2026-10-14 after the fixes below: **4.5–5.8 s per turn,
9B at 44 tok/s, no hidden thinking.** Live gauntlet on his real calendar
(`scripts/eval/v3/gauntlet/run.sh`): 12/12 on 2026-10-12.

### Deploying

- Plugin: `scripts/orion-deploy --allow-dirty` (build, every test suite, snapshot,
  install to `~/.openclaw/extensions/orion-control`, gateway restart + probe,
  automatic rollback). Roll back: `scripts/orion-deploy --rollback`.
- Mac app: `native/Orion/make_app_bundle.sh`, then replace `/Applications/Orion.app`
  (keep a copy as `/Applications/.Orion-previous-<build>-<what>`; latest is
  `.Orion-previous-620-todo-redesign`). Build number = `git rev-list --count HEAD`.
- Phone: `xcodebuild -project native/OrionMobile/OrionMobile.xcodeproj -scheme
  OrionPhone -destination 'generic/platform=iOS' -allowProvisioningUpdates build`,
  then `xcrun devicectl device install app --device 00008140-00013C1C213A801C <app>`
  (retry until the phone is unlocked and near the Mac).
- Live tests through the real route: `openclaw agent --session-key <new key>
  --thinking low --message "…"` (binary in `~/.openclaw/tools/node-v24.15.0/bin`).
  Never run the gauntlet while Nick is mid-conversation; tests must never reach
  his real calendar.

---

## Log

### 2026-11-03 afternoon: wave 18 (Claude, orchestrator)

- **Apps:** scripts/orion-apps (list, quit, quit-unused, hide) and apps-read/chat.ts. Root cause of "can't close apps": the model called the bedtime-only `orion-bedtime-act quit-app`, which was off the allowlist. Quit escalates: graceful, then SIGTERM of the app tree, then SIGKILL. Launchers, game, chat and music apps escalate fully. Apps showing a save or question prompt are left and reported. Pids are re-checked by comm and start time before each signal. Ollama, openclaw and orion processes are never signalled.
- **Mouse:** MouseKit plus Sources/Orion/Mouse (IOHID watcher, otherMouse-only CGEventTap, per-app bindings, game pass-through, settings section, setup popup). scripts/orion-mouse plus mouse-read/chat.ts. Files live in orion-controlled/mouse/{devices,bindings}.json. The `{"kind":"mouse","event":"setup-open"}` outreach line opens the popup. Not yet tried with a real mouse.
- **Food:** a phone photo auto-logs and replies "Logged … Fix anything?". Corrections edit the same entry with a journal, and undo restores it. Link kicks `orion-food-estimate inbox` right after a write.
- **Phone widgets:** blue hologram stills and palette, Home-style widgets, and a food photo pill on the phone Home.
- **Projects:** the model picker sizes itself to the longest name.
- Allowlisted orion-apps and orion-mouse.
- **Mouse toggle:** ⌃⌥M flips bindings.enabled (quiet bubble). The game session is restored on launch, and java Minecraft is found by executable path with a libproc scan every 3 s. Root cause of "front button works in Minecraft": the session was never reloaded after the relaunch, and java had no window title without Screen Recording.
- **Scroll:** the mouse wheel is reversed in the event tap (discrete events only), so the trackpad stays natural. Setting `reverseWheel` defaults to always.
- **Evening:** typed summon overlay (⌃⌥Space, orion://type): the composer sits bottom-centre and the hologram slides left when the answer comes. On-demand "game ready" runs `orion-apps game-prep --now`. Mouse setup and Type to ORION are in the menu bar. The Swift voice test in the 211 suite is flaky.
- **Later the same day:** ORION speaks in the first person: self-voice.ts guards it at finalize, the prompts were rewritten, and the live IDENTITY.md too. Phrasings like "pull up the mouse mapper again" now reopen the popup. "open spotify" is a code-chosen app_open. Stage Manager is toggled through the Control Center AX checkbox, because the defaults key is ignored on macOS 26. Game sessions pause every mouse binding, and `orion-apps game-prep` closes non-essentials and unloads idle models. The Razer's third button sends no HID input over Bluetooth (checked live). Flaky: mail-hardening "gog is killed…" timing test, about 1 run in 2.

### 2026-11-03 afternoon: wave 17b (Claude, orchestrator)

- **Workouts by chat:** scripts/orion-workout-log plus workout-read/chat.ts. At most 2 follow-up questions; WKT- ids with undo.
- **Mail:** several accounts (mail-accounts.json, gog --account, a read-only Yahoo IMAP client with its password in the Keychain).
- **Health:** HealthTodayLine replaces the provenance sentence. Hover now uses onContinuousHover, and click-to-pin is the fallback.
- **Knowledge:** a hub view and a Brain view (the Obsidian vault). Projects plan-pane render caching.

### 2026-11-03 midday: wave 17 (Claude, orchestrator)

- **Self-echo:** short cues ("Still working", "Let me") counted as barge-in and orphaned the spoken answer. Fixed with a CueEcho match, and a refused barge-in is now a no-op for speech (VoiceEcho.swift).
- **Home:** a priority table (question > class > overdue > evening sleep > focus > project > health; no finance card) and an orbit layout. The hologram is the sun's halo.
- **Weather:** Fahrenheit only, spoken in full words ("55 degrees Fahrenheit"). weather-words.ts runs at finalize; the brief and watches are converted.

### 2026-11-03 00:30: voice turns in noise (w16/e-voice2) (Claude, orchestrator)

- **SegmentSpeakerFilter:** drops segments of a voice turn that aren't Nick's, using voice-id per segment of 0.8 s or more.
- **BargeInShape:** a name keeps the text from "Orion" on; an unsure voice needs a whole request.
- **TurnRelation:** a held answer is no longer thrown away by the next turn.
- **clock-answer.ts:** "what time is it" gets "It's 11:56 PM." from code.
- **Root cause of "Still working Timmy":** ORION's own "Still working on it." cue was transcribed back as Nick (self-echo). The general case is still open.

### 2026-11-02 late: wave 16: replies, phone Home, voice address gate, bubble threads (Claude, orchestrator)

- **Replies (w16/a-reply).**
  - Answers that arrived while the app was paused for a continuation are now delivered to chat (PausedAnswerLanding.swift).
  - Long place-check replies go to plan-check-story.ts, not reality's attendance guess. The old route produced "you were at wales with".
  - A question never binds to a pending move offer. Repro: "whats the weather…tmrw" was read as "move to tomorrow". Live mitigation: a gateway restart at 23:15 cleared the in-memory offer.
- **Phone Home (w16/b-phonehome).** First screen: what's next, ORION's latest ask with Reply and quick answers, approvals, Done early (existing `checkin early-auto` path), and a water/sleep/focus glance. Earlier tonight the phone crashed on launch: `CLMonitor("orion.places")` gave "Monitor name is not valid", read off `devicectl … --console`. Renamed to OrionPlaces (f5cca8d).
- **Voice (w16/c-voice).** `FollowUpAddressGate` applies only to follow-up and continuation speech. It vetoes on voice-id below 0.40, mixed voices, a level drop of 12 dB or more, or speech said to someone else, and scores on timing and topic. A borderline score of 0 goes to qwen3.5:4b. Decisions are logged to ~/.openclaw/logs/orion-address-decisions.jsonl.
- **Bubble (w16/d-bubble).** BubbleThread shows the reply and the answer in the bubble, binds by askId, and mirrors to the Mac and phone chats.
- **Tests.** Plugin 4447/4447, Mac 588/0, phone suites green. LayoutRuleTests were updated for the Plan page sitting outside the page ScrollView.
- **Trap.** Parallel workers share `git stash`; two swapped stashes tonight. Workers must commit WIP instead of stashing.

### 2026-11-02 evening: wave 14: tab redesigns, hologram, mail alerts, food estimates, phone water and food (Claude, orchestrator)

**Changed.**
- **UI.** Home hologram moves on battery: Low Power now throttles instead of pausing, occlusion is ignored for the transparent window, and it is more visible. Plan sits outside the page ScrollView, so its columns scroll on their own; it has ring meters, a flow timeline and a circle calendar. Projects run settings and plan/activity/review panes restyled. Knowledge has no jitter (fixed-step physics that settles to rest, a clock-driven entrance), orb nodes, and no zoom buttons. Health uses rings and fixed hover stages; "In seven parts" and the Journal are removed.
- **Mail.** `scripts/orion-mail-watch` and `lib/mail/*` give read-only Gmail importance alerts via gog: rules plus qwen3.5:4b for borderline mail, digests at most every 30 min, security codes never shown. `orion-mail-prefs` holds exact-address rules; school and freemail domains can't be domain-muted.
- **Food.** `scripts/orion-food-estimate` estimates from text or a photo with qwen3.5:9b vision plus a 158-food table, with "Log it?" offers keyed by id, undo, and the food-inbox from the phone's CloudKit link.
- **Phone.** AddWaterIntent widget, lock-screen accessory, Control and Siri phrase, with an idempotent water outbox and Mac-side dedupe. Log food camera capture sends a CKAsset that lands in food-inbox.

**Verification.**
- An opus review of mail and food blocked on 2 HIGH (a code leak via the subject; one "not important" muting a whole domain) and 7 MEDIUM. All fixed; re-review approved. A further 4 MEDIUM were fixed in ccaeb78.
- root 2323/2324 (load flakes pass alone); plugin 4379/4379; tsc 0; Mac swift test 520, 0 failures.

**Live.** Orion.app build 1273+. Gmail sign-in is EXPIRED: Nick must run `gog auth add nmadaio08@gmail.com`. Allowlist (approved by Nick): orion-mail-prefs and orion-food-estimate.

**Open.** `orion-mail-prefs remove` is guarded by instruction only. Real-device checks of the widget, Control, Siri and the CloudKit food photo round trip are pending. The CloudKit `FoodPhoto` record type needs deploying to Production if the container runs there.

### 2026-11-02 11:20 GMT: wave 12: learning loop, questions queue, Sentient-style Home (Claude, orchestrator)

**Found state.** Nick asked whether ORION learns (the audit is in the orchestrator scratchpad `orch/learning-audit.md`). Only the
planned-vs-actual stats were live:
- USER.md had 0 learned lines, and `orion_v2_workspace_sync.sh --apply` would wipe any it gained;
- Nick.md had test residue and 7 duplicate `## Learned` headers, because `orion-brain learn` checked `bm read` output, which never matched;
- corrections died with the session;
- there was no questions store, and ORION couldn't edit or delete its own notes.

Sentient OS is github.com/Sentient-OS-Labs/sentient-os (AGPL-3.0): take ideas only, never code.

**What changed.**
- **Learning (L1, L2, a fixer and an opus review).**
  - `scripts/orion-questions` writes `questions.jsonl`; ORION asks at most one question a day at an interruptible moment.
  - Nick's answers are stored as `#answer` facts, which ORION cannot edit.
  - `orion-brain learn --own/mine/unlearn/edit` works only on `#orion` lines. The tool guard rewrites `forget --apply` to `unlearn`.
  - The nightly `orion-memory-consolidate` runs from orion-daily with at most 10 removals a run, a promotion ledger, and tmp+rename.
  - The workspace sync now keeps learned lines.
  - Corrections become dated `Rule:` lines in USER.md (capped at 30, Nick sessions only), shown on every local turn's state card.
- **UI (U1–U5).**
  - The knowledge graph uses a single TimelineView+Canvas renderer: living, with hover, camera control, and state kept across tabs.
  - New motion primitives: SoftReveal, AmbientTimeline, PageTransition.
  - The new Home has a header with every section inline and no "More" menu; a greeting with the "I'VE LEARNED N THINGS" subline; tilted outline cards from real data (classes, overdue items, recovery/sleep, focus, projects, finance, questions); the hologram back as a dimmed centrepiece (the app-shortcut orbs are removed); a glance row; and a glowing composer.
  - The phone drawer follows the finger, with new chat motion.
- **Clock-leak fix (f601260):** `pendingMemory.memo` aged against `Date.now()`, so a pending-reply test only passed before about 08:00.

**Verification.**
- root 2245/2245 (plus the known 900 ms emergency-halt load flake);
- plugin vitest 4197/4197, tsc 0;
- Mac `swift test`: largest suite 447 tests, 0 failures;
- phone simulator build OK, MobileCore 69/69.

The opus review blocked on 3 HIGH and 5 MEDIUM findings; all were fixed, re-review approved, and a forged-`#answer` follow-up was fixed (082b824). The live Home window was captured and checked (build 1245).

**Live/installed state.**
- Orion.app build 1245 is installed. Previous copies: `/Applications/.Orion-previous-1218-pre-w12` and `-1218-pre-wave10`.
- `orion-questions` and `orion-sleepplan` were added to the exec allowlist (Nick approved).
- Nick approved deleting 5 residue facts from live Nick.md; backup in `.builds/Nick.md.pre-residue-*`.
- The scripts mirror is synced. The plugin deploy follows this entry.
- The phone app is NOT installed: it needs a USB-C data cable.

**Rollback.** `scripts/orion-deploy --rollback` for the plugin; swap the `.Orion-previous-*` copy back for the app.

**Next step.**
1. Learning is NOT closed until a multi-day live check shows:
   - a real question asked and answered, with the answer present in a later session;
   - a correction carried into the next session;
   - a nightly consolidate run on live data without losing anything;
   - the 7 duplicate headers merged.
2. Open MEDIUMs: rule-cap drops are silent to Nick; enforceRuleCap has a small race window.
3. Not done: Hermes-style skills from successful runs, wiring HealthCorrelations, and the phone install.

### 2026-11-02 09:15 GMT: why the phone location stopped, and ORION now asks for a fresh fix (Claude, subagent)

**Found state.** The newest phone fix was 10-30 16:27:59Z. At 08:02 location was "unknown", so a "Leave in 13 min" reminder
stayed a silent bubble. The speak rule was right and is unchanged.

**Root cause: phone side, the installed app is older than every background-delivery fix.** Evidence from
`health-log.json`:
- None of the 1695 `phoneSignals` rows has an `audio` key, and `placeEvents` has never had a row. Both were added in
  2882012 (10-16). The current phone always sends `audio`, and the Mac Link has stored it since then. So the phone runs a
  build from before 10-16. ca9c86f and 0ed780f (10-21: background location mode, CLServiceSession, sending queued samples
  from the background) never reached it.
- In that old build a background location wake calls `sample()` and then `log?(entry)`. `log` is nil unless the app's
  window is alive, so the sample is dropped. Samples arrive only when ORION is open, or while it is suspended in memory.
  That is why signals thinned out from 10-21 (93/day on 10-19, then 6, 9, 5, 21, 3, and nothing from 10-27 to 10-29).
- The Mac side is healthy. During the same gap `sleepLog` events (unplugged/used) kept arriving from the phone through
  its own queue. Signals came back at 08:21:25Z today, walking from home, through the new Link 1218. The unified log
  shows no errors except two short offline blips (08:14 and 08:59).

**What changed** (branch `fix/phone-location-request`, not pushed and not deployed):
- `MobileCore/LocationRequest` and `LinkSnapshot.locationRequest`. `SnapshotReader.locationRequest()` reads
  `location-request.json` (valid id, at most 15 min old). `LinkEngine` publishes it, and the snapshot change pushes to
  the phone. The phone answers each id once (`PhoneSignals.answer`, from BackgroundRefresh and on a foreground snapshot
  change) with a fix and a sample. `CaptureGate.requested` gets past the 5-min throttle.
- `scripts/lib/awareness/fix-request.mjs`. `orion-awareness refresh` writes `meta.phoneFix` {lastAt, ageMin, stale,
  askedAt, askReason}, and `show` prints "phone fix N min old, asked …". It asks when location is unknown, the fix is
  over 20 min old and a class or fixed block is within 90 min or a commute is on. `orion-reach` also asks when a message
  stays a bubble only because home is unknown. Asks are limited to one per 10 min.
- `audioFacet` now reads the bare route string the phone actually sends. Before this it read only `{route}` objects, so
  phone headphones were never seen.

**Rollback.** Revert the branch's commits. Older phones ignore the new snapshot field.

**Exact next step.** Install the phone build from this branch (rebuild; the 08:00 build predates it) with the phone
unlocked. Merge, run `scripts/orion-remote-install` (the LifeWatch tick runs the mirror), then rebuild and install
Orion.app for the Link. On the phone: Location = Always, Signals on, Background App Refresh on, and do not swipe
ORION away.

### 2026-11-02 08:00 GMT: Mac app 1218 installed; phone app built but NOT installed (Claude, orchestrator)

**Found state.** Main is at bb9cd6b, which contains the integ/wave4 worktree's head (e0ab44e). The 12 dirty paths are
`docs/planning/v2/CURRENT_AUTHORITY.json` and untracked 10-16 audit notes, none of them from this session. The
2026-11-02 02:00 entry below is still accurate.

**What changed.** Nothing in the repo. Build and install only, from main at bb9cd6b:
- **Mac:** `native/Orion/make_app_bundle.sh` built **build 1218** (1.2.0) with ORION Link embedded and signed with the
  stable identity. `scripts/orion-identity-check` printed "identity matches" for both the build and
  `/Applications/Orion.app`. I quit the old app, copied the new one in and relaunched it. Orion (pid 67904) and the
  embedded `ORION Link.app` are both running. This makes the Mac wake alarm (WakeAlarmController) and the
  phone-notification → `orion-reach --already-sent phone` ingest live.
- **Phone:** `xcodebuild … -scheme OrionPhone -destination 'generic/platform=iOS' -allowProvisioningUpdates
  -derivedDataPath .builds/morning-1102/phone-dd build` printed BUILD SUCCEEDED with 0 errors. The app is at
  `.builds/morning-1102/phone-dd/Build/Products/Debug-iphoneos/OrionPhone.app`, and logs are in `.builds/morning-1102/`.
  **The install failed:** 25 attempts over about 2 minutes gave CoreDeviceError 12040, "developer disk image could not be
  mounted", with the underlying error 10003 "device is still locked". devicectl lists the phone as `connected (no DDI)`.

**Verification.** Both builds exited 0, the identity check passed, and the processes are running (`pgrep`). Nothing
has rung yet: there is no `wake-plan.json` because Nick hasn't set a sleep plan, so the Mac alarm has nothing to ring.
`wake-request.json` holds a stale 2026-10-19 request, which is outside the 20-minute window and harmless.

**Rollback.** The previous app is at `/Applications/.Orion-previous-1218-pre-wave10`. To roll back, quit Orion, then
`rm -rf /Applications/Orion.app && cp -R /Applications/.Orion-previous-1218-pre-wave10 /Applications/Orion.app`. The
phone has nothing to roll back.

**Exact next step.** With Nick's phone unlocked on the home screen (tap Trust if asked), run
`xcrun devicectl device install app --device 00008140-00013C1C213A801C
.builds/morning-1102/phone-dd/Build/Products/Debug-iphoneos/OrionPhone.app` and look for "App installed". Then Nick:
1. picks apps for each Focus group, including Browsers;
2. tells ORION his sleep plan;
3. keeps his normal alarm for the first morning.

Open work is unchanged from the 02:00 entry below: camera exercise-dismiss, a Safari fixture for the gate, the sandbox
alarm clock gap, saf-delete-folder-v, the gym-pushback template, and Notes wedging during com-* items.

### 2026-11-02 02:00 GMT: wave 10 — sleep plan, alarms, bedtime nudges, phone groups, proactive in both chats (Claude, orchestrator)

**Asked by Nick (23:59).** He wanted five things:
- (A) Every phone notification and every Mac proactive message also lands in the phone chat, and his reply binds to it.
- (B) "I'm going to start waking up earlier" starts an interview. His answers: 6am Mon/Wed/Thu, at least 3h before class, Tue/Fri class 13:30 so 9am. The result changes his wake/sleep times. Plan for 8h sleep, with a nudge 30 min before bed. Escalation is slow; lockdown only when projected sleep is 6h or less, unless he is out with friends or doing schoolwork (gaming doesn't count). He can talk ORION out of it.
- (C) A wake alarm on the phone and the Mac. Exercise-to-dismiss comes later.
- (D) Phone Screen Time blocks specific groups, not everything, driven by what he is doing.
- (E) Earlier the same night: the gentle crisis tier now teases instead of checking in (02b5ccb).

**What changed, all on sweep/integration.** Rollback tag: `pre-wave10-20261102` (5c8fd31).
- D 5debe3c: the legacy combined-selection shields are gone. A browsers group was added. `orion-phone-time block|unblock <group>` writes per-group until/why through the `focusPlan` snapshot field. That field is optional, so it is backward compatible.
- A1 7ec0a9a: `orion-reach --already-sent/--log-only`. Discord, notify, cron-deliver, approve-resume, checkin ticks and watcher alerts now all land in both chats and in outreach.jsonl. Phone replies bind for 2h. Fixed: orion-ontask-watch alerts had no id, so they never reached the phone.
- C 3c8e6e6: Mac `WakeAlarm*` (Sosumi at full volume, snooze 9 min ×2, gives up after 20 min, alarm-log.jsonl). Bridge `quit_app`, `lock_screen`, `dim`, `undim`. `scripts/orion-bedtime-act`, catalog `bedtime_*`.
- E 67265c4: phone-local notifications are mirrored into the thread, deduped by id. The Mac logs them via `orion-reach --already-sent phone`. The phone schedules per-weekday AlarmKit alarms from the plan.
- B b103b0a: `sleepPlan` in life-config, plus `scripts/orion-sleepplan` and `sleep-plan-flow.ts`. The interview runs code-first in local-routing. It writes `wake-plan.json`: {source, alarms[], bedtimes[], lockdowns[]}. bedtimes/lockdowns are dated by the evening the night starts.
- G 4a4c2d2: `phone-block-flow.ts` handles "block safari n stuff till 12" code-first. A yes to an ORION block offer runs the block.
- F c2a5b3a: `scripts/orion-sleep-nudge` runs from `orion-watch tick` (about every 5 min via LifeWatch). Ladder: nudge, bedtime, firm, warn, dim, then lockdown. It acts only when he is active, and only for a plan with source "nick". It refreshes wake-plan.json daily.
- Review fixes (opus reviewer, then f0819fc and d3c3a37):
  - Only `plan`/`class` alarms are emitted, each marked `byNick`; both Swift readers require it. So no weekend or calendar alarms.
  - The wake request is never copied into the plan.
  - quit/lock is refused outside tonight's window, and quit is allowlisted to distraction apps only (never Atlas or Xcode).
  - A bare yes binds acting offers for 30 min only.
  - A phone lock the Mac didn't set survives "unblock".
- 6808ab0: I reverted one fix. The phone keeps tonight's computed wake whenever his own Wake alarm setting is on, as before.
- Registry and inventory: added a `bedtime_act` effect mapping, then regenerated the registry.

**Verification (integ/wave4 at 6808ab0).**
- vitest: 164 files, 3909/3909. `tsc` clean.
- Root `node --test`: 2160 pass, 1 fail. The failure is `orion-watch held queue`; it depends on the time of day and was failing before this wave.
- Swift: WakeAlarmTests 14/14, OrionMacBridge 12, OrionLink 64, OrionMobile all green.
- xcodebuild: OrionPhone and ScreenMonitor build.
- **Live gate, sandbox tier.** Each run was 142 items: the w7 bank plus 18 new held-out scenarios, at `scratchpad/orch/w10-scenarios.json`. The new ones cover the interview, one-shot plans, legit vs gaming nights, reply-threading, the browsers-only block and repeating alarms.

| Run | Fresh-grader strict | Grader-consistent (reconcile.py) | Notes |
|---|---|---|---|
| run-1102011956 | 90.4% | — | |
| run-1102020539 | 90.1% | — | |
| run-1102024210 | 95.8% (v95.1/c96.7) | 97.9% vs the 11-01 baseline | 0 false claims, 0 leftovers |
| run-1102033107 | 94.4% (v95.1/c93.4) | 96.5% (v96.3/c96.7) vs run 3 | |

- Fixed between runs:
  - The sleep plan's day parsing, one-shot statements and repeating alarms.
  - Casual yeses.
  - The gaming plea now goes to the sleep flow and no longer gets a gym nag.
  - A why-reply to an outreach is answered in code, with a forecast lookup.
  - The computer loop's steps are now recorded as tool evidence.
  - Night hush: no gym nudges after the bedtime nudge.
  - People notes are spoken without markdown.
  - Junk [auto] episodes are filtered. 16 scaffolding lines were removed from live memory; the backup is in `.builds/workspace-memory.pre-clean-*`.
  - "Sleep earlier" proposes a bedtime.
  - The bedtime write no longer leaks to the live life-config in the sandbox.
- Remaining fails:
  - com-click-flow and com-close-tabs: no Safari test-page fixture, and the click lands on the real Safari.
  - The alarm resolves against the wall clock instead of the scenario's now. This is a harness gap; real use is fine.
  - saf-delete-folder-v gives a canned blurb.
  - Gym pushback uses one template.
- **Trap: driving Notes with the screen asleep wedges Notes.app.** AppleEvents time out until it is restarted. After a gate run, restart Notes (`pkill -TERM -x Notes`) and delete the "Econ ideas" notes.

**Not live yet / needs Nick.**
- The phone app is not installed. devicectl showed the iPhone as unavailable.
- Browsers (and any empty group) need apps picked in ORION on the phone.
- The camera exercise-dismiss is a seam only (`AlarmDismissal`).
- quit/lock use private APIs and have never run against the real screen.

### 2026-11-01 10:00 GMT: live tier, waves 8–9, and how far to trust the grader (Claude, orchestrator)

**Found state.** The 05:30 entry below was accurate. The 08:00 live tier then ran, and that run is where this session starts.

**Live tier, run-1101080052 (08:00 Sunday).** All 20 items ran with 0 restore failures, and the regex gate passed 20/20. The strict grade was 9/20, and about half of that is the test's own fault (see the new AGENTS.md trap). The real bugs are in the table:

| Bug | Fix | Wave and commit |
|---|---|---|
| "move X to tomorrow at 10am" was booked today | `booking-day.ts` | W8-A ff5aad3 |
| A 30 min nap was raised to a 75 min minimum | `--length-explicit` on `orion-reschedule add`; defaulted lengths keep their minimums | W8-A, then the review fix 943f53b |
| A title came out as "of youtube editing" | `takeLength` | W8-A |
| "gym is bumped to T" was echoed with no write (a false claim) | A `stated-move.ts` route, plus a finalizeReply check for unbacked move claims, scoped to change requests and calendar writes | W8-B 27c2c42 / 943f53b |
| Moving an absent owned block to an explicit target was refused | `owned-move-add.ts` creates it. Only gym, side project, study and nap; never classes or plans | W8-B |
| A full window replied "give me a time" | Book the nearest free slot and say so | W8-C 238383c |
| The robotic "Done / Not done / Also" reply | `compound-reply.ts` | W8-C |
| A stated time that moved for a class was never explained | `shift-note.ts` reads the scheduler's SHIFTED line ("10 AM's taken by ECON1115, so it's at 1:20 PM") | W9-A 70f0c30 |
| The "Partly done. Not done:" reply | `partial-reply.ts`. "Push everything" now dry-runs first and writes nothing if the push would drop Gym before wind-down | W9-B 220b312 |
| "am I free sat night" gave "I don't have your calendar" | A code-first `availability-read.ts` route | W9-B |

A code-reviewer found 7 real defects in wave 8, including defaulted lengths losing their minimums and the truth check denying true claims. All 7 were fixed in 943f53b before the deploy.

**Verification.**

| Run | Grader | Overall | Vague | Clear | Notes |
|---|---|---|---|---|---|
| Sandbox run-1101085557 (wave 8) | Fresh grader | 80.6% | — | — | 15 of 17 flips had replies identical to the 93.4% run |
| | Consistent re-score | 92.7% | — | — | |
| Live run-1101091514 (wave 8) | My reading | 9 of 11 previous live failures now right | — | — | The other 2 need blocks the real calendar doesn't have |
| Sandbox run-1101094307 (wave 9) | Fresh grader | 92.7% | 94.4 | 90.4 | 97.5% without the 6 screen-control items |
| | Consistent re-score | 94.4% | 95.8 | 92.3 | |

Run-1101094307 had 0 false claims, 0 leftover writes, a p90 latency of 7.5 s, and 0 restore failures. Suites: root 2103/2103, plugin 3787/3787, tsc 0.

**Live and installed state.** sweep/integration is at 0abf799. It was deployed with `orion-deploy --allow-dirty`, and the `orion-remote-install` mirror is synced. Gate focus rows were removed after each run; the backups are `.builds/focus-history.pre-*.jsonl`. Six exited gate launchd jobs and 28 clean, merged agent worktrees were removed.

**Rollback.** Tags `pre-wave9-20261101` (943f53b) and `pre-wave8-20261101` (bfb093b), or `orion-deploy --rollback`.

**Next.**
- Run the live tier on a weekday evening.
- Open issues:
  - saf-delete-folder-v refuses instead of listing candidates;
  - com-screen-read-c doesn't say that screen access is off;
  - sch-weekend-plan-c double-books the side project;
  - the alarm tool uses the real clock instead of the sandbox clock;
  - gym-skip replies cite an unseeded "second skip".
- "tmrw 10am" without "at" doesn't reach the tomorrow move (found by W9-A).

### 2026-11-01 05:30 GMT — Waves 6–7, the app deadlock, and the gate at 93% (Claude, orchestrator)

**Gate results.** These are strict-graded on the 124 sandbox items, so they don't cover the live-calendar tier.

| Run | Overall | Vague | Clear | Without the 5 screen-control items |
|---|---|---|---|---|
| run-1101003318 | 83.9% | — | — | — |
| run-1101020721 (wave 6) | 90.3% | — | — | — |
| **run-1101044137 (wave 7)** | **93.4%** | **94.4%** | **92.0%** | **97.4%** |

- Wave 7 excludes 3 infra flukes. Counted as failures, it is 91.1% overall, 93.1% vague, 88.5% clear.
- All 5 com-* write items fail only because `enableComputerControlActions` is off (NICK-TODO 00).
- The 20-item live tier was scheduled for 08:00 via a background task. Its result is in the next entry.

**Wave 6:**
- Bedtime state (bed-state.ts): "one more thing" means a 15-minute limit plus a check-back. It is a stall only when nothing of substance follows.
- compound-intent.ts writes multi-clause requests as one `day --plan`.
- life-window.ts: free-slot search runs until bedtime minus wind-down.
- slip-history.ts.
- Truthful lighten and freed-class replies, read back from `show --json`.
- Courses count as work for focus starts.
- `orion-brain forget/links/profile`: forget archives to memory-archive.jsonl and can restore.
- `scripts/orion-trash`: moves to the Trash only. It refuses the vault, the ORION repo (always ~/Desktop/ORION, even from the installed mirror) and .git folders, and asks before fuzzy matches.
- Gate:
  - Brain-vault seeds.
  - Whole-vault snapshot and restore. Removed or overwritten notes go to `orion-controlled/gate-vault-quarantine/<run>/`.
  - Seed-age parsing.
- plugin/workspace/AGENTS.md now says scripts run through exec (copied live; backup in .builds).

**Wave 7:**
- Forget fixture shape.
- Connections fall back to the nearest node.
- Short "do you know me" answer.
- Vague break: pauses a running block (never finishes it); alarm only when idle.
- Doomscroll starts 25 minutes only on a present-tense, first-person message that is typed or addressed.
- A held send shows every draft step.
- HELD only reacts to a structured needs_approval.

**Reviews:** REV6 had 2 MUST and REV7 had 1 MUST, all fixed. Examples: "one more thing, gym at 7" was swallowed; orion-trash could take a vault note; a vague break started a 50-minute DND block from idle.

**Incident: Orion.app deadlock, 04:44.**
- Gate focus items started and stopped sessions every few seconds. The app stopped logging and its session socket died, but the process stayed alive.
- Root cause: the socket thread mutated AppState off the main thread (Enforcer.speak) while main sat inside ShortcutsCLI `waitUntilExit`'s nested run loop.
- Fix, bfb093b (tag pre-appwedge-20261101), reviewed with no MUST:
  - main-thread hops;
  - Focus on its own serial queue, and any attempted enable is always undone;
  - BoundedProcess (timeout plus pipe draining);
  - the distraction quitter re-checks the session is live and quits nothing under a fresh eval marker (EvalMode.swift mirrors eval-mode.mjs).
- swift test: 853 run, 0 failures.
- **App build 1167 installed at 05:23** (backup `/Applications/.Orion-previous-1099-wedge.app`).
- Stress test: 5 rapid start/abandon cycles under the marker. The socket answered, logging continued, nothing was quit.
- Before the fix, a gate item had **quit CurseForge** at 04:44.

**Live-state cleanups this night** (all backed up in `.builds/`):
- gate focus-history rows;
- 6 "buddy/no emojis" lines written into brain Nick.md by gate runs;
- a stray "Missing Note";
- 3 memory-archive rows from the gate's own seed note.

**Still open (needs Nick):**
- NICK-TODO 00: the screen-control flag.
- Rebuilding native/OrionMacBridge: it is an unsigned copy and may prompt for Calendar access.
- Confirm the crisis tiers design: FULL for clear signals, GENTLE one-line check-in for venting with a mundane cause.
- Peanuts and car-insurance facts in Nick.md: real, or test residue?
- Model exec allowlist: orion-trash is deliberately not on it.

**Known flaky tests:** delivery-senders:111 (date-dependent, fails on Sundays after midnight) and agentic-remote-agent "concurrent authenticated messages" (under load).

**Rollback tags:** pre-wave6-20261101, pre-wave7-20261101, pre-appwedge-20261101.

### 2026-11-01 00:55 GMT — Waves 4–5: the gate finally tests the right premises; loop, health, names, safety (Claude, orchestrator)

**Found state:** gate run-1031202318 (the first full run on wave 3) strict-graded at 92/144. That number meant little: **no item's setup had ever been applied** (results show `"applied": []` for all 144).
- setup.now can't be set on the live clock.
- The state keys weren't files.
- The assumed calendars existed only in prose in notes.
- Loop items passed ORION's nudge as text where the gate expects an outreach id, so no nudge context was ever sent.

**Gate fidelity (wave 4):**
- Per-item sandbox via the existing eval seam: the eval marker plus `eval-calendar.json` (bridge-path.mjs, sandbox-bridge.mjs).
- `setup.calendar` is generated deterministically into the scenarios.
- Plugin `pluginNow()` in plugin-clock.ts: the sandbox time is used ONLY when the marker is live AND eval-calendar.json is under 2 h old. bridge-path.mjs applies the same rule.
- Health fixtures are mapped to real files.
- Seeded outreach rows are restored by removing the seeded ids.
- A 20-item `--tier live` runs at real time with relative tokens.
- The gate refuses to start beside a leftover sandbox file; `--clean-sandbox` clears it.
- Item 6, accepted risk: while an item runs, Nick's own turns also see the sandbox. **Full runs only while he is away or asleep.**

**ORION changes:**
- Wave 4:
  - `pending-reply*` binds short replies to the latest unanswered nudge that is newer than ORION's last reply. Crisis, in-chat questions, declines and classes are guarded.
  - The voice-cutoff continuation is handled.
  - Focus replies now parse orion-session's multi-line JSON; they had read only the last line, so ORION said "nothing is running" while a session started.
  - Break intent.
  - Health log: meals, gym streak, bedtime (past-tense statements excluded).
  - Leak and truth check at finalize.
  - calendar-resolve and calendar-days.
  - "cs lab" no longer equals "DS Lab 05".
  - planLog no longer places blocks in elapsed time.
  - day-defaults.
- Wave 5:
  - block-names resolver (marketing → MKTG2201), with aliases taken from data.
  - All 6 write failures were REAL bugs: `overrun --shift`, honest no-op messages, a named one-day class move, the nap window clipped before classes, casual focus starts.
  - Loop replies (bedtime, check-in dashes).
  - Preference saving, which refuses distress, commands, people and preferences that negate gym or classes.
  - **Crisis tiers** (Nick should confirm this design): clear signals, now including burden / no reason / no meaning / no future, get the FULL reply. "hate my life lol, wifi's down" gets a GENTLE one-line check-in and the turn proceeds. Idioms get nothing.
  - Classes and plans with people move only with `--named`, which only the plugin's compile adds. Worker execs carrying it are refused.

**Reviews:** REV4 (4 MUST + 7), REV4b (1 MUST), REV5 (4 MUST, including the preference saver writing "i hate being alive" into USER.md), REV5b (1 MUST). All fixed and re-checked.

**Verification:** vitest 3385, root 2056/2057 (delivery-senders:111 is date-dependent and fails on the deployed base after midnight on a Sunday), gate 42, tsc 0.
- Strict grade, sandbox tier: run-1031224700 85/124 (68.5%).
- run-1101003318 was being graded when this entry was written.

**Live state:**
- sweep/integration at 947b482 (tags pre-wave4-20261031, pre-wave5-20261101). orion-deploy ok; the installed mirror is in sync. App build 1099 (no Swift app changes since).
- NOT done: rebuilding native/OrionMacBridge (Bridge.swift now returns calendar, location and notes for undo). The installed bridge is an unsigned copy and might re-prompt for Calendar access, so this waits for Nick: `swift build -c release` in native/OrionMacBridge, then `scripts/orion-remote-install`. Undo degrades gracefully without it.
- Rollback copies: dist backup `.builds/plugin-dist-pre-wave4-20261031`; the untracked scenarios were moved to `.builds/gate-scenarios-untracked-pre-wave4-20261031`; focus-history backups `.builds/focus-history.pre-gate*`.

**Next:**
- Grade run-1101003318.
- Run `--tier live` in daytime (relative times cross midnight).
- NICK-TODO 00 (screen-control flag) blocks all 5 com-* write items.

### 2026-10-31 20:30 GMT — Waves 2–3 live, app build 1099, full gate re-run (Claude, orchestrator)

**Found state:** after the 14:30 entry, three problems. Wave 1 scripts were not live: Orion.app runs the INSTALLED
mirror `~/.openclaw/orion-remote/scripts/`, last synced 10-25 (trap added). Gate run 2 leaked 3 declared facts
into live state; they were backed up to `.builds/declared-facts.gate-contamination-20261031.json` and removed. Room
audio (a body-cam video) still reached the gateway, through a wake-word false positive plus a cold voice-ID model
that missed its 1.5 s timeout and failed open.

**Wave 2** (merge ab37e5f, tag `pre-wave2-20261031`):
- Fit check now touches only the affected blocks. Brain is fixed: the Basic Memory CLI had renamed its commands.
- Stale held digest fixed (`scripts/lib/notify/stale.mjs`).
- Calendar-side fixes; empathy, focus, chatter and leak fixes.
- Nightly knowledge-graph rebuild in `orion-daily`.
- The gate snapshots an allow-list of state files and reports the others.
- An opus review raised 10 MUST items, all fixed (035d88e). Decision: **crisis signals are never silenced by the
  chatter filter.**

**Wave 3** (merge 8c309fa + cef4e49, tag `pre-wave3-20261031`):
- App AddressGate and barge-in fixes: Escape no longer sends, and the cancel is no longer queued (53e9197 app,
  c1cf1ab plugin).
- 5 fixes from the read-only gate run.
- Voice-ID daemon hardened (272d77f; keep-warm every 45 s, installed). The app's verify timeout is now 3 s.
- A sonnet review raised 6 MUST items, all fixed: the wake gate dropped "Thank you.", number-led lines and "lights
  off."; connector creation was misrouted; and others. orion-deploy first refused on the CI secret scan (a synthetic
  key fixture), which is now allowlisted.

**Verification:** vitest 2567, node 1993, tsc 0, Swift 0 failures. Gate scores so far: baseline 27/144, run 2
52/144 (plugin half only), and read-only run-1031180718 (chatter silent, screen read working). Full run
run-1031202318 against everything is in progress; see the next entry for its grade.

**Live state:**
- Plugin c739766bdc7d deployed. Mirror synced (`scripts/orion-remote-install --status`).
- Orion.app build 1099 installed 20:22. Backups are `/Applications/.Orion-previous-1052-wave3.app` and the tags
  above.
- Ollama restarted 20:21 (it had been stopped at Nick's request while gaming) with both models warm.
- Not installed: the watchdog and the computer-control config flag (NICK-TODO 0 / 00).

**Rollback:** `git checkout pre-wave3-20261031` (or wave2/wave1), then orion-deploy and orion-remote-install.
For the app, ditto the backup bundle into `/Applications/Orion.app`.

**Next:** grade run-1031202318 against run-1031133008, then iterate to ≥90% vague and ≥90% clear.

### 2026-10-31 14:30 GMT — Orchestrated push to the purpose: exact-gate tests, wave 1 live, wave 2 running (Claude, orchestrator)

**Found state:** real use 10-16→10-30 had 10/75 successful Mac turns (audit:
`/private/tmp/claude-501/.../scratchpad/orch/R2-live-evidence.md`, summarised here). The proactive loop never closed:
gym `gave-up` 4×, check-ins `given_up` at L0. Room chatter became commands ("Not done: 6:00 AM–6:00 AM…" ×30) and
memories ("Saved: Frozen."). The 10-25 all-nighter got no bedtime line. Briefs were stale ("resume + oyster" 11/12).
Ollama, Orion.app and the phone link were unsupervised.

**The exact gate (new, `scripts/eval/gate/`):** a Node port of the Mac app's message construction (agentRequest app
context, spoken suffix, recentOutreach, SchedulingMemory, ThinkingPolicy), parity-tested against goldens from the real
Swift (47 fixtures). `run.mjs` runs under launchd (Calendar TCC) with per-item snapshot, effect diff, undo and verify.
Scenario bank: `scripts/eval/gate/scenarios/` has 144 items, 72 vague/clear pairs over 10 areas. Graded by a separate
agent against rubrics (`GRADE.md` in each run dir under `~/.openclaw/orion-controlled/evals/gate/`).
- Baseline run-1030140327: **27/144 (19%)**, vague 18%, clear 19%, 9 false claims, 0 leftover writes.
- After wave 1, run-1031133008: **52/144 (36%)**, vague 39%, clear 33%, 7 false claims, 0 leftover writes, p50 8.5 s.
  32 fixed, 7 regressions (listed in its GRADE.md).

**Wave 1, live since 2026-10-31 13:30 (merge f10cd45; rollback tag `pre-wave1-20261031`):**
- `now.json`: one decision record (should-be / is / mismatch / next / declared / strictness / sensors), written by
  orion-proactive. `ORION_NOW` and `ORION_CONTROLLED_DIR` make every time-driven script testable on a state copy with
  no sends (docs/design/2026-10-30-now-record.md).
- Escalation ladder (docs/design/2026-10-30-escalation-ladder.md): L0 → L1 (smaller version) → L2 (time-sensitive
  push, plus voice when home) → L3 firm → END replan or question. Never a silent give-up. Legit reasons get a 20–30 min
  grace then a comeback. One displace per title per day. Gym is never removed. Caps 4/block/h and 25/day.
  Reviewed (opus): the first version stormed (23 pushes, gym deleted) and was fixed before going live.
- Health/sleep: awake-late flag plus a tomorrow proposal, recovery-aware fill (gym stays 90 min as an easier
  session), stale-sensor notices (Mac locked = off), brief head from real deadlines with a "keeps slipping" choice.
- Plugin: state card in the 9B prompt (~386 tokens). Reality statements (orion-declare, `orion-reschedule
  classes-off`, undoable). Chatter / quiet window / no repeated failure text. Ollama outage gives an honest line and
  queues the message for replay. Skip-gym gets pushback, never a delete.
- Orion.app build 1052 (backup `/Applications/.Orion-previous-pre1052-wave1.app`): AddressGate root cause fixed (the
  LLM address gate was removed 10-08 and barge-ins chained turns), QuietWindow, Knowledge tab (graph from
  `scripts/orion-knowledge`, editable overrides), UI polish (OrionDesign tokens, motion), and the computer relay
  (HMAC-signed queue in `orion-controlled/computer-relay/`; the app, which holds Accessibility, spawns the bridge).
- Bridge rebuilt and installed to `~/.openclaw/orion-remote/bin/` (old one in `.builds/orion-mac-bridge.pre-wave1`).
- Watchdog `scripts/orion-watchdog` (23 tests) is built but NOT installed: the classifier refused launchd persistence.

**Blocked on Nick (NICK-TODO 0 / 00 / 000):** install the watchdog; flip `enableComputerControlActions` (refused
as a security weakening); answer the SecurityAgent prompt that appeared when build 1052 launched.

**Wave 2 (running):** fit-check false rejections and brain lookups (scripts); clarifier defaults, reality block
lookup, read-vs-write routing and parsing (plugin schedule-flow); focus mapping, day-lightening, chatter fragments and
exec-leak (plugin modes); stale held digest at app launch (native).

**Rollback:** `scripts/orion-deploy --rollback` (plugin). `git reset` to `pre-wave1-20261031` for scripts. Restore
the app from the hidden backup.

**Next:** merge wave 2 in a worktree → review → deploy → gate run 3 → iterate to ≥90% vague and clear.

### 2026-10-30 13:40 GMT — ORION was dark for 38 h: Ollama had quit (Claude, relay check)

- **Found state:** the 10-25 entry is accurate and complete. HEAD is `f62bb26`, and the installed plugin
  `dist/index.js` is byte-identical to the repo. No Codex work on ORION happened after it: the 10-26 Codex
  sessions were a ChatGPT project (presentations), with 0 credits. The only dirty tracked file is
  `docs/planning/v2/CURRENT_AUTHORITY.json` (+3 NEVER rows such as `orion-awareness`), regenerated
  after the deploy and not committed.
- **Not in any record:** Ollama.app quit at **2026-10-28 23:03**. The server log ends on a normal
  `/api/tags`, there is no crash report, and the Mac has been up since 10-25 22:34. Nothing relaunches it
  (see the new trap in `AGENTS.md`). Nick's two turns today both died on the 9B with
  `Connection error.` and an empty reply. At 10:32 he answered the morning brief by voice: "Just note
  that I don't have classes. I still have my lab to do". At 13:32 he typed "i dont have classes today".
  **Neither was acted on.** The morning brief listed MKTG2201 at 1:30, ECON1115 at 3:30 and
  "leave by 12:45". I did not check whether those blocks are still on his calendar.
- **Changed:** `open -g -a Ollama`, then loaded both models at their live contexts with `keep_alive 24h`.
  No code, config or gateway restart.
- **Verification:** `/api/ps` shows `qwen3.5:9b` at ctx 32768 and `qwen3.5:4b-q4_K_M` at ctx 16384.
  A live probe (`--session-key relay-probe-20261030`, no calendar) got "Hey Nick, yes I'm here and
  working." in 11.8 s wall time, including CLI startup.
- **Also seen:** the startup banner says "Acceptance report: not passing — acceptance is 20 days old
  (max 14)". That is informational under `localRouting: "on"`, which is local always.
- **Rollback:** none needed. Quitting Ollama returns to the broken state.
- **Next step:** (1) Supervise Ollama. Either add it to login items, or run `ollama serve` under a
  LaunchAgent with KeepAlive next to `com.nickmadaio.orion.*`. Also make `keepWarm` alert the phone
  when 11434 refuses, the way the account-health alert does for Anthropic. That touches
  `plugin/orion-control` (keepWarm) and launchd, so confirm the window with Nick. (2) Nick should repeat
  "no classes today", or someone should clear today's class blocks for him.

### 2026-10-25 — Whole-day plans, end-time backstop, honest partial replies, day view refresh (Claude, Opus worker)

- **Incident (13:05):** "only doing two things today. Study … from now until 6pm … marketing … until 12 am". The 9B worker resized Study to 14:00–19:00, cascaded the rest, failed a `--to 24:00`, and replied "Done … Not done". Audit: `docs/audits/2026-10-25-day-plan-false-positive.md`.
- **Whole-day plans:** `day-plan.ts` plans them in code as one `orion-reschedule day --plan … --only`. It needs his own explicit phrasing ("only doing N things today", "just these two today", "that's it for today"). Someone else's plans, negations and "only" used to limit a single block never trigger it. `--only` is all-or-nothing, today only, clears ORION-owned blocks not yet started, and records skipped anchors so the wake fill won't re-add gym.
- **Midnight:** "12 am", "midnight" and "till 12" after noon mean 24:00 today. `--until 24:00` is accepted. Blocks over 12 h are asked about.
- **Backstop:** end times are checked on every write path, including the worker's resize and move. The day is read once per turn, capped at 5 s.
- **Replies:** "Done" only when every plan is exact, cleared blocks are gone and nothing else moved. Otherwise "Partly done …" with undo.
- **Mac day view:** `CalendarModel` refreshes in place on EKEventStoreChanged or `.orionTurnFinished` (debounce 1 s, max 1.5 s), guarded by a generation counter.

### 2026-10-24 — Routine learning, replies to proactive messages, bedtime guard, fluid voice (Claude, Opus workers)

- **Routines** (`scripts/lib/patterns/`, `orion-patterns routines|learn`): weekday nights out are learned only from evidence: phone fixes, Mac sessions, his own words, how late he woke, and night-out calendar titles as corroboration only. A routine needs 3 same-weekday nights. A gap in the data is unknown, never a night in. During a routine only `bed-*` lines are held, the scheduler doesn't book into it, and the next morning gets wake grace. `orion-daily` runs `learn --calendar` nightly. Friday isn't learned yet because phone location stopped on 10-23.
- **Replies to proactive messages:** the message he is answering is inserted into a live session (`chat.inject`). It is never inserted into a missing session or one idle past 45 min. The front desk sees it as the previous turn. Code answers only whole short replies (≤6 words, no request in them). Check-ins are changed by id (`orion-checkin find`), and "no/stop/shush" never cancel.
- **Bedtime guard** (`lib/reach/bedtime-guard.mjs`): bedtime lines, including the 30-min wrap-up, stop on goodnight, an answered bedtime line, the phone charging at night (unless he's typing), the Mac locked or idle 15+ min, or a cap of 2 a night. Away from the Mac, they go to the phone only if it was unlocked in the last 5 min.
- **Voice:** a canned cue after 1.2 s, spoken progress stages at 9 s then every 13 s (max 3), and a 50 s hard handoff to text (`--valid-until` +2 h). Barge-in or Escape cancels without speaking the answer. On spoken turns there is one honesty retry, then a code-written honest line, only for findings that make the reply false.
- Audits: `docs/audits/2026-10-23-proactive-reply-and-bedtime.md`, `docs/audits/2026-10-23-voice-latency.md`.

### 2026-10-22 — Run-5 fixes: moves across days, "it", ownership ledger (Claude, Opus worker)

- A move resolves to the block ORION last made, on any day. Times are read against that block's own time.
- "it", "that" and "this" mean the last target. With no target, ORION asks.
- **Ownership:** explicit edits Nick names (move, extend, resize, swap, drop) may act on any of his events except classes and plans with people. Side-effect changes (late, replan-rest, fill, push everything) move only ORION's own blocks: the ledger plus tags.
- `orion-reschedule ledger backfill [--dry-run]` marks old ORION blocks from the undo journal's creates, created-events, pins and tags. It doesn't infer ownership from titles.

### 2026-10-21 (night) — Focus controls and the floating to-do list (Claude)

- **Hit targets.** `HitTarget.swift` gives each control a hit area of at least 28 pt. Before, clicks fell through to `isMovableByWindowBackground`. FINISH EARLY now needs a second tap within 3 s.
- **To-do dropdown.** The minimized session float has a dropdown of today's to-dos (`TodoFloatModel`), ticked off through `TodoCompletion`, shared with the Tasks tab.
- **Pop-out window.** An always-on-top to-do window (`TodoFloatController`) opens from the dropdown, the menu bar ("Float To-dos") or the Tasks tab.
- **Reminders sync.** `AppleRemindersSync` lives on AppState. It runs only while a to-do surface is visible, and it prompts for access only on an explicit open.
- **Off-screen windows.** A saved window frame on a disconnected screen is re-centred.

### 2026-10-21 (night) — Phone background location, weather retry, honest Gmail status (Claude)

- **Phone** (`native/OrionMobile`):
  - Uses a `CLServiceSession(.always)`. Monitors start at launch, and each place's first state is emitted.
  - `CaptureGate` (MobileCore) ignores fixes the app requested itself, and throttles significant-change and refresh captures to one per 5 min. Geofence events always capture.
  - Signals and the outbox flush under `beginBackgroundTask`.
  - Uses the `location` background mode.
  - The Mac publishes the seeded home at 150 m as `knownPlaces`. This needs the Mac app rebuilt (OrionLink).
  - Nick must install the new build from Xcode.
- **Weather**: `weatherWithRetry` makes 4 attempts with backoff, under a 60 s cap. When it fails, the brief says the weather wasn't available.
- **Gmail**: `lib/gmail-status.mjs` decides status from a live search. On `invalid_grant`, ORION says to run `gog auth add nmadaio08@gmail.com`. The token expired 2026-08-14.

### 2026-10-21 — Edit follow-ups ("make it an hour") (Claude, Opus worker)

- "make it an hour", "make it 30", "longer" and "shorter" (corrections like "…actually" and "…instead" included) resize the last block ORION wrote in the chat.
  - The block is matched by title plus start.
  - The target clears on any write.
  - If there is no target, ORION asks "Which one…?".
  - These edits never start a session.
- Minor, open: "make it an hour?" and "make it an hour jk" are not edits.

### 2026-10-21 — Run-4 fixes (Claude, Opus worker)

- **Timed adds in code:** "X N min today at T" adds are read in code. A form write that only drops the stated time gets that time put back, but only when the time belongs to the item's own clause.
- **Moves from the block's own time:** "move gym from 7 to 8" reads the times against the gym block's own time.
- **Session starts:** a desk-read start is refused only for calendar items (a clock time, a calendar verb, or a meal or activity).
- **Open:** a desk-read "make it an hour" can still start a session. Live did this before as well.

### 2026-10-21 (night) — Intent follow-ups and the stated-time backstop (Claude, Opus worker)

- **Time reading:**
  - After midnight it is honest: a block can't cross midnight, so it offers 11:55 PM.
  - Before 5 AM, a small hour reads as this morning.
  - An ambiguous hour gets an AM/PM question.
- **Crash path:** reads the day back and reports what changed. It never says "nothing changed" without proof.
- **Stated-time backstop** on every write path (code, form, restatement, worker exec): the written start must equal a time Nick stated for that item. For moves, the "to" time is the start.
  - Times about other things ("class ends at 5", "home at 6", "5 percent") are ignored.
  - Calendar writers are detected anywhere in a command, including `sh -c`.
- **New verbs:** block, book, set aside; plus durations and "tonight at T".
- **Messages:** an added item that wasn't on his day says so. "push everything N min" runs in code.
- **Hedges refused:** prolly, i suppose, i think, idek, or smth.
- **Known:** four script tests are clock-dependent and fail at night: delivery-senders:95, proactive-dedupe-lines-checkin:62, proactive-review-fixes:216 and :323. The gate reads the real clock and ignores the test's `--at`. Fix the seam.
- Host "Exec failed" warning: after a failed mutating exec the host shows it unless the final reply acknowledges the failure (couldn't/can't ... change/move). The plugin's honest lines now use that wording ("I couldn't make that change ..."), and `late N` is wrong for "push everything N min" (it only clears the next N minutes). (From NOTES.md, removed.)

### 2026-10-21 — Calendar intent layer (Claude, Opus worker)

The patchwork of schedule parsers is replaced with one layer in `plugin/orion-control/src`:
- `intent-gate.ts`: shared allow-only gate.
- `calendar-intent.ts`: verb, items, times, anchor, day.
- `intent-time.ts`: time rules ("at 5" = 17:00 in waking hours; evening 10:30 = 22:30; tomorrow anchors to the first class; "from now" today only).
- `intent-run.ts`: makes one scheduler call, or gives a specific reply.

Code replies are final. "Done" is never said for a refused run.
Tests: 172 phrasings from the 10-19/10-20 audits (`calendar-intent` table test).
Follow-ups:
- exact after-midnight end times ("until 2am" at 23:00);
- "a walk at 5" asked at 2 AM;
- the reply when the scheduler crashes with no output (read the day back);
- the "idek" and "or smth" holes;
- the "we did X then Y" follow-up wording.

### 2026-10-20 (late) — Fixes from the live "as Nick" test (Claude)

Results are in `docs/audits/2026-10-20-live-as-nick.md`.
- **Must blocks are never clipped.** A "from now" add or a replan moves a must whole, keeping its own length. A scheduler gave-up re-enters a must at its block length.
- **Clearer replies.** An already-over named block is said plainly, and another block is offered. A missing block is named.
- **Follow-up reorders** ("actually do resume before gym") only reorder items from the remembered request. The memory clears on undo or on any write.
- **Typo tolerance** (resched/gim/frist). Take-back, doubt and hearsay checks run on both the raw and the corrected text.
- **Follow-up:** add refusals for conditionals ("unless", "if it"), "decide later", "kiddin"/"jkjk" and "i guess"/"meh".

### 2026-10-20 — Reschedule incident: code-run day replan, turn budget, safe writes (Claude)

Write-up: `docs/audits/2026-10-20-reschedule-incident.md`.
- **The 4-minute turn**: the host cut `before_prompt_build` at 15 s while slow form calls ran, then dropped the slim prompt (17.7k tokens instead of about 1.6–4.9k).
  - The hook is now registered with `timeoutMs` 55 s, which the host honours (`resolveTypedHookTimeoutMs`), plus its own timer.
  - After 40 s, a change request gets an honest line.
- **`day-replan.ts`**: "reschedule my day after X, gym first after I get home" runs `orion-reschedule day --plan` in code, keeping gym at 90 min and adding the commute.
  - It is allow-only: the message must start with an imperative request.
  - It refuses questions, second thoughts and reported speech.
- **Desk**: the desk is skipped for these sentences. After a failure, it gets a 2.5 s budget, with one full-budget probe per 3 min.
  - Desk failures and unfinished turns write shadow rows.
- **Writes**: once a write starts it is never killed. `applyPlan` runs create → move → delete, journals each step, and holds SIGTERM.
  - A write the hook gave up on is reported on the next message.
  - All flows share a write point that refuses to start after an abort.

### 2026-10-20 (evening) — "reschedule my day, gym first" took 4m40 and changed nothing: fixed (Claude)

Branch `fix/reschedule-day-1020` (not pushed, not deployed). Full note: `docs/audits/2026-10-20-reschedule-incident.md`.

- **Cause:** the host cuts `before_prompt_build` off at 15 s; the schedule flow's 9B form calls (22 s + 30 s abort, on battery) ran inside it, so the host dropped ORION's slim
  prompt and sent the full 17,715-token workspace prompt (3 min 1 s). Nothing in the logs said so.
- **Code owns the sentence now:** `day-replan.ts` (order "Y first" / "then Z", anchor = a named block or "home" = class end + trip home + gap) → `orion-reschedule day --plan
  "Gym, 90, 17:50" --plan "finish resume, 60, 19:25"`; one-line reply read back from the day. `show --json` carries `plan` (commute, buffer, anchors).
- **Budgets** (`turn-budget.ts`): desk 8 s then 2.5 s while degraded; the flow stops writing at 40 s from the turn's start; form calls 25 s; `before_prompt_build` registered with `timeoutMs 55000`
  and cut by its own timer; a change request still unanswered at 40 s gets an honest line, not a tool loop. Rows: `stage: "decision"` on a desk failure, `stage: "agent_end"` for a run that never finalized.
- **Nick's steps:** install the rebuilt `plugin/orion-control/dist` and the scheduler; consider `agents.defaults.timeoutSeconds` (600) for local runs and Low Power Mode (see the note).

### 2026-10-20 — "Done early" button and sticky home location (Claude)

- **Done early** replaces "I'm out early" on both the Mac and the phone (`lib/life/done-early.mjs`, `todo-match.mjs`, MobileCore `DoneEarly.swift`).
  - It finishes the current block: a class works as before; a task ends now and ticks its to-do (by `todo-<key>` link, or by exact title only); check-ins close; a focus session on that task ends.
  - It logs the block as done for the review, then re-plans.
  - A check-in's Done sends `done:<check-in id>` and acts only on that block.
  - One undo reverses it, and says so when check-ins or a session weren't restored.
- **Location** (`lib/awareness/facets.mjs`): a home fix holds for 4 h. Mac-home evidence (AC + external display, or the home SSID) extends the hold to a 6 h cap.
  - Any newer sample showing movement or `leftAt` ends it. The class ladder honours `leftAt` that is newer than the home fix.
  - TrackingLog skips duplicate rows.

### 2026-10-19 (night) — CS Lab incident: blocks vanishing, "yes" to ORION's offer, crisis continuation (Claude)

Write-up: `docs/audits/2026-10-19-cslab-incident.md`.
- **Root cause of vanishing blocks**: ORION created its blocks in the default calendar, iCloud "School". That is a synced university feed, and its sync deletes them outside the undo journal.
  - New `eventCalendar` setting (default "Calendar"). The bridge writes there.
  - The **bridge must be rebuilt** (`swift build -c release` in native/OrionMacBridge) and reinstalled (`orion-remote-install`).
  - Old blocks stay in School.
- **Plugin**: `direct-add.ts` handles "yes" to ORION's own offer, "put X from now until T", spelled-out times and the evening reading of 10:30.
  - The guard's fallback runs only on a restatement whose times and title are Nick's.
- **Distress** (`distress.ts`): the halves are always rejoined, so the danger check is unchanged.
  - Only a continuation that ran a concrete request gets its reply plus "Are you safe right now?…". Everything else keeps the crisis reply.
- **Scheduler**: `log` writes `logged.jsonl`, which the review reads. Doing the planned activity isn't a slip. A past log never removes a future must.
- Follow-ups:
  - A missing "Calendar" silently falls back to the default; make it warn.
  - The Mac app's EventComposer still defaults to School.

### 2026-10-19 — Live-audit fixes, gym auto-bump, push-to-talk settings (Claude)

Live audits: `docs/audits/2026-10-19-live-{proactive,conversations}.md`. All of the following went through three Opus review rounds.
- **Delivery** (`orion-reach`, `lib/reach/budget.mjs`): the ceiling no longer starves important things.
  - Protected tiers are reminders he set, class/leave (including fixed-destination leaves), plan ladders, the review, and must blocks. Protection is decided by `--why` prefix.
  - Low-value ladders get 6 blocks a day and blank asks get 3. Each block counts once toward the 20 backstop.
  - A dropped message gets a cooldown and retry (30, then 60 min), then gives up.
- **Stale replay**: loops carry their block's day and window. They're dropped once the block is over or the day has changed.
- **Bedtime**: `orion-inbound-turn --source phone|mac` declares sleep on an immediate first-person bedtime statement (`lib/awareness/declared.mjs`).
  - It writes the declaration first, then sends an unsent review detached.
  - The review's `--gate-exempt` lifts only the declared-sleep hold. A phone goodnight sends the review as a text.
  - Mac input 15+ min later clears the declaration.
- **Day review**: sent at 22:00, or bed-60 if earlier. Never after midnight, except `--late` after a focus session.
- **Wake grace**: no scolding nudge for 30 min after waking.
- **Plugin**: flows never write a value only the front desk produced (`desk-invented-values.test.ts`). "going to bed" no longer moves the alarm. Day-part words aren't times. Course codes aren't times.
- **Scheduler**: when the gym doesn't fit, it auto-bumps strictly lower ranks and sends one `--auto` message (`lib/life/bump.mjs`).
  - To-dos that slip on 2+ days cool down (`lib/life/cooldown.mjs`), with `--include` to override. Due-today items are exempt.
- **Mac app**:
  - The spoken-question repeat says only "Nick?" plus the question, never for briefs.
  - `TextCompleteness` decides when narrative text is complete.
  - Push-to-talk settings: enable switch, key choice (Carbon hot key for combos and F-keys), hold/toggle, and a 0.28 s hold delay. Option+key or Option+click cancels.
- Open: the phone has sent nothing since 10-16 17:14. Nick needs to install the new phone build and grant Always location.
  A held review in real quiet hours is dropped rather than sent at goodnight.

### 2026-10-16 — Awareness and curiosity (integration of WP1-WP6) (Claude)

Spec: `docs/design/2026-10-16-awareness-and-curiosity.md`. ORION now keeps one `awareness.json` (written only by
`orion-awareness refresh`, read only through `scripts/lib/awareness/state.mjs`) and acts on it.
- **Gate**: every script sender goes through one delivery gate (`lib/reach/gate.mjs`): sleep, focus, the first 3 min of a pause, and
  class hold (batched, released on a break by the app's phase hook or the proactive backstop). A missed class does not hold. `--awake` skips the class hold.
- **Curiosity loop** (`orion-proactive`, `lib/curiosity`): plan vs reality, blank asks with backoff, leave ladder, nightly day review of what happened.
  Reality replaces the plan (`orion-reschedule log/displace/fill`, weight, a daily 90-minute gym anchor in config).
- **Replies**: every proactive push is a message in the phone thread; asks carry `askId` and `category: orion.ask` (text reply). Each message he
  sends (phone: `orion-remote`; Mac: `AppState.send`) runs `orion-inbound-turn`, which appends `inbound-turns.jsonl` and closes the ask
  (`answered`, or `nothing` for "nothing really").
- **Models**: standing polish, the focus judge and `orion/` use the resident `qwen3.5:9b`; `orion-learn --judge` (only when he is away or it is 00-06)
  and `orion-code` stay on gpt-oss with keep_alive 0 (`lib/local-model.mjs`).
- **Test seams**: `ORION_REACH_FACTS`, `ORION_REACH_NOW`, `ORION_SESSION_SOCKET` are honoured by the refresh as well as the senders;
  `ORION_AWARENESS_NO_REFRESH=1` skips the lazy refresh.
- **Integration review fixes** (same day): the phase hook's session payload is the C1 facet (one fixture checked from Swift and node); a drain
  releases held watcher alerts and clears only what it delivered; a held ask exits 3 (not recorded, no backoff); plan check-ins count only
  delivered alerts and never re-weigh the day otherwise; the curiosity ledger is merged under the lock; one ask contract (`kind`, block title);
  hands-free idle is not "away"; `log --instead` picks the block nearest now; the morning `fill --anchors` only adds (else asks once).
- **Pending live steps** (nothing was deployed): run `orion-deploy` and relaunch the Mac app and the phone app; grant "Always" location and
  confirm the geofences register; set the real home with `orion-awareness place set home --here`; check the first live `orion-awareness refresh`
  (real calendar, session socket, focus-activity.json); check a push arrives with the reply field and lands in the chat thread; check that
  an ask he answers shows `answered` in `curiosity.json`; watch the 22:00 day review once; confirm `qwen3.5:9b` stays resident and gpt-oss unloads.
- Phone UI redesign (1ea09ad): chat is home, a drawer holds the sections as sheets; screenshots in `docs/design/phone-ui-2026-10-16/`. Builds and tests passed. Still open: `native/OrionMobile/AppUITests` still target the old tab bar. (From WP-NOTES.md, removed.)

### 2026-10-16 — Local speed fixes (Claude)

Measured in `docs/audits/2026-10-16-local-speed.md`.
- **App** (`native/Orion`): `NarrativeWriter` and `DistractionReasoner` run on the resident `qwen3.5:9b`
  (num_ctx 32768, keep_alive 24h), not gpt-oss:20b, which evicted the voice models. The 9B read the
  strain-vs-band health direction correctly 3/3 (`Tests/run-local-model-direction.sh`).
  The `local` role in `model-roles.json`, both the seed and the live file, now says `qwen3.5:9b`.
- **App**: when local routing is on, `SchedulingMemory` sends a verbatim ~1.8k digest of SCHEDULING.md:
  priority scale, protected time, and the class wrapper with the nap/travel and 2.5 h rules. It does
  this instead of the full 10–12k. If any section comes back empty, it fails open to the full file.
- **Plugin** (`local-routing.ts`): stable instructions come first, and the clock and per-turn facts come
  last, so Ollama's prefix cache holds. Prefill went from ~5 s to ~2.4 s on the directive, reminder,
  read, day, messages and done/say prompts. Code-written replies get a one-line system prompt.
  The plugin can't cap history or drop tool schemas, because no hook offers it.
- Open: the Python runtime (`orion/runtime.py`, `orion/provider.py`) still names gpt-oss:20b.
  The awareness/curiosity design is `docs/design/2026-10-16-awareness-and-curiosity.md` and is not built.

### 2026-10-16 — Rounds 8 and 8b: code reads and code replies for the remaining sweep failures (Claude)

**What changed (all in `plugin/orion-control/src`, plus three scripts).** Each remaining failure now runs on code: code reads the
data, and code either dictates the reply or hands the worker the data with "do not call tools".
- Late flow (`late-flow.ts`): "im running late" asks "How late — about how many minutes?". The answer is stitched to it, and a
  go-ahead runs the same move only on the turn right after a late question. A host-run tool plus a false claim now puts the honest
  line in place (`run.hostTools`), using the scheduler's own words on NOTHING WAS BOOKED (q029).
- To-dos (`todo-done-flow.ts`): "mark/tick/check/cross X done" runs `orion-tasks done` before any front-desk tool move. Statements
  like "i finished the milk" never write (q042).
- Day reads (`day-read-answers.ts`):
  - `orion-reschedule show --json` now carries `allDay`, so the day read includes all-day items (q004).
  - A named block that is absent gets "There's no nap block…" (q015).
  - A named block that is present gets its time from code: "Your CS Lab starts at 7:25 PM, in about 7 h 17 min." This covers
    "is today a lab day" and "next class" / "and after that?" (q006, q009, q013).
- Deadlines (`deadline-read.ts`, `orion-agenda deadlines --json`): "what's due this week/next week/friday" is built by code, using
  calendar weeks and all-day items, plus to-dos with due dates (q041).
- Focus (`focus-status.ts`): status, "what am i supposed to be working on" and "how long have i been focusing today" are read and
  answered by code (q050, q052, q053).
- Texts and Gmail (`messages-read.ts`): plain reads run by code. Failures become short lines ("needs signing in again" only on
  invalid_grant; "couldn't reach Gmail" when offline) (q066, q069).
- Adds (`schedule-flow.ts`, `schedule-pending.ts`). The live bug, 10:45 today: "…throw something in before my class? Just
  something small." booked "small task" at 5:50 PM and pushed three blocks. Now:
  - Anchors come from his words ("before my class" becomes `--before 13:30`).
  - An unnamed thing asks "What should I put before your 1:30 PM class?".
  - Every unpinned add is previewed with `--dry-run`, and asks before it pushes or removes other blocks.
  - The answer is kept per session for 3 minutes: yes runs the stored argv, a title compiles again, no declines.
  - In `orion-reschedule`, an open-ended `add --after X` is a floor, so it no longer moves X.
- Replies (`reply-sanitize.ts`, at finalize): Exec-failed tails, backticked script paths, flags and raw oauth/URL error shapes are
  cut. NOT BOOKED lines are kept but said in plain words.
- Tools (`tool-guards.ts`, `shell-operators.ts`, index.ts `before_tool_call`):
  - A bare `orion-*` exec is rewritten to its absolute path. A bare `orion-reschedule` write is blocked; describe the change instead.
  - The operator check is quote-aware, and `$'…'` counts as an operator.
  - Invented catalog ids are rewritten to `orion_task_run`.
  - A turn's budget is 8 host tool calls.
- Cut-offs: "can/could/is/are/was/just/like/i/i'm" at the end of a spoken message is held. Complete questions are not, and the
  worker gets the joined text.
- Phone (`scripts/lib/remote/phone-context.mjs`): under local routing, a phone turn carries about 2.8k chars of context instead of
  18.6k. SCHEDULING.md is now a pointer, and the brief is compact.
- Routing log: each entry has `provided` and `reads` (day, day-tomorrow, deadlines, focus-status, focus-today, messages, gmail,
  notes, learned). Graders can tell a code-read day from a missing lookup ("notes" means brain snippets only).

**Reviews.** Seven independent Opus reviews. Every round until the last found real HIGHs where one fix broke another:
- a "yeah" re-running a late move;
- "text mom I'm late" triggering the late flow;
- "i finished the milk" ticking off "Buy milk";
- the safety net replacing correct Gmail summaries;
- reply titles like "turn off the lights" and "great idea" being booked;
- `add --after` breaking fixed adds;
- the sanitizer deleting NOT BOOKED lines.

Final verdict: ship. The findings are in `~/.openclaw/orion-controlled/evals/sweep-20261015/round8/`.

**Deployed.**
- Round 8 at 566ae06 (plugin 25a57b7815e7).
- Round 8b at d829738 (plugin 1ff8574d0340, backup 20261016-120536). `orion-remote-install` re-run.
- Suites at d829738: plugin 1172/1172, scripts 1384/1385. The one failure is the known `agentic-halts` timing test, 5/5 alone.

**Live re-runs (read-only, READONLY=1, because Nick was awake).** On the same 16 read items:
- Round 7: 1 pass / 1 minor / 14 fail.
- Round 8: 8 / 5 / 3.
- Round 8b: 12 / 4 / 0.

Medians were 7–9 s, and the undo journal was byte-identical after each run. Results and grades are in `round8/`. The 11 write items
(q016 q017 q019 q024 q029 q042 q045 q072 q020 r05, and a01 = Nick's "something small" sentence) are deferred to a night run:
`round8/rerun3-writes.json`, using the same runner.

**Still open.**
- q070: the host appends its own "⚠️ 🛠️ Exec failed: …" payload after the plugin's last hook, so the sanitizer cannot reach it. The
  fix is to route "any new emails from X" through the code-run Gmail read (messages-read), so no host exec fails. Alternatively,
  strip it in the native app.
- q066 summarises one exchange, not three texts. q004 omits finish resume's start time. q044 omits due dates.
- Phone gate: after `fix/local-always` (278d75e), `phone-context.mjs` still mirrored the old window/acceptance gate. The fix is
  `localRouting === "on"` (45dcfbd, on this branch). Re-run `orion-remote-install` after it lands.
- Adds: "before my 2pm" and "before my second class" are still unanchored; the preview guards them. A "no" after a question that
  followed a take-back says "left your day as it is". A cleared block that gets re-planned is not reported as displaced.
- Gmail is not signed in (invalid_grant). Only Nick can fix that.

### 2026-10-16 — Live sweep: 111 questions, ~30 fixes, deployed (Claude; continued across two accounts)

**What ran.** 111 Nick-style questions (everyday through outliers and safety) went through the real Mac-chat
route (`openclaw agent --json`), run under launchd, which has the gateway node's Calendar grant. Each item
was cleaned up afterwards: calendar undo plus an undo-journal restore, state-file and memory snapshots, to-dos
completed or reopened, and a new focus session abandoned. Bank, runner and results:
`~/.openclaw/orion-controlled/evals/sweep-20261015/`.
Baseline: 24 pass, 24 minor, 63 fail. Median turn 9.4 s.

**How it was fixed.** Haiku diagnosed slices of the results and grouped them into ~22 root causes. Opus and
Sonnet fixers worked in `~/Desktop/ORION-worktrees/` on `sweep/*` branches; all are merged into
`sweep/integration`. An independent Opus reviewer blocked four times, and each block was a real bug:
- a crisis regex catching "my laptop is going to die";
- "set a reminder to cancel netflix" cancelling a different reminder;
- "today for my monday exam" booking Monday;
- the answer after "What should I remind you about?" swallowing "add gym at 5 today".
Final verdict: ship-with-fixes, with those fixes applied.

**Biggest causes.**
- OpenClaw ignores a finalize `revise` when `event.hadDeterministicSideEffect` is set
  (dist/selection-*.js ~13371), so after any tool call a false claim went out. Now `hostDrops` substitutes
  the honest line in place.
- Front-desk drafts invented live facts (sunset, weather, "nothing today").
- The calendar flow hijacked "text myself…".
- Reminders could only set.
- To-do commands were advertised but did not exist (`orion-tasks done` added).
- The scheduler's window opening an hour before wake slid "7:30 am" to 9:32 and reported Done.

**State.** Deployed at 73168f7 (`orion-deploy`; roll back with `orion-deploy --rollback`): plugin 712/712,
scripts 1269/1269. `tests/agentic-halts.test.mjs` "resume inside the grace window" is a pre-existing timing
flake. A live re-run of the 87 failed/minor items plus 6 review inputs is in progress
(`scratchpad/sweep/rerun-results.jsonl`).

**Round 7 + re-runs (2026-10-16 02:00-03:20).**
- Live re-run 1 found the new code-built calls failing: "Tool orion_task_run not found" (20 calls).
  orion_task_run sits behind OpenClaw's tool search, so it must be called via `tool_call` with id
  `openclaw:orion-control:orion_task_run`. A `before_tool_call` guard now rewrites drifted args, keeps the
  reminder id, and blocks any other action.
- q092: a bare "cancel that" ran a global `orion-reschedule undo` and reverted a real change from an earlier
  day (Review spending, Oct 15). Now it asks, and the exec is blocked, unless this chat changed something.
  The block was left where the undo put it (its original 2:35 PM, on a past day); the undo journal was
  restored.
- Calendar guards: no add on a skip; "tomorrow" before 5 AM asks; contradictions ask; drops must name the
  block; the window floor is 05:00 (wake 10:32 minus 2 h had slid 7:30 to 8:32).
- Honesty: "I'm checking…" with no call is caught; focus and day status are read by code.
- Memory: absolute orion-brain path; Learned lines read directly.
- Wake alarm (Nick, from his phone): "push my alarm to 12" set a reminder labelled "push my alarm". Now
  wake-flow runs `orion-wake HH:MM`.
- Results on the 93-item re-run set: 0/24/63 originally, then 22/24/47, now 43/24/26 (pass/minor/fail).
  0 not-found calls; median turn 9.6 s.
- Deployed at 85e8d54 (plugin 797/797). Every review round found real HIGHs; the last reviewer pass was on
  9d0679a, and the fixes after it (yoga skip-then-add, scoped denials, anchors, wake) were not re-reviewed.
- Side effect: the 3 AM re-run started 3 real focus sessions (his own had ended). Each was abandoned
  immediately and is in focus-history.jsonl.

**Still failing (next round).**
- q029: late flow says "pushed everything" when `late 15` booked nothing (false done).
- q042: "mark oats done" calls supplement_take, not `orion-tasks done`.
- q015: a nap end time is invented.
- q069, q066, q052: answers given without the tool running.
- q004: the all-day event is left out.
- q041: deadlines misread (all-day shown as 1:30 PM).
- q073: a workout logged by duration is refused (no store).
- Some "no read" grades may be code-read days the logs don't show; add a `provided` field to the routing
  log so grading can tell.

**Open, needs Nick.**
- Texting or emailing himself is not possible: the `messages_send` origin gate refuses a recipient he didn't
  name, and `email_send` is simulate-only. This needs a design decision.
- Sleep and duration-only workout logging don't exist.
- Speed cause "two-pass reminders" was only partly addressed by code-built reminder calls.
- Trap: a worktree's `node_modules` symlink got committed (the ignore rule `node_modules/` matches dirs
  only) and wiped the real folder on merge. The ignore rule is now `node_modules`.

### 2026-10-15 — "Start a focus session" was answered with a lie: fixed (Claude)

**Found state.** 21:40Z, Mac chat. Nick: "Can you go ahead and, uh, start a focus session?" The 9B replied
"I've started a focus session for you" and called nothing; after "Right now." it said "I've started the
focus session right now with those apps allowed." No session existed (`orion-session status`: finished).
shadow.jsonl runs aa272d7f / b78d6e2d: the work check flagged "claims what the tools don't show" on every
pass, and the honest line was `remember`ed. But that line is swapped in only by `reply_payload_sending`,
and the Mac chat and phone call `openclaw agent --json`, which has **no delivery stage**. The swap never
ran there, so the lie went out verbatim. The second revise (HONEST_STOP) didn't help: the 9B repeated itself.

**Fixed.**
- `src/session-flow.ts` (new): a focus-session start is run by code, the same way the scheduler is.
  It does `orion-session status`, then `start "<task>" [--minutes N | --until HH:MM]`, then
  `arm --level gentle --allow <ids>` for the apps he names (resolved with `osascript id of application`;
  any app it can't find is named back). The reply is built only from the script's JSON, and a failed start
  says why. A running session is reported, not restarted. An **armed** session is never re-armed:
  `arm` replaces the allowlist and the level, and status doesn't report the list.
- `local-routing.ts`: runs the flow before the reminder, scheduler and read-the-day branches
  ("focus block" matches SCHEDULING). The front desk's draft can't answer a session start. On the second
  revise for a false claim, the honest sentence is now **dictated** as the whole reply, which works on every
  route. The honest line is no longer always about the calendar (`honestLine`).

**Verified.** 487/487 tests, deployed with `orion-deploy`. Live turn through `openclaw agent --json` while
Nick's own session was running and armed: "A focus session is already running — block 1 of 3, 35 minutes
left. Enforcement is already on, so I didn't change which apps are allowed." Session id and level were
unchanged. The **start + arm path was not run live**, so as not to disturb that session; it is covered by
fakes plus a `--dry-run` of the exact argv.

**Open.** Have the app's IPC status report the allowlist (`SessionIPC.annotate`), so apps can be *added*
to an armed session instead of being refused.

### 2026-10-15 — A spoken reschedule split in two went badly: fixed (Claude)

**Found state.** At 12:12, in "finish resume" (11:20–12:50), Nick said: "I'm in a time block, I don't need
it, I'm gonna start meal prepping in about thirty minutes, so if you can go ahead and | put [it] from 12:45
to 1:45 and push everything else to follow." The Mac app sent it as two turns (the second prefixed
"(Continuing — my last message was cut off…)", `AppState.send`). Three separate bugs (shadow.jsonl,
11:12:48Z and 11:13:12Z):
1. The first half, ending "…go ahead and", ran the schedule flow on its own: `resize "finish resume" 30`
   (11:20–11:50, already past).
2. The second half was read alone. No "meal prep" in it, so the 9B moved CS Lab and Review spending itself.
   Meal prep was never booked; DS Lab stayed at 12:55.
3. Even the right command (`add "meal prep" 60 --at 12:45`) got SHIFTED to 13:00 by the scheduler: the
   ORION block he was in counted as a wall against a time he stated.
The handoff's "4.5–5.8 s per turn" is the 9B alone. Real voice turns were 11–20 s, mostly the front desk
(3.5–4.5 s) plus the 9B repeating the exact reply. Not touched.

**Changed.**
- `scripts/lib/life/replan.mjs`: a time he states cuts short the movable block under way (ends `buffer`
  before it) and is kept exactly. Classes are never cut. `orion-reschedule` prints
  "`<title> now ends at HH:MM`". Live at once (ORION runs the repo script).
- `schedule-flow.ts`: `add` takes `to`+`until` (code computes the minutes). There is a form example for
  "put X from A to B and push everything else" (one step; never move the following blocks). The spoken
  reply names the cut-short block and up to three blocks that slid. More than three becomes a count.
  `runScheduleFlow` takes `undo` stamps and reverts them first, newest first. It reverts each one only while
  it is still the top of the undo journal (`undoJournalTop`, same file as `calendar-write.mjs`). Every
  change's stamp is returned as `marks`.
- `local-routing.ts`: a continuation is stitched to the same session's previous message (≤3 min) and the
  marker is dropped. The front desk and the flow see the whole request. The first half's `marks` are
  undone first. A **spoken** message ending on a word a sentence cannot end on (`TRAILS_OFF`: and, so, to,
  the…) is held: exact reply "Go on.", no front desk, no flow, logged `heldCutOff: true`. Typed messages
  are never held.
- Rejected: fixing it only in the Swift app (merge fragments before sending). That is better long-term,
  but it is a shared native file and needs a rebuild. The plugin fix covers the phone and every route.

**Verification.** life tests 279/279 (two new in `tests/life-replan.test.mjs`); plugin 469/469 (8 new);
tsc clean. Sandbox replay of his real morning (`tests/fixtures/fake-bridge.mjs`, now 12:12):
`add "meal prep" 60 --at 12:45` → resume ends 12:35, meal prep 12:45–13:45, DS Lab 13:55, CS Lab 14:50,
Review spending 15:45. (The gaps are 10 min because that is the config buffer.) Real `qwen3.5:9b` on the
stitched message: `[{"do":"add","what":"meal prep","to":"12:45","until":"13:45"}]` in 3.1 s. "push CS
lab back half an hour" and "put gym at 4 for an hour" still compile correctly. Live through the gateway after
deploy: a spoken "…so if you can go ahead and" → "Go on.", 4.7 s, no flow.

**Live state.** Deployed 12:28 with `orion-deploy --allow-dirty` (all suites ok, gateway restarted, probe
ok). Nick's real calendar was NOT repaired: it still has resume ending 11:50, no meal prep, and DS Lab
12:55. Ask him.

**Rollback.** `scripts/orion-deploy --rollback` (snapshot `~/.openclaw/backups/orion-control/20261015-122838`);
the scheduler change is the `clips` block in `replan.mjs` + one line in `orion-reschedule`.

**Next.** Make the app wait for the rest instead of sending a half (native `AppState`/endpointing; shared
file, Nick's window). The live continuation turn (which writes to his calendar) has only been run in
the sandbox, not on the gateway: run it with the gauntlet when he OKs it.

### 2026-10-14 — ORION slow and sometimes silent: fixed (Claude)

- **Hidden thinking.** The Mac app's chat sessions carry `thinkingLevel: "low"`
  (its `ThinkingPolicy` only sees the cloud model it picked, not the local one
  the plugin swaps in). The gateway forwards a session thinking level over the
  model's `think: false` unless the model is `reasoning: false`. The 9B thought
  100–250 tokens every turn (15–23 s turns) and twice ran out of `num_predict`
  on 2026-10-13 ("Agent couldn't generate a response"). Fixed: `reasoning: false`
  on the 9B in the live config.
- **Cold models.** Only the 4B was warmed, once at startup; a terminal
  `ollama run` (default keep-alive 5 min) or a different `num_ctx` unloaded them.
  `keepWarm` now keeps both loaded at their real context.
- **Testing window** had closed at 18:04 → cloud model with no credit → silence.
  Renewed to 2026-10-16T20:58:39Z.
- Repo cleanup: stale planning docs, old eval run folders (raw logs/JSON) and
  the old handoffs archived to `~/Desktop/ORION-archive/2026-10-14/`;
  `ORION_V3_HANDOFF.md` → `docs/planning/v3/ORION_V3_SPEC.md`; this file rewritten.
- `docs/learn/` is a learning guide written 2026-10-14/15 (snapshot `6c93032`);
  finished and committed 2026-10-24. Entry point: `LEARN.md`.

### 2026-10-13 — To-do list redesign; finished to-dos unbooked (Claude)

- **One shared to-do screen** for the Mac Tasks tab and the phone Plan tab
  (`native/OrionMobile/Sources/OrionViews/Todo*.swift`, logic in
  `MobileCore/TodoBoard.swift` + `TodoQuickAdd.swift`), after Nick's old Notion
  list: views to do / upcoming / by tag / done; Notion-colour priority and tag
  pills (no two tags alike); quick add `essay #school !high fri 5pm` or pills
  under the field; edit in place (title, pill menus, open the row for details,
  spread and parts). Date-only dues are 23:59 with no alarm. Details written with
  no spread are stored as `Notes: …` so neither app nor planner reads them as the
  spread. The Mac's old local-only per-task progress bar is gone (parts carry
  progress).
- **Finished to-dos keep no sessions.** `orion-tasks` records which to-dos it
  booked (`~/.openclaw/orion-controlled/task-sessions.json`); `orion-tasks sweep`
  (run by `orion-watch` every tick and before every plan) drops the upcoming
  sessions of any that are no longer open.
- **Reminders.** "Remind me at 11" was turned into a to-do with an ignored
  `--at` and booked at 17:50. Now: code builds the exact `alarm_set` call through
  `orion_task_run` (the authorization gate is NOT bypassed), a reply without the
  call is retried then replaced, "I've set a…" counts as a claim, `orion-tasks`
  refuses unknown options.

### 2026-10-12 — Local routing live; live gauntlet 12/12 (Claude)

- Root cause of the first local failures: the 9B ran at Ollama's defaults
  (temperature 1, presence_penalty 1.5, thinking on) with a 17k-token prompt.
  Fixed params, slim prompt, the fixed-sequence schedule flow, invisible commutes,
  exact replies, account-health alerts. Details: `docs/evals/v3/LOCAL_FAILURES.md`,
  `docs/evals/v3/RESEARCH_IDEAS.md`, `docs/planning/v3/ORION_V3_IMPLEMENTATION_PLAN.md`.

---

## Open, in order

1. **Anthropic credits** (Nick) — until then nothing cloud works.
2. **Acceptance gate** for local routing: a production-replay eval on his real
   logged requests (research idea #6) so "on" stops depending on a testing window.
3. Research ideas still to build (`docs/evals/v3/RESEARCH_IDEAS.md`): #5 store
   successful turns as examples, #4 propose/preview/commit for schedule changes,
   #8 serving (something sometimes loads `gpt-oss:20b`, 12 GB; consider
   `OLLAMA_MAX_LOADED_MODELS=2` — Nick's call).
4. Voice turns arrive split ("(Continuing — my last message was cut off…)"), one
   full turn per fragment; and ambient speech woke ORION on 2026-10-14
   ("I didn't say anything. Why are you active?"). Worth a look in the Mac app's
   turn-taking.
5. The default 45-minute commute home in the scheduler (Nick's call whether it
   should follow `places.json`).
6. `docs/planning/v2/PHASE_GATES.json` is still the program's phase record; the
   V3 work above is outside the numbered phases.

## Lessons (do not re-learn these)

- Never switch live routing without a real-route test and an API-health check.
- A setting can be right in the config and wrong on the wire: check what Ollama
  actually received (`~/.ollama/logs/server.log`: prompt eval / eval lines) and
  the session transcript (`~/.openclaw/agents/main/sessions/*.jsonl`, look for
  `"type":"thinking"`).
- A different `num_ctx` makes Ollama reload the model; warm with the same one.
- Plugin tests must stub the schedule flow; one test once wrote a block "B4" to
  his real calendar.
- Never rewrite published history (Sparkle build numbers); push by fast-forward.
