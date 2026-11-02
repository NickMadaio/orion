# Awareness and curiosity: one "where is Nick, what is he doing" model, and gap-filling questions

Date: 2026-10-16. Status: DESIGN ONLY, nothing implemented. Revised 2026-10-16 (evening) with Nick's answers to
section 8: curiosity is now a plan-vs-reality loop (3.4), delivery and the review follow his rules (3.4.4, 3.6), and
logged reality replaces the plan and triggers a replan by weight (3.8, audit in 1.9).
Branches read: `fix/proactive-2026-10-16` (worktree `ORION-worktrees/proactive`, scripts and plugin) and
`ui/audit-2026-10-16` (worktree `ORION-worktrees/ui-audit`, the Mac app). Both are unmerged. Paths below are
relative to the repo root. `scripts/...`, `plugin/...` and `native/OrionMacBridge/...` lines are from the proactive
worktree. `native/Orion/...` lines are from the ui-audit worktree unless marked otherwise. Live config is read from
`~/.openclaw/orion-controlled/life-config.json` and `~/.openclaw/workspace/SCHEDULING.md`.

## 0. What Nick asked for

- (B) "orion in general should be aware of my location, my computer, my phone, etc. and sometimes he nudges me
  when im in a deep focus session like yes but nudge me AFTER ... after im done or when im on break then he
  tells and nudges me."
- (C) "for proactive, i want him to be nosier and more active. im home and have nothing planned? he asks me? not
  home he texts me, asks me what im up to so he can update my calender (also useful so that his nightly review
  of the day is accurate). he needs to want to fill in the blanks."
- (Added 2026-10-16, from the 10:36 voice turn) An unanswered SPOKEN question must not die. At 10:36 Nick asked
  "can you throw in something before I go to my first class?". ORION answered aloud through the MacBook speakers,
  "Sure, what would you like to add before your first class?" (TTS fine, 3 s). He never heard it, and the
  conversation ended. If ORION asks by voice and gets no answer within about 20 s: if he is at the Mac (recent
  input), show the question prominently and say it once more ("Nick? ..."). If he is idle or away, send it to the
  phone as a push, and his reply links back through OutreachContext. Never more than one repeat.
- (Added, speed audit `docs/audits/2026-10-16-local-speed.md`) All new LLM work in this design (ask wording,
  merged held-message summaries, reply parsing) uses the resident `qwen3.5:9b` or plain code templates.
  Never another large model. Loading `gpt-oss:20b` (13.9 GiB) makes Ollama evict the 9B and the 4B voice
  models and costs about 6 s per turn (audit finding 1, and "2. Are the 4B and 9B swapped in and out?"). The
  app's narrative job, the cause at 10:36, already moved to `qwen3.5:9b` on `fix/speed-app` (commit a443fa3).

**Nick's answers to section 8 (2026-10-16), which this revision builds in:**
- **Nosiness is state-driven, not a quota.** "It could be up to 20/day… it's more about why. A loop checking if things
  are going right, or if there's something he should update me on." Today's example: he needed to leave, ORION told
  him, saw he hadn't, and said it again: "Perfect example." If a task is planned and he isn't doing it, ORION asks why
  or tells him to get on it. "It isn't a specific number but rather according to how things are going." So
  curiosity becomes a plan-vs-reality loop (3.4) that reuses the existing follow-up ladders (1.8). The 5-a-day cap and
  the "two ignored asks pauses it" rule are gone (3.4.3). Focus, sleep and class still defer it.
- **Delivery.** The bubble always shows. ORION speaks aloud only when he is home or has headphones connected (3.4.4).
- **Nightly review.** Spoken if he is home, a text (phone push) otherwise (3.6).
- **Reality replaces the plan, then replan by weight.** What he actually did replaces the planned block on the
  calendar, even one in the past; the slip lives in the review's data. Then ORION re-weighs the rest of today so the
  most important things remain (3.8). The gym and similar must-haves should be planned daily and fitting them in is
  near-mandatory. Nick: "this also shows we need to make sure our weight system is good" (audit in 1.9).
- Pause holds 3 min. A "nothing" reply logs nothing and marks the blank answered. Section 8 lists what is still open.

Purpose test (`docs/vision/ORION_PURPOSE.md`): ORION is an external executive function that "observes what
actually happened" and closes the loop. Awareness is the "observe" step. Gap-filling makes "what actually
happened" true on the calendar, which is what the nightly review reads.

## 1. Current state (what exists today, with file:line)

### 1.1 Script side: presence, quiet, held, focus hold

| Piece | Where | What it does today |
|---|---|---|
| `presence()` | `scripts/lib/reach/presence.mjs:34-47` | Mac facts (`gather()`), then `out`/`where`. These come from the calendar only: a fixed block now, or a commute wall now (`:40-43`). It never reads a location. If no block is on, the default is `where = "home"` (`:37`). |
| `quietFacts()` | `scripts/lib/reach/presence.mjs:19-32` | Sleep window (`night.json`, `sleep-actual.json`, life config) through `sleepWindowFor` (`scripts/lib/reach/quiet.mjs:35-46`). "Awake" means Mac input < 300 s, or the last phone sample within 5 min that is off the charger or moving (`:28-30`). |
| Mac facts | `scripts/lib/reach/facts.mjs:27-35` | `ioreg` HIDIdleTime, screen lock, AC power, headphones, volume. These are spawned fresh on every call: five subprocesses, one of them `system_profiler` (slow, about 1-2 s). |
| `orion-presence` | `scripts/orion-presence:14-16` | Prints `presence()`. Read-only. |
| Channel choice | `scripts/lib/reach/route.mjs:16-27` | quiet -> hold (unless urgent kind), idle >= 5 min or locked -> phone, otherwise the Mac (bubble if `out` or late-awake, voice if home or headphones). |
| Urgent kinds | `scripts/lib/reach/quiet.mjs:9-15` | Only `reminder` and `class` bypass quiet hours and focus. |
| Focus hold | `scripts/lib/reach/focus-hold.mjs:7-15` | `isSessionActive = status === "running" \|\| "paused"`. It spawns `orion-session status --json` on every call. **A break counts as active**: the app reports `status: "running", phase: "rest"` (`scripts/orion-session:193-198` prints it as "on a break"), so a break never releases anything. |
| orion-reach hold | `scripts/orion-reach:89-91` | If a session is active and the kind is not urgent, the message is held with `heldFor: "focus"`. |
| Held queue | `scripts/lib/reach/held.mjs:26-58` | `held.jsonl`, locked append and clear. `mergeHeld` joins lines as "While you were out of reach: ..." (`:56`), drops `expires` and anything over 12 h old. |
| Release | `scripts/orion-proactive:119-123` | Only from the proactive **tick** (about every 5 min). Condition: not running/paused and not asleep-in-window. Then `releaseHeldAlerts`, `orion-reach --drain-held`, `orion-notify flush`. A 5-minute break between two polls is invisible. Even when a poll lands inside one, the break counts as "running", so nothing is released. |
| Proactive decide | `scripts/lib/reach/proactive.mjs:20-89` | Session-done line, class ladder (`class-ladder.mjs:20-65`), gap question (`gap.mjs:22-40`), due-tomorrow, bedtime. `away = ctx.out` (calendar-derived). |
| Gap question today | `scripts/lib/reach/gap.mjs:7-40` | Asks only when there is an **open to-do** to offer (`:24-26`). The gap must be 60+ min (`:7`), at most 2 a day (`:8,27`), between 09:00 and 20:30. It never asks "what are you up to". With no to-dos it says nothing at all. |
| Check-in tick | `scripts/orion-checkin:153-193` | It checks the focus session itself (`:157`, holding only `by: "orion"` check-ins), and the calendar for class (`:160`). It does not use presence. |
| orion-now | `scripts/orion-now:20-48` | A "what should he do now" recommendation, plus the sleep plan. It reads the last phone sample for "last active" (`:33-35`). This is not an awareness state: no location, no session, no Mac. |
| Class evidence | `scripts/lib/life/attendance.mjs:12-33` | "Attended" means off the charger and moving near the class time. It never uses position. |
| Sleep | `scripts/lib/life/night.mjs:64-95` | `actualWake` / `actualSleep`: WHOOP (`sleep-actual.json`), else the phone's `up`/`bed` (`health-log.json sleepLog`), else the first unplug or motion after 04:00. |

So **seven senders consult four different partial notions of "where is he"**: `presence()` (calendar), `activeSession()`
(socket), `quietFacts()` (sleep and phone), and the checkin's own calendar read. None of them knows his location.

### 1.2 Location: what is actually known

- The phone samples motion, charging and a coarse location: `native/OrionMobile/App/PhoneSignals.swift:66-89`
  (proactive worktree). This happens when ORION is opened and every 10 min while it stays open (`:57`), plus
  iOS significant-location-change wakes (`:51-53`, `:91-98`). Accuracy is `kCLLocationAccuracyHundredMeters`
  (`:37`). A location is attached only if the fix is under 15 min old (`:84`).
- The samples land on the Mac in `health-log.json` `phoneSignals` (last 2000), through
  `native/OrionLink/Sources/LinkCore/TrackingLog.swift:121-126`.
- Live data (read-only check today): 1476 samples from 2026-09-29 to 2026-10-16. Median gap 0 min (bursts), max
  gap 945 min. Motion is `unknown` in 931 of them. One coordinate cell dominates (593 samples), and the next
  dominant cell has 355. **There is no coordinate for "home" anywhere.**
- `places.json` (`~/.openclaw/orion-controlled/places.json`) is **not** a place list. It maps names to commute
  minutes (`{"spitalfields": 15, "chapter spitalfields": 15, "spit": 15}`).
- `location.json` is `{ home: "Europe/London", place: "London" }`. That is a time-zone home and a weather city
  (`scripts/lib/reach/weather.mjs:11`, `scripts/orion-timezone`), not a position.
- `life-config.json` has `commuteMinutes`, `homeGapMinutes` and the rest, but no home location.
- The audit already logged the cost (`docs/audits/2026-10-16-proactive-messaging.md:279`). At 00:00 on 10-12 a
  bedtime line was said aloud while he was out ("not even home gang"), because "presence (`out`) is
  calendar-derived; being at the Mac is not being at home".

### 1.3 The 10:36 unanswered spoken question (app log `~/.openclaw/logs/orion-app.log:943412-943468`)

- 10:36:09 the ear opens (Deepgram). 10:36:20 the narrative job's `gpt-oss:20b` request evicts the 9B (speed audit
  timeline). 10:36:35 `[speech] speaking 57 chars`. 10:36:38 `[speech] finished cleanly`, and the follow-up ear
  reopens (`[deepgram] socket OPEN`).
- After that, **nothing is logged**. The follow-up window is `followUpGrace = 6` s
  (`native/Orion/Sources/Orion/AppState.swift:451`). When it lapses with no voice, `checkHandsFree` calls
  `endConversation()` (`AppState.swift:1670-1677`, `:1700-1712`). That clears the turn and goes back to
  wake-word listening. It does not remember that the last thing ORION said was a question, and it does not escalate.
- The reply also took 26 s from the press to speech, partly from the gpt-oss eviction (since fixed: the narrative
  job runs on `qwen3.5:9b`, `fix/speed-app` a443fa3). He had plausibly stopped attending by then. The question was
  spoken through the speakers, with no headphones.

### 1.4 Mac app (ui-audit worktree, `native/`)

- **Session status** is derived, not stored. It is reconciled from the plan plus append-only events
  (`Orion/Sources/SessionDomain/SessionState.swift:5-6`). The status enum is `notStarted | running(focus/rest) | paused |
  waitingForReturn | readyToComplete | readyToAbandon | finished(...)` (`SessionDomain/Reconcile.swift:32-57`,
  `SessionDomain/Events.swift:183-189`). Focus<->rest transitions are implicit (`Walk.consume` does `phaseIndex += 1`,
  `Reconcile.swift:~540-556`). A rest that ends while he is idle becomes `waitingForReturn` (`:546-553`). The heartbeat
  is a 30 s timer (`Orion/Sources/SessionService/SessionService.swift:136,194-206`).
- **Socket reply** (`Orion/Sources/SessionService/SessionIPC.swift:73-172`): `status` (none|not-started|running|paused|waiting-for-return|finishing|
  abandoning|finished), `phase` (focus|rest while running), `phaseIndex`, `blockNumber`, `totalBlocks`, `remainingSeconds`,
  `servedFocusSeconds`, `sessionId` and more.
- **No hook on a phase change runs a script.** Effects are announce, clips, history, absence and clock
  (`SessionDomain/Effects.swift:26-46`). `session.onChange` (`AppState.swift:922-934`) drives the shield, enforcer, tab, break surface
  and extras only. **Scripts learn about a break or an end only by polling.**
- **Real idle**: `IdleReading.current()` (`IdleReading.swift:16-44`). It reads any-input idle through CGEventSource and
  returns nil when invalid. Its only consumer is `ScheduleFocusWatcher` (30 s, started `AppState.swift:610`), which
  writes `focus-activity.json` `{at, app, title, idleSeconds (0 if invalid), idleValid, enforcementAllowed, workApp}`
  (`ScheduleFocusWatcher.swift:13-32`). That file is the one Mac-activity record a script can already read, and it
  is fresh every 30 s. Separately, `Orion/Sources/SessionService/Sensors.swift:39-81` reads the frontmost app, idle and screen lock or sleep, but
  writes nothing to disk. Scripts still shell out to `ioreg` (`scripts/lib/reach/facts.mjs:29`).
