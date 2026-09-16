# Explicit phone connection review — 2026-09-16

The Simulator now has an explicit local connection review route. Loading the
review validates and retains a setup value without contacting the service. The
screen states the loopback address, read-only plan scope, temporary test account
and limited access lifetime. Connect uses exactly the reviewed value, without
re-reading a potentially changed setup file. Not now leaves the reading empty.

Cancel connection cancels the task and clears local state. Cancellation is checked
before signing and before installing the returned token; cancelled errors cannot
overwrite the disconnected state. The existing reader generation guards protect
the subsequent first read. Tokens stay in memory; keys remain persistent.

## Evidence

- Actual Simulator review/decline/relaunch/approve/read/disconnect scenario passes.
  The same single-use setup grant survives decline and relaunch, then exactly one
  plan read follows approval. The review route excludes legacy bootstrap loading.
- Actual cancellation during a delayed signed exchange passes. Both exchange
  endpoints are reached, zero plan requests follow, and the UI remains cancelled
  beyond the delayed reply.
- Failed-exchange legacy fallback refusal and durable revocation remain checked
  by both scenarios. Physical iOS compiles unsigned; no physical proof claimed.
- Existing HTTP read/outage/recovery/revocation regression also passes.
- Independent source reviews found no actionable issues. Evidence logs live in
  `.builds/phone-setup-review-2026-09-16/` and `.builds/phone-pairing-check/`.

## Usable entry and limits

`--review-connection` can be appended to an explicit personal `--http-session
--source … --preview-seconds 120` invocation. It waits at most90 seconds for an
approved first read, then runs the existing bounded timer. Timeout, interruption
and exit revoke the disposable device, stop the server and remove matching setup
files. The UI review and cancellation were exercised automatically; a human
reviewed timed-preview invocation has not been claimed as proof.

This is a prerequisite for persistent user setup, not durable enrollment itself.
Real accounts, secure physical transport and phone deployment remain unfinished.
No hands-on action is required to complete this local slice. Roadmap remains
45/85 phases (53%). Installed Mac and personal plan are unchanged.

Rollback by reverting this scoped local checkpoint. No production enrollment or
service was installed; preserve unrelated capabilities.md.
