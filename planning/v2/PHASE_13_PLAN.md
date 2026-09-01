# ORION v2 Phase 13 — Authentication

Status: **planned — 2026-08-25**. Phase 12 closed the same day.

## What the manifest asks for

Account authentication kept separate from device identity. Short-lived access
tokens or equivalent sessions, refresh/session rotation, revocation, a
device/session inventory, rate limiting, secure cookie and token handling, CSRF
protection, brute-force protection, and suspicious-session detection. Plan for
Sign in with Apple and passkeys. **Do not treat an OAuth connector as ORION
account authentication.**

## The two rules that shape the design

**Account is not device.** Phase 14 gives devices cryptographic identity; that is
a different question from who the user is, and conflating them is how "my Mac is
signed in" quietly becomes "anyone holding my Mac is me". So authentication
produces a `Session` for a *user*, a device is an optional attribute of that
session, and a device key can never be presented as an account credential. There
is a test for each direction.

**A connector is not a login.** Phase 12 stores Google credentials; being able to
read someone's Gmail is not evidence of being them. The mechanism registry
refuses any provider that appears in the connector list, so this cannot be
implemented by accident later.

## Tokens

Opaque random strings, stored only as hashes — Phase 11's `sessions.token_hash`
column already assumes this, and the reason is that a stolen database should not
be a stolen session. Short access lifetime, longer refresh lifetime with an
absolute ceiling, so a refresh chain cannot be extended forever.

**Rotation with reuse detection.** Every refresh issues a new token and retires
the old one. Presenting a retired token is not an error to shrug at: either the
token was stolen or it was replayed, and in both cases the honest response is to
revoke the entire family and make the user sign in again. That is the one place
this design is deliberately harsher than convenient.

## Throttling that cannot be turned into a weapon

Brute-force protection usually means locking an account after N failures, which
hands an attacker a way to lock any account they can name. So there are two
different mechanisms:

- **per source**: a hard limit, because a source making hundreds of attempts is
  an attacker whatever account it names;
- **per account**: increasing delay rather than lockout, so a victim can still
  get in, slowly, while an attacker gains nothing.

## Suspicious sessions

Deliberately narrow, and stated as what it detects rather than as intelligence:
a retired token being reused, a revoked session still being presented, and a
session appearing from a new source while another is active. Each is a fact the
system already has. Anything requiring geolocation or behavioural modelling is
not in this phase and is not pretended at.

## Cookies and CSRF

A declared cookie policy — HttpOnly, Secure, SameSite — asserted rather than
described, plus a double-submit CSRF token bound to the session and compared in
constant time. CSRF applies to cookie-bearing state-changing requests; a bearer
token in a header is not vulnerable to it, and pretending otherwise adds a
ritual without a defence.

## Sign in with Apple and passkeys

Registered as mechanisms with verifier ports and no implementation, because both
need a real cryptographic verifier this repository cannot install tonight. What
this phase fixes is the shape: which mechanisms exist, that each carries an
assurance level, and that a connector can never be one.

## Exit criteria

- Sessions are opaque tokens stored hashed, with short access life and a bounded
  refresh chain.
- Rotation retires the old token; reuse of a retired token revokes the family.
- Revocation is immediate and covers every token in the family.
- A session inventory lists what is active, with device and last use.
- Per-source limiting and per-account backoff, with the reason each is shaped the
  way it is recorded in the code.
- Cookie policy and CSRF are enforced and tested, not described.
- An account credential cannot be a device key, and a connector cannot be an
  authentication mechanism.
- Suites green.
