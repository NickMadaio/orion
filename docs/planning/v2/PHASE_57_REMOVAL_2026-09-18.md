# Phase 57: truthful automation removal — 2026-09-18

Fixed a real failure: the human automation-control command swallowed scheduler
listing/removal errors, matched names by substring, then removed its local
installed record and reported success. A job could keep running while Orion
claimed it had stopped.

The command now reads the scheduler's complete structured job list including
disabled jobs, selects one exact name, removes that exact ID, and reads again to
confirm absence before changing local records. Malformed, incomplete, duplicate,
ambiguous or unavailable responses refuse the transition. A job recreated under
the same name also prevents a false success. A verified already-absent schedule
can be reconciled without another removal call. Unsafe names are rejected before
constructing paths. User-facing errors omit scheduler payloads.

The result says the schedule was removed and warns that an already-running task
may still finish. No new cancellation or scheduler authority was introduced.
The existing human-only install/remove boundary remains unchanged.

## Verification

Eight isolated Node tests pass, covering exact identity, similarly named jobs,
absence, listing and removal errors, post-removal failure, retained/recreated
jobs, malformed/incomplete/duplicate lists and unsafe names. They now run in the
normal CI unit/integration stage. Full quick source CI passes, including348 plugin
tests; CLI and shell syntax checks pass. Independent review found no remaining
actionable issue. Local-record preservation was source-reviewed; helper tests
exercise the scheduler boundary, not the complete filesystem transition.

Read-only CLI inspection verified the installed scheduler JSON contract. The
normal automation list command reports zero proposed/installed automations.
No real schedule was installed, removed, enabled, disabled or executed. Logs:
.builds/phase-57-removal-2026-09-18/. Existing unrelated scheduled jobs were not
modified. Changes apply to the repository's human CLI; no plugin redeploy needed.

## Remaining gates

Phase57 remains in progress. The old expiry row was marked passed solely because
expiresOn was required. The scheduler receives no runtime expiry guard, so that
row is now blocked and the dependent Phase58 entry flag updated consistently.
Runtime expiry, conditions, risk limits, failure behavior, installation command
wiring and timezone selection still need implementation and actual proof.
Formal roadmap remains46/85 complete (54%).

Phase47 file copying remains deployed and proven. Trash ticket A-QZV3 expired
ungranted by11:53 BST; no deletion occurred. A fresh ticket is needed when Nick
is ready to perform the human approval. Keep the disposable proof fixtures.
Rollback: revert this scoped code/document checkpoint; no scheduler state needs
restoration. Preserve unrelated capabilities.md.
