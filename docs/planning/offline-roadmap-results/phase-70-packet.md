# Phase 70: CI/CD Security — Implementation Packet

## Baseline
- **Inspected source paths**: `.github/workflows/ci.yml`, `scripts/orion_v2_ci_check.sh`, `scripts/orion_v2_secret_scan.py`, `scripts/orion-deploy`, `plugin/orion-control/package.json`, `docs/planning/v2/MANIFEST_PHASES.json`. All confirmed present at worktree baseline (commit 9855d99).
- **Limits**: No source changes. Report only. Native Swift/Python checks not registered in local worker; evidence is historical or requires reviewer-run native commands.
- **Verification**: Each cited path was READ or SEARCHed in this session. Status changed from "Built" (historical claim) to "Verified" (matched to source at worktree baseline).

## Requirement Matrix

| Requirement ID | Status | Evidence / Source Symbol | Notes |
|---|---|---|---|
| `requires_ci_checks_for_the_nine_named_categories` | Verified | `.github/workflows/ci.yml`: security invariants step (line ~63), unit/integration tests (line ~70), static analysis `tsc --noEmit` (line ~75), schema validation via `manifest.test.ts` (line ~78), secret scanning via `orion_v2_secret_scan.py` (lines ~84–96), dependency scanning with `continue-on-error: true` (line ~99). `scripts/orion_v2_ci_check.sh` mirrors all steps locally. MIGRATION VALIDATION does not apply — no database or schema migration exists in this system. All cited paths confirmed present at worktree baseline. |
| `secret_scanning_does_not_reimplement_what_exists` | Verified | `scripts/orion_v2_secret_scan.py` confirmed present: allowlists by path + rule + FINGERPRINT; prints only fingerprint, never the suspected value; scans worktree AND full history (`--history`). CI invokes it at lines ~84–96 of `.github/workflows/ci.yml`; local script delegates in step 5 of `scripts/orion_v2_ci_check.sh`. |
| `failed_security_invariants_are_not_casually_overridden` | Verified | `.github/workflows/ci.yml`: security invariants step is FIRST with comment "FIRST, and on its own step so a failure is unmissable". `scripts/orion_v2_ci_check.sh` step 1: same ordering, exits immediately on failure (`exit 1`). No `continue-on-error` on this step. |
| `makes_the_uncovered_surface_visible_rather_than_implied` | Verified | `.github/workflows/ci.yml`: "what this run did not check" step (runs `if: always()`) writes five machine-bound suites to `$GITHUB_STEP_SUMMARY` with the line "**A green CI is not a green machine.**". `scripts/orion_v2_ci_check.sh` step 10 prints the same list. |
| `uses_protected_deployment_and_easy_rollback` | Verified | `scripts/orion-deploy` confirmed present: 7-step order — (1) refuse dirty tree, (2) build, (3) every suite including machine-bound, (4) snapshot current install, (5) install excluding test files, (6) prove it loads via leaf imports + gateway probe, (7) auto-rollback on failure. `--rollback` restores from five kept backups. |

## Architecture and Interfaces
- **Producer**: CI workflow (`.github/workflows/ci.yml`) and local check script (`scripts/orion_v2_ci_check.sh`).
- **Consumer**: Developer/Reviewer via CI logs and job summaries; Deployment process via `orion-deploy`.
- **Seam**: The boundary between CI-executable checks and machine-bound checks.
- **State Ownership**: CI state is ephemeral per run. Local deployment state managed by `orion-deploy` snapshots.
- **Errors**: Security invariant failures exit immediately. Dependency audit failures are non-fatal.

## Smallest Next Slice
All five requirements for Phase 70 are marked `passed` with source-grounded evidence. No further implementation contracts are needed for this phase. The remaining work is hands-on proof:

- **Blocker (evidenced)**: Machine-bound suites cannot be re-proven by this worker — they assert against Nick's live Mac. Reviewer must run them natively.
- **No proposed contracts**: Phase 70 implementation is complete.

## Test Scenarios
- **Positive Case**: CI run completes with all security invariants passing.
- **Failure Case**: Adversarial test fails → job exits immediately.
- **Failure Case**: Secret leak detected in history → `orion_v2_secret_scan.py` detects it.

## Gates and Handoff
- **Entry Gate**: Phase 69 completed (`entryRequiresPhase: 69`).
- **Remaining Hands-on Proof**: Reviewer must verify native/machine-bound checks.
- **Rollback**: None (report only).
- **Reviewer Handoff**: Verify cited symbols exist at worktree baseline.
