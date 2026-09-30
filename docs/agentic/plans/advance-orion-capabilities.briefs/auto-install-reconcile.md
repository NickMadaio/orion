# Brief — auto-install-reconcile: Reconcile incomplete installation without duplicate effects

## Where you start
Both scope files are in your working set with tasks 1-2's code and tests: keep all of it. Before writing, find in the module what `installDisabledAutomation` actually does: the transaction file path and fields, the phase names, the per-name lock, and the scheduler adapter's return conventions. Reconcile must use exactly those. Task 2 was asked, as a recommendation, for: `root/transactions/<name>.json` holding `{ version, name, phase, installationId, installedAt, timeZone, schedulerId, plan, record, evidence }`; phases `create_pending` (no id known), `job_known` (id recorded), `disabled_verified`, `complete`, and `publication_failed`; a lock directory `root/transactions/<name>.lock`; `read(id)` resolving `null` only for a positively absent job and rejecting when it cannot tell. If the stored transaction lacks the full plan, extend `installDisabledAutomation` to store it (in scope), keeping its tests passing.

First exchange: `### READ tests/automation-dispatch.test.mjs` (lines 160-180 are the child-process death pattern). Nothing else.

## Interface (acceptance 1)
    export async function reconcileDisabledAutomation({ root, name, scheduler })
- Validate: root a non-empty string; name matching `/^[a-z0-9][a-z0-9-]{1,47}$/` (the bare name, not "orion-auto-..."); `scheduler.read` and `scheduler.remove` functions.
- It never calls `createDisabled`, never enables, never calls `initializeAutomationDispatch`, `initializeAutomationAdmission`, `reserveAutomationRun` or `dispatchAutomation`, and writes nothing under `root/runtime` or `root/installed`. The transaction file is the only thing it writes.
- Take the installer's per-name lock; on EEXIST return `{ status: "busy" }` and change nothing. A lock left by a dead process stays until a person removes it: never decide a lock is stale.
- The expected plan comes from the stored transaction. Never call `automationSchedulePlan` here: there is no repoRoot or clock, and the plan throws once the automation has expired.

## Decisions (acceptance 2-4)
Status names below are recommendations.
- No transaction file: `{ status: "no_transaction" }`, no scheduler call.
- `create_pending` with no schedulerId: `{ status: "blocked_unknown_create" }`. No scheduler call at all: there is no id to read, and searching by name would be guessing. Never create a replacement.
- `complete`: inspect only. `read(schedulerId)`; require `observed?.id === schedulerId`, `verifyDisabledSchedule(storedPlan, observed) === true`, and the installed file's installationId equal to the transaction's. Match: `{ status: "complete_verified" }`, preferably writing nothing, so a second call gives the same result and identical bytes. Otherwise `{ status: "intervention_required", reason }` with reason such as "enabled", "mismatch" or "read_failed", and no mutation.
- Incomplete with a schedulerId (`job_known`, `disabled_verified`, `publication_failed`): `read(schedulerId)`.
  - It rejects: unknown. Record it; no remove.
  - It resolves `null`: the job is gone. Record verified absence.
  - Exact match (same id, verifier true): `remove(schedulerId)`, then `read(schedulerId)` again. Only a `null` read-back proves removal: `{ status: "cleaned_up" }`. `remove` rejects: `{ status: "cleanup_unknown" }`. Still present after remove: `{ status: "cleanup_failed" }`.
  - Any mismatch (another id, different content, `enabled: true`): `intervention_required`, never remove.
- Append every outcome to the transaction, e.g. `evidence.reconcile = [...earlier, { status, detail }]`, by atomic replace (temp file, rename, directory fsync). Never drop earlier fields and never delete the transaction file. A leftover transaction blocking a same-name reinstall is expected: releasing a name is a later operator workflow.

## Tests (acceptance 5)
Keep every task 1-2 test and append. Each test: its own mkdtemp root, `NOW`, and a file-backed fake scheduler whose jobs live in `join(root, "fake-jobs.json")`, so a child process and the parent see the same scheduler. It records calls in memory.
1. Real child-process exit at a seam, following tests/automation-dispatch.test.mjs 160-180: `execFile(process.execPath, ["--input-type=module", "-e", source, JSON.stringify(args)])`, where the child imports the module by file URL and calls `installDisabledAutomation` with the file-backed fake whose `createDisabled` saves the job and then calls `process.exit(73)` before returning. Assert `error.code === 73`. Reconcile returns `busy` (the dead child's lock remains); the TEST removes the lock, with a comment that the child positively exited; reconcile then returns `blocked_unknown_create` with no scheduler calls. Recommended second seam: exit inside `read` after the id was persisted; reconcile finds `job_known`, an exact disabled job, removes it and proves absence.
2. Re-opened durable state: after each call, assert by reading the transaction file from disk.
3. Repeated reconciliation: a second call gives the same status; for `complete_verified` the file's bytes are unchanged.
4. Scheduler read failure: `read` rejects; unknown recorded; `remove` never called.
5. Mismatched id and content: a job with another id, and one with a different cron; `intervention_required`, no remove.
6. Cleanup failure: `remove` rejects gives `cleanup_unknown`; `remove` resolves but the job still reads back gives `cleanup_failed`; both keep earlier evidence.
On every path, assert `createDisabled` was never called by reconcile.

## Exchange plan
1: the READ. 2: FILE the module (reconcile added; installer extended only if it must be), with CHECK. 3: FILE the whole test file, with CHECK. 4-6: fixes, one file per reply, each with CHECK. Self-review, then DONE naming the test for each scenario.

## Traps
- Trusting `verifyDisabledSchedule` for identity: it accepts any non-empty id. Compare with the recorded id too.
- A rejected read treated as absent, or a resolved `remove` treated as removal.
- Re-initializing ledgers or rewriting `installed/` while inspecting: that is a quota reset and a new identity.
- Breaking a lock inside reconcile; only the test fixture may, after the child has exited.
- Overwriting the transaction with only the latest status.
- Importing the modules' private helpers (`persist`, `writeNew`, `syncDirectory` are not exported): write small local ones.

## For the reviewer (judge the diff against these facts)
- Reconcile contains no `createDisabled`, `initializeAutomation*`, `reserve*` or `dispatchAutomation`, and writes only the transaction file.
- `remove` happens only on an incomplete transaction after an exact id-and-verifier match; success only after a `null` read-back.
- The child-process test really spawns node and exits with 73; the lock is removed by the test, never by reconcile.
- Evidence is appended, never replaced; tasks 1-2 tests unchanged and passing.
