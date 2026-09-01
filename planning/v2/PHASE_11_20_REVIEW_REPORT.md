# Phases 11–20 — independent review, repairs and verification

Review and repairs: **2026-08-28**. Gate: `REC-REVIEW-11-20` in
`ROADMAP_AMENDMENTS.json`, the recovery item Phase 32.5 named as blocking the
next implementation batch.

Nothing was staged, committed or pushed. Nothing live changed. HEAD is still
`1efd37c`.

---

## 1. What was done, and why it was worth doing

Ten phases — Database Foundation through Unified Capture — carried exit claims
that nothing had ever checked. Every previous review in this program found
claims that were **false at the moment they were written**, so the question was
not whether this batch had drifted but whether its self-assessment had ever been
true.

Six reviewers ran independently, one to three phases each. Each was given the
manifest requirements, the recorded exit claims *as claims under audit*, the
current tree, and reproducible commands. None was given the implementer's
narrative. They were told to say what they tried, so that "found nothing" would
mean something.

**Result: 5 of 10 phases were not complete as claimed. 64 defects.**

| Phase | Verdict |
|---|---|
| 11 Database Foundation | **NOT complete as claimed** |
| 12 Secret and Credential Vault | complete as claimed, with defects |
| 13 Authentication | complete as claimed, with defects |
| 14 Device Identity | **NOT complete as claimed** |
| 15 Device Pairing | complete as claimed, with defects |
| 16 ORION Mobile Foundation | complete as claimed, with defects |
| 17 Conversation and State Sync | **NOT complete as claimed** |
| 18 ORION Memory v2 | **NOT complete as claimed** |
| 19 Today Screen | complete as claimed, with defects |
| 20 Unified Capture | **NOT complete as claimed** |

---

## 2. The finding behind the findings

Three separate mechanisms in this batch **verified themselves against
themselves**, and all three were cited as evidence:

- `APPLIED_CHECKSUMS = {1: MIGRATIONS[0].checksum}` — the recorded checksum was
  assigned from the live one, so "was this migration edited?" evaluated `x == x`.
  Changing `messages.body` from `text` to `jsonb` left the schema check at exit 0
  and all 1,375 tests green.
- `is_wall_clock_free(sort_key)` built two **identical** `Position` objects and
  asserted the key gave the same answer for both — true of `lambda _: 0`. Its
  docstring said the two "differ by a timestamp" and that it was "used by the
  check script"; neither was true, and nothing imported it.
- `MIGRATIONS` is *generated from* `SCHEMA`, so `drift()` compared the schema to
  a function of itself and could never fire.

A second pattern, nearly as common: **counts pinned instead of contents.**
`TodaySection.allCases.count == 8` passed after deleting "priorities" and
"action inbox" and substituting "Steps" and "Calories" — literally the metrics
dashboard the manifest forbids. The same shape appeared in `DesktopOnlySurface`,
`CaptureSource`, `CaptureKind` and `SecureKey`.

These are not wrong claims. They are infrastructure built to produce a green
result, which is a different and worse problem, because it survives review by
looking like evidence.

---

## 3. The defects that would have hurt

**Authentication (13) — full account takeover.** `sign_in` took `account` *and*
`user_id` as independent parameters: it verified the proof against `account` and
minted the session for whatever `user_id` the caller passed. Nothing mapped one
to the other, and `routes.py` already declares `POST /auth/session` as the
unauthenticated route that would fill it from a request body.
*Repair:* the verifier now **resolves** an identity rather than answering
yes/no, and `sign_in` has no `user_id` parameter to forge.

**Device Identity (14) — trust from nothing.** `adopt()`, a public method on the
same registry where `register()` correctly raises `VerifierUnavailable`, took no
signature, called no verifier, and produced a `DeviceTrust.PAIRED` device. The
requirement it falsifies is literally named `nothing_is_trusted_without_a_verifier`.
Found independently by two reviewers.
*Repair:* the pairing record retains the joining device's signature, and `adopt`
re-verifies it through the same verifier. A signature does not go stale.

