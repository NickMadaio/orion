# Phase 57 candidate installed-policy executor — September 20

The runtime now connects installed policy, durable dispatch and a bounded fixed
subprocess. It supports only agenda_today. It has no scheduler entrypoint,
installer, sender or recovery bypass. Formal completion remains46/85 (54%).

## What changed

runInstalledAutomation loads a validated name from installed/, never from proposed/
or a caller-supplied policy. The record must have installation metadata and match
the already-initialized dispatcher/admission ledgers. Missing ledgers refuse;
runtime never replenishes or initializes them. Replacing or removing policy is
checked again before launch. Old installation records lacking identity/ledger
state are unsupported, pending explicit installer migration.

Immediately before execution, the adapter repeats expiry, effective-mode, quiet
hours and focus checks, rejects backward/stale time, and refuses a civil-midnight
crossing that would charge a different day's budget. Admission and executor reuse
one pure conditions function. Quota remains reserved exactly once per attempt.
Authority is checked after the potentially slow context probe, then the fixed
absolute orion-agenda script is invoked with only the today argument. TZ is the
installation's explicit timezone.

The subprocess has a35-second timeout, SIGKILL and1MiB output bound; returned
output is capped at8192 characters. An exit error, timeout, overflow or malformed
runner result is an uncertain outcome, never certified retry-safe. The dispatcher
stops and refuses replay. Only a refusal before calling the process runner can
certify that no action was launched. Raw errors and stderr are not returned.

## Review and proof

Independent review reproduced a revocation gap: the first implementation checked
authority before waiting for context, so revocation during that wait could launch
the command. Moved the final authority check after context and policy checks;
added the exact regression. Independent rereview found no remaining actionable
finding within this scope. All74 automation tests passed independently.
Final quick source CI passes348 plugin tests and all74 automation tests; secret
scan is clean with30 reviewed fixtures allowlisted. The --quick run skips the
network dependency audit and does not replace installed Mac route checks.

11 runtime tests cover exact process arguments/options, missing or changed policy,
unsupported actions/delivery, missing ledger, late revocation, focus, mode, expiry,
clock reversal, stale trigger, civil midnight, quiet hours, uncertain failures,
and durable replay refusal. Actual disposable shell processes prove successful
output and write-then-fail behavior without retry. They do not read real calendar
data or install a real automation. Evidence is in
.builds/phase-57-runtime-2026-09-20/.

## Limits and next gate

Installed files and injected adapters are trusted host inputs; this is not a
privilege boundary against another process with the same filesystem authority.
Checks and spawn are not atomic. Concurrent changes after final reads remain a
host-level race. Killing the direct child does not prove descendant cancellation.
These limitations must remain explicit before production scheduling is enabled.

Next: migrate the human-only installer to create bounded records and ledgers,
connect a scheduler entrypoint and prove a disposable complete route. Real
approval consumption, notification transport and production scheduler behavior
remain unproven. No new hands-on step is needed for this source checkpoint.

Rollback by reverting the scoped local checkpoint. No real schedule, permission,
installed plugin, personal plan or calendar was changed. Preserve capabilities.md.
The checkpoint is local, not a verified remote backup.
