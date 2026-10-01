# ORION truthful 2 — shared brief

## Goal
ORION is Nick's external executive function. On 30 September 2026 Nick texted "add fix Orion stuff, finish my resume, send internship applications and maybe study" and got nonsense back: no reminders, every block marked fixed, work booked the minute his lab ended, and a reply that said 4:00 PM for a block booked at 2:30. This batch builds small, pure, tested Node modules that let ORION (1) parse a to-do list properly, (2) prove from his own session log which tools he really called, (3) check that a reply's times match what was booked, (4) triage phone notifications for a future "ORION gate", and (5) a large catalog of realistic test messages. Claude wires each in after review; nothing here touches the real home directory, calendar, notifications or network.

## Files (all NEW; no existing file is edited)
- `scripts/lib/life/grant-policy.mjs` (task grant-policy)
- `scripts/lib/remote/reply-person.mjs` (task reply-person)
- `scripts/lib/life/day-review.mjs` (task day-review)
- Tests: `tests/truthful-<task-id>.test.mjs`, one per task.

## Shared conventions
- Times: minutes after local midnight, integers 0..1439. Dates `YYYY-MM-DD`. "now" is passed in as `{ date, minute }`; library code never calls `Date.now()` or argless `new Date()`.
- Spoken times are 12-hour: `"8:15 PM"`, `"12:00 PM"`, `"12:05 AM"`. Each module that needs a helper defines its own.
- Nick's priorities: classes (never moved), sleep, gym, deadlines and study, 60+ min side project daily, other responsibilities, rest.
- Errors: throw `TypeError` with a short message on invalid arguments.

## Tests
- `node:test` + `node:assert/strict`, ESM, `it`/`test` titles exactly as the task brief says. Fixed clocks only. Fixtures inline in the test file, or written into `mkdtemp(join(tmpdir(), "orion-truthful-"))` and removed in `t.after`.

## Working in this loop
- **Write first.** First exchange: `### FILE` the module with exported signatures and `### FILE` the test file. Then improve with `### EDIT`. Never more than two exchanges in a row without writing.
- `### EDIT` (SEARCH/REPLACE) for existing files, `### FILE` only for new ones. Read check output after every write.
- READ at most 3–4 files per exchange. Keep code compact.
- Pure functions; never mutate arguments. No console.log in library modules. Node built-ins only. `export function …`.
- No triple backticks inside file contents.
