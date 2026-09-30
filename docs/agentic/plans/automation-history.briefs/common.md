# Automation history — shared brief

## Goal

Phase 58 asks that automation simulation "uses historical data where available". Today `orion-automation simulate` only replays the calendar and says its number is a ceiling. This batch adds:

- an append-only history of automation firings;
- a pure summary of that history;
- recording from the installed-automation runtime and from `orion-cron-deliver`;
- a simulation that prints what really happened where history exists.

Nothing is scheduled, installed, deployed or sent.

## Files

- `scripts/lib/orion-automation-history.mjs`: NEW (hist-ledger). Append and read the history ledger.
- `scripts/lib/orion-automation-history-summary.mjs`: NEW (hist-summary). Pure summary over entries.
- `scripts/lib/orion-automation-history-forecast.mjs`: NEW (hist-forecast). Merges a summary into a simulate() forecast.
- `scripts/lib/orion-automation-runtime.mjs`: EXISTS. `runInstalledAutomation`; hist-runtime-record adds recording.
- `scripts/lib/orion-automation-dispatch.mjs`: EXISTS, read only. The result shapes.
- `scripts/lib/orion-automation-admission.mjs`: EXISTS, read only. The refusal reasons.
- `scripts/orion-cron-deliver`: EXISTS. The legacy delivery gate; hist-cron-deliver adds its own history line.
- `scripts/orion-automation`: EXISTS. The CLI; hist-forecast extends `simulate`.
- One test file per task: `tests/automation-hist-<task>.test.mjs`.

## Shared format: a history entry

The file is `<automationRoot>/history/<name>.jsonl`: one JSON object per line, UTF-8, newline-terminated. The keys, in this order:

```
{"v":1,"at":1789898400000,"name":"runtime-test","status":"succeeded","reason":null,"delivery":"not_requested","recordedAt":1789898401234}
```

- `v`: always 1.
- `at`: the SCHEDULED time in ms since epoch (a safe integer ≥ 0), not the time it was written.
- `name`: the automation name, matching `/^[a-z0-9][a-z0-9-]{1,47}$/`.
- `status`: one of `succeeded`, `failed`, `refused`, `outcome_unknown`. These are dispatchAutomation's statuses.
- `reason`: `null`, or a string matching `/^[a-z_]{1,64}$/`, e.g. `quiet_hours`, `duplicate_or_old_trigger`.
- `delivery`: `null`, or one of `not_requested`, `withheld`, `delivered`, `not_delivered`, `unknown`, `not_attempted`.
- `recordedAt`: when the line was written, in ms (a safe integer).

The cron-deliver history is a DIFFERENT file with its own shape, described in its task's brief.

## Tests

- `node:test` and `node:assert/strict`, like `tests/automation-delivery.test.mjs`.
- Every test makes its own temp root with `mkdtemp(join(tmpdir(), "orion-hist-"))` and removes it in `t.after`.
- Never read or write the real home directory. Never run anything that could send a Discord message.
- Test titles must match the brief exactly.
- Your task's test file is the `tests/automation-hist-*.test.mjs` in your scope; `scope-tests` runs exactly that file.

## Working in this loop

- `### EDIT` (SEARCH/REPLACE) for files that exist. `### FILE` only for new files.
- Checks run after every write. Read their output before the next change.
- READ at most 3–4 files per exchange.
- Keep code and tests compact: small functions, no deep nesting, no console.log in library modules.
- Never mutate arguments; return new objects.
- No triple backticks inside file contents.
