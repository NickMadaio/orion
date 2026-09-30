# Attention engine and ops tools — agent work backlog

**Owner:** Nick · **Prepared:** 27 September 2026 (Claude) · **Purpose:** a full day of useful, reviewable work for the local loop.

## Goal
Build ORION's missing attention layer — one place that collects what wants Nick's attention, scores it on Phase 59's six factors (unknown is never zero), de-duplicates it, respects quiet hours, focus and an interruption budget, and either interrupts or files it into Today (Phase 59 *places low-priority suggestions in Today*) with an honest explanation (Phase 63). Alongside it, four small ops tools read ledgers ORION already writes: inference cost and latency (Phase 67), an incident timeline from the audit logs (Phase 74), a focus report (Phase 60), and remote-channel audit stats.

## Starting point (verified at HEAD 9855d99, 2026-09-27)
- No attention queue, scoring or cross-source aggregation exists (the roadmap packet vision-attention-communications.md reached the same conclusion).
- `scripts/lib/orion-automation-admission.mjs` holds the quiet-hours and focus semantics the gate mirrors; `plugin/orion-control/src/waiting.ts` defines the waiting store; `scripts/orion-agenda upcoming --json` emits calendar events; `scripts/lib/orion-automation-host.mjs` reads legacy focus state.
- Every path this plan writes is new, so nothing collides with the uncommitted work in the main checkout. Live wiring (schedules, real readers, delivery, the Swift Today surface) is deliberately left for review.

## How this becomes work
```orion-plan
{"project":"Attention engine and ops tools","options":{"maxAttempts":3,"maxCorrectionDepth":2}}
```
17 of the 30 tasks have no dependencies; the rest depend on one to five earlier modules, so a stuck task never stops the day.

## Tasks

### Attention item shape and validation

```orion-task
{
  "id": "att-item",
  "title": "Attention item shape and validation",
  "objective": "After this task, scripts/lib/attention/item.mjs exports ATTENTION_SOURCES, ATTENTION_SIGNALS, validateAttentionItem and normalizeAttentionItem, which accept exactly the item shape in the common brief and reject everything else with named errors.",
  "context": "READ first: nothing in the repo defines this shape; the common brief is the specification.",
  "scope": [
    "scripts/lib/attention/item.mjs",
    "tests/attention-item.test.mjs"
  ],
  "nonScope": [
    "Do not edit any existing file; every path in scope is new."
  ],
  "constraints": [
    "Pure functions return new objects; never mutate arguments.",
    "Node built-ins only."
  ],
  "preconditions": [],
  "acceptance": [
    "Exports ATTENTION_SOURCES and ATTENTION_SIGNALS with the exact values in the brief.",
    "validateAttentionItem returns {ok:false, errors} naming each invalid field for the cases in the brief.",
    "normalizeAttentionItem trims text, clamps finite signals into [0,1], keeps null signals null, and throws TypeError('invalid attention item') when the result is still invalid.",
    "normalizeAttentionItem never mutates its argument.",
    "Tests cover every scenario listed in the brief's Tests section, by title."
  ],
  "checks": [
    "node-syntax",
    "scope-tests"
  ],
  "dependencies": [],
  "weight": 2,
  "risk": "low",
  "reviewDepth": "standard",
  "escalateWhen": []
}
```

### Urgency from a due time

```orion-task
{
  "id": "att-urgency",
  "title": "Urgency from a due time",
  "objective": "After this task, scripts/lib/attention/urgency.mjs exports urgencyFromDue(dueAt, now), a pure step function that turns time-to-due into an urgency in [0,1], returns 1 when overdue and null when there is no due time.",
  "context": "READ first: nothing; the brief's table is the specification.",
  "scope": [
    "scripts/lib/attention/urgency.mjs",
    "tests/attention-urgency.test.mjs"
  ],
  "nonScope": [
    "Do not edit any existing file; every path in scope is new."
  ],
  "constraints": [
    "Pure functions return new objects; never mutate arguments.",
    "Node built-ins only."
  ],
  "preconditions": [],
  "acceptance": [
    "Exports urgencyFromDue(dueAt, now) with the table in the brief.",
    "A null dueAt returns null, never 0.",
    "It throws TypeError for a non-integer now or a dueAt that is neither null nor a safe integer.",
    "Tests cover every scenario listed in the brief's Tests section, by title."
  ],
  "checks": [
    "node-syntax",
    "scope-tests"
  ],
  "dependencies": [],
  "weight": 2,
  "risk": "low",
  "reviewDepth": "standard",
  "escalateWhen": []
}
```

### Novelty from recent surfacing history

```orion-task
{
  "id": "att-novelty",
  "title": "Novelty from recent surfacing history",
  "objective": "After this task, scripts/lib/attention/novelty.mjs exports noveltyOf(dedupKey, history, now), which lowers novelty the more times the same dedupKey was surfaced in the last seven days.",
  "context": "READ first: the novelty table in this task's brief; the surfacing history it reads is plain {dedupKey, surfacedAt} records, so no repository file is needed.",
  "scope": [
    "scripts/lib/attention/novelty.mjs",
    "tests/attention-novelty.test.mjs"
  ],
  "nonScope": [
    "Do not edit any existing file; every path in scope is new."
  ],
  "constraints": [
    "Pure functions return new objects; never mutate arguments.",
    "Node built-ins only."
  ],
  "preconditions": [],
  "acceptance": [
    "Exports noveltyOf(dedupKey, history, now) with the table in the brief.",
    "Only surfacings of the same dedupKey within the seven days before now count.",
    "Malformed history entries are ignored rather than throwing.",
    "Tests cover every scenario listed in the brief's Tests section, by title."
  ],
  "checks": [
    "node-syntax",
    "scope-tests"
  ],
  "dependencies": [],
  "weight": 2,
  "risk": "low",
  "reviewDepth": "standard",
  "escalateWhen": []
}
```

