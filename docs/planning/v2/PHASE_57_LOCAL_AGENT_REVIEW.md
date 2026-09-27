# Phase 57 — Local Agent Installer Review Packet

## 1. Scope and evidence basis

This document reviews the disabled-installer batch (tasks 1-4) of Phase 57. The
worker wrote one file: this document. Source files examined were:

- `scripts/lib/orion-automation-install.mjs` — combined implementation of tasks 1-3
- `tests/automation-install.test.mjs` — combined test suite for tasks 1-4
- `scripts/orion-automation` — human CLI (install command refuses)

Per-task diffs, review verdicts, commit identifiers and dates were not available
to the worker. Claims are labelled: **Observed** means a passing CHECK output was
seen in this session; **Inferred** means read from source with no test proving it;
**Unproven** means neither observed nor inferred from tests.

The `node-syntax` check passes with "no matching changed files" for a Markdown-only
change and is not cited as evidence about the code.

## 2. Public API

### verifyDisabledSchedule(expected, observed) — Inferred

Pure function. No filesystem, network or scheduler effects. Returns boolean.

- `expected`: output of `automationSchedulePlan` (has `name`, `timeZone`, `cron`,
  `commandArgv`, `schedulerArgs`).
- `observed`: normalized adapter object with fields `{id, name, timeZone, cron,
  commandArgv, cwd, enabled, exact, noDeliver}`.

Checks: nonempty string `id`; exact equality of `name`, `timeZone`, `cron`;
array-length and per-index equality of `commandArgv`; `cwd` equals the value after
`--command-cwd` in `expected.schedulerArgs`; `enabled === false`, `exact === true`,
`noDeliver === true`. Returns `false` on any mismatch, malformed input or exception.

### installDisabledAutomation({root, proposal, timeZone, repoRoot, scheduler, now}) — Inferred

All six parameters required; no production defaults. `scheduler` must expose
`createDisabled(plan)`, `read(id)`, `remove(id)`. `now` must be a safe-integer
epoch-ms number (a Date throws). Returns a promise resolving to an object with
`status` field. Possible statuses:

- `disabled_verified`: successful installation, job disabled and verified.
- `already_installed`: existing installed record found.
- `concurrent_refused`: another call holds the per-name lock.
- `transaction_active`: uncertain transaction in a non-terminal phase.
- `transaction_exists`: leftover transaction file blocks reinstall.
- `unknown_outcome`: scheduler create failed or returned invalid id.
- `verification_failed`: read-back did not match expected disabled state.
- `publication_failed`: dispatch init or record publication failed.

Never enables a job. Never calls `scheduler.remove`.

### reconcileDisabledAutomation({root, name, scheduler}) — Inferred

`name` must match `/^[a-z0-9][a-z0-9-]{1,47}$/`. `scheduler` must expose
`read(id)` and `remove(id)`. Returns a promise with `status` field. Possible
statuses:

- `busy`: another process holds the per-name lock.
- `no_transaction`: no transaction file found.
- `intervention_required`: missing plan, read failure, id mismatch, content
  mismatch, unexpectedly enabled job, or missing installed record.
- `blocked_unknown_create`: create_pending phase with no scheduler id recorded.
- `complete_verified`: complete phase, all checks pass, nothing written.
- `unknown_outcome`: scheduler read rejected during incomplete-phase reconciliation.
- `verified_absent`: scheduler returned null (job gone).
- `cleaned_up`: job removed and verified absent.
- `cleanup_unknown`: remove failed or post-remove read failed.
- `cleanup_failed`: job still present after remove.

Never creates or enables jobs. Never resets consumed quotas. Never guesses a live
lock owner is dead.

## 3. Transaction states and side-effect ordering

From `installDisabledAutomation` source:

1. Validate inputs (roots, scheduler adapter, now as safe integer).
2. Build schedule plan via `automationSchedulePlan`.
3. Generate `installationId` (`randomBytes(16).toString("hex")`).
4. Assemble installed record with policy fields spread at top level.
5. Ensure transactions directory exists.
6. Acquire exclusive per-name lock (`mkdir` on `<name>.lock`). On EEXIST, check
   for existing installed record or active transaction; refuse if found.
7. Refuse if installed record or transaction file already exists.
8. Persist transaction intent (phase `create_pending`) to `<name>.json` via
   temp-file + rename with fsync.