- **Schedulers**: `LifeWatch.swift:18-55` runs `orion-watch tick`, then `orion-watches tick`, then `orion-proactive tick`,
  every 5 min, skipped while one is busy. `orion-checkin tick --json` runs about every 32 s from OrionLink's LinkEngine
  (`OrionLink/App/LinkEngine.swift:76-89,144-189`). The outreach outbox is checked every 4 s (`:90,197-232`).
  `ReminderService` polls every 2 s and calls `orion-reach --kind reminder --urgent` (`ReminderService.swift:52-108`,
  `AppState.swift:733-757`).
- **orion://reach** (`AppDelegate.swift:172-221`) leads to `deliverReach` (`AppState.swift:493-519`). It shows a bubble or
  chat, and speaks if the channel is `mac-voice`. It does no focus or quiet check of its own, which is fine because
  orion-reach already decided.
- **Outreach context, Mac** (`OutreachContext.swift:11-56`, consumed `GatewayClient.swift:97-126`). Only the single
  latest non-held `outreach.jsonl` row is used, within 25 min (`:13`), only if no turn happened since, and once. The
  link is **by time only, with no reply-to id**. The row's `why`/`kind` are not parsed (`:15-25`).
- **No CoreLocation, Wi-Fi SSID or home code** in the Mac app. `CameraPresence` exists, is off by default, and has never
  produced a reading (504 of 504 samples failed).

### 1.5 Phone and link (both worktrees, identical for these files unless noted)

- **Transport**: CloudKit private DB, zone `OrionLink` (`OrionMobile/Sources/MobileCore/LinkSnapshot.swift:18-19`). The
  Mac has no subscription. It polls zone changes every 4 s (`OrionLink/App/LinkEngine.swift:74-77,321-361`).
- **PhoneSignals**: off by default (`PhoneSignals.swift:25`). It samples about every 10 min **only while the app is
  open** (`:57`, `OrionMobileApp.swift:175-176`). **Background significant-change samples are dropped**: `send()` calls
  `log?(entry)` (`PhoneSignals.swift:87`), but `log` is assigned only from the foreground root view
  (`OrionMobileApp.swift:175`), so on a background relaunch it is nil. There is no queue, unlike
  `NightRoutine.record` (`NightRoutine.swift:423-428`). `stop()` never stops significant-change monitoring
  (`PhoneSignals.swift:62-64`). Coordinates are rounded to 3 dp (`LinkSnapshot.swift:411-414`).
- **Wake signals**: `unplugged` arrives only while the app is open, or through a manual Shortcuts automation
  (`WakeSignals.swift:11-57`). `used` comes from a DeviceActivity threshold in the morning window
  (`ScreenWatch.swift:90-115`). `up` is the first open after the alarm (`NightRoutine.swift:411-419`).
- **Push path**: `outreach-outbox.jsonl` becomes a LinkCommand chat record, plus a `LinkAlert "reach-<id>"` if
  `push` (`LinkEngine.swift:188-221`). On the proactive worktree the level is hard-coded 1. The ui-audit fix f6397c3
  makes urgent level 2 (`OrionLink/Sources/LinkCore/OutboxClaim.swift:43-45`). The phone gets APNs through a
  CKQuerySubscription (`CloudLink.swift:88-106`). **Every alert uses the `orion.checkin` category** (Started / 10 more
  min / Done), including questions. **No `UNTextInputNotificationAction` exists**, and button answers carry no alert
  id (`OrionMobileApp.swift:46-80`, `LinkEngine.swift:458-484`).
- **Typed phone reply** goes through `CommandRunner` to `orion-remote handle --from phone --mode chat`
  (`OrionLink/Sources/LinkCore/CommandRunner.swift:33-57`). Outreach records carry no `conversationID`, so they show
  only in "All history" (`ConversationView.swift:21-74`).
