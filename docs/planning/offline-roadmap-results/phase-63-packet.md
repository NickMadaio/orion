# Phase 63: Explainability Evidence and Next Slice

## Baseline
- **Inspected Source Paths**: `plugin/orion-control/src/explain.ts` (explainability assembly), `scripts/orion-why` (CLI consumer), `plugin/orion-control/src/gate.test.ts` (tests for phases 63/64).
- **Limits**: No installed device access; evidence is source-grounded only. Native checks not registered in local worker. All three files exist at worktree baseline commit 9855d99.

## Requirement Matrix

| Requirement ID | Status | Evidence / Source Symbol | Notes |
| :--- | :--- | :--- | :--- |
| `every_consequential_recommendation_supports_why` | Built | `scripts/orion-why` CLI reads task ledger and calls `explainRun()` from `plugin/orion-control/src/explain.ts`; supports `orion-why last N`, `orion-why <taskId>`, and `orion-why can <capability>` (delegates to `orion-authority`). | Covered by tests in `gate.test.ts` describe block `"phases 63/64: why, and how sure"`. |
| `exposes_inputs_evidence_policy_provenance_and_constraints` | Built | `explainRun()` in `plugin/orion-control/src/explain.ts` returns `RunExplanation` with fields: `steps` (inputs + evidence verbatim from record), `policy` (read from `ACTION_CATALOG`), `provenance` (authorization/trust anchor), `constraints` (validator issues verbatim). | Tests verify each field: `"quotes evidence and never invents it"`, `"reports the policy from the catalog"`, `"says an unauthorized run was unauthorized"`, `"passes every constraint through verbatim"`. |
| `does_not_expose_private_hidden_chain_of_thought` | Built | Design decision in both `explain.ts` and `orion-why`: explanations are assembled by deterministic code from durable records (task ledger, catalog metadata, trust anchor), never narrated by the model. The model does not answer "why" at all. | File comments document this explicitly; no model-invoking path exists in either file. |

## Architecture and Interfaces
- **Producer**: `plugin/orion-control/src/explain.ts` exports `explainRun(record: TaskRunRecord): RunExplanation` and `speakExplanation(explanation: RunExplanation): string`. Assembles structured explanation from task ledger records, ACTION_CATALOG metadata, and authorization data.
- **Consumer**: `scripts/orion-why` Node.js CLI reads `~/.openclaw/orion-controlled/task-ledger.jsonl`, calls `explainRun()` via plugin loader, outputs human-readable or JSON explanations. Delegates capability questions to `scripts/orion-authority`.
- **Serialized Fields**: `RunExplanation` interface with `taskId`, `goal`, `status`, `when`, `provenance` (authorized boolean + detail string), `policy` (string array from catalog), `constraints` (validator issue strings), `steps` (StepExplanation array with step/action/status/confidence/evidence/policy), and aggregate `confidence`.
- **State Ownership**: Task ledger is append-only JSONL owned by SessionService/plugin runtime. ACTION_CATALOG is a closed table in `plugin/orion-control/src/catalog.ts`. No in-memory reasoning state is exposed; all explanation data derives from durable records written at execution time.
- **Errors**: Missing ledger → exit 1 with message. Corrupt ledger lines → skipped and counted. Unauthorized run → provenance reports absence explicitly. Unverified steps → confidence degrades to `inferred` or `unable_to_verify`.

## Smallest Next Slice
All three requirements are Built and tested in source. No implementation gap remains within this phase's scope. The next slice would be Phase 64 (confidence levels), which shares the same file (`explain.ts`) and is already implemented alongside Phase 63.

- **Proposed Contract**: None needed — Phase 63 is complete in source. If a follow-up is desired, it would be integration proof on an installed device (outside this worker's scope) or Phase 64 evidence reconciliation (separate phase packet).
- **Blocker**: N/A — no missing implementation.

## Test Scenarios
- **Positive Case**: `explainRun()` on a record with verified steps returns `observed` confidence and verbatim evidence. Test: `"derives confidence rather than accepting a claim of it"` in `gate.test.ts`. Command: `npx vitest run src/gate.test.ts` (TypeScript check only; native Swift/Python checks not registered).
- **Failure Case 1**: `explainRun()` on an unauthorized record (no authorization field) returns `provenance.authorized: false` and confidence `unable_to_verify`. Test: `"says an unauthorized run was unauthorized instead of staying quiet"`.
- **Failure Case 2**: `orion-why` with missing ledger file exits 1 with error message. Verified in source: `if (!existsSync(LEDGER))` block.
- **Injectable Seam**: Corrupt final line in JSONL ledger — test `"survives a half-written final line on an append-only ledger"` verifies graceful skip. Stale revision not applicable (no versioned config for explainability).

## Gates and Handoff
- **Entry Gate**: Phase 62 satisfied (`entrySatisfied: true` per brief; Phase 62 "waiting on" is implemented and tested in same test file).
- **Remaining Hands-on Proof**: Reviewer must verify cited symbols (`explainRun`, `speakExplanation`, `confidenceOfStep`, `CONFIDENCE_LEVELS`) exist at worktree baseline and that `scripts/orion-why` correctly invokes them. No installed-device proof available to this worker.
- **Rollback**: This report is documentation only; no source changes were made. Reverting means deleting this file.
- **Reviewer Handoff**: Check that all six sections are present, requirement IDs match the brief, cited paths exist, and no non-scope files were modified. The `doc-report` check validates structure and citation validity.
