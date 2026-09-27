# Vision: Attention, Watchers and Communications

## Baseline

Inspected sources for this assessment:
- `scripts/lib/orion-automation-runtime.mjs` — candidate host runtime; loads installed policy/ledgers, dispatches automation via adapters. Exports `runInstalledAutomation`.
- `docs/planning/v2/PRODUCT_VISION_DELIVERY_2026-09-07.md` — product vision delivery document; defines capability requirements and architecture direction.

Limits: No source changes in this task. Report only maps existing evidence to requirements and proposes bounded next slices. Missing source in committed worktree is recorded as unavailable, not recreated.

## Requirement matrix

| Req ID | Capability | Source evidence / symbol | Status |
|---|---|---|---|
| REQ-ATTN-01 | Unified attention queue for watchers, commitments, messages | No unified queue exists. `scripts/lib/orion-automation-dispatch.mjs` dispatches per-installation with independent phase state; no cross-watcher aggregation. Vision doc §Proactivity and watchers describes the target. | Not yet proven — needs new attention-queue module |
| REQ-ATTN-02 | Scoring: urgency, importance, novelty, confidence, actionability, interruptibility | No scoring logic found in any inspected source. `scripts/lib/orion-automation-admission.mjs` checks conditions (quiet hours, focus, mode, budget) but does not score items. Vision doc §Proactivity and watchers lists dimensions. | Not yet proven — needs scoring module |
| REQ-ATTN-03 | Quiet/focus/budget governs delivery | `scripts/lib/orion-automation-admission.mjs`: `checkConditions()` enforces `quietHours` (rejects with `"quiet_hours"`), `skipDuringFocus` (rejects with `"focus_active"`/`"focus_unknown"`), daily run/message limits (`"daily_limit"`/`"daily_message_limit"`). Mode matching via `expectsMode`. | Built |
| REQ-ATTN-04 | Low priority items wait in Today | No priority routing exists. `scripts/lib/orion-automation-runtime.mjs` only supports `agenda_today` action which writes to Today, but there is no scoring or priority-based deferral logic. Today/Plan UI exists (build 225) consuming calendar/reminders via MobileCore. | Not yet proven — needs attention-to-Today routing |
| REQ-ATTN-05 | Read-only mail precedes drafts | No Gmail/mail source integration found in inspected sources. Vision doc §Email and messages states "Prove a read-only source, then triage and reviewable drafts." Backend inbox/draft/send contracts exist per vision but not in committed worktree. | Not yet proven — needs mail watcher implementation |
| REQ-ATTN-06 | Expiring recipient/topic delegation never follows implicitly | No delegation logic exists. Vision doc §Email and messages: "later add expiring recipient/topic-scoped delegation." `scripts/lib/orion-automation-dispatch.mjs` has `delivery.targetId` but no expiry or topic scoping on delegation. | Not yet proven — needs delegation module with expiry |
| REQ-ATTN-07 | Watchers persist cursor, source freshness, dedup key, delivery ack | Per-installation persistence exists: `scripts/lib/orion-automation-dispatch.mjs` persists dispatch state (`phase`, `lastAt`, `lastSlot`, `lastDelivery`) to `${key}.dispatch.json`. Admission state persists budget counters. No cross-watcher cursor or source freshness tracking. Idempotency key used for delivery messages via `digest(\`${record.installationId}:${slot}\`)`. | Partial — per-automation persistence exists; cross-watcher cursor/freshness missing |
| REQ-ATTN-08 | Deduplication: duplicate source events yield one visible item | Per-installation dedup via civil-slot comparison in `scripts/lib/orion-automation-dispatch.mjs`: `duplicate_or_old_trigger` refusal when `slot <= state.lastSlot`. No cross-watcher dedup. Delivery uses idempotency key. | Partial — per-automation dedup exists; cross-watcher dedup missing |

## Architecture and interfaces

**Actual producer/consumer mapping from inspected sources:**

