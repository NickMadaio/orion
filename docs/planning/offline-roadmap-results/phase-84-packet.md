# Phase 84: Final ORION Mobile Product Shape

## Baseline
Inspected source paths:
- `scripts/orion-standing`: Node.js proactive system entry point; implements TODAY surface (waiting list, morning brief).
- `scripts/orion-agenda`: Node.js calendar/task query script; implements PLAN surface data retrieval.
- `plugin/orion-control/src/`: TypeScript plugin source; implements ORION control surfaces (approvals, strictness, automation, explain, prep, waiting) and CONTROL surface logic.
- `native/OrionMobile/Sources/MobileCore/Health.swift`: Swift domain type for HEALTH surface data (`HealthReading`).
- `native/OrionMobile/Sources/MobileCore/SecurityCenter.swift`: Swift domain type for authority/delegation state.
- `scripts/orion-readiness`: Python script assessing sixteen final success conditions.

Limits: No iOS app target exists in current worktree. Data surfaces exist in `scripts/` and `plugin/orion-control/src/`. The gap is a renderer, not a model.

## Requirement matrix

| ID | Status | Evidence / Source Symbol | Notes |
|---|---|---|---|
| delivers_today_plan_orion_health_and_control_surfaces | Not yet proven | `scripts/orion-standing` (TODAY), `scripts/orion-agenda` (PLAN), `plugin/orion-control/src/` (ORION/CONTROL), `native/OrionMobile/Sources/MobileCore/Health.swift` (HEALTH) | Data exists; renderer missing. No iOS app target in worktree. |
| is_not_considered_complete_merely_because_the_app_exists | Built | `scripts/orion-readiness` outputs 16 conditions with MET/PARTLY/NOT MET verdicts. Current: 8 met, 5 partly, 1 not met (iPhone as trusted approval device), 2 N/A. | Readiness script provides the evidence required by this condition. |

## Architecture and interfaces
Producer: `scripts/orion-standing`, `scripts/orion-agenda`, `plugin/orion-control/src/` modules, `native/OrionMobile/Sources/MobileCore/` domain types.
Consumer: Proposed iOS app renderer (not yet in worktree).
Seam: The proposed seam is the data contract between existing Node.js/Python scripts and Swift domain types. Specifically, `scripts/orion-standing` produces waiting list findings; `scripts/orion-agenda` produces calendar/task data; `plugin/orion-control/src/approvals.ts` produces authorization state; `native/OrionMobile/Sources/MobileCore/Health.swift` defines `HealthReading`. These are the actual producers. The consumer would be a new iOS view controller or SwiftUI view that renders these surfaces.
Serialized fields: JSON via `scripts/` output, Swift structs (`HealthReading`, `Delegation`).
State ownership: `SessionService` owns durable local state; scripts read from it. Errors: Scripts return exit codes and stderr; Swift types use Result/throws.

## Smallest next slice
Blocker: No iOS app target exists in the worktree. Adding a target changes the bundle's designated requirement and requires Nick at the keyboard (per brief evidence). This is an authority/provider decision not recorded as approved for automated addition.

Exact reconnaissance needed:
1. Confirm with Nick whether an iOS target can be added to the Xcode project without changing the bundle ID or signing identity in a way that breaks existing builds.
2. Identify the minimal set of Swift views required to render TODAY, PLAN, ORION, HEALTH, and CONTROL surfaces using existing data contracts.

Proposed contract (conditional on Nick's approval):
- Scope: `native/OrionMobile/Sources/MobileCore/TodayView.swift` (new), `native/OrionMobile/Sources/MobileCore/PlanView.swift` (new).
- Acceptance: Views render data from `scripts/orion-standing` and `scripts/orion-agenda` via a bridge or file read.
- Dependencies: iOS target exists, signing identity preserved.

## Test scenarios
Positive: Run `scripts/orion-readiness`; verify output contains 16 conditions with verdicts. Run `scripts/orion-standing`; verify it outputs waiting list findings. Run `scripts/orion-agenda today`; verify it outputs calendar data.
Failure: Inject stale revision in `scripts/orion-standing` by modifying the health file timestamp; verify it reports "unavailable" or "degraded" status rather than failing silently. Deny access to `plugin/orion-control/src/approvals.ts` by simulating a missing grant; verify action is blocked with clear error.

## Gates and handoff
Entry gate: Phase 83 (satisfied per manifest, though entrySatisfied is false due to deviation recording).
Remaining hands-on proof: Nick must add iOS target and approve bundle changes. Reviewer must verify cited symbols exist at baseline commit 9855d99.
Rollback: Report only; no source changes made.
Reviewer handoff: Verify `scripts/orion-standing`, `scripts/orion-agenda`, `plugin/orion-control/src/approvals.ts`, `native/OrionMobile/Sources/MobileCore/Health.swift` exist and match described behavior. Confirm blocker is genuine (no iOS target in worktree).
