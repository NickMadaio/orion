# The escalation ladder for a plan block (2026-10-30)

ORION's loop is plan -> remind -> observe -> intervene -> follow up -> adapt (docs/vision/ORION_PURPOSE.md). Until today the
plan-block loop stopped at "remind". The R2 audit of 10-16 to 10-30: gym logged `gave-up` on 10-16, 10-20, 10-21 and 10-23
with "I'll stop pinging about Gym - I've moved what I could."; both 10-27 check-ins ended `given_up` at level 0 with nothing
said; "I'm meal prepping. That's why. Sorry." got "What time or how long do you mean?"; 480 held messages on 10-17/18
("It's been 1039 min. Gym, now."); three leave nudges after "I don't have classes today".

## The ladder

`scripts/lib/reach/plan-ladder.mjs` (words, timing, caps; pure) and `scripts/lib/reach/plan-loop.mjs` (one tick of one loop;
pure, effects injected). `orion-checkin tick` (every 30 s from the phone link) runs it; `orion-proactive tick` opens the loop
5 min into a block with no evidence of a start (lib/curiosity/loop.mjs) and writes now.json.

| rung | when | what |
|---|---|---|
| L0 | the mismatch (block start + 5) | "Time to start: Gym." Firm: plus his own record, "Gym: 0 of the last 6 happened. Not today." |
| L1 | +10 | "Gym — still not started. Just 30 min then, ..." (the smaller version: half the block, 30 at most, never more than is left) |
| L2 | +20 | "It's been 25 min. Gym, now. Phone down, 30 min still counts." as a time-sensitive phone push (`--urgent --urgent-kind plan --channel phone`), and, when he is home or has headphones in (route.mjs `speakOnMac`), the Mac aloud: "Nick. Gym. Now. 30 minutes still counts." |
| L3 | +40 | "You've been avoiding Gym for 45 min. No. Get up." (60+: "No. That's an hour. Get up."). Only when strictness is firm AND Nick granted it: restriction (below). |
| END | +60, or the block is over | `orion-reschedule displace "<title>" --why gave-up` re-weighs the day, then the closing message: moved ("Gym didn't happen at 5:00 PM. I've moved it to 9:20 PM–10:50 PM; that's the plan now. If today's off, say skip."), or, when nothing was placed, the question ("... Should I move it to later today, or is today off?"). Always `--tier protected`. |

A loop is never closed without a message that says what happens now. A block that ended up to 3 h ago gets the closing
message; older, or another day's, lapses silently (`resolution.status: lapsed`), because a message about it would be stale.

**The now record drives it.** A fresh now.json (15 min) that names this block with a `not-started`, `missed` or `off-plan`
mismatch lets a rung go; one that says something else matters (a class, travel, sleep, or no mismatch) holds it. No record,
or a stale one: the block's own window decides. **Strictness** is the record's (`flexible`/`firm`) for its own block, else the
same rule (30+ min, a same-kind slip today, under half over 3+ samples), and a refused excuse makes it firm.

**Restriction** needs both: `life-config.json` `escalation: { restrict: true }` (Nick's grant; off by default, not set live)
and the Mac app's own consent switch on a fresh sample (`focus-activity.json` `enforcementAllowed`, the switch
`orion-ontask-watch` obeys). A block away from the Mac (gym) runs `orion-ontask act lock`; a Mac block `act front --app <workApp>`.
In a state copy it goes to `isolated-outbox.jsonl` as `focus-restrict`.

## Replies, graces and evidence

- **A legitimate reason** (eating, meal prep, cooking, a call, shower, laundry; `graceFor`) to `orion-checkin defer N <id>
  --because "<his words>"` is a grace of 20-30 min (`resolution.status: grace`, `until`), at most two per loop, then the
  comeback "Time to start: Gym. Okay, meal prep's done. Now we're starting.", then the ladder goes on from the next rung 10
  min later. A declared `ate` fact ends an eating grace early. Avoidance ("later", "one more", ...) is refused as before and
  turns the ladder firm.
