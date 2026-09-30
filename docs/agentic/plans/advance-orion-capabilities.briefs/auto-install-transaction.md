# Brief — auto-install-transaction: Create a durable disabled installation transaction

## Where you start
Both scope files are already in your working set, holding task 1's accepted `verifyDisabledSchedule` and its tests: keep both exactly. If `installDisabledAutomation` already exists (an earlier attempt or a reviewer repair wrote it), do not start over and do not trust it: check it line by line against this brief, fix what differs, then write the tests. Every item under Traps is a mistake such a version has actually made.

First exchange: `### READ scripts/lib/orion-automation-dispatch.mjs` and `### READ tests/automation-runtime.test.mjs`. Nothing else is needed.

## Interface (acceptance 1)
    export async function installDisabledAutomation({ root, proposal, timeZone, repoRoot, scheduler, now })
- Before any effect, throw a TypeError when root or repoRoot is not a non-empty string, `scheduler` lacks any of `createDisabled`, `read`, `remove`, or `now` is not a safe-integer epoch-ms number. No defaults: no `homedir()`, no repository path, no default scheduler, no `Date.now()`.
- Scheduler adapter. Recommended (the contract leaves return shapes open; tasks 3-4 build on your choice, so state it in a comment): `createDisabled(plan)` resolves `{ id }` with a non-empty string id, anything else being an unknown outcome; `read(id)` resolves the normalized job `{ id, name, timeZone, cron, commandArgv, cwd, enabled, exact, noDeliver }`, resolves `null` only when the scheduler positively reports no such job, and rejects when it cannot tell; `remove(id)`. This task never calls `remove`, and nothing ever enables a job.

## Order of effects (acceptance 2-4)
Compute `plan = automationSchedulePlan(proposal, timeZone, repoRoot, now)` first (it validates the name), and build the record exactly as the shared notes show. Then:
1. Lock: `mkdir(join(root, "transactions"), { recursive: true })`, then `mkdir(join(root, "transactions", name + ".lock"))`. EEXIST: return a refusal such as `{ status: "concurrent_refused" }` with no other effect. Release the lock in `finally`, only if this call created it.
2. Refuse without writing when `root/installed/<name>.json` or the transaction file already exists, completed or not. Never overwrite either.
3. Recommended path `root/transactions/<name>.json`, created exclusively (`open(file, "wx", 0o600)`, write, `sync()`, then fsync the directory) BEFORE any scheduler call, with `{ version: 1, name, phase: "create_pending", installationId, installedAt, timeZone, schedulerId: null, plan, record, evidence: {} }`. Store the FULL plan and record: task 3's reconcile receives only `{ root, name, scheduler }`.
4. `createDisabled(plan)`. If it rejects or gives no valid id, keep `create_pending`, record the error in `evidence`, return `{ status: "unknown_outcome" }`: an effect may have happened.
5. With a valid id, persist `phase: "job_known"` and `schedulerId` (temp file, rename, directory fsync) BEFORE calling `read`.
6. `observed = await read(id)`. Verified only when `observed?.id === id && verifyDisabledSchedule(plan, observed) === true`. On rejection, `null` or mismatch: keep `job_known`, store the observation or error, return `{ status: "verification_failed" }`. Do not call `remove`.
7. Persist `disabled_verified`; call `initializeAutomationDispatch(join(root, "runtime"), record)`; then publish `root/installed/<name>.json` exclusively: temp file via `open(tmp, "wx", 0o600)`, write, `sync()`, `link(tmp, final)` (EEXIST means refuse), `unlink(tmp)`, fsync the directory. Not `rename`: it overwrites. Any failure: persist `phase: "publication_failed"` with the error and return `{ status: "publication_failed" }`.
8. Persist `complete`; return `{ status: "disabled_verified", name, installationId, schedulerId, enabled: false }`.

