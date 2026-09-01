# ORION v2 Phase 5 — Build the Policy Engine

Status: **planned — 2026-08-23**. Phase 4 closed the same day.

## What the manifest asks for

One deterministic engine, outside the LLM, that answers `ALLOW` / `DENY` /
`REQUIRE_APPROVAL` for every proposed action; a R0–R5 risk vocabulary; fourteen
named evaluation inputs; the model never able to override the result; and all
current Mac tools passing through the engine before remote access exists.

## What already exists, and why that is the problem

Three separate places already decide whether an action may run, and none of them
is the engine the manifest describes:

| Decider | Lives in | Vocabulary | What it knows |
|---|---|---|---|
| `validator.ts` | plugin | `ready` / `needs_approval` / `rejected` | arguments, provenance, taint, approval hash |
| `permissions.ts` | plugin | five profiles × capability tiers | which tiers a profile grants |
| context firewall | `orion/core/context/` | admit / deny | which domains may sit in one bundle |

`ready/needs_approval/rejected` **is** ALLOW/REQUIRE_APPROVAL/DENY under other
names, so the outcome vocabulary is not the gap. The gaps are:

1. **No risk vocabulary.** Four words (`low/medium/high/critical`) that say how
   bad an action is, with no relation to *what kind* of bad. R0–R5 is not a
   finer scale of the same thing — it is a different axis: reversibility and
   reach, not severity.
2. **The decision is spread across three deciders.** No single call site can be
   pointed at and called "the policy engine", which is what makes "the model can
   never override the result" unprovable rather than false.
3. **Nine of the fourteen inputs are not represented anywhere**: originating
   device, target device, delegation, device trust, signatures, expiration,
   security state, request source, authenticated user. Several only become
   *load-bearing* once remote access exists (Phase 44+) — but an engine that
   cannot even express them will be rewritten then, not extended.

## Design

`orion/security/` — the package Phase 1 deliberately left empty, recording that
`orion/security/decisions.py` was "intentionally deferred to Phase 5 rather than
adding a second, premature permission implementation".

```
vocabulary.py   RiskLevel R0-R5, SecurityState, DeviceTrust, RequestSource
risk.py         capability -> risk level, derived, not asserted
profiles.py     the five live profiles as tier sets and risk ceilings
devices.py      device identity and trust, looked up rather than claimed
delegation.py   a delegated grant that can only narrow
signing.py      canonical bytes and HMAC verification for R4/R5
request.py      PolicyRequest: the manifest's fourteen inputs, strictly decoded
decisions.py    PolicyEngine.evaluate -> PolicyDecision -> DecisionEnvelope
```

### Risk is derived, never declared

A request may carry a `declared_risk`, and the engine uses it for exactly one
thing: to **deny on mismatch**, the way `validator.ts` already denies on
`risk_mismatch`. The authoritative level comes from the capability registry's
side effects, reversibility and domain. Anything else lets the caller — which
may be the model — pick its own risk.

The same reasoning applies to device trust: it is looked up in a directory, never
read off the request. A device asserting its own trust level is not a check.

### Most-restrictive-wins, and default deny

Every rule is evaluated, not short-circuited, so an audit record lists every
reason a decision came out the way it did rather than only the first. The
outcome is the most restrictive verdict any rule returned. A capability that
matches no grant is denied: `ALLOW` requires passing every gate, and the engine
raises rather than returning a decision with no reasons at all.

### The rules

| Rule | Outcome | Why |
|---|---|---|
| unknown capability | DENY | default deny; a capability nobody registered has no contract |
| declared risk ≠ derived risk | DENY | mirrors `risk_mismatch`; the caller does not get to set its own level |
| now ≥ expires_at | DENY | "never allow an expired command to execute after a device reconnects" |
| origin device not PAIRED | DENY | revoked and unknown devices cannot act |
| target device REVOKED | DENY | as above, in the other direction |
| target ≠ origin while remote is off | DENY | remote access does not exist until Phase 44 |
| no authenticated user | DENY | every other input is meaningless without one |
| user does not own both devices | DENY | ownership is server-side, never client-asserted |
| profile does not grant the tier | DENY | parity with `permissions.ts`, which stays authoritative live |
| risk above the profile ceiling | DENY | catches a capability added later without a tier decision |
| security state LOCKED | DENY above R0 | Phase 43's LOCK ORION, expressible now |
| external data involved, risk ≥ R2 | DENY | external content cannot cause an external action |
| request source EXTERNAL_CONTENT and capability mutates | DENY | content is data, never instruction |
| R4/R5 without a valid signature | DENY | an unsigned sensitive job cannot execute |
| delegation absent/expired/out of scope | DENY | a delegation may narrow, never widen |
| security state HEIGHTENED above R0 | REQUIRE_APPROVAL | |
| external data involved at R1 | REQUIRE_APPROVAL | |
| request source MODEL_INITIATED above R1 | REQUIRE_APPROVAL | the model may propose, never authorize |
| capability declares `approval_required` | REQUIRE_APPROVAL | parity with the catalog |
| risk ≥ R3 | REQUIRE_APPROVAL | external communication is always the user's call |
| every gate passed | ALLOW | |

### The engine emits Phase 1's envelope

`PolicyDecision.to_envelope()` returns the `DecisionEnvelope` Phase 1 defined, so
the decision that `AuthorizedAction` already refuses to execute without is now
produced by something rather than hand-built in a test.

## Verifying it against the live system, without rewiring it

`scripts/orion_v2_policy_check.py` runs all **78 actions × 5 profiles = 390**
combinations through the engine and compares each against the live rule read out
of the compiled plugin (`profileAllowedTiers` and `approvalRequired`).

The assertion is not "identical" — it is **never more permissive**. Where the
engine is stricter the check lists the exact actions and why, so an intentional
difference is a reviewed line in the handoff rather than a surprise later. The
tier sets in `profiles.py` are additionally compared field-for-field against the
compiled `PROFILE_TIERS`; any drift fails.

## Test-gated slices

1. Vocabulary and risk derivation, including the full 78-action table.
2. The fourteen inputs, strictly decoded — unknown keys rejected, so a
   model-supplied JSON object cannot smuggle an outcome.
3. The rule set, one test per rule, plus most-restrictive-wins and determinism.
4. Delegation, signatures, device trust.
5. Parity: 390 combinations against the compiled plugin.

## Exit criteria

- One engine, deterministic, with no LLM input and no path by which a caller can
  assert its own outcome, risk, or device trust.
- R0–R5 exists and every one of the 78 live capabilities classifies into it.
- All fourteen manifest inputs are represented and evaluated.
- The engine is never more permissive than the live permission system across all
  390 combinations, and every stricter case is enumerated.
- Suites green.

## What this phase does NOT do

It does not replace `validator.ts` or `permissions.ts` as the live decider. That
is the Phase 1 reading again — Core defines and validates contracts, the platform
adapter executes them — and swapping the live gate for a Python one on the same
day it is written would be the opposite of careful. The manifest's "make all
current Mac tools pass through this engine" is met in the form the program has
used since Phase 1: every live tool is evaluated by the engine, and the engine's
answer is proven never to be more permissive than the answer the live gate gives
today. The remaining half — the live route calling the engine instead of
agreeing with it — is recorded as a limitation with the exact work it needs.
