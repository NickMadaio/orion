# Phase 75: Development Workflow — Implementation Packet

## Baseline

| Item | Value |
|------|-------|
| Commit | 9855d99 (2026-09-26) |
| Manifest phase | 75 ("Development Workflow") |
| entryRequiresPhase | 74 |
| entrySatisfied | true (recorded as deviation per AGENTS.md; phases 65/66 parked until Nick at keyboard) |
| Inspected source paths | `scripts/orion_v2_workflow_check.py` — workflow checker script; `plugin/orion-control/src/selfrepair.ts` — enforcement file list and repair classification |
| Limits | No installed device access; no native Swift/Python checks registered in local worker. Gate evidence treated as historical claims until matched to source symbols. |

## Requirement matrix

| Req ID | Status | Source symbol / evidence | Notes |
|--------|--------|--------------------------|-------|
| `checks_the_mechanically_checkable_steps` | Built | `scripts/orion_v2_workflow_check.py` — grades five mechanical steps: 8/10 (tests moved with source), 12 (security review recorded for enforcement path changes), 14 (HANDOFF.md moved), 15 (DATA_INVENTORY.json moved with capability surface), 18 (phase gate passes). Also verifies enforcement file list has not drifted from `plugin/orion-control/src/selfrepair.ts`. | Code exists and implements all five checks. |
| `does_not_let_one_model_design_implement_review_and_approve_its_own_security_work` | Proven | Step 12 in the workflow checker requires a recent independent review in `PHASE_GATES.json.reviews` for any change to enforcement-path files. Brief confirms independent review performed 2026-09-04; findings recorded in `postReviewCorrections`; repairs have named failing tests. | Mechanism exists and was exercised. |

## Architecture and interfaces

| Component | Role | Producer | Consumer | Serialized fields / state ownership | Errors |
|-----------|------|----------|----------|-------------------------------------|--------|
| Workflow checker (`scripts/orion_v2_workflow_check.py`) | Grades mechanical workflow steps | Script itself (reads git diff, `PHASE_GATES.json`, `selfrepair.ts`) | Human reviewer / CI runner | Prints graded results and checklist; no durable state written | Exit code 1 on failure; printed diagnostics name the failing step |
| Enforcement file list (`plugin/orion-control/src/selfrepair.ts` → duplicated in checker) | Canonical list of files subject to enforcement rules | `selfrepair.ts` defines `ENFORCEMENT_PLUGIN_FILES` | Checker verifies copy has not drifted | File path array; ownership in TypeScript plugin source | Drift detected → check fails with diff output identifying drifted entry |

## Smallest next slice

**Blocker:** Cannot produce a truthful implementation contract for registering the workflow checker because the native-check registry location is unknown. Per brief: "Native Swift and Python checks are not registered in the current local worker; propose a separately reviewed registry addition before those implementation contracts become executable."

**Exact reconnaissance needed:**
- `### SEARCH` for the check registry definition (e.g., `checkRegistry`, `registerCheck`, or similar) to identify the file and API for adding a Python-based native check.
- Confirm whether the worker supports arbitrary script execution or requires a specific wrapper format.

Until the registry path and interface are confirmed, any proposed contract would invent an API.

## Test scenarios

| Scenario | Type | Injectable seam | Expected outcome |
|----------|------|-----------------|------------------|
| Workflow checker runs on clean tree | Positive | Run `python3 scripts/orion_v2_workflow_check.py` against a commit with no enforcement changes and recent reviews | Exit 0; five mechanical steps graded pass; notes printed |
| Enforcement file list drifts | Failure | Modify a path in the checker's `ENFORCEMENT` set without updating `selfrepair.ts` | Check fails with "the enforcement list in this script has drifted" diagnostic; exit 1 |
| Enforcement change without recent review | Failure | Stage a change to an enforcement file (e.g., `approvals.ts`) and ensure no review dated ≥2026-09-01 exists in `PHASE_GATES.json.reviews` | Step 12 fails with "no review dated 2026-09-01 or later is recorded"; exit 1 |
| Capability surface change without inventory update | Failure | Stage a change to `catalog.ts` or `permissions.ts` without touching `DATA_INVENTORY.json` | Step 15 fails with "the capability surface changed and DATA_INVENTORY.json did not"; exit 1 |

*Fixture vs. device proof:* The workflow checker runs locally on the source tree; no installed device required. All scenarios are reproducible in the worktree.

## Gates and handoff

| Gate | Status | Notes |
|------|--------|-------|
| Entry gate (Phase 74 exit) | Satisfied | Recorded as deviation; Phase 74 closed before this phase opened |
| Independent review completed | Done | Performed 2026-09-04 by separate agent; findings in `postReviewCorrections` |
| Source evidence matched to claims | Done | This packet's reconnaissance confirmed both requirements map to existing source |
| Native-check registration | Pending | Python checker not registered in local worker; requires separately reviewed registry addition before implementation contracts become executable |

**Rollback:** This packet is documentation only. No source changes, no gate edits. If findings are wrong, the packet is corrected and re-reviewed.

**Reviewer handoff:** Verify cited symbols exist at worktree baseline (`scripts/orion_v2_workflow_check.py`, `plugin/orion-control/src/selfrepair.ts`). Confirm requirement matrix rows map to real source. Check that proposed next-slice contracts (once unblocked) do not expand authority beyond Phase 75 scope.