## Tests (acceptance 5: all six scenarios)
Keep task 1's tests unchanged and append. Each test: its own mkdtemp root, a repoRoot string without a trailing slash (it is never created), `NOW`, and a proposal factory with `expiresOn: "2026-09-27"`.
Fake scheduler: `calls = []`; `createDisabled(plan)` pushes "createDisabled", returns `{ id: "job-1" }`; `read(id)` pushes "read", returns a job built from LITERALS: `{ id, name: "orion-auto-calendar-check", timeZone: "Europe/London", cron: "5 9 * * *", commandArgv: [repoRoot + "/scripts/orion-automation-run", "calendar-check"], cwd: repoRoot, enabled: false, exact: true, noDeliver: true }`; `remove` pushes "remove".
1. Successful registration: status `disabled_verified`; `calls` deepEqual `["createDisabled", "read"]`; the installed file parses to a record with `name === "calendar-check"` and `action === "agenda_today"` at top level; `root/runtime/<sha256hex(installationId)>.dispatch.json` has `phase: "ready"`; the transaction file has `phase: "complete"` and the id. Recommended interop proof: `runInstalledAutomation("calendar-check", DUE, { automationRoot: root, repoRoot, checks: { readContext: async () => ({ now: DUE, effectiveMode: "guarded", focusActive: false }), authorize: async () => true }, run: async () => ({ stdout: "ok" }) })` with `DUE = Date.parse("2026-09-20T08:05:00Z")` returns `status: "succeeded"`.
2. Same-name concurrency: five calls on one root through `Promise.allSettled`; exactly one `disabled_verified`; `createDisabled` called once in total.
3. Existing record unchanged: pre-write `root/installed/calendar-check.json` with known bytes; refused; bytes identical; no scheduler call; no `root/runtime`.
4. Failure before create: timeZone "Mars/Base" (and a proposal without `intent`) throws or refuses; zero scheduler calls; no installed or runtime files.
5. Failed read-back: `read` returns the literal job with `enabled: true`, and in a second case rejects: not verified; transaction `phase: "job_known"` with the id; no installed record; `remove` never called.
6. Publication failure: `await writeFile(join(root, "runtime"), "")` before the call makes ledger creation fail; status `publication_failed`, recorded in the transaction; no installed record.

## Exchange plan
1: the two READs. 2: FILE the module alone, with CHECK. 3: FILE the whole test file (task 1's tests plus the six scenarios), with CHECK. 4-6: fix one file per reply, each with CHECK. Then the self-review, then DONE naming the test for each scenario. A test file over about 12 KB triggers one extra self-review exchange; budget for it.

## Traps
- `now` passed as a Date: the plan throws "Invalid current clock". It is a number.
- `policy: plan.policy` nested in the record. Spread it.
- `plan.name` ("orion-auto-...") as the record name or file name. Use `proposal.name`.
- A different object for the ledger and for the file: any extra field makes the runtime refuse with `invalid_state`.
- A lock never released, or one released by a call that did not create it.
- A transaction holding only `{ phase, evidence }`: task 3 then has nothing to verify against.
- A failed read after a known id recorded as `create_pending`: that phase means no id is known.
- A fake `read` that copies fields from the plan it receives: it always verifies.
- `Promise.all` for the concurrency test: one rejection ends it while another call is still writing.

## For the reviewer (you cannot open files; judge the diff against these facts)
1. Exact signature; TypeErrors before any effect; no `homedir`, default scheduler or `child_process`; no path calls `remove` or enables anything.
2. `now` reaches `automationSchedulePlan` as a number; the record is bare name, installationId, ISO installedAt, timeZone, trigger and the policy fields at top level; the same object goes to `initializeAutomationDispatch(join(root, "runtime"), record)` and to `installed/<name>.json`.
3. The transaction exists (exclusive create) before `createDisabled`; the id is persisted before `read`; existing record or transaction refused without overwrite; the lock is released only by its creator.
4. Success only after ledger init and exclusive publication; no effect, known job and unknown outcome are distinguishable on disk.
5. All six scenarios, each asserting scheduler calls AND durable state; observed jobs from literals; task 1's tests unchanged and passing. A module with no tests for these scenarios fails criterion 5, however correct it looks.
