# Attention and Ops — Batch Review Packet

## Files

Library modules (scripts/lib/attention/):
- item.mjs — attention item shape and validation helpers
- urgency.mjs — urgencyFromDue, urgencyFromSignals
- novelty.mjs — noveltyOf
- score.mjs — DEFAULT_WEIGHTS, scoreAttentionItem
- dedup.mjs — dedupAttentionItems
- gate.mjs — attentionGate
- store.mjs — load/save/add/ack/snooze/prune/openItems for the queue
- rank.mjs — rankAttention
- explain.mjs — explainAttention
- budget.mjs — canInterrupt, recordInterruption
- collect.mjs — collectAttention from all configured source readers
- today-feed.mjs — buildTodayFeed, writeTodayFeed
- digest.mjs — attentionDigest
- simulate.mjs — simulateAttentionDay

Source readers (scripts/lib/attention/sources/):
- calendar.mjs — fromCalendarEvents
- waiting.mjs — fromWaitingStore
- focus.mjs — focusActiveFrom, fromFocusHistory
- manual.mjs — parseManualAttention

CLI scripts:
- scripts/orion-attention — general attention query and management
- scripts/orion-attention-collect — one-pass collection CLI
- scripts/orion-costs — inference cost summary
- scripts/orion-focus-report — focus session report
- scripts/orion-incident-timeline — merged incident timeline

Ops modules (scripts/lib/):
- orion-inference-summary.mjs — inference cost aggregation
- orion-incident-timeline.mjs — incident timeline merging
- orion-focus-report.mjs — focus session summarization
- orion-remote-audit-stats.mjs — remote audit statistics

## Verify

Run each test file with `node --test`:

```bash
node --test tests/attention-item.test.mjs
node --test tests/attention-urgency.test.mjs
node --test tests/attention-novelty.test.mjs
node --test tests/attention-score.test.mjs
node --test tests/attention-dedup.test.mjs
node --test tests/attention-gate.test.mjs
node --test tests/attention-store.test.mjs
node --test tests/attention-rank.test.mjs
node --test tests/attention-explain.test.mjs
node --test tests/attention-budget.test.mjs
node --test tests/attention-collect.test.mjs
node --test tests/attention-today-feed.test.mjs
node --test tests/attention-digest.test.mjs
node --test tests/attention-simulate.test.mjs
node --test tests/attention-src-calendar.test.mjs
node --test tests/attention-src-waiting.test.mjs
node --test tests/attention-src-focus.test.mjs
node --test tests/attention-src-manual.test.mjs
node --test tests/attention-cli-read.test.mjs
node --test tests/attention-cli-write.test.mjs
node --test tests/attention-cli-collect.test.mjs
node --test tests/ops-inference-summary.test.mjs
node --test tests/ops-inference-cli.test.mjs
node --test tests/ops-incident-timeline.test.mjs
node --test tests/ops-incident-cli.test.mjs
node --test tests/ops-focus-report.test.mjs
node --test tests/ops-focus-cli.test.mjs
node --test tests/ops-remote-audit-stats.test.mjs
```

## Proven

Each scenario from the brief's Tests section is covered by named test titles in the files below.

### mkdtemp — temp directory isolation

Every test creates its own temp dir via `mkdtemp(join(tmpdir(), "orion-att-"))` and removes it in `t.after`. Confirmed in:

| Test file | Coverage |
|-----------|----------|
| tests/attention-item.test.mjs | mkdtemp for item validation fixtures |
| tests/attention-urgency.test.mjs | mkdtemp for urgency computation |
| tests/attention-novelty.test.mjs | mkdtemp for novelty scoring |
| tests/attention-score.test.mjs | mkdtemp for scoring with default weights |
| tests/attention-dedup.test.mjs | mkdtemp for deduplication window tests |
| tests/attention-gate.test.mjs | mkdtemp for gate routing rules |
| tests/attention-store.test.mjs | mkdtemp for queue persistence (load/save/ack/snooze/prune) |
| tests/attention-rank.test.mjs | mkdtemp for ranking sort order |
| tests/attention-explain.test.mjs | mkdtemp for explanation generation |
| tests/attention-budget.test.mjs | mkdtemp for budget enforcement |
| tests/attention-collect.test.mjs | mkdtemp for collection aggregation |
| tests/attention-today-feed.test.mjs | mkdtemp for today feed writing |
| tests/attention-digest.test.mjs | mkdtemp for digest output |
| tests/attention-simulate.test.mjs | mkdtemp for day simulation |
| tests/attention-src-calendar.test.mjs | mkdtemp for calendar source reader |
| tests/attention-src-waiting.test.mjs | mkdtemp for waiting source reader |
| tests/attention-src-focus.test.mjs | mkdtemp for focus source reader |
| tests/attention-src-manual.test.mjs | mkdtemp for manual source reader |
| tests/attention-cli-read.test.mjs | mkdtemp for CLI read operations |
| tests/attention-cli-write.test.mjs | mkdtemp for CLI write operations |
| tests/attention-cli-collect.test.mjs | mkdtemp for CLI collect operations |
| tests/ops-inference-summary.test.mjs | mkdtemp for inference cost aggregation |
| tests/ops-inference-cli.test.mjs | mkdtemp for inference CLI |
| tests/ops-incident-timeline.test.mjs | mkdtemp for incident timeline merging |
| tests/ops-incident-cli.test.mjs | mkdtemp for incident CLI |
| tests/ops-focus-report.test.mjs | mkdtemp for focus report summarization |
| tests/ops-focus-cli.test.mjs | mkdtemp for focus CLI |
| tests/ops-remote-audit-stats.test.mjs | mkdtemp for remote audit stats |

