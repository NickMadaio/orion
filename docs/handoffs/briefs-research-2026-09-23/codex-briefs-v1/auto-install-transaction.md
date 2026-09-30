# Task 2 — durable disabled installation transaction

Preserve Task 1 exactly, then add
`installDisabledAutomation({root, proposal, timeZone, repoRoot, scheduler, now})`.
All roots, clock input and adapter methods are explicit; there are no production
defaults. The scheduler surface is only `createDisabled(plan)`, `read(id)` and
`remove(id)`. This task never enables a job.

Build the schedule with `automationSchedulePlan`. Assemble a complete installed
record using the bare proposal name and trigger, plan time zone and policy, a new
random installation id, and an ISO installedAt derived from the supplied clock.
Persist a per-name transaction before the first scheduler effect. The transaction
must retain the full expected plan and installed record because reconciliation
later receives only root, name and scheduler. Record phases and evidence around
each irreversible seam, including the returned scheduler id before read-back.

Use an exclusive per-name intent and refuse an existing installed record,
runtime ledger, active/uncertain transaction or concurrent same-name call without
overwriting it. Suggested classifications are: before_create/no effect,
create_pending/unknown outcome, job_known/id recorded, disabled_verified, and
publication_failed. Exact labels may differ, but the record must distinguish no
effect, a known disabled job, and an unknown scheduler outcome after a crash.

Order the effects so no installed policy is published until exact disabled
read-back succeeds. Once verified, initialize durable dispatch/admission state
under `root/runtime` with the complete record, then publish the byte-equivalent
record at `root/installed/<bare-name>.json`, and only then mark the transaction
complete. Every phase update is an atomic durable replacement. Partial ledger
creation is possible and must remain visible rather than being silently reset.

Tests should cover successful disabled registration, exact record/runtime
interoperability, eight concurrent same-name attempts with only one create,
unchanged pre-existing record/transaction, invalid inputs before create, read
throw and mismatched read-back, and publication failure. Assert calls and durable
phase/evidence after each case. A root/runtime regular file is a safe way to
induce publication failure without production paths or filesystem mocking.

Do not weaken policy authorization, call remove as optimistic cleanup, use
`homedir`, spawn a scheduler, or hide an uncertain create behind a generic throw.
