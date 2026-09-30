# hist-review-packet

## Where you start

The other five tasks added:

- `scripts/lib/orion-automation-history.mjs` (ledger);
- `scripts/lib/orion-automation-history-summary.mjs` (summary);
- `scripts/lib/orion-automation-history-forecast.mjs` (forecast merge);
- recording in `scripts/lib/orion-automation-runtime.mjs` and `scripts/orion-cron-deliver`;
- the `simulate` output in `scripts/orion-automation`.

Their tests are `tests/automation-hist-{ledger,summary,runtime,cron-deliver,forecast}.test.mjs`.

## What to write

`docs/planning/v2/PHASE_58_HISTORY_REVIEW.md`, about 60–120 lines, with these sections in order:

1. `# Phase 58: automation history, review packet`.
2. `## Files`: one bullet per file above, with one line each on what it does.
3. `## Record format`:
   - the history entry keys `v, at, name, status, reason, delivery, recordedAt`, with one line each (see common.md);
   - the cron-deliver line keys `v, at, label, outcome, exitCode`, and the six outcomes `silent, no_match, duplicate, held_back, delivery_failed, delivered`.
4. `## Where history lives`:
   - `~/.openclaw/orion-controlled/automations/history/<name>.jsonl`;
   - `~/.openclaw/orion-controlled/cron-delivery-history.jsonl`.
5. `## What simulate now says`: the ceiling is unchanged; an "Observed:" line appears when history exists; otherwise the no-history note.
6. `## Not yet proven`:
   - No live scheduler calls `runInstalledAutomation` yet, so installed-automation history stays empty until one does.
   - Cron-deliver history starts when this branch is merged and deployed.
   - The Phase 58 gate requirement stays open until history exists on this Mac.
7. `## How to verify`: `node --test tests/automation-hist-<x>.test.mjs` for each of the five test files, and `node --test` for the existing automation suites.

## Traps

- Read the actual modules before writing: describe what they do, not what this brief predicted.
- Don't claim anything ran live.

## For the reviewer

Each acceptance criterion names a section. Check that the section exists and its facts match the code in this branch.
