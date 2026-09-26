# Phase 48: Mac Privilege Separation — Evidence and Next Slice

## Baseline
Inspected source at commit `9855d99` (2026-09-26).
- `plugin/orion-control/src/protected-paths.ts`: Defines immutable paths (`Desktop/ORION`, `.openclaw`, `LaunchAgents`) no file action may write.
- `plugin/orion-control/src/terminal-sandbox.ts`: Generates `sandbox-exec` profiles denying writes to protected paths; redacts secrets from terminal output.
- `plugin/orion-control/src/integrity.ts`: Plugin self-check against SHA-256 manifest in `.openclaw/orion-gate/integrity/`.
- `scripts/lib/orion-integrity.mjs`: Installer-side manifest recording and bridge verifier.
- `plugin/orion-control/src/validator.ts` & `approvals.ts`: Requesting-turn binding for destructive actions (repairs C2, H4).

## Requirement Matrix

| ID | Status | Evidence / Source Symbol | Notes |
| :--- | :--- | :--- | :--- |
| `splits_execution_into_user_worker_and_privileged_broker` | Blocked | None. | Architectural split not started. Requires OS isolation (sandbox-exec or 2nd user). Nick must choose boundary. |
| `privileged_broker_exposes_only_a_tiny_explicit_interface` | Blocked | None. | Depends on broker existence. |
| `does_not_expose_run_arbitrary_root_command` | Passed | `terminal-sandbox.ts` (allowlist), `protected-paths.ts`. | Exec allowlist has no shell/interpreter. Sandbox denies writes to protected paths. No root path exists. |
| `keeps_privileged_code_minimal` | Blocked | None. | Depends on broker split. |
| `signs_and_hardens_executables` | Blocked | None. | Deferred by Nick (Apple Developer Program). Needed for code signing. |
| `prevents_unauthorized_replacement_or_tampering` | Partial | `integrity.ts` (`integrityProblem`), `orion-integrity.mjs`. | Manifests recorded in gate dir. Bridge verified by launchd wrapper. Plugin self-checks at load. **Limit**: Self-check can be bypassed if attacker writes plugin code; needs gateway pre-load check or code signing. |
| `binds_destructive_authorization_to_the_requesting_turn` | Passed | `validator.ts` (requesting-turn validation), `approvals.ts`. | Repaired 2026-09-26. Targets must be in requesting turn or immediate confirmation. One-shot approvals atomic. |

## Architecture and Interfaces
**Current State**: Monolithic user-level execution with soft boundaries.
- **Producer**: `plugin/orion-control` (Node.js). Executes actions via `terminal_run`, `desktop_file_write_explicit`, etc.
- **Consumer**: macOS User Space (Nick's account).
- **Seam**: `sandbox-exec` profile in `terminal-sandbox.ts` provides a write-fence for terminal commands. `protected-paths.ts` enforces read-only access to ORION's own infrastructure for file actions.
- **Missing Seam**: No process-level isolation between "User Worker" (model-driven) and "Privileged Broker" (system admin). Both run as Nick today.

**Proposed Seam (Next Slice)**:
- **Producer**: `orion-worker` (unprivileged, sandboxed).
- **Consumer**: `orion-broker` (privileged, minimal interface).
- **Interface**: Local IPC or Unix socket with strict allowlist of commands (e.g., `install_pkg`, `restart_service`).
- **State Ownership**: Broker owns system state changes; Worker owns model context.

## Smallest Next Slice
**Blocker**: The worker/broker split requires an OS-level isolation decision from Nick. Two options identified:
1.  **Sandbox-exec profile**: Run the broker under a strict sandbox allowing only specific syscalls/files. Easier to implement, less secure against kernel exploits.
2.  **Second macOS User**: Create a dedicated `orion-broker` user. Stronger isolation, requires admin setup and IPC bridging.

**Proposed Contract (Pending Decision)**:
If Nick chooses Option 1 (Sandbox):
- **Scope**: `plugin/orion-control/src/broker-sandbox.ts`, `scripts/orion-broker-launch.sh`.
- **Objective**: Implement a sandbox profile for the broker process that denies all network and file writes except to `/var/log/orion` and specific system binaries.
- **Acceptance**: Broker starts, logs to allowed path, fails on disallowed write.

If Nick chooses Option 2 (Second User):
- **Scope**: `scripts/setup-broker-user.sh`, `plugin/orion-control/src/broker-ipc.ts`.
- **Objective**: Script to create user and set permissions; IPC module for worker-to-broker communication.
- **Acceptance**: User exists, IPC connects, command executes as broker user.

**Current Action**: Record blocker. No implementation contract until Nick selects isolation strategy.

## Test Scenarios
1.  **Positive: Integrity Check Passes**
    - **Inject**: None (normal load).
    - **Expected**: `integrityProblem()` returns `null`. Plugin loads.
    - **Source**: `plugin/orion-control/src/integrity.test.ts`.
2.  **Failure: Tampered Plugin File**
    - **Inject**: Modify `dist/index.js` hash after install.
    - **Expected**: `integrityProblem()` returns string naming changed file. Action execution refused.
    - **Source**: `plugin/orion-control/src/integrity.test.ts`.
3.  **Failure: Write to Protected Path**
    - **Inject**: Attempt `desktop_file_write_explicit` to `Desktop/ORION/scripts/...`.
    - **Expected**: `protectedConflict()` detects path. Action rejected with "protected" error. File unchanged.
    - **Source**: `plugin/orion-control/src/review-repairs.test.ts` (C1).
4.  **Failure: Terminal Write to Protected Path**
    - **Inject**: Run terminal command `touch ~/Desktop/ORION/evil.txt`.
    - **Expected**: `sandbox-exec` denies write. Command fails with "Operation not permitted".
    - **Source**: `plugin/orion-control/src/review-repairs.test.ts` (C3/M5).

## Gates and Handoff
- **Entry Gate**: Phase 47 exit evidence passed (files.copy gap noted but phase open).
- **Remaining Hands-on Proof**:
    - Nick must decide on isolation strategy (Sandbox vs Second User).
    - Code signing deferred until Apple Developer Program enrollment.
- **Rollback**: None needed; this is a planning packet. Source changes are minimal/non-existent for this phase so far.
- **Reviewer Handoff**: Verify matrix IDs match brief. Verify source symbols exist. Verify blocker is honest (no invented API).