- **started / done / cancel** record `resolution: { status, how: "reply"|"evidence", at, replyTo }`. `--reply-to <msgId>`
  names the message; default the last one sent. `orion-checkin find --msg <msgId>` finds the loop by the id a message carried.
- **Declared facts** (`declared-facts.json`): a `skip` for the block or `no-classes` closes it with no message
  (`status: declared`) and a missed sample in life-history; `no-classes` also stops every leave, wake and class-missed rung
  (lib/reach/class-ladder.mjs) and the plan loop never opens for a skipped block.
- **Gym done** (`lib/life/attendance.mjs gymEvidence`): a workout today on `health-log.json workouts[]`
  (`{ day, startedAt, title?, source?: "whoop"|"healthkit" }`; no source is "workout-log"), awareness place `gym`, or his
  word (a `place: gym` fact, a note "went to the gym"). The loop closes `done`, `recordOutcome` writes the actual start and
  patterns.json is recomputed, and `checkins.json attended[]` / `ladders.json attended[]` keep it.

## Message ids and ladders.json

Every ladder message carries `ask.askId = <checkinId>-<L0|L1|L2|L3|END|CBn>` (the L2 voice copy `...-voice`), which is the
`askId` on its outreach.jsonl row and its phone/Mac thread row. `ladders.json` (state dir, beside now.json) is the projection
of checkins.json for today, rewritten on every save, schemaVersion 1:

```js
{ schemaVersion: 1, computedAt, date,
  ladders: [{ id, blockId, title, kind, window, rung: "L0".."END"|null, strictness, status, messages: [{ msgId, rung, name, at, text, channels, strictness }],
              grace: { at, until, reason, returning } | null, resolution: { status, how, at, text?, replyTo?, until? } | null }],
  attended: [{ date, blockId, title, source, at, minute }] }
```

`status`: open, grace, started, done, replanned, asked, declared, lapsed, cancelled. Read it with
`lib/reach/ladder-state.mjs readLadders(dir)`; the chat state card should show the open ladder and the last resolution.

## Storms

Each rung is sent once (the loop's own record). A rung that did not get through is tried again after 2 min, not every tick;
a budget drop backs off 30, 60, 120 min and after three goes straight to the closing message. The safety caps: 4 rungs per
block in any hour and 25 ladder messages a day (`CAPS`); the closing message is never capped. Held messages perish
(`lib/reach/held.mjs`): a check-in, a `plan:` line or any text with a minute count is dropped from the held queue after 30
min instead of coming out in a merged flush. While a ladder is open no blank or fill-blank ask is sent.

## Also on 2026-10-30

- `--urgent-kind plan` (lib/reach/quiet.mjs `TIME_SENSITIVE_KINDS`): time-sensitive on the phone, bypasses nothing (quiet
  hours, focus and class still hold it) and is not protected by itself (budget.mjs).
- **The all-nighter bedtime line**: orion-watch writes `awake-late.json` (`{ night, at, message, ... }`). When its night is
  tonight and it is under an hour old, every bedtime line says its words (`bedtime-guard.mjs bedtimeText`), the nightly cap
  allows one more, and past the last rung (2.5 h after bed) `orion-proactive` says it once (`bed-late-allnighter`).
- **The spoken brief's head** (lib/reach/morning.mjs `briefingTop`): `topOfList` from lib/life/morning-brief.mjs over
  `brief-heads.json` (`{ schemaVersion: 1, heads: [{ date, head }] }`, written by orion-morning when a brief is delivered),
  so the same item three days running is said as slipping with the choice, not repeated.

## Open

- **TODO (health/planning worker, lib/life/fill-day.mjs and orion-reschedule displace)**: the END replan re-enters the gym
  in the LAST slot of the day (demo: 17:00 -> 21:20-22:50, bumping "Go over Orion learning plan"). Where the gym goes is
  fill-day's choice, not the ladder's; it should prefer the earliest slot after now that fits, and a shorter (smaller
  version) gym over none when only that fits.
- A class reported "didn't happen" still gets one question and no follow-up when he does not answer.
- No WHOOP or HealthKit adapter writes `workouts[]` yet; only workouts logged in the app do.
