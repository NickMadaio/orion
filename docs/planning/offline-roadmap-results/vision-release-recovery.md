# Vision: Release and Recovery Gates

## Baseline

**Inspected source paths:**
- `docs/planning/v2/ROADMAP_AMENDMENTS.json` (authority, recovery gates, capability homes)
- `docs/planning/v2/PRODUCT_VISION_DELIVERY_2026-09-07.md` (product vision, delivery order, current evidence)

**Limits:**
- No source changes permitted by this contract.
- Report maps existing modules to vision and enumerates remaining vertical slices.
- REC-* gates are additive; phase numbers 0–84 preserved.

## Requirement Matrix

| Req ID | Capability / Gate | Source Evidence / Status | Notes |
|---|---|---|---|
| REC-REVIEW-11-20 | Independent review recovery for Phases 11-20 | **Built/Proven**: `ROADMAP_AMENDMENTS.json` records status "satisfied", closedOn 2026-08-28, evidence in `PHASE_11_20_REVIEW_REPORT.md`. | 5 of 10 phases not complete as claimed; 64 defects found, 62 repaired. |
| REC-LIVE-FOUNDATION | Tangible v2 backend foundation | **Not yet proven**: `ROADMAP_AMENDMENTS.json` status "required". `PRODUCT_VISION_DELIVERY` notes missing production service; audited contracts exist in `backend/`. | Needs Nick's provider/budget decision. In-memory stand-ins currently used. |
| REC-AUTHORITY-REPLAY | Authority, approval consumption and replay safety | **Not yet proven**: `ROADMAP_AMENDMENTS.json` status "required". Live stack has `permissions.ts`, `validator.ts`, `provenance.ts`, `outcome.ts` in `plugin/orion-control`. | Gaps remain before live Calendar/Gmail writes. Approval consumption not fully durable. |
| REC-READONLY-CONNECTOR | First real read-only integration slice | **Not yet proven**: `ROADMAP_AMENDMENTS.json` status "required". Gmail wrappers exist but grant health not re-tested. | Must run through deployed v2 path with real provider responses. |
| REC-USABLE-CLIENT | Visible usable client slice | **Partially Built**: `PRODUCT_VISION_DELIVERY` notes Today/Plan present in installed Mac build 221/223/225. Phone shell missing. | MobileCore exists but no installable iPhone app target yet. REC-USABLE-CLIENT remains open. |
| REC-OPERATIONS | Reviewed batch checkpoint and recovery operations | **Not yet proven**: `ROADMAP_AMENDMENTS.json` status "required". Mixed-backlog grouping needs Nick's approval. | No commit/push made for recent batches; rollback/restore evidence needed. |

## Architecture and Interfaces

**Producer:**
- Swift clients (`native/Orion`, `native/OrionMobile`) own presentation, Apple framework access, and local durable state via `SessionDomain`/`SessionService`.
- TypeScript plugin (`plugin/orion-control`) owns local policy/action execution.
- Backend contracts (`backend/`) define ownership repositories but currently use in-memory storage.

**Consumer:**
- Mac app consumes planning signals, health data (via firewall), and calendar/task readers.
- Phone app (future) will consume synchronized state and durable commands/results.

**Serialized Fields / State Ownership:**
- Planning: `MobileCore` domain types (`DayPlan`, `Commitment`, `Task`). Owner-scoped repositories in backend.
- Health: `PlanningSignal` firewall separates raw health data from planning model.
- Authority: Approval signatures bound to canonical action/arguments/owner/device/expiry/nonce.

**Errors:**
- Unknown/stale data is never zero or success.
- Failures classified; retries only when safe and idempotent.
- Restart/offline/retry behavior proven through normal route.

## Smallest Next Slice

**Proposed Contract 1: Phone Shell and Minimal Durable Bridge**
- **Scope:** Create real SwiftUI iPhone target, connect one read-only Today route to local service.
- **Paths:** `native/OrionMobile/Sources/...`, `backend/adapters/...`
- **Dependencies:** REC-LIVE-FOUNDATION (partial), existing MobileCore contracts.
- **Acceptance Criteria:**
  1. Real SwiftUI iPhone target renders in Simulator.
  2. Read-only Today route shows current block/next commitment.
  3. Record ownership and stale/offline states proven.
  4. Reconnection after backend restart verified.
- **Escalation:** If provider selection is required before local implementation, BLOCKED.

**Proposed Contract 2: Unified Proactivity and Communications Queue**
- **Scope:** Durable attention queue for deadlines, emails, standing orders.
- **Paths:** `plugin/orion-control/...`, `backend/...`
- **Dependencies:** REC-AUTHORITY-REPLAY (partial), existing watcher contracts.
- **Acceptance Criteria:**
  1. Deadline/email/recovery suggestion enters same queue.
  2. Quiet hours/alert budget enforced.
  3. Duplicate source events yield one visible item.
  4. Restart preserves waiting items.
- **Escalation:** If privacy law or provider feasibility blocks, BLOCKED.

## Test Scenarios

**Positive Case: Read-Only Today Sync**
- **Inject:** Real calendar/task data via local readers.
- **Expected:** Phone UI shows current block and next commitment; backend records ownership.
- **Proof:** Simulator screenshot + backend log showing durable record creation.

**Failure Case: Backend Restart During Sync**
- **Inject:** Kill backend process during Today fetch.
- **Expected:** Phone shows "offline/stale" state; no partial data accepted; retry on reconnection.
- **Proof:** UI state change + backend log showing rejected stale write.

## Gates and Handoff

**Entry Gate:**
- REC-LIVE-FOUNDATION must be satisfied before enabling write/control paths.
- Nick's provider/budget decision recorded.

**Remaining Hands-On Proof:**
- Physical biometric proof (Face ID for approval).
- Device-loss recovery test.
- Real provider integration (Gmail/Calendar) with revocation audit.

**Rollback:**
- Local state preserved; backend records versioned.
- Undo available for plan revisions.

**Reviewer Handoff:**
- Verify source references in Requirement Matrix.
- Confirm no phase renumbering or automatic closure.
- Check that REC-* gates remain additive and not mechanically enforced by phase checker.