9. Call `scheduler.createDisabled(plan)`. On failure or invalid id, persist
   error evidence and return `unknown_outcome`.
10. Persist transaction with phase `job_known` and recorded scheduler id.
11. Call `scheduler.read(jobId)` and verify via `verifyDisabledSchedule`. On
    failure, persist evidence and return `verification_failed`.
12. Call `initializeAutomationDispatch(runtimeDir, installedRecord)`. Creates
    admission and dispatch ledger files with exclusive create (EEXIST on second
    call).
13. Publish installed record at `installed/<name>.json` via temp-file + link
    (not rename) + unlink temp. fsync directory.
14. Persist transaction with phase `complete` and `disabled_verified: true`.
15. Return `{status: "disabled_verified", name, installationId, schedulerId, enabled: false}`.
16. Release lock in finally block.

If any step fails after the lock is acquired but before completion, the
transaction file records the phase and evidence for reconciliation.

## 4. Durable paths

All paths are relative to `root` (injected temporary root in tests):

- `installed/<name>.json` — the installed record consumed by
  `runInstalledAutomation`. Contains `name`, `installationId`, `installedAt`,
  `timeZone`, `trigger`, and policy fields spread at top level (`action`,
  `intent`, `expiresOn`, `conditions`, `permissions`, `riskLimits`,
  `failureBehavior`).
- `runtime/<sha256hex(installationId)>.dispatch.json` — dispatch ledger created
  by `initializeAutomationDispatch`. Holds phase and reservation state.
- `runtime/admission/<sha256hex(installationId)>.json` — admission ledger with
  exclusive create binding.
- `transactions/<name>.json` — transaction intent file. Contains version, name,
  phase, installationId, installedAt, timeZone, schedulerId, plan, record, and
  evidence object.
- `transactions/<name>.lock` — per-name lock directory. Created by mkdir, removed
  by rmdir in finally block.

Transaction writes use temp-file + rename pattern with fsync on the directory for
durability. Installed record uses temp-file + link (refuses on EEXIST) rather than
rename (which would overwrite).

## 5. Reconciliation behavior

`reconcileDisabledAutomation` handles each transaction phase:

- **No transaction file**: returns `no_transaction`, no scheduler calls.
- **Lock held by another process**: returns `busy`, no further work.
- **Missing stored plan**: returns `intervention_required`, evidence appended.
- **create_pending without schedulerId**: returns `blocked_unknown_create`. Never
  creates a replacement job.
- **complete phase**: reads job from scheduler, verifies id match and disabled
  content via `verifyDisabledSchedule`, checks installed record's installationId
  matches transaction's. If all pass, returns `complete_verified` with no writes
  (idempotent). Any mismatch returns `intervention_required`.
- **Incomplete phases with schedulerId** (`job_known`, `disabled_verified`,
  `publication_failed`): reads job from scheduler. On read rejection, returns
  `unknown_outcome`. On null (job gone), returns `verified_absent`. On id or
  content mismatch, returns `intervention_required`. On exact match, calls
  `scheduler.remove`, then reads back to verify absence. If removal verified,
  returns `cleaned_up`. If remove fails or post-remove read fails, returns
  `cleanup_unknown`. If job still present after remove, returns `cleanup_failed`.

Evidence is appended as an array under `tx.evidence.reconcile` for every
reconciliation attempt, preserving history across calls.

## 6. Criterion map

### Task 1: auto-install-readback

| Criterion | Test(s) | Label |
|-----------|---------|-------|
| 1.1 Export verifyDisabledSchedule, pure boolean | `verifyDisabledSchedule returns true for a valid disabled job` | **Observed** |
| 1.2 Require nonempty id, exact fields, enabled===false, exact===true, noDeliver===true | Multiple rejection tests: missing id, blank id, name differs, timeZone differs, cron differs, argv shorter/longer/string/malformed/space-split, cwd truncated, shell-looking argv, active job, exact not true, noDeliver not true | **Observed** |
| 1.3 Tests independently alter each field, cover spaces, valid acceptance, unexpected active job, missing id, shell-like args; do not validate object against itself | `verifyDisabledSchedule does not validate an object against itself`, `verifyDisabledSchedule rejects shell-looking argv entries without executing them`, path with spaces in fixture | **Observed** |
| 1.4 No scheduler process spawned, existing suites pass | All verifyDisabledSchedule tests are synchronous, no execFile calls; CHECK automation-tests passes | **Observed** |

