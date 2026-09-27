# Phase 58: automation history, review packet

## Files

- `scripts/lib/orion-automation-history.mjs` — append-only ledger: validates and appends JSONL history entries for installed-automation firings; reads them back with optional time-window filtering.
- `scripts/lib/orion-automation-history-summary.mjs` — pure summary: counts firings, suppressions, refusals and deliveries over a configurable window, grouped by reason and by UTC day.
- `scripts/lib/orion-automation-history-forecast.mjs` — forecast merge: takes a simulate() forecast and a history summary, adds an `observed` block and honest notes (replaces the focus-not-modelled note with actual counts, or appends a "no history" note).
- `scripts/lib/orion-automation-runtime.mjs` — installed-automation runtime: `runInstalledAutomation` now calls `appendAutomationHistory` after every dispatch that is not `not_due`, recording status, reason and delivery outcome.
- `scripts/orion-cron-deliver` — legacy delivery gate: now records a separate JSONL history line for every invocation with outcome (`silent`, `no_match`, `duplicate`, `held_back`, `delivery_failed`, `delivered`) and the command's exit code.
- `scripts/orion-automation` — CLI: the `simulate` subcommand reads existing history, summarizes it, and merges observed data into the forecast output via `withHistory`.

## Record format

### Installed-automation history entry

Each line in `<name>.jsonl` is a JSON object with these keys:

- `v`: always `1` (format version).
- `at`: the scheduled time in ms since epoch (safe integer ≥ 0), not the write time.
- `name`: automation name matching `/^[a-z0-9][a-z0-9-]{1,47}$/`.
- `status`: one of `succeeded`, `failed`, `refused`, `outcome_unknown` (dispatchAutomation statuses).
- `reason`: `null`, or a string matching `/^[a-z_]{1,64}$/` (e.g. `quiet_hours`, `duplicate_or_old_trigger`).
- `delivery`: `null`, or one of `not_requested`, `withheld`, `delivered`, `not_delivered`, `unknown`, `not_attempted`.
- `recordedAt`: when the line was written, in ms since epoch (safe integer).

### Cron-deliver history line

Each line in `cron-delivery-history.jsonl` is a JSON object with these keys:

- `v`: always `1`.
- `at`: time of recording in ms since epoch.
- `label`: the delivery label passed via `--label`.
- `outcome`: one of `silent`, `no_match`, `duplicate`, `held_back`, `delivery_failed`, `delivered`.
- `exitCode`: the wrapped command's exit code (integer).

## Where history lives

- Installed-automation firings: `~/.openclaw/orion-controlled/automations/history/<name>.jsonl` — one file per automation name.
- Cron-deliver outcomes: `~/.openclaw/orion-controlled/cron-delivery-history.jsonl` — a single shared file.

## What simulate now says

The ceiling numbers (fire count, suppressed count, message count) are unchanged. When history exists for the automation, an "Observed:" line appears showing actual firings, suppressions and deliveries on days with recorded data. When no history exists, a note explains that the numbers are the ceiling only. The focus-not-modelled note is replaced with actual focus-suppression counts when history covers it.

## Not yet proven

- No live scheduler calls `runInstalledAutomation` yet, so installed-automation history files stay empty until one does.
- Cron-deliver history starts being written when this branch is merged and deployed (the recording code is already in the script).
- The Phase 58 gate requirement ("uses historical data where available") stays open until history actually exists on this Mac from a live run.

## How to verify

Run each new test file individually, or run the full suite:

- `node --test tests/automation-hist-ledger.test.mjs` — ledger append and read.
- `node --test tests/automation-hist-summary.test.mjs` — pure summary counts.
- `node --test tests/automation-hist-runtime.test.mjs` — runtime recording.
- `node --test tests/automation-hist-cron-deliver.test.mjs` — cron-deliver recording.
- `node --test tests/automation-hist-forecast.test.mjs` — forecast merge with history.

The existing Phase 57 automation suites also pass:

- `node --test` — runs all `tests/*.test.mjs` including the five new files above.

=======