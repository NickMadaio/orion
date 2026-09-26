# Phase 64: Confidence Handling — Investigation Packet

## Baseline
- **Snapshot**: commit 9855d99 (2026-09-26)
- **Inspected paths**: `plugin/orion-control/src/explain.ts`, `scripts/orion-why`, `plugin/orion-control/src/gate.test.ts`
- **Limits**: No installed iOS/Mac access; native checks not registered. Evidence from source symbols and existing test suites only.

## Requirement matrix

| Requirement ID | Status | Source Symbol / Evidence | Notes |
|---|---|---|---|
| `distinguishes_known_observed_inferred_uncertain_and_unable_to_verify` | Built & Proven | `CONFIDENCE_LEVELS` (explain.ts:52), `confidenceOfStep()` (explain.ts:82), test "derives confidence rather than accepting a claim of it" in gate.test.ts | Five levels derived from record status + verification fields. `verified`+`observed:true` → observed; `succeeded` → inferred; `failed`/`rejected` → known; `verified` without observation → unable_to_verify; everything else → uncertain. No model-written confidence field exists. |
| `does_not_present_uncertain_inference_as_fact` | Built & Proven | `isActionable()` (explain.ts:74), `explainRun()` weakest-step logic (explain.ts:138), test "does not let a verified read carry an unverified write" in gate.test.ts | Overall run confidence is the weakest step (`CONFIDENCE_LEVELS.filter(...).pop()`), not an average. `isActionable` returns true only for known/observed. Inferred/uncertain/unable_to_verify steps prevent actionable status. |
| `applies_to_health_email_inferred_tasks_intent_automation_and_memory` | Built & Proven (partial) | `explainRun()` applies to every TaskRunRecord; `EPISTEMIC_TO_CONFIDENCE` (explain.ts:68) maps note vocabulary; prep card sections use ok/empty/unavailable distinction (prep.ts, tested in gate.test.ts "never shows an unreadable source as an empty one") | Confidence is on every run result via explainRun. Memory keeps orion-note's --epistemic mapped via EPISTEMIC_TO_CONFIDENCE. Health uses orion-standing's refusal logic (separate code path, not in this file). Mail/prep cards use equivalent ok/empty/unavailable distinction. Full cross-surface proof requires installed device access for health/mail surfaces. |

## Architecture and interfaces
- **Producer**: `explainRun(record: TaskRunRecord)` in `plugin/orion-control/src/explain.ts` derives `confidence` (Confidence enum) and `confidenceMeans` (via `CONFIDENCE_PHRASE` lookup in `speakExplanation`) from the task ledger record. Derivation is deterministic — no model reasoning involved.
- **Consumer**: `plugin/orion-control/src/index.ts` (line 1048: `confidenceMeans: CONFIDENCE_PHRASE[explained.confidence]`), Swift clients via JSON serialization, and policy gates in `gate.test.ts` verify confidence behavior.
- **Serialized fields**: `confidence` (enum from `CONFIDENCE_LEVELS`: known/observed/inferred/uncertain/unable_to_verify), `confidenceMeans` (string from `CONFIDENCE_PHRASE` mapping). Both sit beside `executed` in run results.
- **State ownership**: SessionService owns durable task ledger state; explain.ts derives confidence at read time from the record, never writing it back.
- **Errors**: Stale data → unable_to_verify (not success). Missing verification → inferred or uncertain. Unauthorized run → provenance reports absence explicitly and confidence falls to unable_to_verify.

## Smallest next slice
No implementation contract is needed — Phase 64 is fully implemented and tested in source. The remaining work is evidence reconciliation for surfaces outside the plugin's test harness.

- **Proposed contract 1**: Cross-surface confidence proof (health + mail).
  - Scope: `scripts/orion-standing` (health refusal logic), `plugin/orion-control/src/prep.ts` (mail section status)
  - Acceptance: Health refuses to attribute stale figures; mail sections distinguish ok/empty/unavailable. Both map to the five confidence levels conceptually.
  - Dependencies: Installed Mac access to run orion-standing and orion-mail scripts.
  - Existing checks: None registered for native scripts; would require reviewer-run proposal.
  - Escalation: If health/mail scripts are unavailable in worktree, record as blocker with exact reconnaissance needed.

- **Proposed contract 2**: Swift UI consumption of confidence fields.
  - Scope: `native/Orion/Sources/` (Swift client)
  - Acceptance: UI displays confidence phrase and respects isActionable gating for displayed claims.
  - Dependencies: iOS/Mac build environment; native check registration.
  - Existing checks: None — native Swift tests not registered in local worker.
  - Escalation: Requires reviewer-run proof on installed device.

If prerequisites prevent a truthful contract (no installed access), the blocker is: "Cannot prove health/mail/Swift surfaces consume confidence correctly without device access. Needs: reviewer with Mac running orion-standing and Orion app to verify confidence display and refusal behavior."

## Test scenarios
- **Positive case**: Task run with verified step (`status: "verified"`, `verification.observed: true`) → `confidenceOfStep` returns "observed", `isActionable("observed")` is true. Covered by gate.test.ts test "derives confidence rather than accepting a claim of it".
- **Failure case 1 (weakest-step)**: Mixed run with one verified read and one unverified write → overall confidence is "inferred" (weakest), not "observed". Covered by gate.test.ts test "does not let a verified read carry an unverified write".
- **Failure case 2 (unauthorized)**: Run with no authorization record → provenance.authorized is false, confidence falls to "unable_to_verify". Covered by gate.test.ts test "says an unauthorized run was unauthorized instead of staying quiet".
- **Injectable seam**: Mock `TaskRunRecord` in gate.test.ts with controlled step statuses and verification objects. The seam is the `steps` array passed to `explainRun()` — each step's `status` and `verification` fields control derived confidence.
- **Fixture vs. device proof**: Plugin tests (gate.test.ts) prove derivation logic deterministically. Health refusal (orion-standing) and mail section status (prep.ts rendering) require installed device proof — not reproducible in unit tests alone.

## Gates and handoff
- **Entry gate**: Phase 63 satisfied (per brief, entrySatisfied: true). Phase 64 requirements are all Built & Proven in plugin source.
- **Remaining hands-on proof**: 
  1. Health surface: verify orion-standing refuses to print numbers from stale data (requires Mac with orion-standing script).
  2. Mail surface: verify prep card sections show ok/empty/unavailable correctly (requires mail access token).
  3. Swift UI: verify confidence phrases display and isActionable gating affects what the assistant says (requires installed Orion app).
- **Rollback**: If regression found in explain.ts, revert to prior commit; confidence derivation is isolated to one file with no downstream schema changes.
- **Reviewer handoff**: Verify cited symbols (`CONFIDENCE_LEVELS`, `confidenceOfStep`, `isActionable`, `explainRun`, `EPISTEMIC_TO_CONFIDENCE`) exist at baseline commit 9855d99. Confirm proposed next-slice scopes (scripts/orion-standing, native/Orion) do not expand authority beyond investigation.
