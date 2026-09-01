# ORION v2 Phase 15 — Device Pairing

Status: **planned — 2026-08-25**. Phase 14 closed the same day.

## What the manifest asks for

Mac ↔ mobile pairing over a QR code or similar, with a one-time challenge, short
expiration, strong randomness, account binding, and possession proofs **from both
devices**. Never reusable pairing codes. Immediate revocation. All paired devices
visible in the Security Center.

## Both devices, which is the part usually skipped

Most pairing flows prove one side. The phone scans a code and proves it holds its
key; the Mac is assumed, because it displayed the code. That assumption is the
hole: anyone who can see the screen — a shoulder, a screen share, a photograph of
a code left open — is the Mac as far as the protocol is concerned.

So the flow is three steps and the offering device signs too:

1. **offer** — a signed-in person, on a registered device, asks for a pairing.
   The server mints a one-time nonce and a short expiry.
2. **claim** — the joining device proves possession of *its* key over the nonce.
   It is not registered yet.
3. **confirm** — the offering device proves possession of *its* key over the same
   nonce plus the joining device's public key. Only now is the device registered.

Step 3 binds the two: the offering device is signing a statement about *which*
key it is admitting, so a code photographed from across a room cannot be redeemed
without the Mac's private key.

## Never reusable, four ways

A pairing code is the highest-value string in the system for the two minutes it
exists:

- the nonce is single-use and spent on claim;
- the pairing has a terminal state, so a completed one cannot be reused;
- it expires in two minutes, checked at every step rather than only at claim;
- a failed claim cancels the pairing rather than leaving it open to retry, because
  a wrong signature on a pairing nonce is not a typo.

## What this cannot do without a real verifier

Same as Phase 14, and inherited from it: the signature verifier is a port with a
refusing default. Pairing cannot complete unless one is installed, which is the
correct failure — a device pairing without a verified proof is a device somebody
claimed, not a device that proved anything.

## Exit criteria

- Three steps, with a possession proof from each device, and registration only at
  the end.
- The nonce is single-use, the pairing is single-use, and expiry is checked at
  every step.
- Account binding: the offer needs a signed-in owner on a registered, unrevoked
  device, and the joining device lands under that same user.
- A failed proof cancels rather than retries.
- Revocation is immediate and shows in the Security Center listing.
- Suites green.