**Device Identity (14) — origin binding defeated by truncation.** `_key_id` was
`f"key-{device_id}"[:127]` while `Identifier` permits 128 characters, so any two
device ids sharing their first 123 characters produced the **same**
`signing_key_id` — the value `orion/security/rules.py:300` compares to bind a
signature to its origin device. That line's own comment explains why verifying
against any registered key would be wrong.
*Repair:* hashed, not truncated.

**Pairing (15) — revocation with a hole in it.** `offer()` checked
`offering.revoked`; `confirm()` did not, and `confirm()` is where the new device
is admitted. Revoking a compromised Mac between claim and confirm left the
attacker a freshly registered, unrevoked, `PAIRED` device that the revocation
never touched.

**Sync (17) — silent loss of the user's own work.** `acknowledge()` filtered the
whole pending list against a cumulative `_delivered` set, so re-queueing an
already-acknowledged id — a user editing a synced message while offline — meant
the next acknowledge of *anything* deleted the edit. `acknowledge(())` deleted
it too. And `since(cursor)` filtered on position, which a revision does not
change, so every correction made while a device was away was invisible to it
forever.

**Memory (18) — the rule the phase exists for.** The grounds gate sits behind
`if rules.requires_grounds:`, and `EPISODIC` is durable *without* grounds — so
arbitrary scraped text with `EXTERNAL_UNTRUSTED` provenance was stored durable
for a year and served by `recall()`. Two further routes bypassed it entirely:
constructing `MemoryItem` directly, and `dataclasses.replace` laundering an
episodic item into a permanent `USER` fact about the person.

**Capture (20) — auto-saving ambiguity.** `isResolved` tests
`confidence >= 0.75`; the classifier handed itself `0.76` for any text
containing `"my "` as a **substring**. "Jim*my* called about the roof",
"acade*my* sent the invoice" and "ene*my* contact report" all became permanently
savable memory candidates tagged resolved-by-classifier, with no person
consulted. The comment on that very line says a memory candidate needs grounds
the classifier cannot give. The code contradicted its own comment by one
hundredth.

**Today (19) — a screen that freezes.** The overall cap was tested *before* the
section being replaced was removed, so replacing a section charged its old items
against the ceiling. A full twelve-item screen could never be refreshed or
cleared, and sections 5–8 — *Needs you*, *Health*, *Worth knowing*, *ORION
suggests* — could never appear at all. The action-bearing sections were the ones
starved.

**Mobile Foundation (16) — a scan that did not descend.** The deferred-feature
grep used `contentsOfDirectory`, which does not recurse, while SwiftPM compiles
subdirectories. A working `MacRemote` with `gmail.readonly` and `remoteExecute`
at `MobileCore/Remote/` was public, callable, compiled — and green. Separately,
the import boundary was enforced only by the iOS compiler, which catches
platform-*exclusive* frameworks; `import SwiftUI`, `Security` and
`UserNotifications` — the three the phase's own closing work names next — all
passed.

---

## 4. Alternatives rejected

- **Rewriting the false claims instead of appending corrections.** Cleaner to
  read, and it would have destroyed the most valuable thing this review
  produced: evidence that self-assessment here is unreliable. Originals are
  preserved verbatim; `postReviewCorrections` sits beside them.
- **Flipping the five phases to `not_started`.** Strongest mechanical
  enforcement, but it rewrites program history and cascades into the entry-gate
  chain for 21–32, which were reviewed separately and are not implicated.
- **Deleting `is_wall_clock_free` rather than fixing it.** Deleting a vacuous
  guard removes the false assurance but also removes the intent. It now varies
  the clock and requires the key to depend on an ordering field.
- **Making `isJustANumber` reject labelled metrics.** A type cannot tell
  "$1,240 spent" from "Clear morning" without knowing what the words mean. The
  guard was widened to catch bare measurements and **that half of the claim was
  withdrawn** rather than faked. The check records the boundary explicitly.
- **Building foreign-key ownership validation into the in-memory store.** There
  is no repository registry to resolve references through. Registered instead.

---

## 5. Verification

Every repair was mutation-tested: the fix was removed and the new test confirmed
to fail. All mutation work ran in scratch copies; **no file under the repository
was mutated at any point.**

