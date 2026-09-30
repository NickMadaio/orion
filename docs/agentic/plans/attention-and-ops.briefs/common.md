# Attention engine and ops tools — shared brief

## Goal
ORION has many things that want Nick's attention (calendar, what he is waiting on, focus) and no one place that collects, scores, de-duplicates and routes them. Each watcher speaks for itself or stays silent, and low-priority items are dropped instead of being filed into Today (Phase 59's open requirement). This batch builds that place as small, pure Node modules under `scripts/lib/attention/`, three CLIs, and four small ops tools (inference cost, incident timeline, focus report, remote audit stats). Everything is new files; nothing existing is edited. Nothing sends messages, reads the real home directory in tests, or changes authority.

## Files (all NEW)
- `scripts/lib/attention/item.mjs` (item shape) · `urgency.mjs` · `novelty.mjs` · `score.mjs` · `dedup.mjs` · `gate.mjs` · `store.mjs` · `rank.mjs` · `explain.mjs` · `budget.mjs` · `collect.mjs` · `today-feed.mjs` · `digest.mjs` · `simulate.mjs`
- `scripts/lib/attention/sources/calendar.mjs` · `waiting.mjs` · `focus.mjs` · `manual.mjs`
- `scripts/orion-attention`, `scripts/orion-attention-collect` (executable Node scripts)
- `scripts/lib/orion-inference-summary.mjs`, `scripts/orion-costs`, `scripts/lib/orion-incident-timeline.mjs`, `scripts/orion-incident-timeline`, `scripts/lib/orion-focus-report.mjs`, `scripts/orion-focus-report`, `scripts/lib/orion-remote-audit-stats.mjs`
- One test per task: `tests/attention-<task>.test.mjs` or `tests/ops-<task>.test.mjs`.

## Shared format: an attention item
```
{
  "id": "calendar:ab12cd34ef56",          // /^[a-z0-9][a-z0-9:._-]{1,95}$/
  "source": "calendar",                     // one of: calendar, waiting, focus, standing, automation, manual
  "kind": "starting_soon",                  // /^[a-z_]{1,40}$/
  "title": "Seminar starts in 20 min",      // 1..200 chars after trim
  "detail": "",                             // string, 0..1000 chars
  "observedAt": 1790000000000,              // ms, safe integer >= 0
  "dueAt": 1790001200000,                   // ms or null
  "expiresAt": null,                        // ms or null
  "dedupKey": "calendar:ab12cd34ef56",      // 1..120 chars
  "signals": { "urgency": 0.8, "actionability": 0.7, "novelty": null,
               "confidence": 0.9, "importance": null, "interruptibility": null }
}
```
The six signals are Phase 59's factors. Each is a number in [0,1] or `null`. **`null` means unknown and is never treated as 0 when scoring** — unknown is not "unimportant" (Phase 64: unknown is never zero). Gating rules that compare urgency treat a null urgency as below every threshold.

A queue entry is an item plus `state` ("open" | "acked" | "snoozed"), `surfaced` (integer), `ackedAt` (ms|null), `snoozedUntil` (ms|null).

## Tests
- `node:test` + `node:assert/strict`. Each test makes its own temp dir with `mkdtemp(join(tmpdir(), "orion-att-"))` and removes it in `t.after`.
- CLI tests run the script with `spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8", env: { ...process.env, HOME: tmp } })` and ALWAYS pass explicit `--file`/`--dir`/fixture flags. Never read or write the real home.
- Test titles must match the brief exactly. Fixed clocks only: pass `now` explicitly; never depend on the real time.

## Working in this loop
- **Write first.** In your first exchange, ### FILE your module with the exported signatures (even with simple bodies) and ### FILE the test file. Then improve with ### EDIT. Never spend more than two exchanges in a row without writing. The loop gives about 14 exchanges.
- `### EDIT` (SEARCH/REPLACE) for existing files, `### FILE` only for new ones. Checks run after every write: read their output.
- Pure functions: never mutate arguments; return new objects/arrays. No `console.log` in library modules. Node built-ins only. ESM (`export function …`).
- No triple backticks inside file contents.
