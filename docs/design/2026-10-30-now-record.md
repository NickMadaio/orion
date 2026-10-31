# The now record (2026-10-30)

ORION's standing question (docs/vision/ORION_PURPOSE.md) is *given Nick's goals, commitments, current state and what
has actually happened today, what should he do next?* Until today the answer was computed in several places that
disagreed: `lib/life/next-action.mjs` (only `orion-now` / `orion-next` called it), the plan-vs-reality loop in
`lib/curiosity/loop.mjs`, and each sender's own reading of the calendar. On 2026-10-30 Nick said "I don't have
classes today" twice and still got three leave nudges for MKTG2201, because no single record carried that fact.

The now record is that single answer. One pure function computes it, one file holds it, and every surface reads it.

## Schema, version 1

`scripts/lib/life/now-record.mjs` (`nowRecord`, `NOW_SCHEMA_VERSION`, `RECORD_KEYS`, `MISMATCH_KINDS`).
All times are ISO-8601 instants. Adding a field is a minor change that readers ignore; renaming or removing a field,
or changing what one means, is `schemaVersion: 2`. `readNowRecord` returns `null` for any other version rather than
guessing at it.

```js
{
  schemaVersion: 1,
  computedAt: ISO,                       // the clock it was computed at (ORION_NOW in tests)
  shouldBe: {
    kind,                                // a block kind (class, gym, study, side_project, other, rest, ...) or
                                         // "travel" (in the commute to a class) | "prepare" (leave/start within 15 min)
                                         // "free" | "sleep" | "unknown" (calendar unreadable: never "free")
    title, blockId: string|null, start: ISO, end: ISO,
    why                                  // one sentence, safe to show him
  },
  is: {
    activity,                            // sleeping | focus | break | paused | gym | moving | at-mac | away | unknown
    place: string|null,                  // awareness location placeId or state; null when unknown
    focusSession: null | { state, task, endsAt, sessionId },
    evidence: [string],                  // "session:focus on Gym", "mac:active Safari", "location:home", ...
    confidence: "high"|"medium"|"low"|"none"
  },
  mismatch: null | { kind: "not-started"|"off-plan"|"awake-late"|"missed"|"overrun", since: ISO, minutes },
  next: { kind, title, blockId, start: ISO, leaveBy?: ISO },   // never null: falls back to bed, or to waking when asleep
  slipsToday: [{ title, kind, rank, start, end, reason, missedMinutes, replacedBy, at }],
  declared: [{ id, kind, text, at, source, title?, blockId?, place? }],   // facts he told ORION today
  strictness: "flexible"|"firm",
  sensors: { phone: { lastSampleAt, stale }, mac: { lastSampleAt, stale }, whoop: { lastSampleAt, stale } },
  sleepPlan: { bedtime: "HH:MM", wake: "HH:MM" }              // tonight's plan (what orion-now --json .sleep was)
}
```

### How it decides

Priorities are ORION_PURPOSE's: classes > gym > deadlines/study > side project > other > rest.

1. **Sleep first.** Awareness says asleep or late-awake, or it is past `sleepPlan.bedtime` and awareness does not say
   awake: `shouldBe.kind = "sleep"`. Late-awake is `mismatch: awake-late` since bedtime.
2. **An unreadable calendar** is `shouldBe.kind = "unknown"` and no mismatch. Unknown is never evidence.
3. **Blocks that are off today** drop out first: logged, checked in as `done`, slipped (a `slips.jsonl` row for the
   same title and start), or cancelled by a declared fact (`no-classes` takes every class; `skip` names one block).
4. **Classes come first.** Inside the commute wall before a class (`lib/life/commute.mjs`) is `travel`; a commute that
   starts within 15 min is `prepare`. Both win over a planned block that overlaps them.
5. Otherwise `next-action.mjs` decides (the current block by priority, `prepare` within 15 min, a missed study,
   deadline or side-project block comes back, else `free`). A `free` why says when the side-project hour is missing.

