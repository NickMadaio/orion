# Tighten ORION — shared brief

## Goal
ORION is Nick's external executive function (plan → remind → observe → intervene → follow up → adapt). A 76-scenario review on 29 September 2026 found the remaining problems are in the details: replies that narrate tools or mix "20:11" with "8:11 PM", false "I can't" and false "done", plans parsed wrongly from what Nick said, and patterns ORION could learn but does not. This batch builds small, pure, well-tested Node modules that fix those details. Claude wires each one into the live system after review; nothing here touches the real home directory, calendars, notifications or the network.

## Files (all NEW; no existing file is edited)
- `scripts/lib/remote/reply-lint.mjs` — finds and fixes reply-quality problems (task reply-lint).
- `scripts/lib/remote/claims.mjs` — decides whether a reply claims an action or an inability (task claims).
- `scripts/lib/eval/grade.mjs` + `scripts/orion-eval-grade` — grades a scenario run (task eval-grade).
- `scripts/lib/life/lateness.mjs` — how late Nick starts things, from check-in history (task lateness).
- `scripts/lib/life/deadline-ramp.mjs` — study time needed before quizzes and deadlines (task deadline-ramp).
- `scripts/lib/life/plan-parse.mjs` — turns "dinner with friends at 7 tomorrow" into a plan item (task plan-parse).
- `scripts/lib/life/morning-brief.mjs` — the morning message to his phone (task morning-brief).
- `scripts/lib/life/distraction.mjs` — when phone use should get a nudge or a lock (task distraction).
- Tests: `tests/tighten-<task-id>.test.mjs`, one per task.

## Shared conventions
- Times: minutes after local midnight, integers 0..1439 (`start`, `end`, `minute`). Dates: `YYYY-MM-DD` strings. "now" is always passed in as `{ date: "YYYY-MM-DD", minute: int }` (or a `Date` where the brief says so). Library code never calls `Date.now()` or `new Date()` without arguments.
- Spoken/phone times are 12-hour: `clock12(minute)` → `"8:15 PM"`, `"12:00 PM"`, `"12:05 AM"` (no leading zero, space before AM/PM). Each module that needs it defines its own small helper; do not import another task's module.
- Nick's priorities, highest first: classes (never moved), sleep, gym, deadlines and study for them, at least 60 minutes of side project a day, other responsibilities, rest (protected, not leftovers).
- Kinds used in this batch: `class, sleep, gym, deadline, study, side_project, meal, social, errand, rest, other`.
- Errors: throw `TypeError` with a short message for invalid arguments; never return partial garbage.

## Tests
- `node:test` + `node:assert/strict`, ESM. Test titles must match the task brief exactly.
- Fixed clocks only. For the CLI in eval-grade, use `spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" })` with fixture files written into `mkdtemp(join(tmpdir(), "orion-tighten-"))`, removed in `t.after`.

## Working in this loop
- **Write first.** In your first exchange, `### FILE` the module with the exported signatures (simple bodies are fine) and `### FILE` the test file. Then improve with `### EDIT`. Never spend more than two exchanges in a row without writing.
- `### EDIT` (SEARCH/REPLACE) for existing files, `### FILE` only for new ones. Checks run after every write: read their output.
- READ at most 3–4 files per exchange. Keep code and tests compact.
- Pure functions: never mutate arguments; return new objects/arrays. No console.log in library modules. Node built-ins only. `export function …`.
- No triple backticks inside file contents.