### Task 2: auto-install-transaction

| Criterion | Test(s) | Label |
|-----------|---------|-------|
| 2.1 Export installDisabledAutomation with required params, scheduler adapter contract | `installDisabledAutomation: successful disabled registration` asserts result shape; source validates all params | **Observed** (result), **Inferred** (validation) |
| 2.2 Use automationSchedulePlan, random installationId, initializeAutomationDispatch, publish installed record | Test reads installed record and dispatch ledger, verifies shapes | **Observed** |
| 2.3 Persist exclusive per-name transaction before scheduler effect; prevent overwrite | `installDisabledAutomation: same-name concurrency refusal` (5 concurrent calls, exactly one succeeds); `existing record unchanged` (pre-written record not overwritten) | **Observed** |
| 2.4 Return verified disabled state after durable publication; errors preserve status | `successful disabled registration` returns `disabled_verified`; `failed read-back` returns `verification_failed` with phase `job_known`; `publication failure` returns `publication_failed` with evidence | **Observed** |
| 2.5 Tests: successful registration, concurrency refusal, unchanged record, failure before create, failed read-back, publication failure | All six scenarios have dedicated tests | **Observed** |

### Task 3: auto-install-reconcile

| Criterion | Test(s) | Label |
|-----------|---------|-------|
| 3.1 Export reconcileDisabledAutomation; never create/enable/reset/guess | `reconcileDisabledAutomation: never calls createDisabled` asserts zero createDisabled calls | **Observed** |
| 3.2 Completed records inspected idempotently; uncertain create blocked | `complete phase verification` and `repeated reconciliation idempotency` verify no writes on complete_verified; `child process exit at transaction seam` verifies blocked_unknown_create | **Observed** |
| 3.3 Known disabled jobs removed only on exact match; mismatched/enabled reported | `mismatched id and content` returns `intervention_required`; cleanup tests show remove only on exact match | **Observed** |
| 3.4 Persist failed cleanup/unknown outcomes accurately | `scheduler read failure` appends evidence; `cleanup failure scenarios` append evidence for remove rejection and job-still-present | **Observed** |
| 3.5 Tests: child-process exit at seam, re-opened durable state, repeated reconciliation, scheduler read failure, mismatched id/content, cleanup failure | All six scenarios have dedicated tests including actual execFile child death | **Observed** |

### Task 4: auto-install-fixture-route

| Criterion | Test(s) | Label |
|-----------|---------|-------|
| 4.1 Fake scheduler, temp root, real transaction, real ledgers, runInstalledAutomation with injected checks/run | `task4: due trigger succeeds once, repeat refused` uses full install-then-run route; `fixtures prove no real systems` asserts temp roots and fake scheduler calls | **Observed** |
| 4.2 Due trigger produces one execution; repeat refused | `due trigger succeeds once, repeat refused`: first run `succeeded`, second run `refused` with reason `duplicate_or_old_trigger` | **Observed** |
| 4.3 Refusals before execution: revoked authority, expired policy, incompatible mode, unknown focus, changed installation | Table-driven tests for `not_authorized`, `mode_mismatch`, `expired`, `focus_unknown`; separate test for `changed installation (invalid_state)` | **Observed** |
| 4.4 Throwing executor not blindly retried; pending/unknown does not become ready | `throwing executor yields outcome_unknown, next day refused stopped`: first run `outcome_unknown`, next-day run `refused` with reason `stopped`; child-process death test shows `busy_or_unavailable` then `outcome_unknown` after lock removal | **Observed** |
| 4.5 Fixtures prove no real scheduler/calendar/webhook/production root | `fixtures prove no real systems`: asserts temp roots, fake scheduler calls only, checks called, no messages in runtime, delivery not requested | **Observed** |

## 7. Not done / not proven

Five items from contract criterion 3:

1. **Real scheduler adapter**: Does not exist. The only source evidence of the
   real scheduler's output shape is in `scripts/lib/orion-automation-removal.mjs`
   which references jobs with `id` and `name` fields only. Mapping real read-back
   to the normalized job shape used by `verifyDisabledSchedule` is not established.
   All tests use `makeFakeScheduler` or `makeFileBackedScheduler`.

