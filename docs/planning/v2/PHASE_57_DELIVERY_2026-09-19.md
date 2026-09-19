# Phase 57 candidate notification limits — 2026-09-19

Added optional, explicitly targeted delivery to the candidate automation dispatcher.
Message attempts now have a durable daily budget, separate from action attempts.
This is tested through fixture adapters only; no real sender, scheduler or new
permission was enabled. Formal completion remains46/85 (54%).

## Behavior

Delivery requires an installation-bound targetId and a maxMessagesPerDay value
from0 through48. No target is inferred. Zero suppresses all delivery without
blocking an otherwise allowed action or requesting outbound approval. Empty
output consumes no message quota. Action output is bounded to8192 characters
before authorizing the exact final body and target together.

Outbound authorization is separate from action authorization. After execution,
the dispatcher checks delivery authority, refreshes time/effective mode/focus,
and enforces expiry, quiet hours and the daily message limit. Independent review
found that a backward clock between action and delivery could charge a previous
day in a fresh message ledger. Delivery now also requires a timestamp no earlier
than the successful action admission. The regression proves corrected time cannot
produce an extra same-day delivery.

The counter is per installation, not per target, body or trigger. Changed delivery
configuration fails the installation fingerprint check; changing the ceiling does
not silently replenish budget. Message reservations reuse the existing locked,
fsynced atomic admission storage, with a separate key and binding. Missing or
invalid state refuses; uncertain or failed delivery attempts are never refunded.

The dispatcher persists action_completed and delivery_pending separately.
Transport is invoked only after the message slot and pending receipt are durable.
Confirmed delivery, confirmed nondelivery and uncertainty are distinct results.
Unknown/throwing/malformed transport outcomes block future runs pending resolution.
Even retry_once never retries a notification. Known nondelivery remains charged;
a later distinct trigger may run within the remaining budget. A completed action
is never re-executed to retry its notification.

No production transport is supplied. The trusted host must own installation/state,
authorize exact content and destination, and implement a truthful single-message
transport adapter. An idempotency key is supplied to that adapter, but no claim is
made that a real provider honors it. No external messages were sent in this work.

## Verification

52 automation tests pass independently:12 delivery,17 dispatcher,15 admission,
and8 removal. Delivery tests cover exact bounded content/target authorization,
zero budget, empty output, permission refusal, fresh expiry/focus/quiet/mode,
local midnight, cross-ledger backward time, configuration mutation, uncertain
and confirmed failed delivery,8 competing processes for one message slot, and
real child termination immediately before/after a simulated send effect.

After positively observing fixture child exit, test-only lock recovery still
leaves delivery_pending and refuses replay, preserving the charged quota and
completed-action state. Prior run/dispatcher regression suites still pass. A
previous receipt-write-failure assertion now checks the more accurate distinction:
known completed action with delivery not attempted, rather than claiming the
action itself has an unknown outcome.

Independent review reproduced and verified the clock repair and found no remaining
actionable finding within this candidate scope. All four suites are part of CI.
Full quick source CI passes348 plugin tests plus52 automation tests. Network
dependency auditing was skipped by --quick.
Evidence: .builds/phase-57-delivery-2026-09-19/.

## Next gate and limits

Production permission/context/execution/transport adapters and the human-only
installer still need connection and end-to-end proof. This does not establish
real provider delivery, approval consumption, subprocess cancellation, power-loss
recovery or a user-facing recovery flow. Phase57 remains open until those paths
are proven. No new hands-on step is needed for this candidate slice.

Rollback: revert the scoped checkpoint. No production schedules, accounts,
authority files or personal-plan state were changed. Preserve capabilities.md.
