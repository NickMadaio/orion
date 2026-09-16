# Phone reading disconnect — 2026-09-16

Before retaining any connection setup, the phone needs an immediate local off
control. Control now offers Disconnect this reading while configured. It clears
the in-memory token, snapshot and revision history, cancels the active URLSession
and resets loading. A connection generation prevents a delayed response, error
or old request cleanup from updating a disconnected or replacement connection.

This does not delete the persistent device key or revoke server-side membership.
The UI states that boundary. Existing explicit development bootstrap files may
reconnect on a subsequent harness launch; durable user setup remains pending.

## Verification and review

The actual Simulator authenticated route returned its first reading, then delayed
the second GET. The UI disconnected during that refresh and observed the empty
state beyond the server delay. The reader records whether refresh was pending
synchronously at the disconnect action; the test requires this evidence.
This fixes the independent review finding that delay alone could let the test
pass after a request had already finished. Final source review found no remaining
actionable issues.

The harness requires exactly two reads and subsequently checks failed-exchange
legacy fallback refusal and durable revocation. The existing HTTP read/outage/recovery/revoke regression also passes.
Physical-iOS compilation passes
unsigned; no physical device behavior is claimed. Logs are under
`.builds/phone-disconnect-2026-09-16/`; UI details are under
`.builds/phone-pairing-check/`.

Source/history secret scan clean (3581 reviewed occurrences). Temporary setup
files were confirmed absent after the scenarios.

## Scope and rollback

No production Mac change, account enrollment, provider setup, personal-plan write
or remote deployment. No new hands-on step is needed for this slice. Persistent
user-approved configuration and physical transport remain the next setup work.
Formal roadmap remains 45/85 phases (53%); this does not close another phase.
Revert the scoped checkpoint to remove the control and regression harness.
