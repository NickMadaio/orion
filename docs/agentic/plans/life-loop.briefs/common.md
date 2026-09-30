# Life loop — shared brief

## Goal
ORION's purpose (docs/vision/ORION_PURPOSE.md) is to be Nick's external executive function: plan → remind → observe → intervene → follow up → adapt. This batch builds the decision logic for that loop as small, pure Node modules under `scripts/lib/life/`, plus two CLIs. Nothing here reads the real home directory, sends notifications, touches calendars or changes authority. Live wiring (phone signals, notifications, the Swift apps) is done separately after review.

## Shared format: a block (one piece of a day)
```
{
  "id": "class-cs2100-mon",        // /^[a-z0-9][a-z0-9:._-]{0,79}$/
  "title": "CS2100 Lecture",       // 1..120 chars after trim
  "kind": "class",                 // one of KINDS below
  "date": "2026-09-28",            // YYYY-MM-DD, a real calendar date
  "start": 540,                    // minutes after local midnight, integer 0..1439
  "end": 630,                      // integer, start < end <= 1440
  "fixed": true,                   // true = never moved by ORION
  "source": "calendar"             // one of: calendar, template, orion, nick
}
```
KINDS, in priority order (highest first): `class`, `sleep`, `gym`, `deadline`, `study`, `side_project`, `meal`, `other`, `rest`.
Times are LOCAL minutes of day on `date`; there is no time zone handling anywhere in this batch.

## Nick's priorities (the source for every ordering rule)
1. Classes are fixed and never moved. 2. Sleep is protected. 3. Gym is near the top. 4. Deadlines and study for them. 5. At least 60 minutes of `side_project` (YouTube/content) every day. 6. Other responsibilities. 7. Rest and breaks are protected time, not leftovers.

## Tests
- `node:test` + `node:assert/strict`. Test titles must match the brief exactly.
- Fixed clocks only: every function that needs "now" takes it as an argument (`now` = { date: "YYYY-MM-DD", minute: int }). Never call Date.now() or new Date() without arguments in library code.
- CLI tests use `spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" })` with fixture files written into a temp dir from `mkdtemp(join(tmpdir(), "orion-life-"))`, removed in `t.after`.

## Working in this loop
- **Write first.** In your first exchange, ### FILE your module with the exported signatures (simple bodies are fine) and ### FILE the test file. Then improve with ### EDIT. Never spend more than two exchanges in a row without writing. You have about 14 exchanges.
- `### EDIT` (SEARCH/REPLACE) for existing files, `### FILE` only for new ones. Checks run after every write: read their output.
- Pure functions: never mutate arguments; return new objects/arrays. No console.log in library modules. Node built-ins only. ESM (`export function …`).
- No triple backticks inside file contents.
