# Life loop — review packet (2026-09-29)

qwen built the first six modules (block, priority, weekly, daily-needs, gaps, study-request, plus one fix); Claude reviewed them and built the remaining thirteen when Nick handed the project over. Every module is pure Node with no I/O except the two CLIs, which read only the file they are given.

## Files
- `scripts/lib/life/block.mjs` — the block shape (id, title, kind, date, start, end, fixed, source), validation and normalisation.
- `scripts/lib/life/priority.mjs` — Nick's priority order and the comparator; classes and sleep never move.
- `scripts/lib/life/weekly.mjs` — expands a weekly timetable into dated blocks within a term, honouring skipped dates.
- `scripts/lib/life/daily-needs.mjs` — which daily needs (side project hour, gym days, rest, meals) a day meets and what is short.
- `scripts/lib/life/gaps.mjs` — free intervals in a waking window, with buffers around fixed blocks.
- `scripts/lib/life/study-request.mjs` — parses "2 hours of study for macro before friday" into minutes, subject, date and sessions.
- `scripts/lib/life/fit-study.mjs` — places study sessions into gaps, moving only lower-priority movable blocks and never shortening side-project time.
- `scripts/lib/life/sleep-state.mjs` — day / awake late / winding down / probably asleep / unknown from bedtime, wake, phone activity and charging.
- `scripts/lib/life/bedtime.mjs` — the nudge ladder (none, gentle, firm, escalated) and a message stating the sleep still available.
- `scripts/lib/life/follow-through.mjs` — the remind → escalate → follow-up state machine for one block, with legitimate and illegitimate deferrals.
- `scripts/lib/life/deferral.mjs` — classifies a reason as pause, change, avoidance or unclear, with a suggested delay.
- `scripts/lib/life/after-late-night.mjs` — reshapes tomorrow after a short night: classes kept, nap added, early heavy work moved later.
- `scripts/lib/life/patterns.mjs` — completion rate and median delay per kind, median wake and sleep times.
- `scripts/lib/life/sync-event.mjs` — the offline change-event format phone and Mac exchange.
- `scripts/lib/life/sync-merge.mjs` — deterministic merge of two event logs and "since cursor".
- `scripts/lib/life/sync-apply.mjs` — folds events into captures, reminders, tracking and notes, idempotently.
- `scripts/lib/life/next-action.mjs` — the standing question: sleep, do, prepare or free, with a reason.
- `scripts/orion-next` — CLI over next-action for a day file.
- `scripts/orion-study` — CLI that parses a study request and fits it into a day file.

## Verify
- `node --test tests/life-block.test.mjs`
- `node --test tests/life-priority.test.mjs`
- `node --test tests/life-weekly.test.mjs`
- `node --test tests/life-daily-needs.test.mjs`
- `node --test tests/life-gaps.test.mjs`
- `node --test tests/life-study-request.test.mjs`
- `node --test tests/life-fit-study.test.mjs`
- `node --test tests/life-sleep-state.test.mjs`
- `node --test tests/life-bedtime.test.mjs`
- `node --test tests/life-follow-through.test.mjs`
- `node --test tests/life-deferral.test.mjs`
- `node --test tests/life-after-late-night.test.mjs`
- `node --test tests/life-patterns.test.mjs`
- `node --test tests/life-sync-event.test.mjs`
- `node --test tests/life-sync-merge.test.mjs`
- `node --test tests/life-sync-apply.test.mjs`
- `node --test tests/life-next-action.test.mjs`
- `node --test tests/life-cli.test.mjs`

## Proven
The tests prove each module's rules on fixed inputs and fixed clocks: priority ordering, timetable expansion across a term, gap finding with buffers, study parsing and placement without moving classes or shortening side-project time, sleep-state and nudge-level boundaries, the escalation state machine including the third-deferral rule, deferral classification, late-night reshaping, pattern medians including sleep after midnight, deterministic event merging and idempotent application, and the CLIs' outputs and exit codes. Nothing here has run against Nick's live data yet.

## Needs wiring
- Phone signals (location, motion, screen activity, charging) feeding `sleep-state` — the phone now records motion, charging and coarse place into the Mac's health log (`phoneSignals`); background sampling is not yet on.
- Notifications and escalation delivery driven by `follow-through` and `bedtime` (the phone's NightRoutine currently uses its own simpler ladder).
- The class timetable as a weekly template (today it lives in Apple Calendar as recurring events).
- ORION's brain calling `orion-next` / `orion-study` (they need a day file built from the calendar and to-dos, then an allowlist entry).
- The phone's offline event log using sync-event / merge / apply (the phone currently keeps an outbox of link commands instead).
- Reconciliation of applied state into ORION's Markdown files on the Mac.
