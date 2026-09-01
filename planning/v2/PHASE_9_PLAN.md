# ORION v2 Phase 9 — Security Invariant Test Suite

Status: **planned — 2026-08-24**. Phase 8 closed the same day.

## What the manifest asks for

Eighteen named invariants, asserted by automated tests, kept permanently.

## The trap this phase is built to avoid

Four of the eighteen are about systems that do not exist yet: deleted
connections refreshing tokens, one user reaching another user's data, SSRF
against internal URLs, and the server-side half of ownership. A test asserting
that a nonexistent system cannot be attacked **passes**, permanently, and reads
in a report exactly like a test that proves something.

That is the failure mode worth designing against, because a suite whose green
includes four vacuous passes is worse than a suite with four gaps: the gaps
would at least be visible.

So the suite is paired with `planning/v2/SECURITY_INVARIANTS.json`, which records
every invariant as either:

- **enforced** — naming the test(s) that assert it and the code that enforces it;
  the suite verifies those tests actually exist, so a rename cannot quietly
  orphan an invariant; or
- **pending_subject** — naming what does not exist yet and which phase is
  expected to build it. A pending invariant may not have a test, so nobody can
  mark something enforced with an empty one.

A ratchet test asserts the pending count never rises without a deliberate edit.

## What is enforceable today, and by what

| Invariant | Enforced by |
|---|---|
| credentials cannot enter model context | Phase 3 `CredentialLeak`, refused twice |
| credentials cannot appear in logs | Phase 6 redaction, plus zero hits across the live ledger |
| revoked devices cannot act | Phase 5 device trust, looked up not claimed |
| expired jobs cannot execute | Phase 8, re-checked at four moments |
| jobs cannot replay | Phase 8 delivery tokens |
| wrong devices cannot execute targeted jobs | Phase 8 `WrongDevice` |
| unsigned sensitive jobs cannot execute | Phase 5 signature rule |
| altered signed jobs cannot execute | Phase 5 canonical signed fields |
| external content cannot grant permissions | Phase 5 request source, Phase 3 provenance |
| malformed tool arguments fail | Phase 4 closed argument schemas, strict decoders |
| models cannot bypass policy | Phase 5 strict request decoding |
| health data cannot leak | Phase 3 domain matrix, Phase 7 cascade matrix |
| email data cannot leak | as above |
| client ownership cannot override server ownership | Phase 5 directory lookup |
| remote raw shell remains disabled | Phase 4 name check, Phase 5 remote flag |

Four remain pending: **deleted connections refreshing tokens** (Phase 12's
credential vault), **cross-user data access** and **SSRF** (Phase 10's backend),
and the storage half of ownership (Phase 11). Phase 10 is next, so two of the
four are expected to close within the same run — and the registry is how that
becomes visible rather than assumed.

## Exit criteria

- All eighteen manifest invariants registered, none dropped, ids unique.
- Every enforced invariant names at least one test that exists in the suite, and
  the suite proves the name resolves.
- Every pending invariant names its missing subject and expected phase, and has
  no test.
- The pending count is asserted, so it cannot rise silently.
- Suites green.
