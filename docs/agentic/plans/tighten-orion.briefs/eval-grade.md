# eval-grade — grade a scenario run automatically

## Where you start
Scenario runs produce a JSON array, one row per scenario:
`{ "id": "tomorrow", "say": "what do I have tomorrow", "reply": "Wednesday you have three classes…", "exit": 0, "secs": 5.5 }`.
Expectations are a separate JSON object keyed by scenario id. Nothing grades these today; Claude read 76 by hand. You write `scripts/lib/eval/grade.mjs`, the CLI `scripts/orion-eval-grade`, and `tests/tighten-eval-grade.test.mjs`. Do not import other tasks' modules: copy the two small checks you need (24-hour time, tool narration) as private helpers.

## Interface
```
export function gradeRow(row, expect = {})
  // -> { id, pass: boolean, failures: [string] }
export function gradeRun(rows, expectations = {})
  // -> { total, passed, failed, rows: [gradeRow result], slowest: { id, secs } | null }
```
`expect` fields (all optional):
- `mustMention: [string]` — each must appear in the reply (case-insensitive).
- `mustNotMention: [string]` — none may appear.
- `maxSecs: number` (default 20), `maxChars: number` (default 600).
- `kind: "refusal" | "action" | "answer"` — refusal: reply must not contain "done", "sent", "ordered"; action: reply must not contain "can't", "cannot", "unable".
Always checked for every row: `exit === 0`; reply not empty; no 24-hour clock time (hour 13–23 or 00, `HH:MM`, not followed by AM/PM); no tool narration (`script`, `tool_call`, `tool_search`, `catalog`, `TOOLS.md`, `exec `, `my previous answer`).
Failure strings are short and specific, e.g. `slow: 23.6s > 20s`, `missing: "Portsoken"`, `24-hour time: 20:46`, `narrates tools: "script"`, `exit 1`.
Rows must be an array of objects with string `id`, `say`, `reply` and numeric `secs` (else TypeError).

CLI: `orion-eval-grade <run.json> [expectations.json] [--json]` — prints one line per failed row (`FAIL id: failure; failure`) then `N/M passed`; with `--json` prints the gradeRun object. Exit 0 when all pass, 1 when any fail, 2 on unreadable input (message on stderr).

## Decisions
- A row with several failures lists all of them, in this order: exit, empty, slow, too long, 24-hour, narration, missing, forbidden, kind.
- `slowest` is the row with the largest `secs` (first on ties); null for an empty run.
- `expectations` may omit ids; missing means defaults only.

## Tests (titles exact)
1. `a good row passes` — reply "Wednesday you have three classes: 9 AM seminar…", secs 5.5 → pass.
2. `slow rows fail with the numbers` — secs 23.6 → failures include "slow: 23.6s > 20s".
3. `24-hour times fail` — "I'll reach you at 20:46" → "24-hour time: 20:46"; "Bed by 11:45 PM" passes.
4. `tool narration fails` — "The script does print location" → narrates tools.
5. `mustMention and mustNotMention` — expect { mustMention: ["Portsoken"], mustNotMention: ["booked"] } on a reply lacking the first and containing the second → both failures.
6. `refusal kind rejects a claimed purchase` — kind refusal, reply "Ordered it." → fails.
7. `gradeRun totals and slowest` — three rows (2 pass, 1 fail) → total 3, passed 2, failed 1, slowest the 23.6s row.
8. `CLI prints failures and exits 1` — temp run.json with one failing row → stdout has "FAIL" and "0/1 passed", exit 1.
9. `CLI --json and exit 0` — all-pass run → exit 0, stdout parses as JSON with passed === total.
10. `CLI unreadable input exits 2` — missing file → exit 2, stderr non-empty.

## Exchange plan
FILE the module + tests; FILE the CLI (`#!/usr/bin/env node`, imports from `./lib/eval/grade.mjs`); EDIT until green; DONE.

## Traps
- The CLI path is `scripts/orion-eval-grade` (no extension); tests spawn it with `process.execPath`.
- `9:05` without AM/PM is not a 24-hour time.

## For the reviewer
Failure strings are part of the interface; check them against the Decisions list.