| Role | Module | Symbol | What it does today |
|---|---|---|---|
| Producer (single automation) | `scripts/lib/orion-automation-runtime.mjs` | `runInstalledAutomation(name, scheduledAt, adapters)` | Loads one installed JSON record, validates immutability, delegates to dispatch. Only `agenda_today` action supported. |
| Admission guard | `scripts/lib/orion-automation-admission.mjs` | `checkAutomationConditions()`, `reserveAutomationRun()`, `checkConditions()` | Enforces quiet hours, focus skip, daily budget, mode match, expiry. Returns `{ admitted, reason }`. |
| Dispatcher | `scripts/lib/orion-automation-dispatch.mjs` | `dispatchAutomation(root, value, scheduledAt, adapters)` | Per-installation state machine: ready→pending→action_completed→delivery_pending→ready. Deduplicates by civil slot. Persists to `${key}.dispatch.json`. |
| Host checks | `scripts/lib/orion-automation-host.mjs` | `createAutomationHostChecks()` → `readContext()`, `authorize()` | Reads effective mode, focus state (native + legacy), authority map. No scoring or aggregation. |
| Consumer (Today/Plan) | `native/OrionMobile/Sources/MobileCore/DailyPlanning.swift` | `DayPlan.propose` | Proposes day timeline from commitments/tasks. Connected in build 225 per vision update. Not in committed worktree for inspection. |

**Proposed seam — what is missing:**
- **Producer gap**: No unified attention queue. Each automation dispatches independently; no module aggregates outputs into a shared priority-sorted list.
- **Consumer gap**: Today/Plan consumes calendar/reminders via MobileCore but has no path to receive scored attention items from watchers.
- **Serialized fields needed**: Attention item record carrying `id`, `source`, `observedAt`, `urgency`, `importance`, `novelty`, `confidence`, `actionability`, `interruptibility`, `dedupKey`, `deliveryAck`. Vision doc §Architecture names Observation, Commitment, Task as versioned records.
- **State ownership**: Watcher cursor/freshness per source (not yet persisted cross-watcher); queue state in durable store; Today/Plan owns display ordering.
- **Error contract**: Outage → "not checked" label (never "nothing important"); duplicate by `dedupKey` → single visible item; restart preserves waiting items via durable queue state.

## Smallest next slice

**Blocker**: No unified attention queue, scoring module, or cross-watcher deduplication exists in committed source. The runtime dispatches individual automations independently (`scripts/lib/orion-automation-dispatch.mjs`), each with its own phase state and per-installation dedup by civil slot. There is no aggregation point, no priority scoring, and no shared durable queue that watchers could write into and Today/Plan could read from.

**Exact reconnaissance needed before a truthful contract can be written:**
1. SEARCH for any existing attention-queue, priority-scoring, or cross-watcher aggregation module in `scripts/lib/`, `plugin/orion-control/`, or `backend/`. If none exists, the first slice must create one.
2. READ `native/OrionMobile/Sources/MobileCore/DailyPlanning.swift` (if available in worktree) to determine whether an attention-item type already exists or must be proposed alongside the queue.
3. Identify the durable store path used by Today/Plan for persisted state — needed to decide whether the attention queue writes into the same store or a separate one with a sync seam.

**PROPOSED contract (conditional on reconnaissance confirming no queue exists):**

```json
{
  "title": "Attention queue foundation",
  "objective": "Create a durable, in-process attention queue module that accepts scored items from watchers and exposes them for Today/Plan consumption.",
  "scope": [
    "scripts/lib/orion-attention-queue.mjs",
    "scripts/lib/orion-attention-scoring.mjs"
  ],
  "acceptance_criteria": [
    "Queue accepts items with id, source, observedAt, dedupKey and six score dimensions.",
    "Duplicate dedupKey within configurable window yields single entry.",
    "Items are sorted by composite score (urgency weighted highest).",
    "Queue state persists to JSON file and survives process restart.",
    "Quiet hours filter suppresses delivery of low-urgency items during configured range.",
    "Focus-active context suppresses non-critical items.",
    "Empty queue returns empty list, never 'nothing important' on source outage.",
    "Existing admission module (quietHours, skipDuringFocus, budget) is reused, not duplicated."
  ],
  "dependencies": [
    "scripts/lib/orion-automation-admission.mjs (existing)",
    "scripts/lib/orion-automation-dispatch.mjs (existing)"
  ],
  "existing_checks": ["doc-report"],
  "api_signatures": [
    "export async function enqueueItem(queuePath, item): EnqueueResult",
    "export async function readSortedItems(queuePath, context): AttentionItem[]",
    "export function computeScore(item): { urgency, importance, novelty, confidence, actionability, interruptibility }"
  ],
  "escalation": "If MobileCore already defines an attention-item type, the queue must match its schema — requires READ of DailyPlanning.swift before implementation."
}
```

If reconnaissance finds an existing queue or scoring module, this contract is replaced with an integration contract that wires it to Today/Plan.

## Test scenarios