### Score an item from its known signals

```orion-task
{
  "id": "att-score",
  "title": "Score an item from its known signals",
  "objective": "After this task, scripts/lib/attention/score.mjs exports DEFAULT_WEIGHTS and scoreAttentionItem(item, weights), which averages only the KNOWN signals by weight and returns a null score when fewer than three signals are known.",
  "context": "READ first: nothing; the common brief gives the item shape and the unknown-is-not-zero rule.",
  "scope": [
    "scripts/lib/attention/score.mjs",
    "tests/attention-score.test.mjs"
  ],
  "nonScope": [
    "Do not edit any existing file; every path in scope is new."
  ],
  "constraints": [
    "Pure functions return new objects; never mutate arguments.",
    "Node built-ins only."
  ],
  "preconditions": [],
  "acceptance": [
    "Exports DEFAULT_WEIGHTS with the exact values in the brief.",
    "scoreAttentionItem ignores null signals and renormalizes the remaining weights.",
    "Fewer than three known signals gives score null.",
    "The score is rounded to 4 decimal places.",
    "Tests cover every scenario listed in the brief's Tests section, by title."
  ],
  "checks": [
    "node-syntax",
    "scope-tests"
  ],
  "dependencies": [],
  "weight": 2,
  "risk": "low",
  "reviewDepth": "standard",
  "escalateWhen": []
}
```

### De-duplicate items by dedupKey

```orion-task
{
  "id": "att-dedup",
  "title": "De-duplicate items by dedupKey",
  "objective": "After this task, scripts/lib/attention/dedup.mjs exports dedupAttentionItems(items, options), which keeps the newest item for each dedupKey within a time window and reports what it dropped.",
  "context": "READ first: common.md's dedupKey field and this brief's grouping rule; dedup works on items only and needs no other module.",
  "scope": [
    "scripts/lib/attention/dedup.mjs",
    "tests/attention-dedup.test.mjs"
  ],
  "nonScope": [
    "Do not edit any existing file; every path in scope is new."
  ],
  "constraints": [
    "Pure functions return new objects; never mutate arguments.",
    "Node built-ins only."
  ],
  "preconditions": [],
  "acceptance": [
    "Exports dedupAttentionItems(items, {windowMs}) returning {kept, dropped} as in the brief.",
    "Within one dedupKey the newest item is kept and older items inside the window are dropped.",
    "Items of the same key older than the window are kept as separate occurrences.",
    "Kept items are ordered by observedAt descending, ties by id ascending.",
    "Tests cover every scenario listed in the brief's Tests section, by title."
  ],
  "checks": [
    "node-syntax",
    "scope-tests"
  ],
  "dependencies": [],
  "weight": 2,
  "risk": "low",
  "reviewDepth": "standard",
  "escalateWhen": []
}
```

### Route an item: interrupt, file into Today, or drop

```orion-task
{
  "id": "att-gate",
  "title": "Route an item: interrupt, file into Today, or drop",
  "objective": "After this task, scripts/lib/attention/gate.mjs exports attentionGate(item, context), which applies expiry, unranked, quiet-hours and focus rules in a fixed order and returns where the item goes and why.",
  "context": "READ first: scripts/lib/orion-automation-admission.mjs (checkConditions: how quiet hours wrap midnight and how an unknown focus state is treated as active).",
  "scope": [
    "scripts/lib/attention/gate.mjs",
    "tests/attention-gate.test.mjs"
  ],
  "nonScope": [
    "Do not edit any existing file; every path in scope is new."
  ],
  "constraints": [
    "Pure functions return new objects; never mutate arguments.",
    "Node built-ins only."
  ],
  "preconditions": [],
  "acceptance": [
    "Exports attentionGate(item, context) returning {deliver, route, reason}.",
    "Rules apply in the exact order of the brief's decision list.",
    "A quiet window that wraps midnight is honoured.",
    "An unknown focus state (null) is treated as focus active, reason focus_unknown.",
    "deliver is true exactly when route is interrupt.",
    "Tests cover every scenario listed in the brief's Tests section, by title."
  ],
  "checks": [
    "node-syntax",
    "scope-tests"
  ],
  "dependencies": [],
  "weight": 2,
  "risk": "low",
  "reviewDepth": "standard",
  "escalateWhen": []
}
```

### Durable attention queue

```orion-task
{
  "id": "att-store",
  "title": "Durable attention queue",
  "objective": "After this task, scripts/lib/attention/store.mjs keeps a durable JSON queue of attention entries with pure add, acknowledge, snooze, prune and open-items operations and atomic load/save.",
  "context": "READ first: nothing; the common brief defines items and queue entries.",
  "scope": [
    "scripts/lib/attention/store.mjs",
    "tests/attention-store.test.mjs"
  ],
  "nonScope": [
    "Do not edit any existing file; every path in scope is new."
  ],
  "constraints": [
    "Pure functions return new objects; never mutate arguments.",
    "Node built-ins only."
  ],
  "preconditions": [],
  "acceptance": [
    "Exports the eight functions in the brief with those signatures.",
    "addToQueue replaces an open entry with the same dedupKey and keeps its surfaced count.",
    "saveAttentionQueue writes atomically (temporary file then rename) with file mode 0o600.",
    "loadAttentionQueue returns an empty queue when the file does not exist and throws on unreadable content.",
    "ack and snooze of an unknown id throw an Error naming the id.",
    "Tests cover every scenario listed in the brief's Tests section, by title."
  ],
  "checks": [
    "node-syntax",
    "scope-tests"
  ],
  "dependencies": [],
  "weight": 3,
  "risk": "low",
  "reviewDepth": "standard",
  "escalateWhen": []
}
```

