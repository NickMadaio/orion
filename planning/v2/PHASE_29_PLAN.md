# ORION v2 Phase 29 — Gmail Sending

Status: **planned — 2026-08-26**. Phase 28 closed the same day.

## What the manifest asks for

`gmail.send`. Initial sending is R3. Explicit approval. Show recipient, subject,
draft and attachments before approval. Maintain audit records. Narrow future
policies — "send routine availability confirmations" — through explicit
delegation only.

## Reuse, not reinvention

This is the same problem Phase 25 solved for calendar writes: a person is shown
something, approves it, and something else must not go out. So the same shape is
used — a preview, a fingerprint over exactly what was shown, an approval that
carries the fingerprint, and a recompute at authorization.

The difference is what a mistake costs. A calendar write can be undone. **A sent
email cannot be**, by anyone, ever — so `undo_available` is false with the reason
stated, and the four things the manifest names are each asserted present in the
preview rather than assumed to be on screen.

## The recipient is the field that matters

Of the four, the recipient is the one where a mismatch is unrecoverable and
invisible. The fingerprint covers the exact recipient list in order, and a test
changes one address and asserts the approval no longer authorises the send.

## Delegation is declared and refused

The manifest's own example — "send routine availability confirmations" — is
written down as a shape Phase 50 will implement, and refused here by name. A
capability that quietly works because nobody wrote the check is worse than one
that is missing.

## Exit criteria

- `gmail.send` at R3, strictly above calendar writes.
- Sending requires: a reviewed draft, a preview, an explicit approval bound to
  that preview, and a connection carrying the send scope.
- The preview carries recipient, subject, body and attachments — asserted.
- Changing any one of the four invalidates the approval.
- No undo, with the reason recorded rather than a false one offered.
- Every send produces an audit record; refusals do too.
- A delegated send is refused and names Phase 50.