**Scenario A — Positive: watcher item enters queue and surfaces in Today**
- **Inject**: Call `enqueueItem(queuePath, { id: "visa-deadline-1", source: "visa-watcher", observedAt: now, dedupKey: "visa:app123:deadline", urgency: 8, importance: 7, novelty: 3, confidence: 9, actionability: 6, interruptibility: 2 })`.
- **Seam**: `scripts/lib/orion-attention-queue.mjs` (proposed) enqueue path.
- **Expected state**: Queue file contains one entry; `readSortedItems()` returns it ranked by composite score.
- **Product-visible result**: Today view shows the visa deadline item with appropriate urgency indicator.
- **Proof type**: Fixture (in-process queue test). Installed proof requires watcher→queue→Today end-to-end in Mac build.

**Scenario B — Failure: duplicate dedupKey suppressed**
- **Inject**: Enqueue same `dedupKey` twice within the dedup window (default 5 minutes).
- **Seam**: Queue write path with mocked clock.
- **Expected state**: Queue file still contains exactly one entry; second enqueue returns `{ status: "deduplicated", existingId: "visa-deadline-1" }`.
- **Product-visible result**: Today shows the item once, never twice.
- **Proof type**: Fixture.

**Scenario C — Failure: source outage yields "not checked"**
- **Inject**: Watcher adapter throws `Error("source_unavailable")` during polling cycle; queue's `readSortedItems()` is called with `context.sources["visa-watcher"].lastCheck = null`.
- **Seam**: Watcher output adapter (mocked failure); queue read path.
- **Expected state**: Queue returns existing items plus a sentinel or label indicating "visa-watcher: not checked" — never an empty list implying "nothing important."
- **Product-visible result**: Today shows stale/outage indicator for that source.
- **Proof type**: Fixture. Installed proof requires actual network outage simulation.

**Scenario D — Failure: quiet hours suppress low-urgency delivery**
- **Inject**: Enqueue item with `urgency: 2` during configured quiet hours (e.g., 23:00–07:00). Context from `orion-automation-admission.mjs` `checkConditions()` returns `{ admitted: false, reason: "quiet_hours" }`.
- **Seam**: Admission module reused by queue delivery filter.
- **Expected state**: Item persists in queue but is excluded from `readSortedItems()` delivery set; marked as deferred until quiet hours end.
- **Product-visible result**: Item does not appear in Today during quiet hours; appears after quiet period ends.
- **Proof type**: Fixture with mocked clock and admission context.

**Scenario E — Failure: restart preserves waiting items**
- **Inject**: Enqueue item, then simulate process restart by re-reading queue file from disk without re-enqueuing.
- **Seam**: Queue persistence layer (`persist()` to JSON).
- **Expected state**: Item present after reload; `dedupKey`, scores, and `observedAt` unchanged.
- **Product-visible result**: Today still shows the item after app restart.
- **Proof type**: Fixture. Installed proof requires Mac quit/reopen test (per build 221 precedent).

## Gates and handoff

**Entry gate**: Reconnaissance must confirm whether an attention queue, scoring module, or cross-watcher aggregation already exists in committed source. Specifically:
- SEARCH results for "attention", "queue", "score", "priority" across `scripts/lib/`, `plugin/orion-control/src/`, `backend/`.
- READ of `native/OrionMobile/Sources/MobileCore/DailyPlanning.swift` if available, to check for existing attention-item types.
- If any of these exist, the proposed contract must be revised to integrate rather than create.

**Remaining hands-on proof** (after queue foundation is implemented):
1. Installed Mac test: deadline watcher → queue → Today shows item once; duplicate suppressed.
2. Installed Mac test: source outage → "not checked" label visible, never empty silence.
3. Installed Mac test: quit/reopen preserves waiting items in Today.
4. Quiet hours test: low-urgency item deferred during configured range, delivered after.
5. Focus mode test: non-critical items suppressed when `focusActive === true`.

**Rollback**: This task writes only `docs/planning/offline-roadmap-results/vision-attention-communications.md`. No source changes. Rollback is deletion of this file.

**Reviewer handoff checklist**:
- [ ] Every requirement row cites a real source symbol, path, or explicit "Not yet proven" with specific gap.
- [ ] Architecture section names actual producers/consumers from inspected files, not inferred ones.
- [ ] Proposed contract stays within scope (≤3 write paths, ≤8 acceptance criteria).
- [ ] Test scenarios distinguish fixture from installed/device proof.
- [ ] No phase numbers renumbered; no recovery gates closed.
- [ ] No provider selection or authority grant implied.