2. **Explicit human activation**: No activation path exists in any source file.
   The CLI `install` command refuses with exit code 1: "installation is unavailable
   until guarded scheduler registration is connected." Activation (follow-on 3) is
   a separate, human-gated step not implemented in this batch.

3. **Exact installed read-back**: Not proven against a real scheduler. The fake
   schedulers return hand-crafted objects that match the expected shape by
   construction. No test exercises the real scheduler's `read` output through
   `verifyDisabledSchedule`.

4. **Remote controls**: `scripts/orion-remote` has no automation controls. No
   remote activation, removal or inspection is available.

5. **Disposable live-route proof**: Everything was proven with fake schedulers and
   temporary roots only. No job was ever registered with a real scheduler, nor
   verified absent after removal from a real scheduler. The "live route" in task 4
   means the fixture pipeline (install -> dispatch ledger -> runtime execution)
   works end-to-end with injected adapters, not that a real scheduler was involved.

## 8. Limitations for Astra review

### Changed paths

Three files were changed or created by this batch:
- `scripts/lib/orion-automation-install.mjs` (new — tasks 1-3 implementation)
- `tests/automation-install.test.mjs` (new — tasks 1-4 test suite)
- `docs/planning/v2/PHASE_57_LOCAL_AGENT_REVIEW.md` (this document, task 5)

### Crash windows

1. **Before scheduler create**: Transaction file not yet written; no durable
   state. Safe — no side effects to reconcile.

2. **After create but before id persisted in transaction**: The child-process
   death test (`child process exit at transaction seam`) covers this. The job
   exists on the scheduler but the transaction has no `schedulerId`. Reconciliation
   returns `blocked_unknown_create` — requires human inspection.

3. **After id persisted but before read-back**: Transaction in `job_known` phase
   with valid scheduler id. Reconciliation reads, verifies, and removes if exact
   match. Covered by `child process exit after id persisted` test.

4. **After read-back but before or during publication**: Transaction still in
   `job_known` phase (phase only advances to `complete` after publication).
   Reconciliation treats it as incomplete: reads, verifies, removes if exact match.

5. **initializeAutomationDispatch writes two files non-atomically**: Admission
   file and dispatch ledger are created separately with exclusive create. A crash
   between them leaves admission without dispatch or vice versa. The installed
   record is not published until both succeed, so the runtime cannot execute an
   unledgared job. However, a stale admission file could block future installation
   of the same installationId (different name would use different id).

6. **Dispatcher's window between reservation and pending**: Not exercised by
   installer tests; belongs to runtime behavior.

7. **Lock directories left by crash**: The `finally` block removes the lock, but a
   hard crash (process.exit, OOM, kill -9) leaves it. Reconciliation returns
   `busy` when lock exists. Human must remove the lock directory before
   reconciliation can proceed.

8. **Leftover transaction blocking same-name reinstall**: A transaction in
   `complete` phase does not block reinstall via the lock (lock is released), but
   the transaction file itself persists. The installer checks for existing
   installed record first, so a completed installation blocks correctly. However,
   a transaction in `publication_failed` phase with no installed record would
   allow reconciliation to clean up, then a fresh install could proceed.

9. **Legacy CLI remove knows nothing of transactions**: `scripts/orion-automation
   remove` calls `removeAutomationSchedule` and moves the installed record back to
   proposed. It does not touch transaction files or dispatch ledgers. A removed
   job leaves behind stale transaction and runtime state that reconciliation would
   need to handle.

### Unknown outcomes

- Real scheduler schema compatibility: untested.
- Behavior under concurrent reconciliation calls (lock prevents it, but lock
  removal by human is manual).
- Interaction with the real scheduler's own failure modes (network partition,
  scheduler restart, id reuse policy).

## 9. Next bounded source task and live proof required

Quoted from the approved plan's follow-on list:

**Follow-on 1 (next source task)**: "Implement the exact installed scheduler
adapter: supported argv only, parse current read-back format, create disabled,
verify exact identity and fields, refuse unknown schema."

**Follow-on 4 (live proof required)**: "Exercise a disposable complete route
through the installed scheduler, then stop/remove it and verify absence. No real
calendar messages or broad standing routines as a test substitute."

Activation (follow-on 3) is a separate, human-gated step and is not started by
this documentation task. No code was written for follow-ons in this task.

Phase 57 is not marked complete. The manifest and gates were not edited. No
installation or deployment was claimed.
