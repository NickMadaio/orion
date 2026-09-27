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

Tests prove, in isolation with fixed clocks and temp directories:

- Item validation rejects malformed fields and normalizes valid ones.
- Urgency computation maps due-time distance to [0,1] correctly; null dueAt yields null.
- Novelty scores decrease with repeated surfacing of the same dedupKey within 7 days.
- Scoring applies default weights, requires ≥3 known signals (three-known-signals rule), and rounds to four decimal places.
- Deduplication keeps the newest item per dedupKey within the window and drops older duplicates.
- Gating routes items in priority order: expired → drop, unranked → today, quiet hours → today, focus active/unknown → today, high score → interrupt, low score → today.
- Queue persistence loads empty on ENOENT, saves atomically, adds/replaces by dedupKey, acks, snoozes, prunes expired and old acked entries, and returns open items correctly.
- Ranking sorts by score descending (null last), then dueAt ascending (null last), then id ascending.
- Explanations produce human-readable sentences for each gate reason code.
- Budget enforcement tracks interruptions per hour and per day with configurable limits.
- Collection aggregates items from calendar, waiting, and focus sources with outage tracking.
- Today feed builds a versioned document with interrupt/today/outages/note fields and writes atomically.
- Digest produces plain-text summaries with "Now:" and "Later today:" sections, truncation, and quiet messages.
- Simulation runs hour-by-hour ranking with budget enforcement over a full day.
- Source readers parse calendar events, waiting stores, focus history, and manual CLI args into valid attention items.
- CLI scripts accept --file/--dir flags, operate on temp directories, and produce expected output without touching the real home directory.
- Ops modules (inference summary, incident timeline, focus report, remote audit stats) aggregate data correctly within time windows.

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