### Calendar events become 'starting soon' items

```orion-task
{
  "id": "att-src-calendar",
  "title": "Calendar events become 'starting soon' items",
  "objective": "After this task, scripts/lib/attention/sources/calendar.mjs exports fromCalendarEvents(events, options), turning events that start within the horizon into attention items and counting the ones it cannot read.",
  "context": "READ first: scripts/orion-agenda (the `upcoming --json` branch: events come straight from the bridge; start may be `start` or `startDate`).",
  "scope": [
    "scripts/lib/attention/sources/calendar.mjs",
    "tests/attention-src-calendar.test.mjs"
  ],
  "nonScope": [
    "Do not edit any existing file; every path in scope is new."
  ],
  "constraints": [
    "Pure functions return new objects; never mutate arguments.",
    "Node built-ins only."
  ],
  "preconditions": [],
  "acceptance": [
    "Exports fromCalendarEvents(events, {now, horizonMinutes}) returning {items, skipped}.",
    "Only non-all-day events starting between five minutes ago and the horizon become items.",
    "Events with no readable start are counted in skipped, not dropped silently.",
    "Item ids and dedupKeys are stable for the same event across calls.",
    "Tests cover every scenario listed in the brief's Tests section, by title."
  ],
  "checks": [
    "node-syntax",
    "scope-tests"
  ],
  "dependencies": [],
  "weight": 2,
  "risk": "low",
  "reviewDepth": "standard",
  "escalateWhen": []
}
```

### Overdue and due-today waiting items

```orion-task
{
  "id": "att-src-waiting",
  "title": "Overdue and due-today waiting items",
  "objective": "After this task, scripts/lib/attention/sources/waiting.mjs exports fromWaitingStore(store, options), turning open, un-snoozed waiting-on entries that are overdue or due today into attention items.",
  "context": "READ first: plugin/orion-control/src/waiting.ts (WaitingItem and WaitingStore: fields, status values, dueBy as a YYYY-MM-DD date, surfaced count).",
  "scope": [
    "scripts/lib/attention/sources/waiting.mjs",
    "tests/attention-src-waiting.test.mjs"
  ],
  "nonScope": [
    "Do not edit any existing file; every path in scope is new."
  ],
  "constraints": [
    "Pure functions return new objects; never mutate arguments.",
    "Node built-ins only."
  ],
  "preconditions": [],
  "acceptance": [
    "Exports fromWaitingStore(store, {now, maxSurfaced}) returning items as in the brief.",
    "Only status 'open' entries that are not snoozed and are overdue or due today become items.",
    "An entry surfaced maxSurfaced times or more gets interruptibility 0.1.",
    "An invalid store throws TypeError('invalid waiting store').",
    "Tests cover every scenario listed in the brief's Tests section, by title."
  ],
  "checks": [
    "node-syntax",
    "scope-tests"
  ],
  "dependencies": [],
  "weight": 2,
  "risk": "low",
  "reviewDepth": "standard",
  "escalateWhen": []
}
```

### Focus state and a gentle no-focus-yet item

```orion-task
{
  "id": "att-src-focus",
  "title": "Focus state and a gentle no-focus-yet item",
  "objective": "After this task, scripts/lib/attention/sources/focus.mjs exports focusActiveFrom(focusJson, now), which mirrors the automation host's legacy focus reading, and fromFocusHistory(rows, options), which files a low-priority item when no focus session has happened today by mid-afternoon.",
  "context": "READ first: scripts/lib/orion-automation-host.mjs (legacyFocus: session null means not focusing; session.until in ms; anything else unknown).",
  "scope": [
    "scripts/lib/attention/sources/focus.mjs",
    "tests/attention-src-focus.test.mjs"
  ],
  "nonScope": [
    "Do not edit any existing file; every path in scope is new."
  ],
  "constraints": [
    "Pure functions return new objects; never mutate arguments.",
    "Node built-ins only."
  ],
  "preconditions": [],
  "acceptance": [
    "Exports focusActiveFrom and fromFocusHistory with the signatures in the brief.",
    "focusActiveFrom returns true, false or null exactly as the brief's table.",
    "fromFocusHistory returns one no_focus_today item only when today's served focus is zero and the UTC hour is 15 or later.",
    "Malformed history rows are skipped.",
    "Tests cover every scenario listed in the brief's Tests section, by title."
  ],
  "checks": [
    "node-syntax",
    "scope-tests"
  ],
  "dependencies": [],
  "weight": 2,
  "risk": "low",
  "reviewDepth": "standard",
  "escalateWhen": []
}
```

### Manual items from command-line arguments

