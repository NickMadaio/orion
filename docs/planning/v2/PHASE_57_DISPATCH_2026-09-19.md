# Phase 57 candidate dispatcher — 2026-09-19

Connected the durable admission guard to a candidate execution dispatcher. The
fixture path now reserves a run, records pending execution, performs a disposable
local action and saves its outcome. This is not installed scheduler wiring or a
production authority adapter. Formal completion remains46/85 (54%); Phase57 stays
open. No real automation, notification, permission or installed plugin changed.

## Behavior

The dispatcher accepts only actions from the existing closed automation table;
command arguments are copied from that table, never caller-supplied shell text.
A stable fingerprint binds the complete installed record, including action and
failure behavior. A separate exclusive lock covers the whole invocation.

Daily, hourly and weekly triggers are checked in the installation's timezone.
Future triggers and arrivals more than five minutes late refuse. Durable receipts
reject repeated/older trigger times; civil-slot comparison suppresses the repeated
hour during the autumn clock change. Missing/corrupt/changed state fails closed.

Each attempt fetches trusted current context, requests authorization from the host
adapter and passes through the existing durable admission guard. It then saves a
pending receipt before invoking the execution adapter. The adapter receives only
the fixed action and argv. These are host interfaces, not model-supplied authority.
The production adapters still need implementation and normal-route proof.

stop halts after a known failure. retry_once allows at most one additional attempt,
only when a trusted executor certifies that the failure produced no side effect.
Each retry repeats authorization and admission and consumes its own daily slot.
Quota/authority refusal during retry reports the prior attempt and stops the job.
report_and_continue permits a later trigger after a known side-effect-free failure,
while still refusing a duplicate trigger. Exceptions or uncertain effects stop.

A process dying during an action leaves a pending receipt/lock. Even after a
fixture operator proves the process exited and clears its lock, pending state
prevents replay. There is no automatic stale-lock cleanup or implicit quota refund.
Failure to save an outcome reports uncertainty and the number of attempts already
made; it does not claim nothing happened. Output is local returned data, capped at
8192 characters. No notification sender is called by this module.

## Review and evidence

Independent review found that retry preparation briefly persisted ready state,
allowing a later scheduled run after retry context/authority threw. It now stays
pending throughout retry preparation. Added regression tests for both adapter
errors and an actual process exit between attempts.

17 dispatcher tests pass, alongside15 admission and8 removal tests (40 total).
Tests cover a real disposable file effect, durable replay refusal, concurrent
calls, expiry/authority/trigger refusals, retry quotas/revocation, all failure
policies, daily/weekly timing, repeated DST hour, changed installation, pending
recovery, actual child termination after an effect, and injected receipt rename
failures before/after execution. Independent final review reran all40 and found
no remaining actionable issue in this scope. All three suites are wired into CI.
Full quick source CI also passes348 plugin tests and40 automation checks; the
network dependency audit is skipped by --quick.
Evidence: .builds/phase-57-dispatch-2026-09-19/.

These tests prove local candidate orchestration and process-failure handling.
They do not prove physical power-loss recovery, untrusted storage resistance,
production permission enforcement, bounded subprocess cancellation, notification
limits, or installed scheduler behavior. The trusted host must own record/state
storage and supply effective permissions/focus and truthful executor outcomes.
In particular, daily_rollup can modify files before failing: ordinary process
failure is never enough to certify retrySafe.

## Next

Implement production host adapters and message-budget enforcement, then connect
the human-only installer using an explicit installation-bound timezone. Prove
that complete route with disposable effects before enabling real automation.
No new hands-on step is required for this candidate work. The separate Trash
recovery test still awaits a fresh human-only approval when Nick is ready.
Rollback this scoped checkpoint; no production state restoration is needed.