### spawnSync with explicit flags — CLI test isolation

CLI tests invoke scripts via `spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8", env: { ...process.env, HOME: tmp } })` and always pass explicit `--file`/`--dir`/fixture flags. Never read or write the real home. Confirmed in:

| Test file | Coverage |
|-----------|----------|
| tests/attention-cli-read.test.mjs | spawnSync with --file/--dir flags for orion-attention reads |
| tests/attention-cli-write.test.mjs | spawnSync with --file/--dir flags for orion-attention writes |
| tests/attention-cli-collect.test.mjs | spawnSync with --file/--dir flags for orion-attention-collect |
| tests/ops-inference-cli.test.mjs | spawnSync with explicit fixture flags for orion-costs |
| tests/ops-incident-cli.test.mjs | spawnSync with explicit fixture flags for orion-incident-timeline |
| tests/ops-focus-cli.test.mjs | spawnSync with explicit fixture flags for orion-focus-report |

### Fixed clocks — no real time dependency

All tests pass `now` explicitly; none depend on the real clock. Confirmed in:

| Test file | Coverage |
|-----------|----------|
| tests/attention-urgency.test.mjs | fixed now for urgencyFromDue computation |
| tests/attention-novelty.test.mjs | fixed now for novelty window calculation |
| tests/attention-gate.test.mjs | fixed now for gate expiry and quiet-hour checks |
| tests/attention-store.test.mjs | fixed now for ack/snooze/prune timestamps |
| tests/attention-budget.test.mjs | fixed now for hour/day window enforcement |
| tests/attention-collect.test.mjs | fixed now passed to source readers |
| tests/attention-today-feed.test.mjs | fixed now for generatedAt and expiry |
| tests/attention-simulate.test.mjs | fixed day string for hour-by-hour simulation |
| tests/attention-src-calendar.test.mjs | fixed now for event window filtering |
| tests/attention-src-focus.test.mjs | fixed now for focus session and history checks |
| tests/attention-src-manual.test.mjs | fixed now for manual item id generation |
| tests/attention-src-waiting.test.mjs | fixed now for overdue/due-today classification |

Nothing is proven about live runs, real file system state outside tests, or integration with external services.

## Needs a decision

1. **Live readers for calendar and waiting** — source readers are implemented but not wired into a live polling or event-driven loop. Collection is triggered manually via CLI with explicit fixture flags.
2. **Schedule for orion-attention-collect** — no cron-like scheduler exists; the collect CLI must be invoked explicitly. A decision is needed on frequency and trigger mechanism.
3. **Delivery of interrupts** — the gate decides interrupt vs. today, but nothing actually delivers interrupts (notifications, UI alerts, etc.).
4. **Swift Today surface reading attention-today.json** — the Today feed is written to a JSON file but not connected to any Swift UI or notification system. Phase 59's requirement for low-priority items to be filed into Today is implemented in data form only.

## Rollback

Every path listed above is new. Deleting them undoes the batch:

```bash
rm -rf scripts/lib/attention/
rm scripts/orion-attention scripts/orion-attention-collect scripts/orion-costs scripts/orion-focus-report scripts/orion-incident-timeline
rm scripts/lib/orion-inference-summary.mjs scripts/lib/orion-incident-timeline.mjs scripts/lib/orion-focus-report.mjs scripts/lib/orion-remote-audit-stats.mjs
rm tests/attention-*.test.mjs tests/ops-*.test.mjs
rm docs/planning/v2/ATTENTION_ENGINE.md docs/planning/v2/ATTENTION_AND_OPS_REVIEW.md
```