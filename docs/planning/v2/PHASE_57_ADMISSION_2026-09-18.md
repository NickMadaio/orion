# Phase 57 durable admission guard — 2026-09-18

Built a candidate guard that reserves a scheduled attempt before any action can
start. It is not yet wired into the installer or scheduler. Phase57 remains open;
formal completion stays46/85 (54%). No real schedules or actions were changed.

## Behavior

The trusted installation record binds a stable installation ID, name, explicit
supported IANA timezone, inclusive expiry date, daily run limit, quiet hours,
focus suppression and expected effective strictness. Impossible dates and
malformed policy are refused. Expiry and daily counters use local civil dates,
including short/long daylight-saving days. Quiet hours are half-open; equal
endpoints mean no quiet interval, matching the existing simulator.

The caller must supply the effective strictness after delegation expiry and a
trusted focus reading. A mismatch refuses; when focus suppression is requested,
anything except an explicit inactive reading refuses. This guard grants no action
authority: a later dispatcher must still enforce the real policy/permission gate.

State initialization is explicit and exclusive, separate from runtime admission.
A missing, corrupt or differently bound state file never resets the counter.
An exclusive directory lock serializes competing processes. Admission writes and
syncs a private temporary record, atomically replaces state, then syncs its
directory before returning success. Failed/uncertain attempts are never refunded.
Backward clock movement refuses, preventing a previous day's quota from reopening.
An abandoned lock is not automatically removed based on age.

The storage directory and installation identity must be owned by the trusted host.
There is no new CLI, plugin action, scheduler entry, model authority or production
state initialization in this slice. The exported initializer is an implementation
primitive, not an exposed authorization route.

## Review and verification

Independent review found that syntactically valid but internally inconsistent
state could reopen quota: yesterday's stored day alongside today's timestamp.
The guard now requires stored day to match the timestamp in the bound timezone,
and any nonempty daily record must have at least one consumed attempt.

15 admission tests plus8 removal tests pass. Admission checks include inclusive
expiry, impossible dates, quiet/focus/mode refusal,8 child processes competing for
one slot, restart accounting, both DST transitions, backward time, policy mutation,
missing/corrupt/inconsistent state and abandoned locks. Isolated child processes
inject real module filesystem dependency failures at write, file-sync, rename and
directory-sync, and terminate immediately before/after publication. No failure
returns admission; after-publication accounting survives controlled fixture-only
lock recovery. This is process-failure proof, not a physical power-loss test.
Independent final review found no remaining actionable issue within this scope.

Full quick source CI passes, including348 plugin tests and23 automation tests.
Both automation suites are in that normal gate. Network dependency audit was
skipped by --quick. Logs:
.builds/phase-57-admission-2026-09-18/. No credentials or real scheduled payloads
were needed by the tests.

## Next gate

Build the dispatcher around this guard, with installation-bound authority,
trusted current focus/strictness inputs, message-budget reservation, bounded
failure/retry behavior and duplicate-trigger handling. Then repair installer
command wiring/timezone selection and prove the complete route with disposable
local effects before enabling a real automation. Proposal validation, including
maximum installation lifetime, remains a separate installer responsibility.

No claim is made yet for production expiry enforcement, notification ceilings,
trigger correctness, actual action authorization, power-loss recovery or a usable
operator recovery flow. Phase57 expiry stays blocked until connected-route proof.
Rollback: revert the scoped source checkpoint; no production restoration needed.
