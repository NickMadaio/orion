# Task early-cli — `orion-reschedule early`

## Why
The button on the phone and Mac (built later by Claude) calls this command. It must write the change to his calendar through the same guarded path as every other reschedule: rules checked before writing, read back after, undoable.

## Files you own
- `scripts/orion-reschedule` (EDIT only; 486 lines — add one `else if (command === "early")` branch next to the `now` branch, plus usage lines in the header comment).
- `scripts/lib/life/calendar-write.mjs` (EDIT only): in `applyPlan`, a move may carry an optional `toEnd`; when present the event is moved to `[to, toEnd]` instead of `[to, to + length]`. Undo already records the original start and end — keep that.
- `tests/surfaces-early-cli.test.mjs` (new).

## Command
```
orion-reschedule early [block|out-of-class|home] [--now HH:MM] [--check] [--dry-run] [--date YYYY-MM-DD]
```
- `--now HH:MM` replaces the current minute (tests use a future date, where "now" is otherwise midnight). Validate with the existing `minute()` helper; bad value → `fail(...)` exit 2.
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
