# Phase 62: Waiting-On Tracking

## Baseline
- **Inspected source paths**:
  - `plugin/orion-control/src/waiting.ts` — exports `WaitingItem`, `validateItem`, `overdue`, `pending`, `draftFollowUp`, `civilToday`, `daysLate`, `MAX_SURFACES`
  - `plugin/orion-control/src/catalog.ts` — `ACTION_CATALOG` entries with `capabilityTier === "waiting_on"` (six actions)
  - `scripts/orion-standing` — functions `readWaiting()`, `waitingFindings()`; constant `WAITING_FILE`
- **Limits**: No installed device access; native checks not registered in local worker. Source inspected at worktree baseline commit 9855d99.

## Requirement matrix

| Requirement ID | Status | Evidence / Source Symbol | Notes |
|---|---|---|---|
| tracks_user_initiated_requests_awaiting_responses | Built | `WaitingItem` type in `plugin/orion-control/src/waiting.ts`; `validateItem()` enforces non-empty `expect` and required `dueBy`; six actions in `ACTION_CATALOG` under tier `waiting_on` | Store is `~/.openclaw/orion-controlled/waiting.json`. Every item names `expect` (observable ending event). Validated by test "insists on the event that would end it" in `gate.test.ts`. |
| surfaces_overdue_items | Built | `overdue()` and `pending()` in `plugin/orion-control/src/waiting.ts`; `waitingFindings()` in `scripts/orion-standing` filters for `status === "open"`, `dueBy < day`, not snoozed, `surfaced < 5`. Surfacing is morning-only: `readWaiting()` called only when `resolved === "morning"` in `orion-standing`. | Morning-only enforced by code path. Cap of 5 enforced by `MAX_SURFACES` constant and test "stops nagging without forgetting". Corrupt store returns `degraded` status, not empty list. |
| allows_dismiss_remind_later_and_draft_follow_up | Built | `draftFollowUp()` in `plugin/orion-control/src/waiting.ts`; snooze via `snoozedUntil` field checked in `overdue()` and `waitingFindings()`. Test "drafts a follow-up and cannot send one" asserts no waiting action reaches a person: execution kind is `"waiting"`, no send/message/mail in execution definition. | Draft writes text onto record only. Six actions pinned by test; none have outbound delivery. Dismiss/snooze are trivial state changes on the record. |

## Architecture and interfaces
- **Producer**: `plugin/orion-control` — the six `waiting_on` tier actions in `ACTION_CATALOG` write to `~/.openclaw/orion-controlled/waiting.json`. Actions include create, update, dismiss, snooze, draft, and list operations.
- **Consumer**: `scripts/orion-standing` — reads the store via `readWaiting()` during morning passes only. `waitingFindings()` computes overdue items and formats them for surfacing.
- **Serialized fields**: `WaitingItem` type: `id`, `what`, `who`, `expect` (observable ending event), `since`, `dueBy`, `status` (`open`/`resolved`/`dismissed`), `surfaced` (count), `snoozedUntil` (optional ISO date). Store wrapper: `{ version: 1, items: WaitingItem[] }`.
- **State ownership**: Orion-owned JSON file at `~/.openclaw/orion-controlled/waiting.json`. Plugin writes; standing orders read-only.
- **Errors**: Corrupt/unreadable store returns `{ status: "degraded", reason: ... }` and is surfaced as a blind spot, never as an empty list. Missing file returns `{ status: "skipped" }`.

## Smallest next slice
Phase 62 requirements are all Built and evidenced in source. No implementation contract is needed. The remaining gap is **proof**: the tests exist in `plugin/orion-control/src/gate.test.ts` (describe block "phase 62: what Nick is waiting on") but native/device integration proof requires installed access not available to this worker.

**Proposed next contract** (for reviewer registration, if device access becomes available):
None required for implementation. If device-level proof is needed, a separate investigation packet should be raised to verify `orion-standing morning` output against a fixture store containing overdue items.

## Test scenarios

### Positive cases
1. **Overdue item surfacing**: 
   - Inject: Write `waiting.json` with an open item where `dueBy` is yesterday and `surfaced < 5`.
   - Command: `node scripts/orion-standing morning --now 2026-09-03T09:00`
   - Expected: Output contains the overdue item text, including who, what, days past, and expect field.

2. **Snoozed item suppression**:
   - Inject: Write `waiting.json` with an open item where `dueBy` is yesterday but `snoozedUntil` is tomorrow.
   - Command: `node scripts/orion-standing morning --now 2026-09-03T09:00`
   - Expected: Output does NOT contain the snoozed item.

3. **Draft follow-up generation**:
   - Inject: Call `draftFollowUp(item, now)` in test context.
   - Expected: Returns text containing key details from the item (what, who, days late). Does not trigger any outbound message action.

### Failure cases
1. **Corrupt store handling**:
   - Inject: Write invalid JSON to `waiting.json`.
   - Command: `node scripts/orion-standing morning --now 2026-09-03T09:00`
   - Expected: Output reports "Waiting list: ... is unreadable" as a blind spot. Does NOT crash or return empty list silently.

2. **Missing store handling**:
   - Inject: Delete `waiting.json`.
   - Command: `node scripts/orion-standing morning --now 2026-09-03T09:00`
   - Expected: No waiting-related output (status "skipped" is silent).

3. **Surfacing cap enforcement**:
   - Inject: Write `waiting.json` with an overdue item where `surfaced >= MAX_SURFACES` (5).
   - Command: `node scripts/orion-standing morning --now 2026-09-03T09:00`
   - Expected: Item is NOT surfaced in output.

4. **Hourly check suppression**:
   - Inject: Write `waiting.json` with an overdue item.
   - Command: `node scripts/orion-standing check --now 2026-09-03T14:00`
   - Expected: No waiting-related output (waiting is morning-only).

## Gates and handoff
- **Entry gate**: Phase 61 satisfied (confirmed in brief: `entrySatisfied: true`).
- **Remaining hands-on proof**: 
  - Unit tests in `gate.test.ts` cover logic correctness but require local execution to verify.
  - Integration proof requires running `orion-standing` against a real or fixture store on an installed device.
  - Native check registration is not available in this worker environment.
- **Rollback**: No source changes made; report only. If evidence proves insufficient, phase remains open with "Not yet proven" status.
- **Reviewer handoff**: Verify cited symbols exist at baseline commit 9855d99. Confirm test scenarios are executable against the described seams. Assess whether device-level proof is required for closure or if unit test coverage suffices.
