# Task 3 — deterministic crash reconciliation

Preserve all earlier APIs/tests and add
`reconcileDisabledAutomation({root, name, scheduler})`. It is a recovery reader,
never a creator or enabler. It cannot recompute the plan: the signature has no
proposal, repoRoot, time zone or clock, and expiry-sensitive plan creation would
be wrong later. Read the expected plan, installed record, scheduler id, phase and
prior evidence from Task 2's durable transaction.

If an installer/transaction lock is live or uncertain, report busy and change
nothing. A create-pending record with no durable returned id is unknown and must
stay blocked for human inspection; never create a replacement or search by name
and guess. Completed records are inspected idempotently and never reinitialized.

For a recorded id, call only `scheduler.read(id)`. A mismatch, unexpectedly
enabled job, malformed result or read failure is intervention-required and must
not change any job. A known disabled job may be removed only when the transaction
is incomplete, observed id equals the recorded id, and
`verifyDisabledSchedule(storedPlan, observed)` is true. After remove, claim
cleanup only when another read establishes the adapter's documented absence
shape. Preserve all prior evidence and append the new attempt/result atomically.
Never write runtime quotas/ledgers or installed policy during reconciliation.

Tests need a real child-process death at each transaction seam, reopening state
from disk afterward. Cover repeated reconciliation, live lock refusal, unknown
create without id, read failure, id/content/enabled mismatch, cleanup failure,
successful verified cleanup plus absence read-back, and idempotent completed
inspection. Assert that create/enable are never called and unrelated ids are
never touched.

If Task 2's adapter absence convention or whole-run lock is missing, add the
minimum compatible behavior inside the two scoped files and retain prior tests.
Do not delete a transaction merely to permit a reinstall: evidence preservation
is part of the contract, and releasing a name safely belongs to a later explicit
operator workflow.