```orion-task
{
  "id": "att-src-manual",
  "title": "Manual items from command-line arguments",
  "objective": "After this task, scripts/lib/attention/sources/manual.mjs exports parseManualAttention(argv, options), which turns `\"title\" --due ISO --urgency n --importance n --expires ISO` into a valid attention item and rejects bad flags by name.",
  "context": "READ first: this brief's flag list; the item it returns must pass the item shape in common.md.",
  "scope": [
    "scripts/lib/attention/sources/manual.mjs",
    "tests/attention-src-manual.test.mjs"
  ],
  "nonScope": [
    "Do not edit any existing file; every path in scope is new."
  ],
  "constraints": [
    "Pure functions return new objects; never mutate arguments.",
    "Node built-ins only."
  ],
  "preconditions": [],
  "acceptance": [
    "Exports parseManualAttention(argv, {now}) returning an item as in the brief.",
    "Each invalid flag throws a TypeError whose message names the flag.",
    "The dedupKey depends on the title only, so adding the same reminder twice replaces it in the queue.",
    "Tests cover every scenario listed in the brief's Tests section, by title."
  ],
  "checks": [
    "node-syntax",
    "scope-tests"
  ],
  "dependencies": [],
  "weight": 2,
  "risk": "low",
  "reviewDepth": "standard",
  "escalateWhen": []
}
```

### Rank open items into now, later and dropped

```orion-task
{
  "id": "att-rank",
  "title": "Rank open items into now, later and dropped",
  "objective": "After this task, scripts/lib/attention/rank.mjs exports rankAttention(entries, context), which scores and gates each entry and returns interrupt-now, later-today and dropped lists in a stable order.",
  "context": "READ first: scripts/lib/attention/score.mjs and scripts/lib/attention/gate.mjs (the two functions this combines).",
  "scope": [
    "scripts/lib/attention/rank.mjs",
    "tests/attention-rank.test.mjs"
  ],
  "nonScope": [
    "Do not edit any existing file; every path in scope is new."
  ],
  "constraints": [
    "Pure functions return new objects; never mutate arguments.",
    "Node built-ins only."
  ],
  "preconditions": [
    "exists: scripts/lib/attention/score.mjs",
    "exists: scripts/lib/attention/gate.mjs"
  ],
  "acceptance": [
    "Exports rankAttention(entries, context) returning {now, later, dropped}.",
    "Each entry is scored with scoreAttentionItem and routed with attentionGate.",
    "now and later are ordered by score descending with null last, then dueAt ascending with null last, then id.",
    "Output rows carry id, title, source, score, reason and dueAt only.",
    "Tests cover every scenario listed in the brief's Tests section, by title."
  ],
  "checks": [
    "node-syntax",
    "scope-tests"
  ],
  "dependencies": [
    "att-score",
    "att-gate"
  ],
  "weight": 2,
  "risk": "low",
  "reviewDepth": "standard",
  "escalateWhen": []
}
```

### Say why an item was shown or held back

```orion-task
{
  "id": "att-explain",
  "title": "Say why an item was shown or held back",
  "objective": "After this task, scripts/lib/attention/explain.mjs exports explainAttention(item, scored, gated), which returns plain sentences saying where the item went, why, and which signals were unknown (Phase 63 explainability).",
  "context": "READ first: scripts/lib/attention/gate.mjs (the reason codes to explain).",
  "scope": [
    "scripts/lib/attention/explain.mjs",
    "tests/attention-explain.test.mjs"
  ],
  "nonScope": [
    "Do not edit any existing file; every path in scope is new."
  ],
  "constraints": [
    "Pure functions return new objects; never mutate arguments.",
    "Node built-ins only."
  ],
  "preconditions": [
    "exists: scripts/lib/attention/gate.mjs"
  ],
  "acceptance": [
    "Exports explainAttention(item, scored, gated) returning an array of sentences.",
    "The first sentence is the exact text for the gate reason from the brief's table.",
    "Unknown signals are listed by name; a null score says ranking was not possible.",
    "Tests cover every scenario listed in the brief's Tests section, by title."
  ],
  "checks": [
    "node-syntax",
    "scope-tests"
  ],
  "dependencies": [
    "att-gate"
  ],
  "weight": 2,
  "risk": "low",
  "reviewDepth": "standard",
  "escalateWhen": []
}
```

### An interruption budget

```orion-task
{
  "id": "att-budget",
  "title": "An interruption budget",
  "objective": "After this task, scripts/lib/attention/budget.mjs exports canInterrupt(ledger, now, limits) and recordInterruption(ledger, now), which cap interruptions per hour and per day and say when the next one is allowed.",
  "context": "READ first: this brief's hour and day windows; the ledger is an array of millisecond timestamps kept by the caller.",
  "scope": [
    "scripts/lib/attention/budget.mjs",
    "tests/attention-budget.test.mjs"
  ],
  "nonScope": [
    "Do not edit any existing file; every path in scope is new."
  ],
  "constraints": [
    "Pure functions return new objects; never mutate arguments.",
    "Node built-ins only."
  ],
  "preconditions": [],
  "acceptance": [
    "Exports canInterrupt and recordInterruption with the signatures in the brief.",
    "The hour limit is checked before the day limit and nextAt says when the oldest counted interruption ages out.",
    "recordInterruption returns a new ledger holding only the last 24 hours.",
    "Tests cover every scenario listed in the brief's Tests section, by title."
  ],
  "checks": [
    "node-syntax",
    "scope-tests"
  ],
  "dependencies": [],
  "weight": 2,
  "risk": "low",
  "reviewDepth": "standard",
  "escalateWhen": []
}
```

### Collect items from every source, naming outages

```orion-task
{
  "id": "att-collect",
  "title": "Collect items from every source, naming outages",
  "objective": "After this task, scripts/lib/attention/collect.mjs exports collectAttention({now, readers}), which runs each configured source reader, converts its data to items, and reports each failing source as an outage instead of pretending it had nothing.",
  "context": "READ first: scripts/lib/attention/sources/calendar.mjs, waiting.mjs and focus.mjs (the three converters it calls).",
  "scope": [
    "scripts/lib/attention/collect.mjs",
    "tests/attention-collect.test.mjs"
  ],
  "nonScope": [
    "Do not edit any existing file; every path in scope is new."
  ],
  "constraints": [
    "Pure functions return new objects; never mutate arguments.",
    "Node built-ins only."
  ],
  "preconditions": [
    "exists: scripts/lib/attention/sources/calendar.mjs",
    "exists: scripts/lib/attention/sources/waiting.mjs",
    "exists: scripts/lib/attention/sources/focus.mjs"
  ],
  "acceptance": [
    "Exports collectAttention({now, readers}) returning {items, outages}.",
    "A reader that throws, or data its converter rejects, becomes an outage naming the source.",
    "A source with no reader configured is neither called nor an outage.",
    "Items are ordered by observedAt descending, then id.",
    "Tests cover every scenario listed in the brief's Tests section, by title."
  ],
  "checks": [
    "node-syntax",
    "scope-tests"
  ],
  "dependencies": [
    "att-src-calendar",
    "att-src-waiting",
    "att-src-focus"
  ],
  "weight": 2,
  "risk": "low",
  "reviewDepth": "standard",
  "escalateWhen": []
}
```

### A Today feed file the app can read

```orion-task
{
  "id": "att-today-feed",
  "title": "A Today feed file the app can read",
  "objective": "After this task, scripts/lib/attention/today-feed.mjs exports buildTodayFeed(ranked, options) and writeTodayFeed(file, feed), producing the versioned JSON document that files low-priority items into Today (Phase 59) and says plainly when a source could not be read.",
  "context": "READ first: scripts/lib/attention/rank.mjs (the ranked shape it takes).",
  "scope": [
    "scripts/lib/attention/today-feed.mjs",
    "tests/attention-today-feed.test.mjs"
  ],
  "nonScope": [
    "Do not edit any existing file; every path in scope is new."
  ],
  "constraints": [
    "Pure functions return new objects; never mutate arguments.",
    "Node built-ins only."
  ],
  "preconditions": [
    "exists: scripts/lib/attention/rank.mjs"
  ],
  "acceptance": [
    "Exports TODAY_FEED, buildTodayFeed and writeTodayFeed as in the brief.",
    "The feed note names unreadable sources and never claims nothing needs Nick while a source is missing.",
    "writeTodayFeed writes atomically with mode 0o600.",
    "Tests cover every scenario listed in the brief's Tests section, by title."
  ],
  "checks": [
    "node-syntax",
    "scope-tests"
  ],
  "dependencies": [
    "att-rank"
  ],
  "weight": 2,
  "risk": "low",
  "reviewDepth": "standard",
  "escalateWhen": []
}
```

### A short digest for voice or Discord

```orion-task
{
  "id": "att-digest",
  "title": "A short digest for voice or Discord",
  "objective": "After this task, scripts/lib/attention/digest.mjs exports attentionDigest(feed, options), a plain-text summary of a Today feed that lists what needs Nick now and later, caps its length, and repeats the feed's outage note.",
  "context": "READ first: nothing; the feed shape is in this brief.",
  "scope": [
    "scripts/lib/attention/digest.mjs",
    "tests/attention-digest.test.mjs"
  ],
  "nonScope": [
    "Do not edit any existing file; every path in scope is new."
  ],
  "constraints": [
    "Pure functions return new objects; never mutate arguments.",
    "Node built-ins only."
  ],
  "preconditions": [],
  "acceptance": [
    "Exports attentionDigest(feed, {max}) producing the exact line format in the brief.",
    "More rows than max end with an '…and N more' line for that section.",
    "An outage is always mentioned, and 'Nothing needs you.' appears only when every source was read.",
    "Tests cover every scenario listed in the brief's Tests section, by title."
  ],
  "checks": [
    "node-syntax",
    "scope-tests"
  ],
  "dependencies": [],
  "weight": 2,
  "risk": "low",
  "reviewDepth": "standard",
  "escalateWhen": []
}
```

### Simulate a day of attention

```orion-task
{
  "id": "att-simulate",
  "title": "Simulate a day of attention",
  "objective": "After this task, scripts/lib/attention/simulate.mjs exports simulateAttentionDay(entries, options), which replays a set of entries hour by hour through ranking and the interruption budget and reports how often Nick would have been interrupted versus how much would have been filed into Today.",
  "context": "READ first: scripts/lib/attention/rank.mjs and scripts/lib/attention/budget.mjs.",
  "scope": [
    "scripts/lib/attention/simulate.mjs",
    "tests/attention-simulate.test.mjs"
  ],
  "nonScope": [
    "Do not edit any existing file; every path in scope is new."
  ],
  "constraints": [
    "Pure functions return new objects; never mutate arguments.",
    "Node built-ins only."
  ],
  "preconditions": [
    "exists: scripts/lib/attention/rank.mjs",
    "exists: scripts/lib/attention/budget.mjs"
  ],
  "acceptance": [
    "Exports simulateAttentionDay(entries, options) returning the shape in the brief.",
    "Each entry interrupts at most once, in the first hour it ranks as now and the budget allows.",
    "Interruptions refused by the budget are counted in blockedByBudget and the entry is filed instead.",
    "Tests cover every scenario listed in the brief's Tests section, by title."
  ],
  "checks": [
    "node-syntax",
    "scope-tests"
  ],
  "dependencies": [
    "att-rank",
    "att-budget"
  ],
  "weight": 3,
  "risk": "low",
  "reviewDepth": "standard",
  "escalateWhen": []
}
```

### orion-attention: list and show

```orion-task
{
  "id": "att-cli-read",
  "title": "orion-attention: list and show",
  "objective": "After this task, scripts/orion-attention is an executable Node CLI whose `list` and `show <id>` commands read the attention queue (default ~/.openclaw/orion-controlled/attention.json, or --file) and print open items by score, as text or --json.",
  "context": "READ first: scripts/lib/attention/store.mjs and scripts/lib/attention/score.mjs.",
  "scope": [
    "scripts/orion-attention",
    "tests/attention-cli-read.test.mjs"
  ],
  "nonScope": [
    "Do not edit any existing file; every path in scope is new."
  ],
  "constraints": [
    "Pure functions return new objects; never mutate arguments.",
    "Node built-ins only."
  ],
  "preconditions": [
    "exists: scripts/lib/attention/store.mjs",
    "exists: scripts/lib/attention/score.mjs"
  ],
  "acceptance": [
    "scripts/orion-attention starts with '#!/usr/bin/env node' and implements list and show as in the brief.",
    "A missing queue file prints 'No attention items.' and exits 0.",
    "An unknown command or id exits 2 or 1 with a message on stderr.",
    "Tests run the script only with --file pointing into a temp directory.",
    "Tests cover every scenario listed in the brief's Tests section, by title."
  ],
  "checks": [
    "node-syntax",
    "scope-tests"
  ],
  "dependencies": [
    "att-store",
    "att-score"
  ],
  "weight": 2,
  "risk": "low",
  "reviewDepth": "standard",
  "escalateWhen": []
}
```

### orion-attention: add, ack, snooze, prune

```orion-task
{
  "id": "att-cli-write",
  "title": "orion-attention: add, ack, snooze, prune",
  "objective": "After this task, scripts/orion-attention also has add, ack, snooze and prune commands that change the queue through store.mjs and the manual parser, confirming each change in one line.",
  "context": "READ first: scripts/orion-attention (the read commands from the previous task), scripts/lib/attention/sources/manual.mjs.",
  "scope": [
    "scripts/orion-attention",
    "tests/attention-cli-write.test.mjs"
  ],
  "nonScope": [
    "Do not edit any existing file; every path in scope is new."
  ],
  "constraints": [
    "Pure functions return new objects; never mutate arguments.",
    "Node built-ins only."
  ],
  "preconditions": [
    "exists: scripts/orion-attention",
    "exists: scripts/lib/attention/sources/manual.mjs"
  ],
  "acceptance": [
    "add parses its arguments with parseManualAttention and saves the item.",
    "ack and snooze change one entry; an unknown id exits 1 with the message on stderr.",
    "prune reports how many entries it removed.",
    "The read commands keep working unchanged.",
    "Tests cover every scenario listed in the brief's Tests section, by title."
  ],
  "checks": [
    "node-syntax",
    "scope-tests"
  ],
  "dependencies": [
    "att-cli-read",
    "att-src-manual",
    "att-store"
  ],
  "weight": 2,
  "risk": "low",
  "reviewDepth": "standard",
  "escalateWhen": []
}
```

### orion-attention-collect: one pass end to end

```orion-task
{
  "id": "att-cli-collect",
  "title": "orion-attention-collect: one pass end to end",
  "objective": "After this task, scripts/orion-attention-collect runs one collection pass from fixture files (calendar JSON, waiting store, focus history), adds the items to the queue, ranks the open items, writes the Today feed and prints the digest; --dry-run writes nothing.",
  "context": "READ first: scripts/lib/attention/collect.mjs, scripts/lib/attention/today-feed.mjs, scripts/lib/attention/digest.mjs.",
  "scope": [
    "scripts/orion-attention-collect",
    "tests/attention-cli-collect.test.mjs"
  ],
  "nonScope": [
    "Do not edit any existing file; every path in scope is new."
  ],
  "constraints": [
    "Pure functions return new objects; never mutate arguments.",
    "Node built-ins only."
  ],
  "preconditions": [
    "exists: scripts/lib/attention/collect.mjs",
    "exists: scripts/lib/attention/today-feed.mjs",
    "exists: scripts/lib/attention/digest.mjs"
  ],
  "acceptance": [
    "The flags in the brief are implemented; every input and output path comes from a flag.",
    "--dry-run prints the digest and writes neither the queue nor the feed.",
    "A missing or unreadable input file is reported as an outage in the digest, not as an error exit.",
    "Tests run only against temp-directory fixtures.",
    "Tests cover every scenario listed in the brief's Tests section, by title."
  ],
  "checks": [
    "node-syntax",
    "scope-tests"
  ],
  "dependencies": [
    "att-collect",
    "att-store",
    "att-rank",
    "att-today-feed",
    "att-digest"
  ],
  "weight": 3,
  "risk": "low",
  "reviewDepth": "deep",
  "escalateWhen": []
}
```

### Summarize the inference ledger

```orion-task
{
  "id": "ops-inference-summary",
  "title": "Summarize the inference ledger",
  "objective": "After this task, scripts/lib/orion-inference-summary.mjs exports parseJsonl(text) and summarizeInference(rows, window), which total calls, failures, tokens, estimated cost and latency percentiles per model and per day.",
  "context": "READ first: nothing in the repo; the brief shows the real ledger row shape.",
  "scope": [
    "scripts/lib/orion-inference-summary.mjs",
    "tests/ops-inference-summary.test.mjs"
  ],
  "nonScope": [
    "Do not edit any existing file; every path in scope is new."
  ],
  "constraints": [
    "Pure functions return new objects; never mutate arguments.",
    "Node built-ins only."
  ],
  "preconditions": [],
  "acceptance": [
    "Exports parseJsonl and summarizeInference with the shapes in the brief.",
    "Rows outside [from, to) are excluded and malformed rows are counted, not thrown.",
    "p50 and p95 latency use the nearest-rank method.",
    "Cost is summed from estimated_cost_usd and rounded to 6 decimals.",
    "Tests cover every scenario listed in the brief's Tests section, by title."
  ],
  "checks": [
    "node-syntax",
    "scope-tests"
  ],
  "dependencies": [],
  "weight": 2,
  "risk": "low",
  "reviewDepth": "standard",
  "escalateWhen": []
}
```

### orion-costs: inference cost and latency at a glance

```orion-task
{
  "id": "ops-inference-cli",
  "title": "orion-costs: inference cost and latency at a glance",
  "objective": "After this task, scripts/orion-costs prints the last N days of the inference ledger (default 7) per model and per day, as text or --json, using orion-inference-summary.mjs.",
  "context": "READ first: scripts/lib/orion-inference-summary.mjs.",
  "scope": [
    "scripts/orion-costs",
    "tests/ops-inference-cli.test.mjs"
  ],
  "nonScope": [
    "Do not edit any existing file; every path in scope is new."
  ],
  "constraints": [
    "Pure functions return new objects; never mutate arguments.",
    "Node built-ins only."
  ],
  "preconditions": [
    "exists: scripts/lib/orion-inference-summary.mjs"
  ],
  "acceptance": [
    "scripts/orion-costs supports --file, --days, --now and --json as in the brief.",
    "A missing ledger prints 'No inference recorded.' and exits 0.",
    "Tests use only temp-directory ledgers.",
    "Tests cover every scenario listed in the brief's Tests section, by title."
  ],
  "checks": [
    "node-syntax",
    "scope-tests"
  ],
  "dependencies": [
    "ops-inference-summary"
  ],
  "weight": 2,
  "risk": "low",
  "reviewDepth": "standard",
  "escalateWhen": []
}
```

### One timeline from the audit logs

```orion-task
{
  "id": "ops-incident-timeline",
  "title": "One timeline from the audit logs",
  "objective": "After this task, scripts/lib/orion-incident-timeline.mjs exports buildIncidentTimeline(logs, options), merging the permission, remote, repair and location audit rows into one time-ordered list of events with a one-line summary and a severity (Phase 74 incident response).",
  "context": "READ first: nothing in the repo; the brief shows the real row shapes.",
  "scope": [
    "scripts/lib/orion-incident-timeline.mjs",
    "tests/ops-incident-timeline.test.mjs"
  ],
  "nonScope": [
    "Do not edit any existing file; every path in scope is new."
  ],
  "constraints": [
    "Pure functions return new objects; never mutate arguments.",
    "Node built-ins only."
  ],
  "preconditions": [],
  "acceptance": [
    "Exports buildIncidentTimeline(logs, {since}) returning events in ascending time order.",
    "Each log kind is summarized and given a severity exactly as the brief's table.",
    "Rows without a parseable time are counted in skipped.",
    "Tests cover every scenario listed in the brief's Tests section, by title."
  ],
  "checks": [
    "node-syntax",
    "scope-tests"
  ],
  "dependencies": [],
  "weight": 2,
  "risk": "low",
  "reviewDepth": "standard",
  "escalateWhen": []
}
```

### orion-incident-timeline: read the audit logs as one story

```orion-task
{
  "id": "ops-incident-cli",
  "title": "orion-incident-timeline: read the audit logs as one story",
  "objective": "After this task, scripts/orion-incident-timeline reads the four audit logs from a directory (default ~/.openclaw/orion-controlled, or --dir), and prints the merged timeline since a time, as text or --json.",
  "context": "READ first: scripts/lib/orion-incident-timeline.mjs.",
  "scope": [
    "scripts/orion-incident-timeline",
    "tests/ops-incident-cli.test.mjs"
  ],
  "nonScope": [
    "Do not edit any existing file; every path in scope is new."
  ],
  "constraints": [
    "Pure functions return new objects; never mutate arguments.",
    "Node built-ins only."
  ],
  "preconditions": [
    "exists: scripts/lib/orion-incident-timeline.mjs"
  ],
  "acceptance": [
    "scripts/orion-incident-timeline supports --dir, --since, --severity and --json as in the brief.",
    "Missing log files are treated as empty; unreadable lines are counted.",
    "Tests use only temp directories.",
    "Tests cover every scenario listed in the brief's Tests section, by title."
  ],
  "checks": [
    "node-syntax",
    "scope-tests"
  ],
  "dependencies": [
    "ops-incident-timeline"
  ],
  "weight": 2,
  "risk": "low",
  "reviewDepth": "standard",
  "escalateWhen": []
}
```

### A weekly focus report

```orion-task
{
  "id": "ops-focus-report",
  "title": "A weekly focus report",
  "objective": "After this task, scripts/lib/orion-focus-report.mjs exports focusReport(rows, window), summarizing focus sessions per day and in total: sessions, minutes of focus served, blocks completed, early ends and the longest session.",
  "context": "READ first: nothing in the repo; the brief shows the real focus-history row shape.",
  "scope": [
    "scripts/lib/orion-focus-report.mjs",
    "tests/ops-focus-report.test.mjs"
  ],
  "nonScope": [
    "Do not edit any existing file; every path in scope is new."
  ],
  "constraints": [
    "Pure functions return new objects; never mutate arguments.",
    "Node built-ins only."
  ],
  "preconditions": [],
  "acceptance": [
    "Exports focusReport(rows, {from, to}) returning the shape in the brief.",
    "Minutes come from servedFocusSeconds, rounded to one decimal.",
    "Malformed rows are counted in skipped.",
    "Tests cover every scenario listed in the brief's Tests section, by title."
  ],
  "checks": [
    "node-syntax",
    "scope-tests"
  ],
  "dependencies": [],
  "weight": 2,
  "risk": "low",
  "reviewDepth": "standard",
  "escalateWhen": []
}
```

### orion-focus-report: the week in focus

```orion-task
{
  "id": "ops-focus-cli",
  "title": "orion-focus-report: the week in focus",
  "objective": "After this task, scripts/orion-focus-report prints the last N days (default 7) of focus history per day and in total, as text or --json.",
  "context": "READ first: scripts/lib/orion-focus-report.mjs.",
  "scope": [
    "scripts/orion-focus-report",
    "tests/ops-focus-cli.test.mjs"
  ],
  "nonScope": [
    "Do not edit any existing file; every path in scope is new."
  ],
  "constraints": [
    "Pure functions return new objects; never mutate arguments.",
    "Node built-ins only."
  ],
  "preconditions": [
    "exists: scripts/lib/orion-focus-report.mjs"
  ],
  "acceptance": [
    "scripts/orion-focus-report supports --file, --days, --now and --json as in the brief.",
    "A missing history prints 'No focus sessions recorded.' and exits 0.",
    "Tests use only temp-directory files.",
    "Tests cover every scenario listed in the brief's Tests section, by title."
  ],
  "checks": [
    "node-syntax",
    "scope-tests"
  ],
  "dependencies": [
    "ops-focus-report"
  ],
  "weight": 2,
  "risk": "low",
  "reviewDepth": "standard",
  "escalateWhen": []
}
```

### What the remote channel was asked, and what it refused

```orion-task
{
  "id": "ops-remote-audit-stats",
  "title": "What the remote channel was asked, and what it refused",
  "objective": "After this task, scripts/lib/orion-remote-audit-stats.mjs exports remoteAuditStats(rows, window), counting remote commands by decision, verb and day and listing the most common refusal reasons.",
  "context": "READ first: nothing in the repo; the brief shows the real remote-audit row shape.",
  "scope": [
    "scripts/lib/orion-remote-audit-stats.mjs",
    "tests/ops-remote-audit-stats.test.mjs"
  ],
  "nonScope": [
    "Do not edit any existing file; every path in scope is new."
  ],
  "constraints": [
    "Pure functions return new objects; never mutate arguments.",
    "Node built-ins only."
  ],
  "preconditions": [],
  "acceptance": [
    "Exports remoteAuditStats(rows, {from, to}) returning the shape in the brief.",
    "byVerb keeps the ten most frequent verbs; topRefusalReasons the five most frequent reasons among refused, rejected and error rows.",
    "Ties sort by name so the output is deterministic.",
    "Tests cover every scenario listed in the brief's Tests section, by title."
  ],
  "checks": [
    "node-syntax",
    "scope-tests"
  ],
  "dependencies": [],
  "weight": 2,
  "risk": "low",
  "reviewDepth": "standard",
  "escalateWhen": []
}
```

### Attention engine architecture document

```orion-task
{
  "id": "att-doc",
  "title": "Attention engine architecture document",
  "objective": "After this task, docs/planning/v2/ATTENTION_ENGINE.md explains the attention engine as built on this branch: the item and queue formats, the scoring and routing rules, the modules and CLIs, and what is not wired yet.",
  "context": "READ first: scripts/lib/attention/score.mjs, scripts/lib/attention/gate.mjs, scripts/orion-attention-collect.",
  "scope": [
    "docs/planning/v2/ATTENTION_ENGINE.md"
  ],
  "nonScope": [
    "Do not edit any existing file; every path in scope is new."
  ],
  "constraints": [
    "Pure functions return new objects; never mutate arguments.",
    "Node built-ins only."
  ],
  "preconditions": [
    "exists: scripts/lib/attention/score.mjs",
    "exists: scripts/lib/attention/gate.mjs"
  ],
  "acceptance": [
    "Section 'Item and queue' lists every item field and every queue-entry field.",
    "Section 'Scoring' gives the six signals, their default weights, and the three-known-signals rule.",
    "Section 'Routing' lists the gate rules in order with their reason codes.",
    "Section 'Modules and commands' lists each file under scripts/lib/attention/ and both CLIs with one line each.",
    "Section 'Not wired yet' states that live readers, a schedule and the Swift Today surface are not connected on this branch.",
    "Tests cover every scenario listed in the brief's Tests section, by title."
  ],
  "checks": [
    "node-syntax"
  ],
  "dependencies": [
    "att-cli-collect",
    "att-explain",
    "att-simulate"
  ],
  "weight": 1,
  "risk": "low",
  "reviewDepth": "standard",
  "escalateWhen": []
}
```

### Batch review packet for Astra and Nick

```orion-task
{
  "id": "batch-review-packet",
  "title": "Batch review packet for Astra and Nick",
  "objective": "After this task, docs/planning/v2/ATTENTION_AND_OPS_REVIEW.md lists every file this batch added with one line each, the commands to verify it, what is proven by tests, and what still needs a human decision or live wiring.",
  "context": "READ first: docs/planning/v2/ATTENTION_ENGINE.md, then list scripts/lib/attention/ with SEARCH.",
  "scope": [
    "docs/planning/v2/ATTENTION_AND_OPS_REVIEW.md"
  ],
  "nonScope": [
    "Do not edit any existing file; every path in scope is new."
  ],
  "constraints": [
    "Pure functions return new objects; never mutate arguments.",
    "Node built-ins only."
  ],
  "preconditions": [],
  "acceptance": [
    "Section 'Files' lists every new file under scripts/lib/attention/, the three attention and three ops CLIs, and the four ops modules, one line each.",
    "Section 'Verify' gives one node --test command per new test file.",
    "Section 'Proven' states only what the tests prove, without claims about live runs.",
    "Section 'Needs a decision' lists: live readers for calendar and waiting, a schedule for orion-attention-collect, delivery of interrupts, and the Swift Today surface reading attention-today.json.",
    "Tests cover every scenario listed in the brief's Tests section, by title."
  ],
  "checks": [
    "node-syntax"
  ],
  "dependencies": [
    "att-doc",
    "ops-inference-cli",
    "ops-incident-cli",
    "ops-focus-cli",
    "ops-remote-audit-stats"
  ],
  "weight": 1,
  "risk": "low",
  "reviewDepth": "standard",
  "escalateWhen": []
}
```


## Next batch (not executable)
Live readers and a schedule for orion-attention-collect; delivery of interrupts through the existing alert path; the Mac and phone Today surfaces reading attention-today.json.

## What Astra reviews
That every module is pure where the brief says so, that no test touches the real home directory, and that unknown signals are never scored as zero.

## Progress rules
Accepted tasks stay on the branch for review. Nothing is merged, deployed, scheduled or installed by the loop.
