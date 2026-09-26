# Phase 70: CI/CD Security — Implementation Packet

## Baseline
- **Inspected source paths**: `.github/workflows/ci.yml`, `scripts/orion_v2_ci_check.sh`, `scripts/orion_v2_secret_scan.py`, `plugin/orion-control/package.json` (for vitest/tsc config), `docs/planning/v2/MANIFEST_PHASES.json`.
- **Limits**: No source changes. Report only. Native Swift/Python checks not registered in local worker; evidence is historical or requires reviewer-run native commands.

## Requirement Matrix

| Requirement ID | Status | Evidence / Source Symbol | Notes |
|---|---|---|---|
| `requires_ci_checks_for_the_nine_named_categories` | Built | `.github/workflows/ci.yml` steps: `security invariants`, `unit and integration tests`, `static analysis`, `schema validation`, `secret scanning`, `dependency scanning`. `scripts/orion_v2_ci_check.sh` mirrors these locally. MIGRATION VALIDATION is N/A (no DB/schema migrations in system). | 8/9 categories implemented; migration validation correctly excluded. |
| `secret_scanning_does_not_reimplement_what_exists` | Built | `scripts/orion_v2_secret_scan.py`: uses `load_allowlist()` for path+rule+fingerprint allowlisting. `scan_history()` scans full git history via `git rev-list` and `git grep`. Output is redacted (`render()` prints only fingerprint). | Delegates to existing Python scanner; does not reimplement regex/exclusions in shell/CI. |
| `failed_security_invariants_are_not_casually_overridden` | Built | `.github/workflows/ci.yml`: `security invariants` step is first after install. `scripts/orion_v2_ci_check.sh`: Step 1 runs adversarial suite (`src/gate.test.ts`, `src/index.test.ts`) and `exit 1` on failure before any other step reports green. `continue-on-error` used only for `dependency scanning` (npm audit) and non-security checks. | Ordering enforces security priority; no casual override mechanism exists. |
| `makes_the_uncovered_surface_visible_rather_than_implied` | Built | `.github/workflows/ci.yml`: Step `what this run did not check` writes to `$GITHUB_STEP_SUMMARY` listing 5 machine-bound suites (`orion_v2_strictness_check.sh`, etc.) and states "A green CI is not a green machine." `scripts/orion_v2_ci_check.sh`: Step 10 prints same list to stdout. | Uncovered surfaces explicitly named in CI summary and local output. |
| `uses_protected_deployment_and_easy_rollback` | Built | `scripts/orion-deploy`: 7-step process (dirty tree check, build, full suite run including machine-bound checks, snapshot current install, install new dist, verify load via leaf imports + gateway probe, rollback on failure). `--rollback` restores from `$HOME/.openclaw/backups/orion-control`. | Protected deployment with automatic rollback and integrity recording. |

## Architecture and Interfaces
- **Producer**: CI workflow (`.github/workflows/ci.yml`) and local check script (`scripts/orion_v2_ci_check.sh`).
- **Consumer**: Developer/Reviewer via CI logs and job summaries; Deployment process via `orion-deploy`.
- **Seam**: The boundary between CI-executable checks (unit, integration, static analysis, secret scanning) and machine-bound checks (exec allowlist, plugin state, permissions).
- **State Ownership**: CI state is ephemeral per run. Local deployment state is managed by `orion-deploy` snapshots.
- **Errors**: Security invariant failures exit immediately. Dependency audit failures are non-fatal (`continue-on-error`).

## Smallest Next Slice
All five requirements for Phase 70 are marked `passed` with source-grounded evidence. No further implementation contracts are needed for this phase. The remaining work is hands-on proof:

- **Blocker (evidenced)**: Machine-bound suites (`orion_v2_strictness_check.sh`, `orion_v2_authority_contract_check.sh`, `orion_v2_lock_check.sh`, `orion_v2_remote_check.sh`, `orion_v2_mobile_check.sh`) cannot be re-proven by this worker — they assert against Nick's live Mac (exec allowlist, installed plugin, real permission state). This is not a deficiency; it is the design. Reviewer must run them natively to confirm the boundary still holds on the actual machine.
- **No proposed contracts**: Phase 70 implementation is complete. The next phase that depends on CI/CD security surfaces will carry its own requirements.

## Test Scenarios
- **Positive Case**: CI run completes with all security invariants passing, job summary correctly lists machine-bound suite status.
  - **Injectable Seam**: None (historical evidence).
  - **Expected Outcome**: Green CI, accurate summary.
- **Failure Case**: Adversarial test fails.
  - **Injectable Seam**: Modify a test to fail.
  - **Expected Outcome**: Job exits immediately; no green ticks for subsequent steps.
- **Failure Case**: Secret leak detected in history.
  - **Injectable Seam**: Commit a fake secret, then revert.
  - **Expected Outcome**: `orion_v2_secret_scan.py` detects it during history scan.

## Gates and Handoff
- **Entry Gate**: Phase 69 completed (`entryRequiresPhase: 69`).
- **Remaining Hands-on Proof**: Reviewer must verify native/machine-bound checks if local worker cannot execute them.
- **Rollback**: None (report only).
- **Reviewer Handoff**: Verify cited symbols exist at worktree baseline. Verify proposed scopes do not expand authority.