**Mismatch**, first match wins: `awake-late`; `overrun` (a focus session still on the task of a block that ended in
the last two hours); then, for the `shouldBe` block, any evidence of a start means none (a session on its task, its
place, a log, a work app: `lib/curiosity/loop.mjs evidenceOfStart`, plus a session match on 3-letter words such as
"Gym", which the loop's 4-letter match misses); `missed` once the block's window is over; `off-plan` when he has been
away from home 15+ min during a home block; `not-started` 5+ min after the start. A fixed class, or the commute to
one, is `not-started` only when awareness says he is **at home** after it began: no location is not a mismatch.

**Strictness** is `firm` when the mismatch is 30+ min old, or something of the same kind or title already slipped
today, or `patterns.json` shows that kind happening under half the time over 3+ samples. Otherwise `flexible`. It is
tone ("No. You've been avoiding this for an hour."), not the permission axis in `lib/orion-plugin.mjs`.

**Sensors** are stale after 2 h (phone), 10 min (Mac), 24 h (WHOOP); missing is stale.

## Declared facts

`scripts/lib/awareness/declared-facts.mjs`, file `declared-facts.json` in the state dir:

```js
{ schemaVersion: 1, facts: [{ id, date: "YYYY-MM-DD", at: ISO, kind: "no-classes"|"skip"|"ate"|"place"|"note",
                              text, source, title?, blockId?, place? }] }
```

`addDeclaredFact(dir, { kind, text, source, title?, blockId?, place? }, now)` validates, de-duplicates per day and
keeps 14 days. Only `no-classes` and `skip` change blocks; the rest are carried to every reader. Nothing in this
module parses his words: the reality-intent work decides that "i dont have classes today" is a `no-classes` fact and
calls `addDeclaredFact`.

## Producers

| producer | when | how |
|---|---|---|
| `scripts/orion-proactive tick` | every tick that is not `--dry-run` | `buildNow` with its own awareness (session and sleep fallbacks) and the calendar it already read, then `writeNowRecord` (temp file + rename, under the awareness lock) |
| `scripts/orion-now --json` | on demand | `buildNow` from the state dir; prints, never writes |
| `scripts/orion-proactive tick --dry-run --print-now` | on demand | prints the record the tick would write |

`scripts/lib/life/now-state.mjs` holds the IO: `buildNow`, `sleepPlanFor` (orion-now's sleep rule, moved),
`sensorsFrom`, `stateInputs`, `writeNowRecord`, `readNowRecord`, `NOW_FILE`. The two producers can differ only in
`is`: proactive falls back to the session socket when the awareness session facet is stale.

## Consumers: the contract for the next workers

Read with `readNowRecord(dir)` and treat `null` as "no decision available", never as "free".

- **Chat state card** (plugin): `shouldBe`, `mismatch`, `next`, `declared` and `strictness` are the card. Read
  now.json; do not recompute.
- **Escalation ladder** (lib/reach, lib/curiosity, orion-checkin): `mismatch.kind`, `mismatch.minutes` and
  `strictness` pick the rung; `shouldBe.blockId` names the block; `declared` cancels a ladder for a block he said is off.
- **Health and sleep planning** (lib/life, orion-watch): `sleepPlan`, `mismatch.kind === "awake-late"`, `sensors.whoop`.
- `orion-morning` already reads `sleepPlan.wake` from `orion-now --json`.

The files that are the contract: `scripts/lib/life/now-record.mjs`, `scripts/lib/life/now-state.mjs`,
`scripts/lib/awareness/declared-facts.mjs`, `scripts/lib/clock.mjs`, and the tests that pin them,
`tests/life-now-record.test.mjs` and `tests/clock-isolation.test.mjs`.

## Testing at a fake time against a throwaway state dir

`scripts/lib/clock.mjs` is the one clock and the one state directory.

- `ORION_NOW=<ISO>` is the time for orion-now, orion-proactive, orion-checkin, orion-watch, orion-reach,
  orion-morning, orion-day-review, orion-awareness, orion-notify and the libs they use (bridge-path `clockNow`,
  history, logged, calendar-write, focus-hold, patterns). The older seams (`ORION_REACH_NOW`, `ORION_CHECKIN_NOW`,
  `ORION_RESCHEDULE_NOW`) still win when set. `orion-watch --at HH:MM` still pins the hour on top.
- `ORION_CONTROLLED_DIR=<dir>` is the state directory for all of them, including life-config, pins, skips, the
  reschedule undo and lock, history and patterns, wake-request, the task ledger, checkins, remote.json and
  ontask-state, which used to be pinned to the live directory.
- When that dir is anything but the live `~/.openclaw/orion-controlled` (compared by real path, so `orion-remote`
  naming the live dir explicitly is not a test), the run is **isolated** and nothing goes outward. The Mac app URL
  (`orion://reach`, the morning screen, the lights), the phone push, Discord, OpenClaw messages and every calendar or
  reminder **write** through the bridge append to `<dir>/isolated-outbox.jsonl` instead
  (`{ at, wallAt, channel, by, payload }`). A bridge write throws after it is recorded, so callers mark nothing done.
  Bridge reads still go to the real bridge. A seam a test names (`ORION_REACH_OPEN_BIN`, `ORION_BRIDGE_BIN`,
  `ORION_DISCORD_ALERT_BIN`) is a stand-in executable and still runs. `ORION_BRIDGE_READ_BIN` replaces the bridge
  for reads only, so writes are still stopped.

```bash
rsync -a --exclude project-agent --exclude focus-clips --exclude selfdev-worktree --exclude evals \
  --exclude Orion-previous.app ~/.openclaw/orion-controlled/ /tmp/state-copy/
ORION_CONTROLLED_DIR=/tmp/state-copy ORION_NOW=2026-10-30T12:40:00Z scripts/orion-now --json
ORION_CONTROLLED_DIR=/tmp/state-copy ORION_NOW=2026-10-30T12:40:00Z scripts/orion-proactive tick --dry-run --print-now
ORION_CONTROLLED_DIR=/tmp/state-copy ORION_NOW=2026-10-30T12:40:00Z scripts/orion-proactive tick   # writes now.json in the copy
cat /tmp/state-copy/isolated-outbox.jsonl                                                           # what it would have sent
```

Two things a replay cannot fix. The copy's `awareness.json` was written at the copy's real time, so at an earlier
`ORION_NOW` its facets can come from the "future". And a process without the Calendar grant (a Claude Code session,
for one) gets "Allow Calendar access" from the real bridge, which the record reports honestly as
`shouldBe.kind: "unknown"`. The 2026-10-30 demo fed the copy's `glance-calendar.json` through `ORION_BRIDGE_READ_BIN`
for that reason.

## Demo, 2026-10-30, against a copy of the live state

Calendar: MKTG2201 13:30-15:00, ECON1115 15:30-17:00, then ORION blocks from 17:50 (finish resume, AE1 presentation,
CS midterm study, Gym 21:20, Orion learning plan). Commute 45 min. Phone telemetry stale since 10-26.

| ORION_NOW | shouldBe | mismatch | next |
|---|---|---|---|
| 12:40 | prepare: get ready to leave for MKTG2201, until 12:45 | none | MKTG2201 13:30, leave by 12:45 |
| 13:20 | travel: head to MKTG2201, 12:45-13:30 | none (location unknown) | MKTG2201 13:30 |
| 17:30 | free until finish resume at 17:50 (side-project hour missing) | none | finish resume 17:50 |
| 13:20 with a `no-classes` fact | free until 17:50 | none | finish resume 17:50; `declared: [no-classes]` |

The fourth row is the fix for the MKTG2201 nudges in the record: once the reality-intent work writes the fact, the
record stops saying "leave". Making the class ladder obey it is the escalation worker's change. In each case the
isolated `orion-proactive tick` wrote `now.json` in the copy, identical to `orion-now --json` except `is` at 17:30
(the session-socket fallback), and the one outward step it took, the held Discord digest at 17:30, went to the outbox.
