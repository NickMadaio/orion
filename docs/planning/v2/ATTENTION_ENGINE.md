# Attention Engine

## Purpose

ORION has many things that want Nick's attention (calendar, what he is waiting on, focus) and no single place that collects, scores, de-duplicates and routes them. The attention engine fills that gap: it gathers items from sources, scores them using six weighted signals, deduplicates by key, gates them into interrupt or Today based on context, and produces a ranked Today feed plus a digest summary. Everything is pure Node modules under `scripts/lib/attention/` with two CLIs for collection and querying.

## Item and queue

### Attention item fields

| Field | Type | Constraints |
|-------|------|-------------|
| `id` | string | `/^[a-z0-9][a-z0-9:._-]{1,95}$/` |
| `source` | string | One of: `calendar`, `waiting`, `focus`, `standing`, `automation`, `manual` |
| `kind` | string | `/^[a-z_]{1,40}$/` |
| `title` | string | 1–200 chars after trim |
| `detail` | string | 0–1000 chars |
| `observedAt` | number | ms timestamp, safe integer ≥ 0 |
| `dueAt` | number \| null | ms timestamp or null |
| `expiresAt` | number \| null | ms timestamp or null |
| `dedupKey` | string | 1–120 chars |
| `signals` | object | Six signal values, each a number in [0, 1] or `null` |

### Signals

Each signal is a number in `[0, 1]` or `null`. `null` means unknown and is **never** treated as 0 when scoring — unknown is not "unimportant". Gating rules that compare urgency treat a null urgency as below every threshold.

| Signal | Description |
|--------|-------------|
| `urgency` | How time-sensitive the item is |
| `importance` | How significant the item is to Nick |
| `actionability` | Whether Nick can act on it now |
| `confidence` | How confident the source is in its data |
| `novelty` | How new or unexpected the item is |
| `interruptibility` | How suitable it is for interrupting current work |

### Queue-entry fields

A queue entry is an attention item plus these additional fields:

| Field | Type | Description |
|-------|------|-------------|
| `state` | string | `"open"`, `"acked"`, or `"snoozed"` |
| `surfaced` | integer | How many times the item has been surfaced |
| `ackedAt` | number \| null | ms timestamp when acknowledged, or null |
| `snoozedUntil` | number \| null | ms timestamp until which snoozed, or null |

## Scoring

Scoring uses six weighted signals. The default weights are:

| Signal | Default weight |
|--------|---------------|
| `urgency` | 0.30 |
| `importance` | 0.20 |
| `actionability` | 0.15 |
| `confidence` | 0.15 |
| `novelty` | 0.10 |
| `interruptibility` | 0.10 |

The score is a weighted average of the **known** signals only. A signal is "known" if its value is a finite number; otherwise it is "unknown".

**Three-known-signals rule**: If fewer than three signals are known, the score is `null` (unranked). This prevents items with sparse signal data from receiving misleading scores.

The final score is rounded to four decimal places. Weights can be overridden by passing a custom weights object; the default is exported as `DEFAULT_WEIGHTS`.

## Routing

The attention gate (`attentionGate`) decides where an item goes and why. Rules apply in this exact order; first match wins:

| # | Condition | Route | Reason code |
|---|-----------|-------|-------------|
| 1 | `expiresAt` is set and `expiresAt <= now` | `drop` | `"expired"` |
| 2 | Score is `null` (unranked) | `today` | `"unranked"` |
| 3 | In quiet hours AND urgency < 0.9 | `today` | `"quiet_hours"` |
| 4 | Focus active or unknown AND urgency < 0.9 | `today` | `"focus_active"` or `"focus_unknown"` |
| 5 | Score ≥ 0.6 | `interrupt` | `"score"` |
| 6 | Otherwise (score < 0.6) | `today` | `"low_score"` |

Quiet hours are defined as `[start, end]`. If `start < end`, quiet when `start <= hour < end`. If `start > end`, the window wraps midnight: quiet when `hour >= start` or `hour < end`. Equal values or null means never quiet.

## Modules and commands

### Library modules (`scripts/lib/attention/`)

| File | Purpose |
|------|---------|
| `item.mjs` | Item shape validation and construction helpers |
| `urgency.mjs` | Urgency signal computation |
| `novelty.mjs` | Novelty signal computation |
| `score.mjs` | Weighted scoring with default weights and three-known-signals rule |
| `dedup.mjs` | Deduplication by dedupKey |
| `gate.mjs` | Routing gate: decides interrupt vs. today vs. drop |
| `store.mjs` | Queue persistence: load, save, add items |
| `rank.mjs` | Rank open items using scoring and gating |
| `explain.mjs` | Generate human-readable explanations for scores and routes |
| `budget.mjs` | Attention budget tracking and enforcement |
| `collect.mjs` | Collect items from all configured source readers |
| `today-feed.mjs` | Build and write the Today feed from ranked items |
| `digest.mjs` | Produce a summary digest of the current attention state |
| `simulate.mjs` | Simulation helpers for testing attention scenarios |

### Source readers (`scripts/lib/attention/sources/`)

| File | Purpose |
|------|---------|
| `calendar.mjs` | Read calendar events as attention items |
| `waiting.mjs` | Read "waiting on" items |
| `focus.mjs` | Read focus history and derive focus-related items |
| `manual.mjs` | Read manually submitted attention items |

### CLI commands

| Command | Purpose |
|---------|---------|
| `scripts/orion-attention-collect` | One-pass collection: reads fixtures, collects items, adds to queue, ranks, writes Today feed and prints digest. Supports `--dry-run`. |
| `scripts/orion-attention` | General attention query and management CLI. |

## Not wired yet

The following are **not connected** on this branch:

1. **Live readers** — source readers (`calendar.mjs`, `waiting.mjs`, `focus.mjs`) are implemented but not wired into a live polling or event-driven loop. Collection is triggered manually via the CLI with explicit fixture file flags.
2. **Schedule** — there is no cron-like scheduler that runs collection on a timer. The collect CLI must be invoked explicitly.
3. **Swift Today surface** — the Today feed is written to a JSON file but is not connected to any Swift UI or notification system. Phase 59's requirement for low-priority items to be filed into Today is implemented in data form only.

## How to verify

Run each attention test file with Node's built-in test runner:

