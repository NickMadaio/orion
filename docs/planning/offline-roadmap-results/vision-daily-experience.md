# Vision Daily Experience Report

## Baseline
- Inspected source paths:
  - `native/Orion/Sources/Orion/TodayPlanModel.swift` (primary ownership boundary for Today/Plan)
  - `docs/planning/v2/PRODUCT_VISION_DELIVERY_2026-09-07.md` (product vision and delivery context)
- Limits: Source references only; no speculative rewrites. Report maps existing code to vision gaps.

## Requirement Matrix
| Req ID | Capability | Source Evidence / Status | Notes |
|--------|------------|--------------------------|-------|
| REQ-1  | Keep local plan revisions authoritative | Built: `TodayPlanModel` uses `TodayPlanStore`, tracks `document.revision`, passes `expectedRevision` to `accept()`/`undo()`. Handles `.revisionConflict` by reloading. | Revision authority is implemented in the store/model layer. |
| REQ-2  | Connect completion, running late and focus outcomes to explainable replan/undo | Built: `preview(_:)` handles `.finish`, `.moreTime`, `.replan`. Each generates a human-readable `reason` string. `undo()` reverts to previous revision. | Explainability is present via `reason` strings in proposals. |
| REQ-3  | Preserve fixed events, off-hours, transition time and stale-source labels | Built: `TodayPlanScheduler.propose` consumes `commitments` (fixed events) and `preferences` (off-hours/transitions). Stale sources detected via `sourceFingerprint`, `hasUsableSources()`, and `validateSources`. Throws `.staleSources` if invalid. | Constraints are passed to scheduler; staleness is checked before preview/accept. |
| REQ-4  | Inspect existing phone EventKit work without duplicating it | Built: `TodayPlanModel` consumes `AppleCalendarSync` and `AppleRemindersSync` via `TodayPlanCalendarSource` and `TodayPlanRemindersSource` protocols. No duplicate EventKit logic in model. | Phone/shared adapters are abstracted behind protocols; model is pure consumer. |

## Architecture and Interfaces
- **Producer**: `TodayPlanScheduler.propose` (in MobileCore) generates a `TodayPlan` from inputs, commitments, preferences, pins. `TodayPlanModel.preview(_:)` calls it with current state.
- **Consumer**: `TodayPlanModel` owns the published `proposal: TodayPlan?` and `document: TodayPlanDocument`. UI observes these via `@Published`. Accept/undo flow writes through `TodayPlanStore`.
- **Serialized fields**: `TodayPlanDocument` carries `revision: Int`, `current: TodayPlan?`, undo history. `TodayPlan` carries `sourceFingerprint`, `preferences`, `generatedAt`, `blocks: [PlannedBlock]`, `completedIDs`. Fingerprint guards stale-source acceptance.
- **State ownership**: `TodayPlanStore` (durable local) owns persisted revisions. `TodayPlanModel` owns in-memory proposal and input validation. `AppleCalendarSync`/`AppleRemindersSync` are read-only sources behind protocols; model never writes to them.
- **Errors**: `TodayPlanError.revisionConflict` on concurrent write — reloads document. `.staleSources` when inputs changed between preview and accept. `.unknownBlock` for invalid finish/pin/unpin target. Source unavailability sets `sourceMessage` without throwing.

## Smallest Next Slice

### Slice 1: Installed Today/Plan Acceptance Scenarios (Mac)
**Objective**: Prove the existing `TodayPlanModel` implementation satisfies acceptance criteria in an installed build, not just unit tests.
**Scope**: `native/Orion/Sources/Orion/TodayPlanModel.swift` (read-only), `native/Orion/Sources/Orion/TodayPlanStore.swift` (read-only). No source changes.
**Acceptance Criteria**:
1. Early finish scenario: Finishing a task early preserves bedtime/off-hours constraints in the replan.
2. Conflict scenario: Overlapping hard commitments surface a visible conflict rather than silent overlap.
3. Persistence scenario: App restart preserves the accepted plan revision and pins.
4. Idempotency scenario: Duplicate completion of an already-finished task changes state only once.
**Dependencies**: Installed build with Today/Plan UI connected to `TodayPlanModel`.
**Existing Checks**: None registered for installed proof; requires manual or scripted UI verification.
**API Signatures**: Uses existing `preview(.finish)`, `accept()`, `undo()` on `TodayPlanModel`.
**Escalation**: If installed build lacks Today/Plan UI, escalate to build/release owner.

### Slice 2: Phone Today Read-Only Bridge (Preparation)
**Objective**: Define the contract for a read-only Today view on iPhone, consuming Mac-durable state via local network or shared storage.
**Scope**: Contract definition only. No implementation.
**Blocker**: Missing iPhone application target and REC-USABLE-CLIENT foundation.
**Reconnaissance Needed**: Inspect `native/OrionMobile` for existing SwiftUI shells; verify `SessionService` remote transport contracts.

## Test Scenarios

### Scenario 1: Positive — Early Finish Replan
- **Inject**: Call `preview(.finish("task-id"))` then `accept()` on a plan with off-hours ending at 22:00.
- **Expected State**: New proposal generated; remaining tasks shifted but none scheduled after 22:00. `document.revision` incremented.
- **Product Result**: UI shows updated timeline; bedtime constraint respected.

### Scenario 2: Failure — Stale Source Acceptance
- **Inject**: Call `preview(.plan)`, then modify underlying calendar data (simulated by changing `inputs.fingerprint`), then call `accept()`.
- **Expected State**: `accept()` returns early with error "The preview or its sources changed...". `document` unchanged.
- **Product Result**: User sees error message; no silent corruption of plan.

### Scenario 3: Positive — Conflict Surface
- **Inject**: Add a commitment overlapping an existing pinned task via `preview(.replan)`.
- **Expected State**: Proposal generated with conflict indication or unscheduled block; no overlap in serialized blocks.
- **Product Result**: UI highlights conflict or shows unscheduled item for user resolution.

### Scenario 4: Failure — Revision Conflict Recovery
- **Inject**: Simulate concurrent write by having `store.accept` throw `.revisionConflict`.
- **Expected State**: `TodayPlanModel` reloads document from store; `error` set to localized description; UI reflects latest revision.
- **Product Result**: User sees updated state without crash; can retry action.

## Gates and Handoff

### Entry Gate
- Installed Mac build with Today/Plan UI connected to `TodayPlanModel` (Build 221+).
- Calendar and Reminders permissions granted for testing.
- No pending source changes in `native/Orion/Sources/Orion`.

### Remaining Hands-On Proof
1. **Installed Acceptance**: Run Scenarios 1–4 on physical Mac or Simulator with real EventKit data. Record pass/fail.
2. **Phone Bridge Contract**: Review `SessionService` remote transport for feasibility of read-only Today sync.
3. **Provider Decision**: Nick must select backend provider before Slice 2 implementation begins (non-scope for this task).

### Rollback
- Report changes are documentation-only; no source rollback needed.
- If installed proof fails, record specific failure modes in report and escalate to implementation owner.

### Reviewer Handoff
- Verify requirement matrix citations against `TodayPlanModel.swift`.
- Confirm smallest next slice is bounded (no new source writes).
- Check that test scenarios map to acceptance criteria in brief Step 2.
