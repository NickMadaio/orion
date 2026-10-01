# Task early-cli — `orion-reschedule early`

## Why
The button on the phone and Mac (built later by Claude) calls this command. It must write the change to his calendar through the same guarded path as every other reschedule: rules checked before writing, read back after, undoable.

## Files you own
- `scripts/orion-reschedule` (EDIT only; ~640 lines — add one `else if (command === "early")` branch next to the `extend`/`resize`/`rename` branches, plus usage lines in the header comment and the command name in the usage `fail(...)` line).
- `tests/surfaces-early-cli.test.mjs` (new).
- Already at HEAD, do not change: `applyPlan` (calendar-write.mjs) and `projectDay` accept a move with `toEnd` (the event becomes `[to, toEnd]`). `ORION_RESCHEDULE_NOW=<ISO time>` replays a moment in tests (see `tests/life-reschedule-extend.test.mjs`, whose `world()` harness is the one to copy). The extend/resize helpers `writeShape` and `findBlock` show the house style for a one-block change.

## Command
```
orion-reschedule early [block|out-of-class|home] [--now HH:MM] [--check] [--dry-run] [--date YYYY-MM-DD]
```
- `--now HH:MM` ("I finished at 3:10") replaces the current minute. Validate with the existing `minute()` helper; bad value → `fail(...)` exit 2. Tests set the clock with ORION_RESCHEDULE_NOW instead.
- `--check`: print one line of JSON, `earlyContext(...)` of `scripts/lib/life/early.mjs`, and exit 0 without writing.
- No mode: if the context is after-class print `ASK: out-of-class or home (just finished <classTitle>)` and exit 3; if it is block use mode block; if none print `Nothing is under way to finish.` and exit 1.
- Otherwise call `finishEarly(blocks, { now, mode, commuteMinutes: config.commuteMinutes, buffer: config.bufferMinutes, dayEnd: window.end })` (errors → `fail(message, 1)`).
- Build moves for `applyPlan`: each `moves` item becomes `{ id, title, from, to }`; `shortened` becomes `{ id, title, from: block.start, to: block.start, toEnd: now }`.
- Judge first: `refuseIfBroken(projectDay(dayWithClip, { moves }), now, "finishing early")` where `dayWithClip` is `blocks` with the `clipped` class's `end` set to `now`, and the shortened block's `end` set to `now`. (projectDay keeps each block's length for moves, so apply the shortening to the input day, not as a move.)
- Then (unless `--dry-run`) `applyPlan({ date, moves, created: [], removed: [], blocksById })` and `verifyWritten(date, now)`.
- Output, like the `now` branch: `Changed <Day> <date>:` then `  finished <title> at HH:MM`, `  moved <title>: HH:MM → HH:MM` per move, `  nothing else had to move` when there are none, and the undo line.

## Tests — `tests/surfaces-early-cli.test.mjs`
Copy the `world()` harness from `tests/life-reschedule-cli.test.mjs` (fake bridge `tests/fixtures/fake-bridge.mjs`, FAKE_CALENDAR, a future DATE). Titles exactly:
- "early during a block shortens it and pulls the rest forward"
- "early right after class without a mode asks which"
- "early home after class pulls the afternoon to now"
- "early --check prints the context as JSON and writes nothing"
- "early --dry-run writes nothing"
- "early then undo restores every block exactly"
Each writing test asserts the resulting calendar has no overlaps.
