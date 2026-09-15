# ORION v2 Phase 30 — HealthKit Local Layer

Status: **planned — 2026-08-26**. Phase 29 closed the same day.

## What the manifest asks for

HealthKit on iPhone only. Request individual data types incrementally, starting
with eight useful categories. **Do not request every HealthKit permission.**
Handle denied and revoked permissions gracefully. **Keep raw historical HealthKit
data local whenever practical.**

## Phase 16 built the lock this phase opens

`Deferred.swift` lists HealthKit as owned by Phase 30 and `MobileCoreCheck` greps
every source for `HealthKit`, `HKHealthStore` and `HKQuery`. That check is
supposed to fail now — it is the gate this phase is the key to.

Releasing it by hand-editing two lists is how the *other* two features get
released by accident later. So `forbiddenTokens` is derived from `features`: a
feature carries its own tokens, removing the feature removes them, and a feature
still listed cannot have its tokens missing. Gmail and remote Mac control stay
locked, and the check asserts they do.

## MobileCore still imports no framework

The iOS build is what keeps that true, and it stays true here. This phase defines
the **port** — the authorization state machine, the requested type set, the
sample shapes — and the `HKHealthStore` adapter is the platform layer, which does
not exist. The default implementation refuses, exactly as Phase 16's secure store
and Phase 12's cipher do.

## The fact that shapes the whole authorization model

**HealthKit will not tell you whether read access was granted.** Apple returns
`notDetermined` or a *write* status; for reads, a denial and an empty data set
are deliberately indistinguishable, so that an app cannot detect that a person
declined to share something.

That is not a limitation to work around — it is the privacy property, and
pretending otherwise produces the exact bug `AGENTS.md` already records:
*missing health data is not zero.* So read authorization has a state that means
**unknowable**, and a query that returns nothing is `noData`, never `denied` and
never `0`.

## Raw data stays local by being unable to leave

"Keep raw historical data local whenever practical" is a rule about a type.
`HealthSample` is not `Codable`, has no JSON form, and Phase 17's cache rules
already list `health_state` as never cached. A sample that cannot be encoded
cannot be uploaded by a future convenience.

## Exit criteria

- The eight named categories, and a strict subset of what HealthKit offers —
  requesting the full catalogue is refused.
- Types are requested incrementally; a second request asks only for what is new.
- Read authorization can be `unknowable`; no query returns zero for absent data.
- Revocation is handled and does not delete what is already local.
- `HealthSample` has no encodable form.
- HealthKit is released from `Deferred` and Gmail and Mac control are not.
- The iOS build still passes with no framework imported.