- **Outreach context, phone**: `scripts/orion-remote:586-594` still injects the **last 3 rows from 6 h** ("this message
  may be his answer"). This is the exact bug the Mac side fixed in commit 8220d23, **not fixed on the phone path**.
  `watchQuestion()` (`:596-606`) adds watch.json's last question from up to 6 h back.
- **No geofences, CLRegion or CLMonitor, no saved places, no INFocusStatusCenter** on the phone.

### 1.6 Calendar writes, "log what I did", nightly review

- **schedule-flow** (`plugin/orion-control/src/schedule-flow.ts`): the intents are
  `fill_between|plan|clear_after|move|resize|extend|add|drop|skip|swap|tidy|late|overrun|cannot|ask|answer` (`:20,:46`).
  **There is no `log`/`now` intent.** The routing gate (`local-routing.ts:714`, `SCHEDULING :158`, `RUNNING_LATE :166`,
  `isCalendarTurn :204`) means "i'm at the gym" reaches the flow only through the word "gym", and the model must force it
  into `add`/`ask`. "was at the library since 2" matches nothing and never reaches the flow. `places.json` is read
  only by `knownTravel()` (`schedule-flow.ts:102-113`), and nothing in the repo writes it.
- **orion-reschedule**: `add` refuses intervals that are already over ("NOTHING WAS BOOKED: ... already over today",
  `scripts/orion-reschedule:806-814`) and refuses ones that have already started, with the hint `now "<title>, N"`
  (`:801-803`). `now` (`:380-415`) is **the only path that writes the past**: `--at` up to 240 min back (`:395`), with
  `source: "orion"` (`:398`). A **fully past** block ("gym 2-4") is not supported. `busy HH:MM-HH:MM` (`:361-365`)
  only adds a replan wall, with no event.
- **Event shape**: `live-day.mjs toBlocks` (`:40-56`) gives `{id, title, kind, date, start, end, fixed, source:
  "orion"|"calendar", calendarId}`. ORION events carry a `[orion:<kind>]` note marker (`Bridge.swift:438-439`, read
  back at `live-day.mjs:55`). Writes go through `calendar-write.mjs applyPlan` (`:59-101`, with an undo journal) and
  then `bridgeRequest` (`bridge-path.mjs:36-46`).
- **Nightly review: none runs.** `scripts/lib/life/day-review.mjs reviewDay()` is called only by
  `tests/truthful-day-review.test.mjs`. It counts only `source === "orion"` blocks as planned (`:24-30`), ignores
  calendar blocks and gaps, and reads no focus history, phone signals or attendance. `scripts/orion-daily` summarises
  ORION's own `task-ledger.jsonl` into a memory note (`:28-79,166-211`), not Nick's day. `orion-standing`'s 21:00
  evening pass (`:626,769`) looks at tomorrow. `life-history.jsonl` gets rows only from check-ins
  (`scripts/lib/life/history.mjs:13-22`, `orion-checkin:114,185`). **A blank on the calendar is read as nothing, and
  never as unknown.**

### 1.7 Who sends, and what each consults today

| Sender | Path | Focus check | Break-aware | Quiet check | Location |
|---|---|---|---|---|---|
| orion-proactive (ladder, gap, bedtime) | `orion-reach` | yes, via orion-reach `:89-91` and `decide` busy `proactive.mjs:23` | no | yes | calendar-only `out` |
| orion-checkin tick | alerts to the phone, through LinkEngine directly | ORION-made only (`orion-checkin:157,171`) | no | **no** | no |
| orion-watch | alerts-outbox / held | yes, class only passes (`orion-watch:209-223`) | no | own `awake` gate | no |
| orion-notify (Discord) | Discord, then the phone fallback | yes (`orion-notify:413`) | no | 23:00-08:00 fixed | no |
| orion-standing | orion-notify | none itself, and `--urgent` "blocked" bypasses notify's focus gate (`:842-858`) | no | 23:00-08:00 | no |
| orion-morning | `orion-reach --awake` | yes, through orion-reach | no | bypassed by design | no |
| ReminderService (app) | `orion-reach --urgent` reminder | bypass (correct) | n/a | bypass (correct) | no |
| Enforcer / session announce (app) | chat line only | n/a | n/a | n/a | n/a |
| Voice reply (app) | spoken in the turn | n/a | n/a | n/a | n/a, and no escalation if unanswered |

### 1.8 Follow-up machinery that already exists (the plan-vs-reality loop reuses it)

| Piece | Where | What it does today | Reused as |
|---|---|---|---|
| Leave ladder | `scripts/lib/reach/class-ladder.mjs:20-65`, called from `proactive.mjs:58` | Per fixed destination: `leave-<start>` 5-15 min before the travel wall (`:26-35`, any fixed destination). For **real classes only** (`:36-37`): `leave-late-<start>` at leave time to +10 min if he has not moved (`:52`, urgent), `wake-<start>` up to 10 min after the start (`:53-58`), and one `class-missed` replan offer (`:59-63`). "Moved" is `signals.leftAt` (phone off the charger and moving, `:24,:45`), not location. This is today's "told him to leave, saw he hadn't, said it again". | The `should-leave` mismatch (3.4.2). Extended to non-class fixed destinations (non-urgent rungs) and to awareness location as evidence. |
| Check-in loop | `scripts/orion-checkin:86-99` (add, `--by orion` at `:91`), `:153-193` (tick, every ~32 s from LinkEngine) and `scripts/lib/life/follow-through.mjs:3-47` | A pure escalation loop: `waiting -> reminded -> intervening`, levels 1-4, next check after 10, 10, 5, 5 min (`GAPS`, `:3`). Messages by level, from "Time to start: X." to "You've been avoiding X for N min. Get up." (`orion-checkin:68-80`). `started` goes quiet and checks once after 25 min (`:176-179`); a legitimate `defer` waits 5-45 min (`follow-through.mjs:39-44`), a second non-legitimate one escalates. Gives up after 8 alerts (`MAX_ALERTS`, `:34,:184-186`). Alerts go **only to the phone**, through LinkEngine's alerts outbox. | The `not-started` mismatch (3.4.2). The loop is unchanged; plan check-ins get a block id and their alerts go through `orion-reach` (C9). |
| On-task ladder | `scripts/orion-ontask-watch` (run every 30 s by `ScheduleFocusWatcher.swift:36`), `scripts/lib/focus/escalation.mjs:20-44` (`focusBlock`) | Inside an ORION focus block (study, side project, other), off-task Mac activity steps `nudge -> say -> front -> quit -> lock`; ten minutes of phone use warns (`orion-ontask-watch:34-37`). | The `off-plan` mismatch at the Mac. Unchanged. |
| Proactive keys | `scripts/orion-proactive:96-115`, `proactive-sent.json` | Each key is said at most once per day; a failed send is retried next tick. | Mismatch keys (`mismatch-<type>-<blockId>-<level>`). |
| Rate guard | `scripts/lib/reach/route.mjs:38-47` (`allowed`) | The same text within 2 h is refused; more than 6 reached messages an hour are refused. | Kept as the burst limit. Escalation texts differ by level, so the duplicate rule never blocks a follow-up. |

### 1.9 Weight/priority system audit

Nick's two questions, answered against the code:

**Q1. Does it support "the displaced item outranks a later one, so move it"?** Partly, by accident, and not for a block
that is already in the past. The mechanism exists: `replan(..., { rebuild: true })` lays every remaining movable block
out again, choosing "most important first" (`scripts/lib/life/replan.mjs:143-160`), and `orion-reschedule now` deletes
whatever did not fit (`scripts/orion-reschedule:412-415`). But:
- A planned block that is **fully past** is `finished` and stays where it was (`replan.mjs:75,88`). Nothing re-offers
  it for later today, so "I did gym instead of finish resume 2-4" can never move finish resume into the evening.
- "Most important" is `importanceOf` (title regex, `scripts/lib/life/priority.mjs:23-29`), then "existing before new"
  (`replan.mjs:145-146`, the `fresh` term), then kind order (`priorityOf`, `priority.mjs:1-20`). **His saved ranks are
  never consulted**: `life-config.json` has `ranks: { gym: "high" }`, but `rankOf` (`priority.mjs:74-87`), the only
  reader of `ranks`, is used only to print ranks into the model's prompt (`scripts/orion-remote:567-581`). No placement
  code reads it.
- **Importance does not survive the calendar.** `day --todos` and `--plan` compute importance when booking
  (`orion-reschedule:596,:771,:782`; `task-spread.mjs:109-112` for `orion-tasks --priority`), but the event note stores
  only the kind (`native/OrionMacBridge/Sources/OrionMacBridge/Bridge.swift:437-440`), and the read returns only the
  first `[orion:<x>]` marker (`Bridge.swift:257-259`, parsed at `scripts/lib/life/live-day.mjs:47-56`). On the next
  replan a "high, due today" to-do is importance 1 like everything else.
- Two scales disagree. `priorityOf` orders class, sleep, gym, deadline, study, side project, meal, other, rest
  (`priority.mjs:1-11`). `rankOf` and SCHEDULING.md (`:92-107`) say study is high like the gym and meals are medium
  like to-dos. A to-do is kind `other`, below side project and meal in `priorityOf`.
- `schedule-flow.ts:32-35` shows the model only FIXED or not; no rank. Fine, since the weight belongs in code.

**Q2. Does a daily gym get auto-planned?** No.
- `fillDay` adds "Gym" only on `gymDays`, default Mon/Wed/Fri (`scripts/lib/life/config.mjs:13`, `fill-day.mjs:29`).
  `life-config.json` does not set `gymDays`, so it is not daily.
- `fillDay` runs only on an explicit `orion-reschedule fill` or `day --fill` (`orion-reschedule:628-635,:957-966`).
  No tick or morning step calls it: `orion-watch` only asks about an empty day and runs `orion-tasks sweep|plan`
  (`orion-watch:149-160`).
- Even then the gym is optional in practice: `fillDay` skips any ask that would leave less than `freeMinutesKept`
  free (`fill-day.mjs:39-45`), and `day --fill` places the asks with every existing block frozen as fixed
  (`orion-reschedule:966`), so a gym can never displace a lower-ranked block. A fresh "Gym" has importance 1, so the
  `keepFree` rule can also drop it (`replan.mjs:157`).

**Verdict.** The building blocks (rebuild replan, unplaced reporting, ranks in config) exist, but the weight is
scattered across three scales, his ranks are not enforced, importance is lost on the calendar round-trip, a past
displaced block cannot re-enter the day, and nothing plans the gym daily. 3.8 fixes these inside `orion-reschedule`
and `replan.mjs`, with no new engine.

## 2. Gaps

G1. **No single state.** Seven senders build their own partial picture (1.7). Each spends 1-4 s spawning `ioreg`,
    `system_profiler` and `orion-session` per message.
G2. **A break is "busy".** `isSessionActive` treats `running` + `rest` as active (`focus-hold.mjs:7`). `decide()` does
    the same (`proactive.mjs:23`). Nothing is ever released on a break.
G3. **Release is polled, every 5 min** (`LifeWatch.swift`), and only by orion-proactive. A 5-min break is missed by
    construction. The app knows the exact moment of the change (`session.onChange`) and tells nobody.
G4. **The merged text says "While you were out of reach"** for every hold reason (`held.mjs:56`). Nick asked for
    "after I'm done or when I'm on break, he tells me". The wording should name the reason, and stay short.
G5. **Location is unknown in practice.** There is no home coordinate. Background samples are dropped
    (`PhoneSignals.swift:87`). `out` is guessed from the calendar, and `where = "home"` is the **default**, which
    breaks "unknown is unknown".
G6. **Gaps without a to-do are silent** (`gap.mjs:24-26`). There is no "what are you up to?", no away flavour, and no
    unknown-place or new-place question. More broadly, nothing compares the plan with reality: a planned block he
    is not doing gets a nudge only if he set a check-in himself (1.8), and the leave ladder escalates for classes only.
G7. **No reply linkage that survives a phone delay.** The Mac uses 25 min and time only. The phone uses 3 rows from 6 h
    (still the old bug). Neither knows the message was a **gap question about 14:00-16:00**, so a reply like "gym"
    cannot be turned into a block deterministically.
G8. **Past blocks cannot be logged**: `add` refuses them, `now` is limited to 240 min and not reachable from the form,
    and "was at X since 2" never reaches the flow.
G9. **No nightly review runs.** The one that exists treats blanks as nothing and ignores logged reality.
G10. **The checkin tick ignores quiet hours**, and orion-standing's `--urgent` passes notify's focus gate (1.7). They are
    held inconsistently.
G11. **An unanswered spoken question dies after 6 s** (1.3). There is no repeat, no prominent display and no phone
    fallback, and no memory that a question is open.
G12. **Phone questions have no text reply**, and their buttons are the check-in buttons (Started / 10 more min / Done),
    which are meaningless for "what are you up to?".
G13. **Speaking ignores whether he can hear it privately.** `chooseChannel` speaks at the Mac whenever he is not "out"
    (`route.mjs:24-26`), and "out" is calendar-derived. Headphones come from a 1-2 s `system_profiler` call that also
    counts AirPlay as headphones (`facts.mjs:17,:32`). The phone's audio route is never read.
G14. **Logged reality cannot replace the plan.** The calendar keeps the planned block when he did something else, so
    the calendar does not show his real day (1.6, 3.5).
G15. **The weight system is not enforced** (1.9): saved ranks unused, importance lost on the calendar, a past
    displaced block never re-enters the day.
G16. **The gym is not planned daily** and is the first thing `fillDay` drops on a full day (1.9).

## 3. Proposed architecture

### 3.1 One source of truth: `~/.openclaw/orion-controlled/awareness.json`

One file, one writer program: `scripts/orion-awareness refresh`. It is read through one library,
`scripts/lib/awareness/state.mjs`. Every sender reads it, and none of them recomputes facts.

```jsonc
{
  "schema": "orion.awareness.v1",
  "at": "2026-10-16T14:02:11Z",           // when this snapshot was composed
  "session":  { "state": "focus|rest|paused|waiting|none|unknown", "sessionId": "...", "phaseIndex": 2,
                "phaseEndsAt": "ISO|null", "task": "...", "at": "ISO", "source": "socket|phase-hook" },
  "calendar": { "state": "ok|unknown", "now": { "title", "start", "end", "kind", "fixed", "source" } | null,
                "next": { ... } | null, "freeUntil": 960 | null, "travelNow": "commute to class" | null, "at": "ISO" },
  "location": { "state": "home|known|elsewhere|moving|unknown", "placeId": "home|gym|...|null",
                "cell": "51.53,-0.09" | null, "since": "ISO|null", "at": "ISO", "source": "region|sample|null" },
  "mac":      { "state": "active|idle|locked|asleep|unknown", "idleSeconds": 12, "frontApp": "Claude", "at": "ISO" },
  "phone":    { "state": "in-use|moving|still|charging|unknown", "charging": false, "motion": "walking",
                "lastSampleAt": "ISO|null", "at": "ISO" },
  "audio":    { "mac":   { "route": "bluetooth|wired|speakers|airplay|unknown", "headphones": true | false | null,
                           "device": "AirPods Pro", "at": "ISO" },
                "phone": { "route": "bluetooth|wired|speaker|unknown", "headphones": true | false | null, "at": "ISO" } },
  "sleep":    { "state": "asleep|awake|late-awake|unknown", "inWindow": false, "wokeAt": 569, "bed": 1440,
                "source": "whoop|phone|mac|window", "at": "ISO" },
  "derived":  { "activity": "focus|rest|class|commute|sleeping|free|busy|unknown",
                "atMac": true, "atHome": true | false | null, "interruptible": "yes|urgent-only|no",
                "speakOnMac": true }   // atMac && !lateAwake && (atHome === true || audio.mac.headphones === true)
}
```

**The headphones facet, signal by signal.**
- **Mac output route.** The app already reads it: `AudioRoute.defaultOutputID()` (`native/Orion/Sources/Orion/AudioRoute.swift:92-94`),
  `transportType(of:)` and `isBluetooth(_:)` (`:132-148`), wrapped by `AppState.currentOutputRouteKind()`
  (`AppState.swift:1181-1186`, used by barge-in at `:1103`). New: `AudioRoute.outputRoute()` returns
  `bluetooth` (transport Bluetooth or BluetoothLE), `wired` (transport BuiltIn with data source `hdpn`, read through
  `kAudioDevicePropertyDataSource` on the output scope, or transport USB with "headphone" in the name), `airplay`
  (transport AirPlay: a speaker, **not** headphones, unlike `facts.mjs:17` today) or `speakers`, plus the device name
  (`kAudioObjectPropertyName`). `ScheduleFocusWatcher` writes it into `focus-activity.json` as
  `audio: { route, device, headphones }` every 30 s (`ScheduleFocusWatcher.swift:13-32`), so scripts never call
  `system_profiler` again (`facts.mjs:32` stays only as the fallback when the file is stale).
- **Phone output route, when obtainable.** `AVAudioSession.sharedInstance().currentRoute.outputs` port types:
  `.bluetoothA2DP`, `.bluetoothHFP`, `.bluetoothLE` give `bluetooth`; `.headphones` gives `wired`; `.builtInSpeaker`
  or `.builtInReceiver` give `speaker`. It is read in `PhoneSignals.send` (`native/OrionMobile/App/PhoneSignals.swift:82-89`)
  and carried as a new optional `audio` field on `LinkLog.signal` (`native/OrionMobile/Sources/MobileCore/LinkSnapshot.swift:371`,
  validated at `:408-414`), landing in `phoneSignals` through `TrackingLog.swift:121-126`. `PhoneSignals` also observes
  `AVAudioSession.routeChangeNotification` while it runs and sends one extra sample on a connect or disconnect. **Limit:**
  iOS lets the app read the route only while it runs (foreground, the 10-min timer, significant-change wakes), so the
  phone facet is often stale and then `unknown` (20-min limit, like the phone facet). It is used only for phone
  delivery (3.4.4), never to decide the Mac may speak: AirPods connected to the phone are not in his ears for the Mac.

**Staleness rules: unknown is unknown, never a guess.** Each facet has its own `at`, and a reader treats a facet older than
its limit as `unknown`, whatever it says:

| Facet | Fresh source | Max age before `unknown` | Notes |
|---|---|---|---|
| session | phase hook or socket | 90 s (the hook keeps it current, refresh re-asks the socket) | Socket unreachable (app down) gives `unknown`. A sender's gate treats `unknown` session as **not** in focus, because the app being down means no session can be enforced; the morning and class ladders must not starve. |
| calendar | `liveDay()` | 10 min, or invalidated by a calendar write (orion-reschedule touches `awareness.dirty`) | A read failure gives `state: unknown`, never "free". |
| location | region event (phone) or sample with coords | region state: until the next region event, at most 12 h. Sample: 20 min. | `atHome = null` when unknown. **The default "home" in `presence.mjs:37` goes away.** |
| mac | `focus-activity.json` (30 s writer) plus a lock flag | 90 s | No file, or app down, falls back to one `ioreg` read (today's `facts.mjs`). |
| phone | last `phoneSignals` row, `phoneScreen` | 20 min | `charging` and `motion` from a 2-hour-old sample are not "now". |
| audio.mac | `focus-activity.json` `audio` (30 s) | 90 s | Stale gives `headphones: null`, which never allows speech on its own. |
| audio.phone | last `phoneSignals` row with `audio` | 20 min | Stale gives `unknown`. |
| sleep | WHOOP night, phone bed/up, Mac input | recomputed each refresh | `asleep` needs inWindow plus no Mac input for 5 min plus no fresh phone motion (today's `quietFacts`). |

**Who writes, and how often.** One program (`orion-awareness refresh`), with an O_EXCL lock and tmp+rename (the
`held.mjs:10-24` pattern). It is invoked by:
1. the Mac app's **session phase hook** (new, 3.2), immediately on every phase change, with `--session '<json>'` so
   no socket round-trip is needed;
2. `LifeWatch` every 5 min, **before** `orion-proactive tick` (and orion-proactive reads the file);
3. LinkEngine when a phone `signal` or `place` log lands (new);
4. lazily, by `readAwareness()` itself when the file is older than 2 min. The calendar facet is reused from the
   file if it is under 10 min old, so a lazy refresh costs about 100 ms (no calendar read, no `system_profiler`).
   Headphones come from the `audio` facet (focus-activity.json and phone samples), so `orion-reach` no longer spawns
   `system_profiler` at send time.

`orion-presence` and `orion-now --json` keep their CLIs but read awareness.json (orion-presence prints it).
`presence()` becomes a thin adapter that returns the old shape from awareness, so `route.mjs` and its tests stay valid.

### 3.2 Delivery policy: defer, don't drop

One pure gate, `scripts/lib/reach/gate.mjs`:

```js
// verdict for one message given awareness; pure.
export function gate(aw, { kind, urgentKind = null, now }) // -> { action: "deliver"|"hold", reason, heldFor? }
```

- `urgentKind` in `URGENT_KINDS` (`reminder`, `class`): **deliver** always. This is unchanged: a reminder he set for
  that time, or a class he is about to miss.
- `aw.sleep.state === "asleep"`: hold, `heldFor: "quiet"` (today's rule).
- `aw.session.state === "focus"`: hold, `heldFor: "focus"`.
- `aw.session.state === "paused"`: hold for the first 3 min of a pause, then deliver. Someone who paused is not focusing.
  (Nick confirmed 3 min.)
- `rest`, `waiting`, `none`, `unknown`: deliver. **A break is when held things come out.**
- In class (`calendar.now.kind === "class"` and not marked missed): hold, `heldFor: "class"`, released at the end of the class.

Every sender calls `gate()`: orion-reach (replacing `:84-91`), orion-checkin tick (replacing `:157,170-171`; a check-in
HE set for a time counts as a reminder and still fires), orion-notify (`:413`), orion-watch (`:209-223`) and
orion-standing (its urgent findings go through `gate` with `urgentKind` only if they are a class).

**Release on the phase change, not on a poll.** In `session.onChange` (`AppState.swift:922`) the app compares the
previous and new `(status, phaseKind, phaseIndex)`. On a transition it spawns, detached and with a 30 s timeout,
`orion-awareness phase --from focus --to rest --session '<json>'`. That refreshes awareness.json and runs
`orion-reach --drain-held --reason break|end`. orion-reach releases only when `gate` allows it: rest,
finished/none, waiting, or paused for over 3 min. For the pause case, the hook also fires once from the heartbeat,
when a pause crosses 3 min. The 30 s heartbeat (`SessionService.swift:136`) is fine for detecting the
paused-for-3-min case. The focus-to-rest edge is instant, so even a 2-minute break gets its message at the start.

**The merged message** (`held.mjs mergeHeld`) uses a code template, with **no LLM** (speed audit):
- one item: the item itself;
- reason `focus` and released on a break: "While you were focused: A. B." (at most 3 lines, then "+N more in chat");
- reason `focus` and released at the end: the session-done line from `proactive.mjs:50-53` **absorbs** it, as one
  message: "Session done. 1h 40m today. While you were focused: A. B.";
- reason `quiet`: "While you were asleep: ...". Reason `class`: "While you were in class: ...".
- An item marked `expires`, or past its own `validUntil` (a "leave in 10 min" whose time has gone), is dropped, as today.
  An ask or a mismatch nudge (3.4) is **never** held: it is dropped and re-decided by the next loop tick, since a held
  "what are you up to?" or "time to start X" is stale by definition. The loop re-checks at the break or the end, so
  deferral still happens, with fresh facts.
- On a break the channel is the Mac if `atMac`, which the break surface already shows. Otherwise it goes to the phone.

### 3.3 Location: how "home" becomes known

- New file `~/.openclaw/orion-controlled/known-places.json`:
  `{ places: [{ id: "home", name: "home", lat, lon, radiusM: 120, kind: "home|campus|gym|work|other", source:
  "nick|learned", confirmedAt }] }`. **`places.json` stays as it is** (commute minutes for schedule-flow).
- **Seeding home** (`orion-awareness place learn`): the coordinate cell with the most samples between 01:00 and 06:00
  while charging, over the last 14 days. It is **proposed, never assumed**: ORION asks once, "Is this where you live? (the
  spot your phone sleeps at)". Until he says yes, `atHome` stays null. `orion-awareness place set home --here` uses the
  latest fresh sample.
- **Phone geofences** (iOS `CLMonitor` / `CLCircularRegion`, at most 20). The phone reads known places from the
  LinkSnapshot and monitors them. Enter and exit events are sent as a new `LinkLog.place(event, placeId, at)` through a
  **queue that survives background launches** (like `NightRoutine.record`). This is the reliable home/away bit, and it
  works with the app closed. Samples stay the fallback (within `radiusM` of a known place, with a fresh fix).
- **Mac Wi-Fi as a second home signal** (optional, a decision for Nick): `CWWiFiClient` SSID equal to his home network.
  It needs Location Services for Orion.app on macOS 14+.
- `location.state = "elsewhere"` when a fresh fix is more than `radiusM` from every known place. `moving` when motion
  is walking, cycling or vehicle. `since` is the first sample or region event of the current stay (dwell).

### 3.4 Curiosity as a plan-vs-reality loop (Feature 2)

Nick: nosiness "isn't a specific number but rather according to how things are going": "a loop checking if things
are going right, or if there's something he should update me on". So curiosity is not a rationed question. It is a
loop that compares what should be happening with what is happening, acts on a mismatch, and follows up until the
mismatch is resolved. Filling unknown blanks is one case of it, not the whole of it.

#### 3.4.1 The loop

New pure module `scripts/lib/curiosity/loop.mjs`:

```js
// one tick: plan vs reality -> actions; pure (awareness, day and ledgers in, actions out)
export function planVsReality(aw, { day, checkins, ledger, sent, weights, now })
  // -> [{ key, type: "should-leave"|"not-started"|"off-plan"|"blank", blockId?, action, text?, ask? }]
```

It runs on every `orion-proactive tick` (5 min, right after `orion-awareness refresh`), and also from
`orion-awareness` on a location change (left or arrived) and on the session phase hook (3.2), so leaving, arriving
and "session over" are evaluated at once, not up to 5 min later. Each tick:
1. **Should.** From the calendar facet and today's blocks: the block that should be under way (`calendar.now`), the
   next fixed destination and its travel wall (`commuteWalls`), and planned movable blocks that started in the last
   30 min. Each block carries its weight (3.8, C10).
2. **Is.** From the awareness facets only: session (focus, and on what task), location (home, a known place,
   elsewhere, moving), Mac (active, front app and `workApp` from `focus-activity.json`), phone (motion, in use),
   sleep. Unknown stays unknown: an unknown facet is never evidence of a mismatch.
3. **Compare.** At most one mismatch per block, by the table below.
4. **Act** through the machinery that already exists (1.8). Nothing new escalates on its own.

#### 3.4.2 Mismatch types

| Type | Should vs is | Evidence that all is fine (no mismatch) | Action (reused machinery) | First text (code template) |
|---|---|---|---|---|
| `should-leave` | A fixed destination's travel wall has started, and he has not left. | `location.state` is not `home` (or not the known place he was at), or `phone.motion` is walking, cycling or vehicle, or today's `signals.leftAt` (`class-ladder.mjs:24`). | The leave ladder, `class-ladder.mjs`: `leave-` then `leave-late-` then `wake-`. Two changes: "not left" uses `atHome === true` when it is known, with `leftAt` as the fallback; and `leave-late` also runs for **non-class** fixed destinations (dinner with friends), as a plain reminder with no `urgentKind`, so it does not cut through focus or quiet hours. | Unchanged: "Leave in 12 min for CS1800 at 9:00 AM.", then "You should be out the door now...". |
| `not-started` | A planned block of weight high or medium (3.8) started 5+ min ago. | A focus session whose task matches the block; for study, side project or other, the Mac front app is a work app (`focus-activity.json workApp`); for a block with a known place (the gym), `location.placeId` matches; a `started` check-in for it; a logged block covering now. | `orion-checkin add 0 "<title>" --by orion --block <id>` once (C9). The existing loop escalates (10, 10, 5, 5 min, `follow-through.mjs:3`) with its existing level texts (`orion-checkin:68-80`). New evidence closes it silently (`orion-checkin started <id>`). | Level 1 asks why: "Finish resume was down for 2:00 - not started yet. What's up?" Level 2+: "Finish resume - still not started. Start now; just the first five minutes." |
| `off-plan` | A block is under way and he is doing something else. | At the Mac inside an ORION focus block: `orion-ontask-watch` already handles it (1.8), unchanged. Away: he is at the block's place, or the block has no place. | Away only: `location` is `elsewhere` or another known place for 15+ min during a block planned at home or on campus. One ask with `--ask` whose window is the block, followed up through the same check-in loop. | "You're out - is finish resume still happening, or did plans change? I'll update the calendar." |
| `blank` | No block now, and nothing known about what he is doing. | Anything on the calendar covering now, a logged block, a session. | One ask, by the blank table below. | Below. |

**How replies close a mismatch.** "Doing X instead" or "I'm at X" is logged (3.5), which **replaces** the planned
block (3.8) and closes its check-in. "10 min" or "after lunch" is a check-in `defer`. "Not today" or "skip it" is a
`cancel`: the block is displaced and the day is re-weighed (3.8). Giving up after the last level also counts as
displaced (3.4.3).

Blank asks (the old gap asks, now one mismatch type). Eligibility, all required: `sleep.state === "awake"`, not
inWindow; `session.state` in `none|unknown` (not rest: a break is for resting); not `calendar.now`, not `travelNow`;
`calendar.state === "ok"` (an unreadable calendar is not a blank); 09:00 to 22:00 local; and the blank backoff
allows it (3.4.3). `scripts/lib/curiosity/decide.mjs` keeps this table and replaces `gapQuestion` (`gap.mjs`):

| Type | Condition | Text (code template, his casual register) | Channel |
|---|---|---|---|
| `home-gap` | `atHome === true`, and nothing now, and `freeUntil - now >= 30` (or no next block) | "Nothing planned till 4 - what are you up to? Want me to put something there?" With an open top to-do (`rankTodo`, `gap.mjs:13-16`): "Nothing planned till 4 - what are you up to? I could put finish resume there." | auto (3.4.4) |
| `away-gap` | `location.state` is `known` (not home) or `elsewhere`, dwell >= 20 min, nothing on the calendar covering now | "What are you up to? I'll log it." With a known place: "At the gym? I'll log it." | auto (3.4.4; in practice the phone) |
| `unknown-place` | `elsewhere`, a new cell, dwell >= 20 min | "Where are you at? I'll log it." | auto, asked once per stay |
| `save-place` | `elsewhere`, same cell, dwell >= 90 min, **or** the 3rd separate day at that cell | "You've been here a while - want me to save this spot? What is it?" | auto, once per cell, then never if he says no |
| `fill-blank` (evening) | from the review (3.6): the largest unlogged, unanswered blank today over 45 min, once, 20:00 to bedtime minus 30 | "Quick one for tonight's review - what was 2 to 4? Gym, library, nothing?" | auto |

#### 3.4.3 Controls (these replace the 5-a-day cap and the "two ignored asks pauses it" rule)

State lives in `curiosity.json` (`{ asks: [{ askId, reachId, type, key, window, cell, at, answeredAt, outcome }],
blankGapMinutes, pausedUntil }`, C7) and, for mismatch loops, in `checkins.json` (the existing file).
1. **Safety ceiling, about 20 a day.** `life-config.json dailyReachCeiling` (default 20). `orion-reach` counts today's
   reached outreach rows whose `why` starts with `proactive:`, `plan:` or `curiosity:`. A reminder he set and the class
   rungs (`urgentKind`) are neither counted nor blocked. At the ceiling, everything else is dropped (not held) and
   recorded with reason `ceiling`, which `orion-doctor` shows. It is a runaway guard, not a target.
2. **Per-mismatch cooldown.** One live loop per key (`<type>-<blockId>`, or `<type>-<window>` for blanks). Follow-ups
   come only from that loop's own schedule: 10, 10, 5, 5 min (`follow-through.mjs:3`), or the deferred 5-45 min
   (`:39-44`). Nothing else may repeat the same mismatch in between. A plan loop stops after 5 alerts (not the 8 of a
   check-in he set, `orion-checkin:34`) with one closing line, "I'll stop pinging about finish resume - I've moved
   what I could.", and the block is treated as displaced (3.8).
3. **Backoff for blank asks only.** At least 60 min between blank asks; one per gap (`home-gap-<date>-<freeFrom>`) and
   one per stay (`away-<date>-<cell>-<since>`). A blank ask is "ignored" when no inbound turn (Mac or phone) arrives
   within 45 min. Each ignored blank ask doubles the gap (60, 120, 240, capped at 240); any answer resets it to 60.
   There is no pause. **Mismatch nudges are never backed off**: they keep following up until resolved, deferred,
   cancelled or given up.
- **Focus, sleep and class still defer.** Nothing from the loop is sent during focus (or the first 3 min of a pause),
  quiet hours, a class or a commute, except the class ladder's urgent rungs, as today. Nothing is held either (3.2):
  the loop re-evaluates at the phase hook (a break or the end) and on the next tick, so the nudge lands on the break
  with fresh facts. While gated, a check-in loop's tick is skipped (`orion-checkin:170-171`, generalised by `gate()`),
  so its level does not climb while he cannot act.
- "Leave me alone" or "stop asking" pauses blank asks for a day (`orion-awareness curiosity pause --days 1`). For an
  open mismatch it counts as `cancel` (plans changed), not as a mute.
- Never more than one line, never `--urgent` (except the class rungs), and never the same text twice within 2 h
  (`allowed()`, `route.mjs:38-47`, which also keeps its 6-an-hour burst limit).

#### 3.4.4 Delivery: the bubble always, voice only if home or headphones

`chooseChannel` (`route.mjs:16-27`) changes to:
- **At the Mac** (idle under 5 min, unlocked): always the bubble. ORION also speaks it (`mac-voice`, which shows the
  bubble and speaks, `AppState.swift:493-519`) only when `derived.speakOnMac` is true: `atHome === true` **or**
  `audio.mac.headphones === true`, and not late-awake. Home unknown on speakers means bubble only. The calendar-derived
  `out` no longer decides speech.
- **Away from the Mac**: a phone push (the "text"). The same bubble is also posted on the Mac, silently, so it is there
  when he is back. The reply links by id (3.5). If `audio.phone.headphones === true`, the push is marked
  time-sensitive so that iOS Announce Notifications can read it into his AirPods, but only if he has turned that on
  for ORION (an iOS setting, section 8).
- Quiet hours are unchanged: hold, or bubble only when he is up late at the Mac.
- The unanswered-spoken-question repeat (3.7) stays as designed: a question already spoken may be said once more.

**No LLM in the decision or the wording.** The templates are code. The only model in the loop is the normal chat turn
that handles his **reply**, which runs on the resident `qwen3.5:9b` exactly as today. Never `gpt-oss:20b`.

### 3.5 The reply path: from question to calendar block

1. **The ask carries a structured tag.** `orion-reach` gets `--ask '<json>'`, written into the `outreach.jsonl` row as
   `ask: { askId, type, window: { date, start, end|null }, place, cell }`. The outbox row carries `askId` and
   `category: "orion.ask"` to the phone.
2. **The phone shows a text-reply notification.** New category `orion.ask` with a `UNTextInputNotificationAction`
   ("Reply", placeholder "gym, library, nothing...") and one button, "Not now". It replaces the check-in buttons for
   `kind: question`. The reply goes as a chat record with `replyTo: <reachId>`, and so does a reply typed in the
   ORION chat while that alert is the latest.
3. **The link is explicit when there is an id, and timed when there is none.**
   - `CommandRunner` passes `--reply-to <reachId>` to `orion-remote handle`. On the Mac, the reply-to is the open
     spoken or bubble question (3.7).
   - `orion-remote` and `OutreachContext.swift` **share one rule**: exact id first, else the single latest non-held
     row within **25 min**, or within **90 min if the row carries an `ask`** (a text from away is answered late), only if
     no turn has happened since, and only once. This also fixes the phone path's 3-rows-from-6-h bug (1.5).
   - The context line names the ask: `[ORION context: 38 min ago you asked "What are you up to? I'll log it." (blank
     ask about 14:00-now, he is away). If he says what he did or is doing, log it.]`. For a mismatch nudge it names
     the block: `(finish resume, planned 14:00-16:00, not started)`, so "did gym instead" becomes `log gym --instead
     "finish resume"`.
4. **Logging is deterministic.** The plugin gets a new form step, `log`: `{ do: "log", what, from: "HH:MM", to:
   "HH:MM"|"now", where? }`. When an `ask` window is in context, `from` and `to` default to that window, so "gym" becomes
   gym from 14:00 to now. "was at the library since 2" becomes `from: 14:00, to: now`, and "gym 2-4" becomes a fully past
   block. "did gym instead of resume" adds `instead`. The routing gate adds a `LOGGING` pattern
   (`\b(i'?m|i am|was|been|just)\b.*\b(at|in|doing|since)\b`, `\binstead\b`, `since \d`, `from \d.* to \d`, or any reply
   when an ask is open).
5. `orion-reschedule log "<title>" --from HH:MM --to HH:MM|now [--where <placeId>] [--instead "<planned title>"]`
   creates the event with the tags `[orion:<kind>] [orion:logged]` (C5, C10). It accepts any interval **today, after
   04:00 and ending no later than now + 3 h**. It trims around fixed blocks and never overwrites one. **Reality
   replaces the plan** (Nick, decision 7): a movable block that overlaps the logged interval is replaced on the
   calendar (renamed in place when it covers the same slot, `rename` semantics, else trimmed or removed), so the
   calendar shows his real day, past blocks included. The slip is written to `slips.jsonl` (C10), not kept on the
   calendar. Then the day is re-weighed (3.8).
6. "nothing" or "just chilling" logs **nothing** (Nick, decision 6): the ask is closed with `outcome: "nothing"` and
   its window recorded, so the review shows that blank as answered ("free") and never asks about it again. "not now"
   closes the ask with `outcome: "declined"`, which **does not** count as ignored.
7. "put gym there" (home-gap) is an ordinary `add`, as today.

### 3.6 The nightly review reads reality

- `day-review.mjs` gains `actualDay({ blocks, focusHistory, attendance, slips, asks, now })`. Its inputs: logged blocks
  (tag `logged`), real calendar blocks with attendance evidence, focus sessions served (`focus-history.jsonl`), the
  planned ORION blocks, `slips.jsonl` (what reality replaced or the replan bumped, 3.8) and the curiosity ledger's
  answered blanks. The result has four lists: **done** (logged, served focus, attended), **slipped** (from
  `slips.jsonl`, plus planned blocks still on the calendar with no evidence), **free** (blanks he answered "nothing")
  and **blank** (an interval over 30 min, between 08:00 and now, with no block, no session and no answer) shown as
  "unknown", never as "nothing".
- New `scripts/orion-day-review [--json] [--send]`. It runs at bedtime minus 30 min, from orion-proactive with key
  `review-<date>`. One merged message: "Today: CS1800, gym 2-4 (instead of finish resume), 1h40 focus. Slipped:
  YouTube (bumped for finish resume). 5-6 unknown." The one `fill-blank` ask (3.4) runs before it, so the review is
  accurate.
- **Delivery (Nick, decision 8): spoken if he is home, a text otherwise.** `atHome === true`: `orion-reach --channel mac
  --loud --listen` (the morning brief's path, so the calendar-derived `out` cannot silence it), which speaks and
  shows the bubble. `atHome` false or unknown: `--channel phone`, a push to his own phone only. Quiet hours and
  focus still gate it like anything else; if gated, the review waits for the next eligible tick that evening.

### 3.7 The unanswered spoken question

A new pure policy in the app, `SpokenQuestionFollowUp` (a value type, clock-injected, in the shape of `TurnTakingState`):

- **Arm** when an ORION utterance that was spoken aloud ends in `?` (after trimming quotes and emoji), or when a
  `deliverReach` has `listen: true` or `ask`. Record `{ text, spokenAt, reachId? }`.
- **Answered** when any user turn starts (voice or typed, Mac or phone): disarm.
- **At 20 s** after speech ended with no answer (the existing 6 s follow-up window lapses into `endConversation()` at
  `AppState.swift:1677`, and the policy keeps its own deadline):
  - if `IdleReading.current() < 20` and the screen is unlocked (he is at the Mac): show the question **prominently**
    (summon the hologram with the bubble, `reachMessage`, and keep it for 10 min instead of 120 s) and **say it once
    more**, prefixed: "Nick? Sure, what would you like to add before your first class?". Then reopen the follow-up ear
    (`beginListening(handsFree: true, followUp: true)`) with a 10 s grace;
  - otherwise (idle 20 s or more, locked, or asleep): **send it to the phone**, with
    `orion-reach "<question>" --kind question --channel phone --ask '{"type":"voice-repeat"}' --why "unanswered spoken
    question"`. The row then lands in `outreach.jsonl`, and the reply links back through 3.5 (90-min ask window).
- **Never more than one repeat**: after the repeat (either branch) the policy is spent for that question. A second
  silence closes it quietly.
- It respects the gate: if a focus session started in the meantime, the phone repeat is held like anything else (the
  question came from his own request, but a held copy is pointless), so it is dropped instead (`--no-queue`).
- The 20 s timer is a wall-clock `DispatchSourceTimer`, not a run-loop timer, so it fires while the panel is hidden.

### 3.8 Reality replaces the plan, then replan by weight

Nick: when he says he did X instead of a planned block, even one already past, X replaces the block so the calendar
reflects his real day; then ORION re-weighs, and if the displaced item outranks something still ahead today, the rest
of the day is reshuffled so the most important things remain. The gym and similar must-haves are planned daily and
fitting them in is near-mandatory. All of this goes into `orion-reschedule` and `replan.mjs` (audit, 1.9), not a new
engine.

**1. One weight, computed in code.** New `weightOf(block, config) -> { rank, score }` in `scripts/lib/life/priority.mjs`,
with ranks `fixed` (0), `must` (1), `high` (2), `medium` (3), `low` (4). Evidence, first match wins:
- a real class (`kind === "class" && fixed && source !== "orion"`) is `fixed`; any other fixed block is `fixed`;
- the block's stored rank tag (`rank-<r>`, point 2), written when it was booked from `orion-tasks --priority`, a must
  word, or an anchor;
- an anchor from `life-config.json anchors` (point 5) is `must`;
- his saved words, `config.ranks` (today's `rankOf` lookup, `priority.mjs:77-78`), so `gym: high` finally counts;
- title words: "must", "have to" and the rest give `must`; "if there's time", "optional" give `low` (today's
  `importanceOf` regexes, `:26-27`);
- the kind default, aligned with SCHEDULING.md (`:92-107`): sleep, gym, deadline and study `high`; to-dos (`other`),
  side project and meals `medium`; rest and breaks `low`.

`rankOf` becomes a wrapper over `weightOf` (the prompt text in `orion-remote:567-581` is unchanged). `priorityOf` is kept
only as the tie-break inside one rank. In `replan.mjs:145-146` the order becomes **score, then existing before fresh,
then `priorityOf`, then time**, so a high-rank new item beats a medium existing one, and the `keepFree` bypass
(`:157`) and the "must-haves could not fit" report (`orion-reschedule:982-990`) key on rank `must` (today: importance 0).

**2. The weight survives the calendar.** `Bridge.swift` create (`native/OrionMacBridge/Sources/OrionMacBridge/Bridge.swift:437-440`)
accepts `orionTags` (at most 4, each `^[a-z0-9_-]{1,20}$`) and writes `[orion:<kind>] [orion:<tag>] ...`, kind first.
The read (`:257-259`) keeps `orion` (the first marker, so `GlanceExport.swift:62` and old readers are unchanged) and
adds `orionTags` (every marker). This is also what makes `[orion:logged]` visible at all: today only the first marker
is returned. `calendar-write.mjs` passes the tags (`:50,:66,:78`) and `live-day.mjs toBlocks` (`:47-56`) returns
`tags`, `logged` and `rank`. Tags in use: `logged`, `anchor`, `rank-must|high|medium|low`.

**3. Log replaces the plan** (`orion-reschedule log`, 3.5 step 5):
1. The displaced blocks are the movable blocks overlapping `[from, to]`, or the block named by `--instead`.
2. On the calendar: a block covering the same slot is renamed in place and retagged `logged` (today's `rename`); a
   partial overlap is trimmed to the part outside and the logged event is created; a fully covered block is removed and
   the logged event created. Fixed blocks are never touched; the logged event is trimmed around them.
3. A slip row goes to `~/.openclaw/orion-controlled/slips.jsonl`: `{ date, at, planned: { title, start, end, kind,
   rank }, missedMinutes, replacedBy, reason: "reality" }`. The calendar keeps no trace of the plan; the review does.
4. The day is re-weighed (point 4) unless `--no-replan`. Everything is one undo transaction (`calendar-write.mjs applyPlan`).

**4. Re-weigh the rest of today.** The displaced item's missed minutes (at least its saved minimum, `minimums`) re-enter
as one flexible, **non-fresh** item with `after = now`, into a `rebuild: true` replan of the rest of today. That is the
call `now` already makes (`orion-reschedule:412-415`), with the displaced item added to its `flexible` list, which
today never happens for a past block (`replan.mjs:75`). Then:
- if it outranks something still ahead, the lower item is unplaced and removed, and gets a slip row with
  `reason: "bumped:<title>"`; the displaced item takes the room. It displaces **strictly lower** ranks only: at equal
  rank it goes in only if there is free room;
- if nothing lower is ahead and there is no room, it stays off today (slip `reason: "no-room"`). A to-do is picked up
  again by `orion-tasks plan`, which `orion-watch` already runs daily (`orion-watch:154-160`);
- fixed blocks, travel walls and times he stated stay put (`replan.mjs` walls and pinned, unchanged); a `must`
  block is never bumped; a displaced `low` item (a missed break) is not re-entered at all;
- one message says what changed, through `orion-reach --kind update` (so the gate applies): "Logged gym 2-4. Finish
  resume moved to 7-9; YouTube is off today."

The same re-weigh runs when a not-started loop ends in `cancel` or gives up (3.4.3), and on "skip it".

**5. Daily anchors: the gym is planned every day and is near-mandatory.** New `life-config.json anchors`:
`[{ title: "Gym", kind: "gym", minutes: 60, days: [1,2,3,4,5,6,7], rank: "must" }]`. It replaces `gymDays` and
`gymMinutes` (`config.mjs:13`); when `anchors` is absent it is derived from them, so nothing breaks before Nick sets it.
The days and length are his call (section 8); the default proposed here is every day, 60 min.
- **Planned automatically.** New `orion-reschedule fill --anchors [--date]` (C11): for each anchor due that day and
  not on the calendar, add it with tags `anchor` and `rank-must` through the same rebuild replan, so it can bump
  lower-ranked movable blocks but never a fixed block or a time he stated. `orion-proactive` calls it once a day
  (key `anchors-<date>`) as soon as he is awake, and again after any replan that removed an anchor.
- `fillDay` adds anchors first and exempts them from `freeMinutesKept` (`fill-day.mjs:39-45`). `day --fill` stops
  freezing every existing block as fixed for `must` asks (`orion-reschedule:966`): those go through the rebuild replan.
- If the fixed day truly has no room, it is never silently dropped: it is reported as a must-have that could not fit
  (`orion-reschedule:990`) and the plan loop asks once, "No room for the gym today - skip it, or drop something?".
- The plan loop (3.4.2) nudges a not-started anchor like any `must` block.

**6. SCHEDULING.md** (`~/.openclaw/workspace/SCHEDULING.md:92-116`, not in the repo) is updated to name the five ranks
and the anchors, and to say the code enforces them, so the model does not reason its own ranking.

## 4. Exact changes per file

**Precondition:** merge `fix/proactive-2026-10-16` and `ui/audit-2026-10-16` into `main` first. Both touch
`scripts/orion-reach`, `native/Orion/Sources/Orion/AppState.swift` and `native/OrionLink/App/LinkEngine.swift`, and the
proactive branch has the newer orion-reach. Every package below branches from that merge.

### 4.0 Frozen contracts (all packages code against these, and fixtures use them)

- C1 `awareness.json` schema (3.1, including the `audio` facet and `derived.speakOnMac`), plus `readAwareness({ dir, now, maxAgeMs }) -> aw`, which applies staleness and returns
  `unknown` facets. Location: `scripts/lib/awareness/state.mjs`.
- C2 `gate(aw, { kind, urgentKind, now }) -> { action, reason, heldFor }` in `scripts/lib/reach/gate.mjs` (3.2).
- C3 `orion-awareness phase --from <s> --to <s> --session '<json>'`. It refreshes awareness, then releases if eligible.
  `orion-reach --drain-held --reason break|end|wake`.
- C4 An outreach row's `ask` field and the `--ask '<json>'` flag on orion-reach. The outbox row gets `askId` and
  `category`. The phone reply carries `replyTo`. `orion-remote handle --reply-to <reachId>`.
- C5 `orion-reschedule log "<title>" --from HH:MM --to HH:MM|now [--where id] [--instead "<title>"] [--no-replan]`, tag
  `logged`. It replaces overlapping movable blocks, writes `slips.jsonl`, and re-weighs (3.8). Exit 0 changed, 1 refused
  (prints why), 2 usage; stdout's last line is the one-message summary.
- C6 `known-places.json` schema (3.3) and `LinkLog.place(event: "enter"|"exit", placeId, at)`, landing in
  `health-log.json placeEvents` (last 500).
- C7 `curiosity.json` ledger schema (3.4.3, `outcome` includes `nothing`). `orion-awareness curiosity pause --days N`.
- C8 `day-review.mjs` exports `actualDay(...)` and `blanks(day, { now, minMinutes })`.
- C9 Plan check-ins: `orion-checkin add <min> "<what>" --by orion --block <blockId>`; `orion-checkin started|cancel
  <id>` as today. A check-in with `block` is a plan loop: at most 5 alerts, and its alerts are sent through
  `orion-reach --kind checkin --why "plan: <blockId>" --ask '{"type":"mismatch","blockId":...,"window":...}'` (so the
  gate, the 3.4.4 channel rule and the ceiling apply) instead of the LinkEngine alerts outbox. On give-up or cancel it
  calls `orion-reschedule displace "<title>" --why cancel|gave-up` to re-weigh the day (C11).
- C10 Weight and tags: `weightOf(block, config) -> { rank: "fixed"|"must"|"high"|"medium"|"low", score: 0-4 }` in
  `scripts/lib/life/priority.mjs`; bridge `orionTags` on create and in reads; blocks from `live-day.mjs` carry `tags`,
  `logged`, `rank`; `slips.jsonl` row schema (3.8 point 3).
- C11 `orion-reschedule fill --anchors [--date]` and `orion-reschedule displace "<title>" [--why ...]` (re-weigh a
  block that will not happen); `life-config.json anchors` and `dailyReachCeiling` schema (3.8 point 5, 3.4.3).
- C12 `orion-proactive tick [--reason tick|phase|place]`: `orion-awareness` spawns it detached (debounced 60 s) after
  a phase hook or a place event, so the loop reacts at once.

### 4.1 WP1, awareness core (scripts)

- NEW `scripts/lib/awareness/state.mjs`: `readAwareness`, `writeAwareness` (lock, tmp+rename), and the staleness table.
- NEW `scripts/lib/awareness/facets.mjs`: pure composers `sessionFacet(statusJson)`, `calendarFacet(day, travel, now)`,
  `macFacet(focusActivity, lockFlag, now)`, `phoneFacet(healthLog, now)`, `sleepFacet(...)` (moved from
  `presence.mjs quietFacts`), `locationFacet(samples, placeEvents, knownPlaces, now)`, `audioFacet(focusActivity,
  phoneSignals, now)` (3.1, the headphones facet), and `derive(aw)` (including `speakOnMac`).
- NEW `scripts/lib/awareness/places.mjs`: `distanceM`, `matchPlace`, `learnHome(samples)` (overnight charging cluster),
  `readKnownPlaces` and `writeKnownPlaces`.
- NEW `scripts/orion-awareness`: `refresh [--session json]`, `show [--json]`, `phase --from --to --session`
  (refresh, then always spawn `orion-reach --drain-held --reason break|end`. orion-reach (WP2) decides through `gate` whether anything is released, so WP1 never imports `gate.mjs`),
  `place learn|set <id> --here|list|forget <id>`, `curiosity pause --days N`. After `phase` and after a place event it
  also spawns `orion-proactive tick --reason phase|place` detached, debounced 60 s (C12). Test seams: `ORION_REACH_NOW`,
  `ORION_CONTROLLED_DIR`, `ORION_SESSION_SOCKET`.
- EDIT `scripts/lib/reach/presence.mjs`: `presence()` becomes an adapter over `readAwareness`, and `where` defaults to
  `"unknown"`, not `"home"`. `quietFacts` moves to facets, re-exported for its existing tests.
- EDIT `scripts/lib/reach/focus-hold.mjs`: `isSessionActive(s)` is true only for `running` + `phase: "focus"`, and
  for `paused` under 3 min. Add `sessionState(s)` returning focus|rest|paused|waiting|none|unknown. `activeSession`
  first reads awareness when its session facet is fresh (90 s), then the socket.
- EDIT `scripts/lib/reach/facts.mjs`: `gather()` first reads `focus-activity.json` (idle, front app) and the new
  `locked`/`displayAsleep` fields (WP4 adds them). It keeps `ioreg` as the fallback. Headphones come from
  `focus-activity.json audio` (WP4); `system_profiler` is only the fallback when that is stale, and `parseHeadphones`
  stops counting AirPlay as headphones (`:17`). Volume is read only when `{ audio: true }` is asked for.
- EDIT `scripts/orion-presence`: print awareness (`--json` unchanged in shape, plus an `awareness` key).
- NEW tests `tests/awareness-state.test.mjs`, `tests/awareness-facets.test.mjs`, `tests/awareness-places.test.mjs`,
  `tests/awareness-cli.test.mjs`.

### 4.2 WP2, delivery: defer, don't drop (scripts senders)

- NEW `scripts/lib/reach/gate.mjs` (C2).
- EDIT `scripts/lib/reach/held.mjs`: entries keep `heldFor`, `validUntil` and `kind`. `mergeHeld(entries, { reason })`
  uses the templates in 3.2 ("While you were focused: ...", at most 3 lines, then "+N more in chat"). An entry with
  `kind: "question"` and an `ask` is never merged (it is dropped as stale).
- EDIT `scripts/orion-reach`: replace `:80-91` with `gate(readAwareness(...))`. Add `--ask '<json>'` (stored on the
  row and the outbox, C4), `--reason` for `--drain-held`, and `--valid-until ISO`. A held question with an `ask`
  is not queued (as `--no-queue`). Keep exit codes 0/3/4.
- EDIT `scripts/lib/reach/route.mjs`: `chooseChannel` takes awareness-derived facts (`atMac`, `atHome`,
  `speakOnMac`) and applies 3.4.4: at the Mac, the bubble always, voice only if `speakOnMac`; away, the phone. The
  calendar-derived `out` no longer decides speech. `allowed()` is unchanged (2 h duplicate, 6 an hour).
- EDIT `scripts/orion-reach` (continued): the daily ceiling (3.4.3, `dailyReachCeiling`, exit 3 with reason `ceiling`);
  a phone delivery also posts the same row to the Mac as a silent bubble (`orion://reach`, whose `channel` is not
  `mac-voice`, so `AppDelegate.swift:176` shows it without speaking; no Swift change); `timeSensitive: true` on the
  outbox row when `audio.phone.headphones === true`; `entry.headphones` comes from the audio facet.
- EDIT `scripts/orion-checkin`: in `tick`, `gate()` for each alert. A check-in he set (`by: "nick"`) is
  `urgentKind: "reminder"`, and an ORION one is not. Held alerts go to `held.jsonl` with `via: "alerts-outbox"`
  (already understood by `releaseHeldAlerts`, `held.mjs:64-71`). Quiet hours now apply (G10). Plan check-ins (C9):
  `add --block <id>`, a 5-alert cap for them, and their alerts go through `orion-reach --kind checkin --why "plan:
  <blockId>" --ask ...` instead of stdout for LinkEngine; on give-up or cancel, `orion-reschedule displace` (C11).
- EDIT `scripts/orion-notify`: `:413` and `flush :362-385` use `gate`. The fixed 23:00-08:00 becomes `sleep.state`.
- EDIT `scripts/orion-watch`: `:209-223` uses `gate` (class alerts keep `urgentKind: "class"`).
- EDIT `scripts/orion-standing`: an urgent finding that is not a class is sent with no bypass (`:842-858`). Its
  quiet test becomes `gate`.
- NEW tests `tests/delivery-gate.test.mjs`, `tests/delivery-release-on-break.test.mjs`,
  `tests/delivery-senders.test.mjs` (each sender, held vs delivered, with a fake awareness file).

### 4.3 WP3, the plan-vs-reality loop, curiosity and the nightly review (scripts)

- NEW `scripts/lib/curiosity/loop.mjs` (`planVsReality(...)`, 3.4.1-3.4.2: should vs is, the four mismatch types,
  evidence rules), `scripts/lib/curiosity/decide.mjs` (the blank asks, 3.4.2), `scripts/lib/curiosity/ledger.mjs`
  (read, write, `recordAsk`, `markAnswered` from `outreach.jsonl` and the turn logs, the blank backoff 60/120/240,
  outcome `nothing`), `scripts/lib/curiosity/words.mjs` (templates; `hm` "till 4" style, `spokenClock` from
  `morning.mjs:61-66`).
- EDIT `scripts/lib/reach/gap.mjs`: keep `rankTodo` (used by words.mjs). `gapQuestion` is deleted. Its callers move to
  curiosity.
- EDIT `scripts/lib/reach/class-ladder.mjs`: "not left" reads `atHome === true` when known, with `leftAt` as the
  fallback (`:24,:45`); `leave-late` also for non-class fixed destinations, as a plain reminder without `urgentKind`
  (`:36-52`).
- EDIT `scripts/lib/reach/proactive.mjs`: `busy` becomes `session.state in focus|rest|paused`. `away` becomes
  `atHome === false`, with unknown not counted as away for bedtime, where the bedtime rule asks "not at home" only
  when known. The gap block (`:60-65`) is removed. Add a session-done line that accepts merged held text (3.2).
- EDIT `scripts/orion-proactive`: read awareness (drop its own presence and session spawns, `:56-65`); accept
  `--reason` (C12); run `planVsReality()` and act: class ladder as today, `orion-checkin add 0 ... --by orion --block`
  for `not-started`, `orion-reach --kind question --ask ...` for `off-plan` and blanks; once a day when he is awake,
  `orion-reschedule fill --anchors` (key `anchors-<date>`, C11); at bedtime minus 30, `fill-blank` then
  `orion-day-review --send` (key `review-<date>`); the release block (`:119-123`) becomes one call to
  `orion-reach --drain-held --reason end` when `gate` says deliver (a backstop for when the app hook was missed).
- EDIT `scripts/lib/life/day-review.mjs`: `actualDay`, `blanks` (C8); reads `slips.jsonl` and answered blanks;
  `reviewDay` uses them; blank is "unknown", an answered "nothing" is "free".
- NEW `scripts/orion-day-review` (`--json`, `--send`: `--channel mac --loud --listen` when `atHome === true`, else
  `--channel phone`, 3.6).
- NEW tests `tests/curiosity-loop.test.mjs` (each mismatch type, its evidence, unknown is never a mismatch),
  `tests/curiosity-decide.test.mjs` (blank eligibility table), `tests/curiosity-controls.test.mjs` (per-mismatch
  cooldown, blank backoff and reset, no pause after ignores, decline vs ignore, "stop asking"),
  `tests/curiosity-tick.test.mjs` (orion-proactive with temp HOME, fake session server, fake bridge, fake awareness),
  `tests/day-review-actual.test.mjs`.

### 4.4 WP4, Mac app (Swift, `native/Orion`)

- EDIT `Sources/Orion/AppState.swift`:
  - in `session.onChange` (`:922-934`), keep the last `(statusTag, phaseKind, phaseIndex)`; on change, call `PhaseHook.fire(from:to:snapshot:)`;
  - `deliverReach` (`:493-519`) arms `SpokenQuestionFollowUp` when `listen`, `ask` or the text ends with `?`;
  - `speak(_:origin:)` arms it for voice replies that end with `?`;
  - `endConversation()` (`:1700`) and the start of each turn notify the policy;
  - `reachClear` keeps a repeated question's bubble for 10 min.
- NEW `Sources/Orion/PhaseHook.swift`: builds the session JSON and spawns `orion-awareness phase ...` detached
  (`Process`, 30 s kill, the same env as LifeWatch), and logs `[phase] focus->rest hook ok|failed`.
- NEW `Sources/Orion/SpokenQuestionFollowUp.swift`: a pure policy (arm, answered, tick(now, idle, locked) ->
  `.none|.repeatAloud(text)|.sendToPhone(text)`, at most one repeat) plus a thin driver with a `DispatchSourceTimer`.
  The phone branch spawns `orion-reach ... --channel phone --kind question --ask '{"type":"voice-repeat"}'`.
- EDIT `Sources/Orion/ScheduleFocusWatcher.swift`: add `locked`, `displayAsleep` (from `CGSessionCopyCurrentDictionary`,
  as `Sensors.swift:73-81` does), `bundleID` and `audio: { route, device, headphones }` to `focus-activity.json`, and
  write `idleSeconds: null` when invalid (not `0`: unknown is unknown).
- EDIT `Sources/Orion/AudioRoute.swift`: add `outputRoute()` next to `isBluetooth` (`:144-148`): bluetooth, wired
  (built-in transport with data source `hdpn`), airplay, speakers, plus the device name (3.1). `currentOutputRouteKind`
  (`AppState.swift:1181-1186`) can use it unchanged in meaning.
- EDIT `Sources/Orion/OutreachContext.swift`: parse `ask` and `why`; window 25 min, or 90 min with `ask`; prefer an
  explicit `replyTo` (set by `SpokenQuestionFollowUp` while armed); the label names the ask window (3.5).
- EDIT `Sources/Orion/GatewayClient.swift`: pass the label through, unchanged otherwise.
- EDIT `Sources/Orion/LifeWatch.swift`: run `orion-awareness refresh` before `orion-proactive tick`.
- NEW tests in `Tests/` (the existing `ProactiveAudit20261016Tests.swift` pattern): `PhaseHookTests`,
  `SpokenQuestionFollowUpTests`, `OutreachContextAskTests`, `AudioRouteTests` (route classification from transport and
  data source values).

### 4.5 WP5, phone and link (Swift `native/OrionMobile`, `native/OrionLink`) plus the reply-to plumbing

- EDIT `OrionMobile/App/PhoneSignals.swift`: queue entries when `log == nil` (persisted in the app group, flushed by
  `CloudLink.sendNow`, the `NightRoutine.record` pattern), so background significant-change samples arrive; `stop()`
  stops monitoring. `send` adds the audio route from `AVAudioSession.sharedInstance().currentRoute.outputs` (3.1), and
  a `routeChangeNotification` observer sends one extra sample on a headphones connect or disconnect.
- NEW `OrionMobile/App/PlaceMonitor.swift`: reads known places from the snapshot (C6), runs a `CLMonitor` with
  circular conditions (at most 20), and sends `LinkLog.place` enter/exit through the same queue. It needs "Always",
  which `PhoneSignals` already requests.
- EDIT `OrionMobile/Sources/MobileCore/LinkSnapshot.swift`: add the `LinkLog.place` case (validated, rounded),
  `knownPlaces` in the snapshot, and an optional `audio` on `.signal` (`:371`, validated against
  `bluetooth|wired|speaker|unknown` at `:408-414`; old payloads without it still decode).
- EDIT `OrionMobile/App/OrionMobileApp.swift`: register the `orion.ask` category (`UNTextInputNotificationAction` "Reply"
  plus "Not now") **merged** with the existing categories (fixing the replace-all ordering race with `orion.night`).
  `didReceive` for `orion.ask` sends a chat with `replyTo` (or a decline log).
- EDIT `OrionMobile/App/CloudLink.swift`: the alert subscription passes `category` from the record (`orion.ask` for
  questions, `orion.checkin` otherwise). Add `replyTo` to chat sends.
- EDIT `OrionLink/Sources/LinkCore/TrackingLog.swift`: apply `.place` to `placeEvents`; keep `audio` on
  `phoneSignals` rows.
- EDIT `OrionLink/App/LinkEngine.swift`: the outreach outbox carries `category`/`askId` onto the LinkAlert, and
  `timeSensitive` maps to the time-sensitive level (`OutboxClaim.swift:43-45`, ui-audit f6397c3); after a
  `signal`/`place` log, spawn `orion-awareness refresh` (debounced 10 s); publish `known-places.json` into the snapshot.
- EDIT `OrionLink/Sources/LinkCore/CommandRunner.swift`: pass `--reply-to <id>` when the chat record has `replyTo`.
- EDIT `scripts/orion-remote`: `--reply-to`; `recentOutreach()` (`:586-594`) adopts the shared rule (exact id, else
  the single latest within 25/90 min, no turn since, once; the turn record goes in `outreach-consumed.json`).
  `watchQuestion()` gets the same 90 min.
- NEW tests `OrionLink/Tests/LinkCoreTests/PlaceLogTests.swift`, `OrionMobile` MobileCore tests for `LinkLog.place`
  and `.signal` `audio` validation, and `tests/remote-outreach-reply-to.test.mjs`.

### 4.6 WP6, reality replaces the plan and replan by weight (scripts, plugin, bridge)

This is its own package. The `log` work that was "WP3 part 2" moved here, because `log`, the replace and the
re-weigh all live in `orion-reschedule`. That keeps WP3 and WP6 on disjoint files. `day-review.mjs` and
`orion-day-review` moved to WP3, since they only read C8 and C10 data.

- EDIT `scripts/lib/life/priority.mjs`: `weightOf` (C10, 3.8 point 1). `rankOf` wraps it, `priorityOf` stays as the
  tie-break, and `importanceOf` stays for its callers but is fed by `weightOf`.
- EDIT `scripts/lib/life/replan.mjs`: order by weight score, then existing before fresh, then `priorityOf`, then time
  (`:145-146`). The `keepFree` bypass and must-have reporting key on rank `must` (`:157-159`). Accept displaced items
  (`displaced: [{ block, minutes }]`) as non-fresh flexible items with `after = now`. A displaced item may bump only
  strictly lower ranks, and never a `must`.
- EDIT `scripts/orion-reschedule`:
  - `log` (C5, next to `now`, `:380-420`) with the replace, the `slips.jsonl` rows, the re-weigh and
    `touch awareness.dirty`;
  - `displace "<title>" --why` (C11);
  - `fill --anchors` (C11), through the rebuild replan so anchors can bump lower ranks;
  - `day --fill` stops freezing existing blocks for `must` asks (`:966`);
  - rank tags on every block it books (`:596,:771,:782` already compute importance; now it is stored).
- EDIT `scripts/lib/life/fill-day.mjs`: anchors go first and are exempt from `freeMinutesKept` (`:29,:39-45`).
- EDIT `scripts/lib/life/config.mjs`: `anchors` and `dailyReachCeiling` defaults and validators (next to `:58-59`).
  When `anchors` is absent, it is derived from `gymDays`/`gymMinutes`.
- EDIT `scripts/lib/life/calendar-write.mjs`: pass `orionTags` (`:50,:66,:78`).
- EDIT `scripts/lib/life/live-day.mjs`: `toBlocks` (`:47-56`) returns `tags`, `logged` and `rank` from `orionTags`.
- EDIT `native/OrionMacBridge/Sources/OrionMacBridge/Bridge.swift`: write `orionTags` on create (`:437-440`), return
  all markers as `orionTags` on read (`:257-259`), and keep `orion` as the first marker.
- EDIT `plugin/orion-control/src/schedule-flow.ts`: a `log` step in `Intent.do` (`:20`) and the schema enum (`:46`).
  Prompt examples: "i'm at the gym", "was at the library since 2", "gym 2-4", "did gym instead of resume", and
  "nothing really", which logs nothing. `compile()` produces `["log", what, "--from", hh, "--to", hh|"now"]`, plus
  `"--instead", title` when given. When the outreach label carries an ask window or a mismatch block, those are the
  defaults.
- EDIT `plugin/orion-control/src/local-routing.ts`: a `LOGGING` pattern, and an open ask in context routes to the
  flow (`:714`).
- EDIT by hand, outside the repo: `~/.openclaw/workspace/SCHEDULING.md:92-116` gets the five ranks, the anchors, and
  a note that the code enforces them (3.8 point 6).
- NEW tests:
  - `tests/life-weight.test.mjs`: the `weightOf` evidence order; `ranks.gym` counts; a rank tag survives a round-trip.
  - `tests/life-replan-weight.test.mjs`: a displaced high item bumps a later medium one; an equal rank does not; a
    `must` is never bumped; a fixed block never moves.
  - `tests/life-reschedule-log.test.mjs`: replace in place, partial trim, a fully past block, slips rows, one undo.
  - `tests/life-anchors.test.mjs`: the gym is planned on every anchor day, bumps a low block, and is reported when
    the fixed day has no room.
  - `plugin/orion-control/src/schedule-flow-log.test.ts`, and an OrionMacBridge test for writing and reading tags.

## 5. Edge cases

| Case | Behaviour |
|---|---|
| **Stale data** | Each facet past its limit (3.1) is `unknown`. Unknown never means "home", "free", "asleep" or "attended". `gate()` with an unknown session delivers (the app is down, so no session is enforced). Curiosity with an unknown calendar or location does not ask the location-specific types. A home-gap needs `atHome === true`, and an away-gap needs a known non-home or `elsewhere`. |
| **Phone off, dead or no signal** | No samples, no region events, so `location` goes `unknown` after 20 min (a sample) or 12 h (a region state). No away questions are sent. Pushes queue in CloudKit; the next time it is on, only the newest ask is still valid (an ask has `validUntil` = window end + 30 min, and the phone hides expired ones on delivery through the NotificationService extension). |
| **Mac off, asleep or app down** | `mac.state` is `unknown`; `atMac` false; routing goes to the phone (as today when locked). The phase hook cannot fire, but no session runs without the app either. The `orion-proactive` backstop release covers a missed hook. |
| **Travel or another city** | `location.json` time zone changes are handled by `orion-timezone`. Known places are coordinates, so away from all of them is `elsewhere`. Curiosity `save-place` is suppressed when more than 50 km from home (a trip, not a new local spot); `away-gap` stays, which is still useful for the review. Day boundaries follow the local clock (`localDate`). |
| **All-nighters** | The sleep window opens, but Mac input or phone motion means `late-awake`: not `asleep`, so nothing is held for quiet. Blank asks stay off from 22:00 (it is not the time to ask "what are you up to"), and bedtime lines own that space. The day review runs once per `review-<date>` key, where the night belongs to the evening it started (the `dayKey` rule, `orion-proactive:39`). |
| **Breaks shorter than the poll** | Release comes from the app's phase edge (C3), not the 5-min tick, so a 2-min break still gets "While you were focused: ...". With an empty queue, nothing is sent. If the hook spawn fails, the next tick's backstop releases it at the next eligible state. That may be the end of the session, which is the accepted degradation. |
| **Rapid phase flapping** (skip break, shorten) | Release is idempotent: the queue is cleared under its lock, so a second drain finds nothing. Hook spawns are debounced to one in flight. |
| **waiting-for-return** (a break ended while he was away) | Deliver to the phone (he is not at the Mac). The app's own "come back" handling is unchanged. |
| **A class during a session** | The class ladder is `urgentKind: class`, so it interrupts (unchanged). |
| **He answers a blank ask after the blank is over** | The ask window is honoured (3.5 step 4): "gym" at 16:20 to an ask about 14:00-now logs 14:00-16:20, unless he gives times. |
| **Two open asks** (an away text unanswered, then a spoken question) | The explicit `replyTo` wins. Without one, the newest row is used (one row only, as today). |
| **Answer with a place he has not saved** | The log uses his words as the title. If an `unknown-place` ask was open and the reply names a place ("the library"), the plugin offers once: "Want me to save this spot as the library?". That is the `save-place` follow-up, never a second question in the same message. |
| **Home not confirmed yet** | `atHome` null: no home-gap or away-gap asks, only `unknown-place` when far (more than 1 km) from the proposed home candidate, and the one "is this home?" question. Nothing is spoken on the Mac speakers (3.4.4) unless headphones are on, and the review goes as a text. "Not left" for the leave ladder falls back to `leftAt`, as today. |
| **Mismatch evidence is unknown** (phone stale, Mac idle, no session) | Unknown is never evidence of a mismatch, and never evidence that all is fine. `not-started` for a block with no possible evidence (a to-do away from the Mac, phone stale) still nudges once at level 1 as a question ("Finish resume was down for 2:00 - how's it going?"), and climbs only if he does not answer. |
| **Several mismatches at once** | One message per tick: the highest-weight block's loop goes first (a class ladder rung always wins); the others wait for the next tick. Each keeps its own cooldown. |
| **The ceiling is reached** | Only reminders he set and the class rungs still go out. The day's later mismatch nudges are dropped and logged as `ceiling`; the review still lists the slips. |
| **He logs something over a block he already did** | The planned block has evidence (session served, attended): `log` refuses to replace it and asks which one is right. Done work is never overwritten. |
| **Re-weigh would move something he set himself** | His stated times are pinned walls in `replan` (unchanged): never moved. Only ORION-planned movable blocks are bumped, and every bump is named in the one message and in `slips.jsonl`. `undo` restores the whole change. |
| **Headphones on the phone, Mac on speakers** | The Mac does not speak: the AirPods are not in his ears for the Mac (3.1). Away from the Mac, the push is time-sensitive so iOS Announce can read it, if he enabled that. |
| **Privacy** | Coordinates stay rounded (3 dp, about 110 m) and on his own CloudKit and Mac. `known-places.json` holds only places he confirmed. No coordinates go in logs, and messages never contain coordinates. |

## 6. Test plan

All script tests are `node:test` in `tests/`, with **a temp HOME** (`mkdtempSync`) and `ORION_CONTROLLED_DIR`,
`ORION_LIFE_CONFIG`, `ORION_SESSION_SOCKET` and `ORION_REACH_NOW` pointed into it, following
`tests/proactive-focus-hold.test.mjs:14-33`.

Fakes:
- `tests/fixtures/fake-session-server.mjs` (exists). Rewrite its reply file to move focus to rest to none.
- `tests/fixtures/fake-bridge.mjs` (exists): calendar in `$FAKE_CALENDAR`, reminders in `$FAKE_REMINDERS`. Add `log`
  support only through orion-reschedule, which already uses the bridge.
- Awareness fixtures: each package's tests write `awareness.json` as a literal object that follows C1 (fresh or with
  old `at` stamps). There is no shared fixture module, so WP2 and WP3 never depend on WP1's files or on each other.
- NEW `tests/fixtures/health-log.mjs` (WP1 owns it): samples and place events at given local times (all coordinates synthetic, never
  his real ones).
- The fake `open` bin (exists) for Mac channels. `ORION_REACH_FACTS` (exists) for Mac facts.

Must-pass scenarios (end to end with fakes):
1. During focus, `orion-reach "Rain at 3"` is held. Then `orion-awareness phase --from focus --to rest` sends exactly one
   outbox row, "Rain at 3." (one item), or "While you were focused: A. B." (two). The second phase call sends nothing.
2. A 2-min break with no tick in it: the release still happens (this is the phase hook, not the poll).
3. A class reminder during focus is sent immediately. A reminder he set (`--kind reminder --urgent`) is sent immediately.
4. A check-in by orion during focus is held and released on the break. A check-in by nick fires. Both are held in quiet hours.
5. `awareness.json` older than its limits gives `unknown` facets, and `presence().where === "unknown"`.
6. Home-gap at 14:00 with nothing until 16:00 and atHome gives one ask with "till 4". A second tick in the same gap gives no ask.
7. Away at an unknown cell for 25 min gives "Where are you at? I'll log it." (phone, `--ask` on the row). 95 min at
   the same cell gives `save-place`, once.
8. Blank backoff: two ignored blank asks give gaps of 120 then 240 min, with no pause; an answer resets to 60. "not now"
   is not counted as ignored. A mismatch nudge in the same period is not delayed by the backoff.
9. `orion-reschedule log "gym" --from 14:00 --to 16:00` at 17:00, over a planned "finish resume" 14:00-16:00, renames
   that block in place to gym with tag `logged`, writes one `slips.jsonl` row, and leaves no trace of finish resume on
   the calendar. It refuses to overwrite a fixed class; it trims around it. One `undo` restores everything.
10. `orion-remote handle --reply-to <id>` gets the ask label for that id even 80 min later. Without an id, a 30-min-old
    plain row is **not** attached, and a 60-min-old ask row is.
11. The day review with a logged block, a served session, an attended class, a slip, a blank answered "nothing" and a
    2 h blank lists done, slipped, free and "2-4 unknown". "nothing" created no calendar event. At home it is sent with
    `--channel mac --loud`; with `atHome` false or unknown, with `--channel phone`.
12. No new code path loads a model other than `qwen3.5:9b`. Assert in tests: curiosity, gate and merge produce text
    without any network or Ollama call (the fetch is stubbed to throw).
13. Not started: "finish resume" planned 14:00, at 14:05 no session, no work app, no check-in. One `orion-checkin add
    --by orion --block` is created; ticks at +10, +20, +25, +30 min give levels 1-4 through `orion-reach`; the 5th
    alert is the closing line and calls `orion-reschedule displace`. Starting a matching focus session at +12 closes the
    loop with no further message.
14. Should leave: a fixed dinner with a 15:30 travel wall, `atHome === true` at 15:31 gives `leave-late` (no
    `urgentKind`); `atHome === false` gives nothing. A class keeps today's urgent rungs.
15. Off-plan away: `location` elsewhere for 20 min during a home study block gives one ask whose window is the block;
    the reply "at the library studying" logs over it.
16. Ceiling: with 20 counted messages today, a mismatch nudge exits 3 with reason `ceiling`; a reminder he set and a
    class rung still go out.
17. Delivery: at the Mac with `atHome === true`, `mac-voice`; `atHome` null and `audio.mac.headphones` true,
    `mac-voice`; `atHome` null and speakers, `mac-bubble`; `audio.phone.headphones` true with the Mac on speakers,
    `mac-bubble`; idle 6 min, phone plus a silent Mac bubble, `timeSensitive` only when the phone route is headphones.
18. Re-weigh: logging gym over finish resume (medium) at 16:00, with YouTube (low) 19:00-20:00 and no free room, puts
    finish resume at 19:00 and removes YouTube with slip `bumped:finish resume`; with a medium to-do in place of
    YouTube nothing is bumped and the slip says `no-room`.
19. Anchors: `fill --anchors` on a Tuesday with `days` 1-7 adds Gym with tags `anchor`, `rank-must`; on a full day it
    bumps the lowest movable block, never a class or a stated time; with no room it reports a must-have that could not
    fit.

Swift (XCTest, the `ProactiveAudit20261016Tests.swift` pattern; all clock-injected):
- `SpokenQuestionFollowUpTests`: armed by "?", disarmed by a turn; at 20 s with idle 3 s, repeat aloud once; with idle
  300 s, send to the phone once; a second silence does nothing.
- `PhaseHookTests`: running(focus) to running(rest) produces one spawn with `--from focus --to rest`, and the
  heartbeat with no change spawns nothing.
- `OutreachContextAskTests`: the 90-min ask window, the replyTo preference, once only.
- `PlaceLogTests`: a `.place` entry lands in `placeEvents`, capped at 500, with rounded coordinates.
- `AudioRouteTests`: Bluetooth and BluetoothLE give `bluetooth`, built-in with `hdpn` gives `wired`, AirPlay gives
  `airplay` (not headphones), anything else gives `speakers`.
- Manual on device (Nick, about 10 min): leave home and come back with the app closed, and confirm 2 place events on the
  Mac; reply to an `orion.ask` push from the lock screen, and confirm the block is logged; connect and disconnect
  AirPods with ORION open, and confirm the `audio` field changes in `phoneSignals`.

## 7. Work packages (disjoint files; run in parallel after the precondition merge)

The replan/weight work is its own package, WP6. Its files would have overlapped WP3 only through `orion-reschedule`,
`live-day.mjs` and the plugin, so the logging part of the old WP3 moved into WP6 (4.6), and WP3 is now the loop and
the review. No file appears in two rows.

| WP | Scope | Files it owns (only it edits these) | Depends on (contract only) | Acceptance tests |
|---|---|---|---|---|
| **WP1 Awareness core** | awareness.json, facets (including the headphones facet), places, CLI | NEW `scripts/lib/awareness/{state,facets,places}.mjs`, NEW `scripts/orion-awareness`; EDIT `scripts/lib/reach/{presence,focus-hold,facts}.mjs`, `scripts/orion-presence`; NEW `tests/awareness-*.test.mjs` | C1, C3 (drain spawn), C6, C7 (pause subcommand writes the ledger field only), C12 (spawns the tick) | Scenarios 5 and 2 (hook side); the `audio` facet from a fixture `focus-activity.json` and phone rows, with staleness. Existing `tests/reach-route.test.mjs`, `proactive-quiet-hours.test.mjs` and `proactive-focus-hold.test.mjs` still pass. `orion-awareness refresh` under 300 ms with a cached calendar and no `system_profiler`. `learnHome` on a synthetic 14-day log picks the overnight-charging cell, and refuses with fewer than 5 nights of evidence. |
| **WP2 Delivery** | gate, held wording, the 3.4.4 channel rule, the daily ceiling, plan check-ins, every script sender | NEW `scripts/lib/reach/gate.mjs`; EDIT `scripts/lib/reach/{held,route}.mjs`, `scripts/orion-reach`, `scripts/orion-checkin`, `scripts/orion-notify`, `scripts/orion-watch`, `scripts/orion-standing`; NEW `tests/delivery-*.test.mjs` | C1 (literal fixture files), C2, C4 (the `--ask` flag), C9, C11 (`displace` CLI and `dailyReachCeiling`, read with a default of 20) | Scenarios 1, 3, 4, 16 and 17; scenario 13 on the `orion-checkin` side (levels, 5-alert cap, alerts through `orion-reach`, `displace` spawned); held merge wording; exit codes 0/3/4 unchanged; `proactive-delivery-failures.test.mjs` still passes. |
| **WP3 Plan-vs-reality loop and review** | the loop, mismatch types, blank asks, controls, leave ladder changes, proactive tick, day review | NEW `scripts/lib/curiosity/{loop,decide,ledger,words}.mjs`, NEW `scripts/orion-day-review`; EDIT `scripts/lib/reach/{gap,proactive,class-ladder}.mjs`, `scripts/orion-proactive`, `scripts/lib/life/day-review.mjs`; NEW tests `tests/curiosity-*.test.mjs`, `tests/day-review-actual.test.mjs` | C1, C4, C7, C8, C9 (creates plan check-ins), C10 (reads `rank`, `logged`, `slips.jsonl`), C11 (calls `fill --anchors`), C12 | Scenarios 6, 7, 8, 11, 12, 13 (loop side), 14 and 15; existing `proactive-*.test.mjs` pass. |
| **WP4 Mac app** | phase hook, unanswered spoken question, outreach ask-awareness, richer focus-activity (lock, audio route) | EDIT `native/Orion/Sources/Orion/{AppState,OutreachContext,GatewayClient,ScheduleFocusWatcher,LifeWatch,AudioRoute}.swift`; NEW `PhaseHook.swift`, `SpokenQuestionFollowUp.swift`; NEW tests in `native/Orion/Tests/` | C3 (spawns it), C4 (`--ask`, ask rows), C1 (writes the `audio` source) | The Swift tests in section 6, including `AudioRouteTests`. Manual replay of 10:36: ask a question by voice and stay silent, and get "Nick? ..." once at about 20 s with the bubble kept; walk away (idle more than 20 s), and the phone gets the question; the reply on the phone links (WP5) or the timed link works. Plug in wired headphones, then AirPods: `focus-activity.json audio.route` changes within 30 s. |
| **WP5 Phone, link and reply-to** | background samples, phone audio route, geofences, `orion.ask` text reply, replyTo plumbing, time-sensitive pushes, orion-remote outreach rule | EDIT `native/OrionMobile/App/{PhoneSignals,OrionMobileApp,CloudLink}.swift`, NEW `PlaceMonitor.swift`, EDIT `native/OrionMobile/Sources/MobileCore/LinkSnapshot.swift`, `native/OrionLink/Sources/LinkCore/{TrackingLog,CommandRunner}.swift`, `native/OrionLink/App/LinkEngine.swift`, `scripts/orion-remote`; NEW tests (`PlaceLogTests`, `tests/remote-outreach-reply-to.test.mjs`) | C4, C6, C1 (spawns `orion-awareness refresh`; writes the phone `audio` source) | Scenario 10; PlaceLogTests and the `.signal` `audio` validation; the device checks in section 6; a background significant-change sample shows up in `phoneSignals` with the app closed. |
| **WP6 Reality replaces the plan, replan by weight** | `weightOf`, rank tags through the bridge, `log` with replace and slips, re-weigh, `displace`, daily anchors, plugin log step | EDIT `scripts/lib/life/{priority,replan,fill-day,config,calendar-write,live-day}.mjs`, `scripts/orion-reschedule`, `native/OrionMacBridge/Sources/OrionMacBridge/Bridge.swift`, `plugin/orion-control/src/{schedule-flow,local-routing}.ts`; NEW tests `tests/life-{weight,replan-weight,reschedule-log,anchors}.test.mjs`, `plugin/.../schedule-flow-log.test.ts`, an OrionMacBridge tag test. By hand: `~/.openclaw/workspace/SCHEDULING.md` | C5, C10, C11 | Scenarios 9, 18 and 19; plugin tests: "i'm at the gym" (with an ask window) gives `log gym --from <ask start> --to now`, "was at the library since 2" gives `--from 14:00 --to now`, "gym 2-4" gives a past block, "did gym instead of resume" adds `--instead`, "nothing really" gives no `log`; existing `schedule-flow*.test.ts`, `life-*.test.mjs` and replan property tests pass. |

Merge order after the parallel builds: WP1, then WP6, then WP2, then WP3, then WP5, then WP4. WP6 goes early because
WP3's anchors call and the review read its data, and WP2's `displace` spawn calls its CLI. Each one passes on its own
against fixtures; the order only reduces rebase noise. Integration checks after all six: scenario 1 with the real app
(start a 20/2/20 session, send a test reach, and confirm the release at the 2-min break), and one live day with a
planned block he skips, to watch the not-started ladder, the log, the replace and the re-weigh end to end.

## 8. Decisions only Nick can make

Answered 2026-10-16 and built in above: nosiness (3.4), delivery of asks (3.4.4), pause = 3 min (3.2), "nothing"
replies (3.5), logging over a planned block (3.5, 3.8), nightly review delivery (3.6). Resolved: the narrative job's
`gpt-oss:20b` moved to `qwen3.5:9b` on `fix/speed-app` (a443fa3).

Still open, and only Nick can do or decide them:
1. **Confirm home.** Approve the "is this home?" question or set it with `orion-awareness place set home --here`.
   Also: is the Mac's home Wi-Fi a valid second signal? That needs Location Services for Orion.app. This matters more
   now: until home is known, the Mac speaks only when he has headphones on (3.4.4).
2. **Phone signals and "Always" location.** Turn on Control > Signals and grant "Always". This is required for
   away detection, geofences and the phone audio route, and nothing works away from the Mac without it. Optional: turn
   on Settings > Notifications > Announce Notifications for ORION if he wants pushes read into his AirPods.
3. **The gym anchor: which days, and how long?** He said the gym should be planned daily. The proposed default is
   every day, 60 min, rank `must` (3.8 point 5). Today's config says Mon/Wed/Fri. Are there rest days? Is anything
   else a daily must (for example, the side-project hour, which is a saved minimum today but not an anchor)?