| | before | after |
|---|---|---|
| Python tests | 1,375 | **1,437** |
| Swift checks (MobileCore) | 293 | **335** |
| iOS simulator build | clean | clean |
| `orion_v2_schema_check` | OK | OK |
| `orion_v2_policy_check` | OK | OK |
| `orion_v2_audit_check` | OK | OK |
| `orion_v2_capability_check` | OK | OK |
| `orion_v2_sync_check` | OK | OK |
| secret scan (with allowlist) | clean | clean (25 reviewed findings) |

Two mutation results worth recording because they nearly lied:

- The Phase 15 revocation mutation first replaced the **wrong** occurrence of
  `if offering.revoked:` — the one in `offer()` — and an *existing* test caught
  it, which would have read as a pass for the new test. Re-run against the
  `confirm()` occurrence by byte offset.
- The Phase 18 durability fix is two guards. Removing **only** the type
  invariant, leaving the store guard in place, still fails the two
  direct-construction tests — so they are independently proven rather than
  covering for each other.

One repair was validated by an unrelated mutation: restoring the global
`capabilities` unique index tripped `test_editing_the_applied_schema_is_detected`,
confirming the repaired migration fingerprint now covers index changes, which it
did not before.

---

## 6. Registered, not repaired

Recorded in `PHASE_GATES.json` under the Phases 11–20 review entry:

1. **MobileCore `Message` has no `revision` field**, so the phone resolves
   conflicts by arrival order while the server resolves by revision. Needs a
   Swift-side field and a conflict-vector file — larger than a repair, and it
   changes a cross-language contract.
2. **`Throttle` `source_hash` is caller-declared.** Deriving it server-side needs
   the request pipeline, which does not exist.
3. **No repository validates that a referenced row belongs to the same owner.**
   The in-memory store has no foreign keys.

Two historical claims could not be reconciled and no replacement numbers were
invented:

- Gates 14 and 15 **both** claim `867/867`, but `test_v2_device_identity.py`
  holds 36 tests of which 14 are Phase 15's, and 831 + 36 = 867. Phase 14's count
  already included Phase 15's tests.
- Gates 19 and 20 **both** claim `103 Swift checks` on the same day, though
  Phase 20 added 19 checks after Phase 19. Truncating `main.swift` at each phase
  boundary gives 76 → 91 → 110.

Neither is reconstructible: the whole batch is uncommitted, so there is no
snapshot of the tree as it stood.

---

## 7. Rollback

No commit was made, so rollback is file-level. The repairs touch:

```
backend/db/{migrations,repository,schema}.py
backend/vault/{credentials,keys,plaintext}.py
backend/auth/{service,tokens,throttle,web,mechanisms}.py
backend/devices/registry.py
backend/pairing/session.py
backend/memory/{records,store}.py
backend/sync/{engine,offline,ordering}.py
scripts/orion_v2_sync_check.py
native/OrionMobile/Package.swift
native/OrionMobile/Sources/MobileCore/{Today,Capture,SecureStorage,Streaming}.swift
native/OrionMobile/Sources/MobileCoreCheck/main.swift
tests/test_v2_{database_foundation,credential_vault,authentication,device_identity,conversation_sync,memory_v2,security_invariants}.py
planning/v2/PHASE_GATES.json
```

`git checkout --` on any of them restores the pre-review state, because none of
this batch was ever committed. Note that `git checkout` on the untracked files
(`backend/`, `native/OrionMobile/`, most of `tests/`) does nothing — those have
no committed version to return to, and reverting them means deleting them.

No runtime rollback exists because nothing live changed: no plugin edit, no
rebuild, no install, no gateway restart, no configuration write.

---

## 8. What this does not establish

- It does not review Phases 0–4, whose independent-review provenance Phase 32.5
  flagged as unreconciled.
- It does not make any of this batch *deployed*. The backend remains tested logic
  with in-memory state, no request pipeline, no real cipher, no Google
  transport, no HealthKit sample.
- `CsrfGuard`, `CookiePolicy` and `AuthService` are still called by nothing
  outside their tests. The CSRF token is now session-bound; it is not yet
  *enforced*, because there is no pipeline to enforce it in.
- MobileCore still has no SwiftUI view, no app target, no Keychain adapter and no
  push registration. Phase 16 disclosed that honestly; the repairs did not change
  it.
