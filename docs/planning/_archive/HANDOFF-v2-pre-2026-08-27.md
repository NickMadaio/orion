# ORION v2 handoff — archive of entries before 2026-08-27

Split out of `docs/planning/v2/HANDOFF.md` on 2026-09-01 because that file had reached
2,818 lines and a new session could no longer read it end to end and come away
with only true beliefs. Everything here is **historical**: it was accurate when
written and much of it has since been superseded.

Nothing was deleted. The live `docs/planning/v2/HANDOFF.md` keeps every entry from
2026-08-27 onward; everything older lives here, in the same newest-first order.
It covers Phases 1-30 as they were closed, day by day.

**Do not plan from this file.** For the current position read
`docs/planning/v2/HANDOFF.md`. `docs/planning/v2/SESSION_LOG_2026-08-25.md` is a one-page
summary of the Phase 5-20 run if that is all you need.

Three specific traps in the material below:

- The "Resume here — 60 seconds to know where you are" section was written
  2026-08-25 and every number in it is stale: it expects 925 Python tests
  (today: 1,440) and HEAD at `1efd37c` (long since moved). Its *reasoning* about
  the dirty tree and `DEVELOPER_DIR` is still sound; its expected values are not.
- The "Exact next step" section at the very end points at Phase 5, which closed
  2026-08-24. It is the tail of a much older entry, kept for its analysis of why
  the live TypeScript gate already implements most of Phase 5.
- Every phase here was recorded as complete against the manifest ordering. That
  ordering still stands — see `docs/planning/v2/PROGRAM_CORRECTION_2026-09-01.md` for
  the one thing about it that was genuinely wrong, and how far that goes.

---

## 2026-08-26 ORION v2 Phases 21-30 COMPLETE — tasks, calendar, planner, Gmail, health

Ten phases, two tracks finished. Everything below is Python except Phase 30,
which is Swift and released a gate Phase 16 built for exactly this moment.

### Found state, and where the previous record was right

The 2026-08-25 handoff was accurate — unusually so. Phases 0-20 complete, HEAD
still `1efd37c`, nothing committed. I re-derived the whole baseline before
touching anything and it matched: Python 925/925, Swift 103 checks, native/Orion
318 XCTest cases, plugin 146/146, eight check scripts clean.

Two corrections to how the baseline is *run*, neither of which is a defect in
the record:

- `scripts/orion_v2_secret_scan.py` reports "25 unexpected high-confidence
  findings" and exits 0 **when you forget `--allowlist`**. With
  `--allowlist docs/planning/v2/secret-scan-allowlist.json` it says clean. My
  invocation, not a regression.
- `native/Orion` tests need `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer`.
  The 22:15 correction already says why; the test command in isolation does not.

### What was built

| Phase | Where | The rule that carries it |
|---|---|---|
| 21 Task System | `backend/tasks/` | Blocked is derived from the graph, never stored; a learned estimate cannot be recorded as a measurement |
| 22 Calendar Read | `backend/connectors/`, `backend/calendar/` | A webhook `Notification` has no field an event could live in; incremental absence is never deletion |
| 23 Planner v1 | `backend/docs/planning/` | Determinism proven by shuffling; a `Suggestion` has no method that applies it |
| 24 Schedule Stability | `backend/docs/planning/stability.py` | Moving something prices *disturbing a decision*, so a planner's own fallback is cheap to correct |
| 25 Calendar Writes | `backend/calendar/writes.py` | The approval carries a fingerprint of the preview; what was approved is what executes |
| 26 Gmail Read | `backend/gmail/` | `StoredMessage` has no text field at all — not even a subject |
| 27 Action Inbox | `backend/gmail/inbox.py` | A correction signal is scoped and `ORION_INFERRED`, so Phase 18 refuses to make it durable |
| 28 Gmail Drafting | `backend/gmail/drafts.py` | Recipients come only from structured headers, never from text |
| 29 Gmail Sending | `backend/gmail/send.py` | R3, explicit approval, four fields in the preview and in the fingerprint, no undo |
| 30 HealthKit Local | `MobileCore/Health.swift` | Read authorization can be `unknowable`; an empty answer is `noData`, never zero |

**~4,900 lines of implementation, ~4,300 of tests across seven new files, ten
phase plans.**

### The decisions worth re-reading

**Phase 24 found two defects in itself.** A forced relocation — an item whose
slot vanished because the window shrank or a meeting appeared — was being put
through the improvement-vs-cost comparison, so an object could be *declined out
of the day entirely*: the alternative to moving was read as staying when it was
actually disappearing. And once that was seen, the comparison turned out to be
**dead code**: everything re-placed was forced, so `worth_moving` never fired in
`replan`. There is now an explicit improvement pass, and the two categories are
separate in the result.

**Phase 26's untrusted layer inherits rather than restates.** Email text carries
Phase 3's `EXTERNAL_UNTRUSTED` and cannot carry anything else. The injection
suite's fourteen payloads are then run through **Phase 18's own
`durability.check`**, under all four grounds, at 99 observations, with an
approver claimed — and refused every time. The proof is not that a filter catches
them; `suspicion_for_display` is named for what it is used for precisely because
a function called `is_safe()` invites a caller to branch on it.

**Phase 30 released Phase 16's gate the way it was designed to be.**
`MobileCoreCheck` greps every source for `HealthKit`/`HKHealthStore`/`HKQuery`
and that check was *supposed* to fail now. Releasing it by hand-editing two
parallel lists is how the other two features get released by accident later, so
`forbiddenTokens` is now derived from `features`, and HealthKit moved to a
`released` list rather than being deleted.

**The HealthKit authorization model is shaped by a fact people get wrong.**
HealthKit will not tell an app whether *read* access was granted — a denial and
an empty data set are deliberately indistinguishable. That is the privacy
property, not a limitation, and `HealthAuthorization.unknowable` is the normal
outcome of a read. Modelling it as `granted` reproduces the bug `AGENTS.md`
already records — *missing health data is not zero* — one layer earlier.

### The trap this session cost an hour to, now in AGENTS.md

**A same-length source edit can leave poisoned `.pyc` bytecode.** Python
invalidates a `.pyc` on `(mtime, size)` at one-second resolution. My mutation
harness swapped `RiskLevel.R3` for `RiskLevel.R2` — same length — and restored
the file within the same second, so the cached *mutated* bytecode still looked
valid. The full suite then failed on a test that passed when its file was run
alone, and the source on disk was correct the whole time.

The dangerous direction is the other one: a poisoned module can make an
*unrelated* mutation appear CAUGHT. So no earlier verdict could be trusted. The
harness now sets `PYTHONDONTWRITEBYTECODE=1`, and **all 104 Python guards from
Phases 21-29 were re-run from scratch: 104 caught, 0 survived, 0 skipped.** The
gate evidence for Phases 28 and 29 records this rather than quietly showing the
corrected number.

### Vacuous tests caught, in this session's own work

Three, and the pattern is worth naming because it recurred:

- **Phase 22**: the constant-time comparison was tested by asserting
  `compare_digest` appears in `validate`'s source. It survived a mutation to
  `!=` — because the **docstring** says the words. Replaced with a
  patched-wraps assertion that observes the call. Phase 25 and 29 have the same
  test, written correctly from the start because of this.
- **Phase 22**: the all-day-timezone refusal and the scope ceiling had *no test
  at all*; the ceiling was masked by a membership check that fired first.
- **Phase 30**: "a released feature's tokens are no longer forbidden" passed
  when the token list was emptied, because `allSatisfy` over an empty collection
  is true — so a feature could be released by deleting its tokens rather than by
  deciding to.

### Verification

| | at session start | now |
|---|---|---|
| Python tests | 925 | **1,322** |
| Swift checks (MobileCore) | 103 | **140** |
| native/Orion XCTest | 318 | **318** (untouched) |
| Plugin tests | 146 | **146** (untouched) |
| Mutations run | — | **121** (104 Python, 17 Swift) |
| Mutations that survived | — | **0** |

iOS simulator build clean. All eight check scripts clean. Secret scan clean
(25 allowlisted). Import boundaries clean throughout.

**The import boundary check earned its keep**: `backend/gmail/search.py` needed
percent-encoding, the obvious call is `urllib.parse.quote`, and
`backend/boundaries.py` refused the import — the whole of `urllib` belongs to
`egress.py`. The encoder is hand-written and differential-tested against `quote`
on 3,000 random strings including unicode and emoji: zero mismatches.

### Live and installed state

**Nothing live changed.** No plugin edit, no rebuild, no install, no gateway
restart, no config write, no live smoke, no Anthropic spend. Nothing committed;
HEAD is still `1efd37c`.

No network request is made anywhere in Phases 22-29. These are request builders,
provider-shape parsers and the rules around them. Nothing has spoken to Google.

### Rollback

Delete `backend/tasks/`, `backend/connectors/`, `backend/calendar/`,
`backend/docs/planning/`, `backend/gmail/`, the seven new `tests/test_v2_*` files
(`task_system`, `calendar_read`, `planner`, `calendar_writes`, `gmail_read`,
`action_inbox`, `gmail_write`), `native/OrionMobile/Sources/MobileCore/Health.swift`,
and `docs/planning/v2/PHASE_{21..30}_PLAN.md`. Revert `Deferred.swift` and the health
and deferred blocks in `MobileCoreCheck/main.swift`, and the 21-30 blocks in
`PHASE_GATES.json`, `MANIFEST_PHASES.json` and `MANIFEST_TRACEABILITY.md`.

### Next

**Phase 31 — Health Baseline Engine.** Swift or Python is an open choice: Phase
30 put the local layer in MobileCore, and baselines are computed locally per the
manifest, which argues for Swift. Nothing blocks it.

Two follow-ups from this session matter more than the phase order:

1. **An approval is not single-use.** Phases 25 and 29 both bind an approval to
   a content fingerprint, and neither consumes it. The same approved preview
   authorises the same send indefinitely — a retry loop becomes a mailing. This
   should be closed before any transport exists, not after.
2. **Phase 31 must not score a missing input as zero.** `SessionDomain/DayScore.swift`
   already does this correctly on the Mac and `HealthLocalLayer.contributes`
   exists for the phone. Two implementations of that rule is how they come to
   disagree — the same failure Phase 17 exists to prevent, in a different domain.

Shared files needed by Phase 31: `native/OrionMobile/**` only, if it goes in
Swift. No live config, no plugin, no `native/Orion` changes.

## Resume here — 60 seconds to know where you are

Written 2026-08-25 at the end of the session that closed phases 5–20.

```bash
cd ~/Desktop/ORION
date                                    # this session spanned three days; do not infer it
git log -1 --format='%h %ci %s'         # expect 1efd37c, 2026-08-20 -- nothing was committed
git status --short | wc -l              # ~113 dirty paths; MOST OF THEM ARE THIS WORK

PYTHONPATH=. ./.venv/bin/python -m unittest discover -s tests -t tests -q   # expect 925 OK
./scripts/orion_v2_mobile_check.sh                                          # expect 335 checks, 0 failed
./.venv/bin/python scripts/orion_v2_phase_gate.py --phase 20 --require-open # expect passed
```

If those four agree, nothing moved since 2026-08-25 and the records below are true.

**Xcode 26.6 is installed**, but `xcode-select` points at CommandLineTools, so
plain `xcodebuild`/`xcrun`/`swift test` report there is no iOS SDK. There is one.
Every tool here sets `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer`
for a single invocation — `AGENTS.md` says not to change the machine's active
developer directory, and that rule predates this work. `orion_v2_mobile_check.sh`
builds MobileCore for the iOS simulator on every run; importing AppKit into
MobileCore fails it with exit 1.

**The whole of phases 5–20 is UNCOMMITTED and mostly UNTRACKED.** `git clean -fd`
would delete about forty files and three days of work; `git checkout .` would
revert the rest. The tree also carries unrelated work that is not mine. Do not
tidy it.

### Exact next step

**Phase 21 — Task System.** Nothing blocks it except its own plan:
`docs/planning/v2/PHASE_21_PLAN.md` must exist before implementation, which
`PHASE_GATES.json` records as its `blockedOn`. It is Python, in `backend/`, and
needs no shared file and no coordination window.

The pattern every phase in this run followed: read the manifest text for the
phase (`~/Desktop/Orion v two implementation plan.md`, sections start with
`# PHASE`), write the plan, build with tests, prove the tests bite by breaking
the code and watching them fail, record requirements *and limitations* in
`PHASE_GATES.json`, then append a dated handoff entry.

### Where everything is

| | |
|---|---|
| one-page summary of phases 5–20 | `docs/planning/v2/SESSION_LOG_2026-08-25.md` |
| per-phase detail | this file, newest first |
| machine-readable evidence | `docs/planning/v2/PHASE_GATES.json` |
| what is enforced vs pending | `docs/planning/v2/SECURITY_INVARIANTS.json` (18/18, 0 pending) |
| how to run everything | `AGENTS.md`, "Running the suites" |
| blocked on Nick | `NICK-TODO.md` — 5a, 5b and 7 are open |

### The four things built and deliberately not wired

Each is a recorded limitation, not an oversight, and each will be tempting to
"finish" without noticing it was a decision:

1. the **policy engine** agrees with the live gate and does not replace it;
2. the **audit system** proves live rows fit its contract and does not write them;
3. the **backend** is 17 declared modules with no server and no database;
4. the **vault** and **device identity** have no real cipher or signature verifier
   — both refuse rather than fall back, because this repository has had zero
   third-party dependencies since it began.

Read this file before changing any v2 contract or live integration file. The
working tree contains substantial unrelated native and OpenClaw work owned by
Nick/Claude. Preserve it. This v2 work is uncommitted; do not commit or push
unless Nick asks.

## 2026-08-25 ORION v2 Phases 16–20 COMPLETE — mobile foundation, sync, memory, Today, capture

Five more phases, and the first ones that are not Python. The environment finding
below shaped all of them.

### The finding, checked before writing anything

**There is no Xcode on this machine — only Command Line Tools.**

```
xcrun --sdk iphonesimulator --show-sdk-path   → SDK cannot be located
xcodebuild -version                          → requires Xcode
xcrun simctl list devices                    → simctl is not a developer tool here
```

No iOS SDK means SwiftUI cannot be compiled, no app can be built, and no
simulator exists to run one in. It also means **XCTest and swift-testing are both
unavailable**, since they ship with Xcode.

So Phase 16 wrote the half of the app that is real Swift, compiled it against the
macOS toolchain, and checks it with an executable that exits non-zero — proven by
making an assertion fail before trusting it. `native/Orion` already separates
`SessionDomain` for exactly this reason ("enforced by the compiler instead of by
good intentions"); `native/OrionMobile/MobileCore` follows it. A folder of SwiftUI
nobody can compile would have been the thing the independent review caught last
time, wearing a different hat.

### Phase 16 — Mobile Foundation

Five tabs with **ORION in the centre and as the default**: opening on a dashboard
makes an assistant something you check rather than something you talk to. Six
desktop-only surfaces are enumerated and asserted absent.

All nine "implement first" features exist as models: account state machine,
conversation store, stream assembler, secure storage port (refusing), device key
*reference* (no property could hold a private key), device management,
notifications, settings, security controls.

Two that are worth the words: **security notifications cannot be switched off** —
a person can silence them at the OS level, but the app must not offer a setting
that makes "a new device was paired to your account" quietly stop arriving. And a
**cancelled stream keeps its partial text and says it stopped**, because deleting
what ORION already said would be rewriting history the person watched happen.

Gmail, HealthKit and remote Mac control are named with the phase that owns each,
and the check greps every source for their API names. It caught my own comment in
`Today.swift` — I reworded the comment rather than weakening the check.

### Phase 17 — Conversation and State Sync

Ordering is a **Lamport counter**, never a clock: two devices five hours apart
still order the same way. The rule now exists twice — Python for the server,
Swift for the phone — which is *itself* how two devices end up disagreeing about
history. So `docs/planning/v2/sync-ordering-vectors.json` holds six cases whose
expected order was **written by hand** (generating them would make them agree with
whatever the code does, including if it is wrong), and both sides are checked
against it. Reversing the Swift tiebreak fails three assertions.

**A defect these tests found:** `since(cursor)` returned the message the cursor
pointed *at*, so a reconnecting device was handed back the last message it
already had — every time. The cursor carried sequence and device but not message
id, which cannot express "after this exact message". Fixed, with a test that pins
the cursor's shape.

Conflicts resolve on revision then device id, deterministically, and are
**recorded** rather than swallowed: the person whose edit lost is going to notice,
and "your other device had a newer revision" is an answer.

### Phase 18 — Memory v2

"Do not allow arbitrary external content to become durable memory" is not a
filter on text — it is a rule about provenance, which Phase 3 already records. So
promotion needs grounds, and `EXTERNAL_UNTRUSTED` is refused under **all four**
whatever observation count or approver is claimed.

`ORION_INFERRED` is refused too. Phase 3 declined to call inference
authoritative; "Orion concluded this" hardening into a permanent fact about a
person is what that refusal was protecting against.

Recall goes **through** Phase 3's domain matrix rather than around it — a health
memory is invisible to an email task — while `inspect()` deliberately does not
filter, because "let me see what you know about me" is a different question from
"what may this task see". Deletion works for every class: the manifest says
delete, not "unless the system thinks one is important".

### Phase 19 — Today Screen

"Do not turn it into a giant metrics dashboard" is enforced by the type. A
`TodayItem` **cannot be constructed from a bare number** — `"7"` and `"82%"` both
return nil; a number is welcome inside a sentence or as supporting detail, never
instead of one. Items sort state → meaning → action whatever order they arrive
in. Sections are capped at three, the screen at twelve, and an empty section is
omitted rather than rendered — an empty card is a promise the screen did not keep.

### Phase 20 — Unified Capture

An unresolved capture has **no durable payload** — `nil`, not `false`, so the
caller cannot save what it was not given. That is one of two refusals: Phase 18's
store refuses the same thing in the cloud. Two boundaries, because "permanently
save" happens at both.

`unknown` is a kind rather than a failure, and the classifier returns it for
screenshots and photos because nothing here can look at an image. That is the
correct answer, not a placeholder one.

### Verification

Python **925/925** (was 867). Swift **103 checks, 0 failed**, and `swift build`
clean. Plugin **146/146** unchanged. New: `orion_v2_mobile_check.sh` and
`orion_v2_sync_check.py`. All existing checks still clean.

Four mutations were caught and reverted: the bare-number guard, the unresolved-
capture guard, ORION's default tab, and the un-switchable security notification.

### Live and installed state

**Nothing live changed.** No plugin edit, no rebuild, no restart, no spend.
Nothing committed; HEAD is still `1efd37c`.

### Rollback

Delete `native/OrionMobile/`, `backend/sync/`, `backend/memory/`,
`scripts/orion_v2_{mobile_check.sh,sync_check.py}`,
`docs/planning/v2/sync-ordering-vectors.json`, the three new test files, and revert the
16–20 blocks in `PHASE_GATES.json`.

### Next

Phase 21 is the Task System — richer task metadata, back in Python. Nothing
blocks it.

The standing question is now Xcode: until it is installed, every mobile phase
produces a compiled domain layer and no app. That is recorded as Phase 16's
deviation, and it is workable for the phases ahead — but it means nothing has
ever run on a phone.

## 2026-08-25 ORION v2 Phases 11–15 COMPLETE — database, vault, auth, device identity, pairing

Five phases in one run, on Nick's instruction to continue after Phase 10. The
decision that unblocked them is recorded in `PHASE_GATES.json` under phase 11:
**declaration-first** — schema, migrations, vault, auth and pairing built and
tested; nothing deployed, and **no dependency added**, because "continue the
phases" is not "change what this repository depends on".

### Phase 11 — Database Foundation

Twenty-six tables declared as data, so the ownership rules are properties that
can be *checked* rather than instructions to handlers: every owned table carries
exactly one `user_id`, non-null, referencing `users`, and **indexed owner-first**
— without that index ownership is correct and unusable. `users` is the only root,
asserted.

Migrations are **operations on the schema model, not SQL strings**. That is what
makes `replay(MIGRATIONS) == SCHEMA` a real check without a database — the same
relationship the Phase 4 capability check has to `catalog.ts`. Each migration
carries a checksum over what it *does*, so editing an applied one is visible and
renaming it is not.

`TableRepository.insert` takes the owner from the session and **refuses** a
payload naming `id`, `created_at` or any owner column. Refused rather than
stripped: a read carrying an ownership claim is noise, a write carrying one is an
attempt to create a row belonging to somebody else. That discharges Phase 10's
recorded obligation.

### Phase 12 — Secret and Credential Vault

The uncomfortable part first: **there is no AES in the standard library and this
repository has no dependencies.** So the cipher is a port whose default *raises*,
and the vault refuses any cipher that does not declare itself authenticated —
confidentiality without integrity means an attacker who can write to the database
can flip bits in a token. Nothing here has ever encrypted anything with a
production-grade cipher, and the gate says so.

Everything else is real: DEK per credential wrapped by a KMS-held KEK; the row
holds ciphertext and the *wrapped* key; `KmsPort` has **no method that returns a
KEK**, so "master keys outside PostgreSQL" is a property of the interface.
Rotation re-wraps without touching ciphertext. The ciphertext is bound to
user|connection|provider, so copying a row between users yields a token that
fails authentication rather than decrypting under somebody else's name.

Plaintext is **borrowed**: available inside a `with`, overwritten after it, and
refusing `repr`, `str`, `format`, `bytes()`, comparison and hashing. The three
ways a secret reaches a log are an f-string, a debugger, and `json.dumps` of a
dict somebody thought was safe. It is also not JSON — so Phase 3's bundle, Phase
6's details and Phase 7's payload each refuse it *by type*, which is how "never
provide tokens to ORION models" is enforced without any of them knowing about
secrets.

**Deleting a connection revokes its credentials in the same call**, not through a
job or an event: anything asynchronous leaves a window in which a deleted
connection can still refresh. That closes Phase 9's last pending invariant —
`EXPECTED_PENDING` is now **0**.

### Phase 13 — Authentication

**Rotation with theft detection.** Every refresh retires the old token;
presenting a retired one revokes the *entire family*. Either it was stolen or it
was replayed, and both mean the chain is no longer trustworthy. Deliberately
harsher than convenient.

**Throttling shaped so it cannot be a weapon.** Locking an account after N
failures hands an attacker a way to lock any account they can name. So: a hard
limit per *source*, and exponential backoff per *account*, capped, never a lock.
A success clears the account's backoff and not the source's limit — knowing one
password does not make a source that failed nineteen times trustworthy.

**CSRF where it applies and nowhere else.** Cookie-bearing state changes, yes;
bearer tokens, no — a browser does not send those automatically, and requiring a
token there is a ritual that makes people believe a system is protected in places
it is not.

A mechanism is usable when a **verifier is installed**, not when a flag says
`implemented`. Passkeys and Sign in with Apple are registered with the exact
verifier each needs; none is installed, and sign-in refuses.

### Phase 14 — Device Identity

Three identities, three types, and a test that none can be passed for another. A
`DeviceIdentity` holds no user; an `Attestation` holds neither a key nor a user.
A jailbroken phone with a genuine key is a real device running an app nobody can
vouch for, and the record can say exactly that.

Registration is a possession proof over `owner|device_id|public_key|challenge` —
signing the bare challenge would let a captured signature register a different
device. Challenges are single-use, five minutes, and purpose-bound, so a pairing
challenge cannot be spent as a registration proof. A pasted PEM private key in
the public-key field is refused at construction.

**Phase 5's `DeviceDirectory` finally has a source.** It has been hand-built in
tests since Phase 5; `as_policy_directory()` now produces it, so "revoked devices
cannot act" is a fact about registered devices. A *failed* attestation holds a
device at PENDING rather than PAIRED — something was offered and did not check
out, which is a stronger signal than nothing being offered.

### Phase 15 — Device Pairing

Most pairing flows prove one side: the phone signs, the Mac is assumed because it
displayed the code. Anyone who can see the screen is then the Mac as far as the
protocol is concerned. So the **offering device signs too**, over the joining
device's public key — attesting to *which* key it is admitting, not merely to
having been there.

Never-reusable, four ways: single-use nonce, terminal states, two-minute expiry
checked at *every* step, and a failed proof that **cancels rather than retries**
— a wrong signature on a pairing nonce is not a typo.

**One deviation, recorded.** My first implementation demanded a registration
signature from the joining device over a challenge minted inside `confirm()` —
a protocol nobody can implement, because the joining device is not online then
and would have to sign something that did not exist when it last was. It is now
adopted on the strength of its claim proof, and the device record carries
`proven_by:pairing:<id>` so it always says how it got there. Whether that
satisfies "possession proofs from both devices" is Nick's to confirm; both
devices do prove possession, the joining one just does it once.

### Verification

Python **867/867** (was 730 when this run began; 404 when the session started).
Plugin **146/146**, unchanged throughout. Schema check OK — 26 tables, one
migration replaying to exactly the declared schema, 361 lines of reviewable DDL
with no hardcoded row. Policy 390/390, audit and capability checks agree, secret
scan clean with two more reviewed fixtures. Backend boundary check clean.

Three fixes were mutation-tested: removing the offering-device signature check,
the nonce comparison, or the registration signature check each fails a test.

### Live and installed state

**Nothing live changed, across all eleven phases in this session.** No plugin
edit, no rebuild, no install, no gateway restart, no config write, no live smoke,
no Anthropic spend. Nothing was committed; HEAD is still `1efd37c`.

### Rollback

Delete `backend/db/`, `backend/vault/`, `backend/auth/`, `backend/devices/`,
`backend/pairing/`, `scripts/orion_v2_schema_check.py`, the five new test files,
and revert the 11–15 blocks in `PHASE_GATES.json` plus the two allowlist entries.

### Next

**Phase 16 — ORION Mobile Foundation — is not started, and is a different kind of
work**: a native iPhone app in Swift and SwiftUI. That is a real client, not a
contract, and it needs Nick's direction on scope before anybody opens it. Its
blocker is recorded.

Two questions are still Nick's, both in `NICK-TODO.md`: whether the Phase 1
reading is accepted in writing for phases 5–15, and whether one proof per device
satisfies Phase 15's "both devices".

## 2026-08-25 Independent review of Phases 5–10, and the repairs it forced

An agent with no context of how the work was done was pointed at the manifest and
the repository and told to verify every claim rather than trust it. It mutation-
tested 40 code sites, brute-forced the policy engine over 14,040 request shapes,
ran bypass batteries against the redactor and the egress guard, and re-derived
every number in `PHASE_GATES.json` from command output.

**Its verdict: Phases 5, 6 and 8 were not complete as claimed; 9 and 10 were
weakened.** That was accepted rather than argued with. Everything below is
repaired, each fix mutation-tested — the new test was confirmed to fail when the
fix is removed, and one newly written test that did *not* fail was rewritten
until it did.

### What it confirmed

- All 12 policy rules were load-bearing: removing any one fails a test.
- No ALLOW above R2 across 14,040 request shapes.
- The parity check reproduces exactly: 390/390, zero more permissive.
- No job could be made to run twice or take an illegal transition.
- Nothing committed, pushed, or changed live; the plugin was untouched.

### The two that mattered

**A signature proved nothing about which device sent the request.**
`sensitive_actions_are_signed` verified against *any* key in the directory, so
this user's phone could sign a request claiming to originate on the Mac — and the
decision then carried a `signature_verified` obligation asserting it had been
checked. `Device.signing_key_id` had been stored, validated, and carried through
`revoke()` while being read by nothing. The key must now be the origin device's.
This is the one that would have been baked into a contract twenty phases before
anyone tried to use it.

**`resource` was an evaluation input no rule read.** The manifest names fourteen;
the gate claimed each had a rule acting on it; `grep resource rules.py` returned
nothing. There is now a rule — and, more usefully, a written limitation saying
what the engine deliberately *cannot* decide about a resource, because root
scoping needs the configured roots and the engine does not have them.

### The rest, by phase

- **Phase 6** — `proposed_action` and `capability` bypassed the redactor while
  the requirement said no unredacted event could exist; a token in
  `proposed_action` survived verbatim. Both now go through it. "Every spelling"
  was overstated: DSA and ENCRYPTED PEM headers, lowercase `bearer`, an uppercase
  URL scheme, and `pwd`/`pass`/`creds`/`priv_key`/`XApiKey` all survived. Fixed,
  and the claim now says what is covered instead of claiming everything.
- **Phase 7** — a follow-up event with a malformed payload was validated on
  *dequeue*, outside the per-handler guard, so it raised out of `publish()` and
  took the whole delivery report with it. Validated inside the guard now.
- **Phase 8** — the 2026-08-24 amendment's own reasoning ("a token is a secret; a
  device identity is a claim") had been applied to `start()` and not to
  `succeed()` or `fail()`. A token holder could mark work done that never ran.
  Also: every job event was stamped with the job's *creation* time, so any
  ordering or latency reading of the stream was wrong.
- **Phase 9** — the evidence said "40 tests across 8 invariant classes", which
  reconciles with no reading of the file at any point. Counted from the AST: 46
  tests, 11 invariant classes, 33 distinct tests named by the registry.
- **Phase 10** — `Owner` was freely constructible, so the ownership invariant was
  a docstring: a handler doing `Owner(payload["user_id"], session_id)` would have
  passed every check and every test. It now needs a construction proof only
  `resolve_owner` holds. The import check keyed on `backend/modules/<name>/`,
  which cannot coexist with `backend/modules.py` — the boundary system would have
  stopped importing the moment it became load-bearing. Route validation looked
  only at the verb, so `GET /jobs → submit_job` and an **unauthenticated
  `GET /health → audit.read_trail`** both passed. Records used a global id space,
  giving a cross-user existence oracle and letting an attacker squat an id. And a
  hostname spelled with U+212A KELVIN SIGN folded to ASCII `k` inside
  `urlsplit().hostname`, matching an allowlist entry for a domain it was not.

### The one I pushed back on, and why it changed anyway

The reviewer said closing the SSRF invariant was invalid because nothing fetches
a URL — that closing it against a library with no caller inverts Phase 9's own
anti-vacuity rule. That is right. Rather than reopen it, the registry entry now
*says* it outright, and `backend/boundaries.py` forbids every backend file except
`egress.py` from importing an HTTP client. A future fetch that skips the guard
now fails the boundary check instead of reopening the invariant in silence.

### Verification after the repairs

Python **730/730** (was 709 before the review; the increase is 21 new tests, each
pinning a repair or a previously untested branch). Plugin **146/146**, unchanged.
Policy check 390/390 with zero more permissive. Audit check clean. Capability
check agrees. Secret scan clean. Phase gates 5–10 all open, 11 correctly closed.

Every fix was checked by breaking it again: signature binding, the resource rule,
the device check on `succeed`, the `Owner` construction proof and the Unicode host
refusal each fail their test when reverted.

### What this says about the evidence style

Two of the three worst findings were **claims that were false at the moment they
were written** — not code that drifted. The gate file's evidence lines are prose
written by whoever did the work, and nothing checks them. That is worth a
mechanism eventually; for now, `PHASE_GATES.json` carries a `reviews` block, and
every corrected claim is recorded under its phase in `postReviewCorrections`
rather than quietly edited into the original evidence.

## 2026-08-24 ORION v2 Phase 10 COMPLETE — the Backend Foundation

Seventeen declared modules with an enforced dependency graph, three environments
that cannot share anything, server-side ownership, and the SSRF guard — which
closes two of Phase 9's three pending invariants. **No server was stood up, on
purpose**, and that is recorded as a deviation rather than glossed.

### The honest problem, stated first

There is no backend. ORION is a Mac app — Swift, OpenClaw, TypeScript — and a
Python package with **zero third-party dependencies**: `pyproject.toml` says
`dependencies = []` and has always meant it. `pip install fastapi` is not a
foundation; it is a dependency added to a dependency-free repo, at midnight, for
a service with no host, no database and no client.

So this phase built the half that is decidable now and expensive to improvise
later, and refused the half that needs a host and a review window. Both halves
are listed in `PHASE_GATES.json` in the same detail.

### Seventeen modules, declared rather than stubbed

Phase 1 wrote the rule this would otherwise have broken: *"Empty packages are not
a milestone."* Seventeen empty directories satisfy "create backend modules" and
check nothing.

Instead each module declares what it owns, what it may depend on, its data
sensitivity and its public operations — things a boundary check can be run
against. The graph is proven acyclic and dependency-complete, and the checker
walks **real import statements**, so it starts trivially true over an empty tree
and becomes load-bearing the moment code lands. Proven on a temp tree: `gmail`
importing `health` fails; `planning` importing `health` passes, because planning
declares it.

"Do not introduce microservices without a concrete need" is asserted as a number:
`DEPLOYABLES == ("orion-backend",)`.

### Rules, not runbook entries

- **No two environments share a database, secret scope, credential namespace or
  OAuth app** — asserted across all three, with a test proving a shared database
  would be caught. Only production may use the production APNs environment: a
  staging build pointed at production APNs sends real pushes to real phones from
  code nobody released.
- **`resolve_secret_reference` raises outside its own scope.** "Never use
  production secrets locally" as a function, not a sentence. It returns a
  *reference*, never a value — anything that can return a secret eventually gets
  asked to log one.
- **No route may take an owner from a path.** `{user_id}` in a URL means some
  handler is about to trust it. Ownership comes from the session.

### The two invariants owed to Phase 9

- **one user cannot access another user's data** — an `Owner` can only be built
  from an authenticated `Session`, and `Repository` has **no method that does not
  take one first**. That is structural: a repository with an unscoped `all()`
  will have it called by something, and the check will live in whichever callers
  remembered. `owner_first_violations()` fails if a later repository offers one.
- **SSRF** — default-deny host allowlist, https on 443 only, no URL credentials,
  and refusal of loopback, private, link-local, CGNAT, reserved and cloud-metadata
  addresses in literal and hostname form, including IPv4-mapped IPv6
  (`[::ffff:127.0.0.1]`) and trailing-dot evasion.

`EXPECTED_PENDING` drops 3 → 1. The last one is Phase 12's.

### A flaky test that is not mine

One full-suite run failed and thirteen others passed. Rather than shrug, I chased
it: **`tests/test_tts_daemon.py` fails intermittently under load**, reproduced
once by running four copies of that file concurrently. It uses real sockets,
`sleep(0.005)` polling and a 60 ms wall-clock deadline, so a busy machine can
miss the window. It predates this work — Phases 5–10 take `now` as an argument
and touch no clock. Added to `AGENTS.md` traps: a full-suite failure you cannot
reproduce is probably this, not your change.

### Verification

Python **709/709** (was 648; 404 when this run began). Plugin **146/146**,
unchanged. Policy check 390/390 never-more-permissive, audit check OK, capability
check agrees, secret scan clean (one more reviewed fixture), phase gates 5–10 all
open.

### Live and installed state

**Nothing live changed, in any of the six phases.** No plugin edit, no rebuild, no
install, no gateway restart, no config write, no live smoke, no Anthropic spend.
`backend/` cannot import the Mac runtime — enforced by AST, because those modules
touch a Keychain and a desktop that do not exist on a server.

### Rollback

Delete `backend/`, `tests/test_v2_backend_{foundation,security}.py`, revert the
two closed entries in `SECURITY_INVARIANTS.json` (and `EXPECTED_PENDING` to 3),
and revert the Phase 10 block in `PHASE_GATES.json`.

### Next

**Phase 11, the Database Foundation — deliberately not entered.** It is blocked on
Nick's answer to the Phase 10 deviation: does the backend track proceed
declaration-first, or wait until there is a host to deploy to? Phase 11 also
inherits one hard rule: every table repository must subclass
`backend.ownership.Repository` rather than query around it, or the invariant this
phase just closed reopens without anybody noticing.

## 2026-08-24 ORION v2 Phase 9 COMPLETE — the Security Invariant Suite

Eighteen invariants, fifteen enforced by tests against the primitives that
actually enforce them, three recorded as **pending a subsystem that does not
exist yet** — and the machinery that makes that distinction survive.

### The trap this phase was built to avoid

Four of the eighteen concern systems nothing has built: deleted connections
refreshing tokens, cross-user data access, SSRF, and the storage half of
ownership. **A test asserting that a nonexistent system cannot be attacked
passes, permanently, and reads in a report exactly like proof.** A suite whose
green includes vacuous passes is worse than one with visible gaps.

So the suite is paired with `docs/planning/v2/SECURITY_INVARIANTS.json`. Every
invariant is either *enforced* — naming tests that the suite proves resolve to
real methods — or *pending_subject*, naming what is missing and which phase owns
it. **A pending invariant may not have a test**, so nothing can be marked
enforced with an empty one, and `EXPECTED_PENDING = 3` is a ratchet: the count
falls when a phase closes one and cannot rise without a deliberate edit.

### What the suite found

**`JobQueue.start()` authenticated the delivery token and never asked which
device was answering.** A token that leaked would have let any device run a job
targeted at another — precisely the invariant "wrong devices cannot execute
targeted jobs". A token is a secret; a device identity is a claim; the invariant
needs both checked. `start()` now requires the answering device and raises
`WrongDevice`.

Phase 8 had already closed, so this is recorded in `PHASE_GATES.json` under
`postClosureAmendments` rather than edited into the original evidence. Writing
the invariants down found a real hole within an hour of the code being written,
which is the argument for writing them down.

### Proven to bite, not just to pass

Two deliberate breakages, both reverted:

- pointing a registry entry at a renamed test → `RegistryTests` fails, so a
  rename cannot orphan an invariant;
- deleting the device-trust rule from the policy engine → `DeviceInvariants`
  fails.

A test that cannot fail is not evidence.

### Verification

Python **648/648** (was 607). Plugin **146/146**, unchanged. Policy check
390/390, audit check OK, capability check agrees, secret scan clean.

### Live and installed state

**Nothing live changed.** No plugin edit, no rebuild, no restart. The one code
change outside tests was `JobQueue.start()`, which nothing live calls.

### Rollback

Delete `tests/test_v2_security_invariants.py` and
`docs/planning/v2/SECURITY_INVARIANTS.json`, revert the `device` argument on
`JobQueue.start()`, and revert the Phase 9 block in `PHASE_GATES.json`.

### The limitation, stated plainly

The invariants are asserted against ORION's v2 contracts. Those are the
authoritative contracts and they are **not** the live decider: "models cannot
bypass policy" is proven of the engine, while on the live route the equivalent
guarantee still rests on `validator.ts` — which Phase 5's parity check proves the
engine agrees with, but does not replace.

### Next

Phase 10, the Backend Foundation. It owns two of the three pending invariants
(cross-user data access, SSRF) and must lower `EXPECTED_PENDING` as it closes
them. The manifest asks for a modular monolith — Python, FastAPI, PostgreSQL —
and the honest question will be what "foundation" means in a repo whose Python
has no third-party dependencies at all and whose live product is Swift and
TypeScript.

## 2026-08-24 ORION v2 Phase 8 COMPLETE — the Job System

Eleven fields, twelve states, and the manifest's one absolute enforced in four
places rather than one: **an expired command cannot execute after a device
reconnects.**

### Why that rule needed four checks

A job system that checks expiry at dispatch satisfies the sentence in a diagram
and violates it on the first flaky connection. The queue can hold a job for an
hour; the device can be offline when it is sent; the device can hold it locally
across an outage; the answer can arrive from a run that should never have begun.
So every method takes `now` and re-checks, and the test that matters is the
reconnection story rather than a unit check on one method: dispatched at 21:00,
device returns at 21:30, `start()` raises and the job is EXPIRED.

### Idempotency and replay are different problems

Conflating them is how one of the two ends up unimplemented, so they are
separate mechanisms here:

- **Idempotency** is about the submitter. The same `(user, idempotency_key)`
  returns the same job — including after it has already SUCCEEDED. Retrying a
  request that may already have landed is safe.
- **Replay prevention** is about the device. Every dispatch mints a delivery
  token, and a redispatch invalidates the previous one. That is what makes a
  lost acknowledgement recoverable: the late answer from the first attempt
  cannot complete a job that has since moved on.

### Three judgements worth recording

- **A lost lease on a RUNNING job is recorded as FAILED before it is retried.**
  It did start. An audit trail that hides that cannot explain a duplicate side
  effect later.
- **A job that started in time may report success late.** Refusing the result
  would leave a half-done delete with nothing recording that it happened.
- **Out of retries ends in EXPIRED**, because the twelve states have no
  "exhausted" and FAILED is the state a retry comes back from. The reason field
  says which limit ran out: `delivery_unacknowledged; no attempts left`.

### Phase 7 now has a producer

Every job state change publishes `remote_jobs.job_state_changed`. Payloads carry
ids and statuses; a test asserts a job's `arguments` never reach the bus, which
the bus would refuse anyway. Phase 7's honest criticism — "nothing publishes to
this" — is answered by the next phase rather than left standing.

### Verification

Python **607/607** (was 568). Plugin **146/146**, unchanged. Policy check
390/390, audit check OK, capability check agrees, secret scan clean.

### Live and installed state

**Nothing live changed.** No plugin edit, no rebuild, no restart. `orion/core/jobs/`
is inside the Phase 1 import firewall; the queue is in-memory and owns no clock —
every method takes `now`, which is why the expiry rules are tested without
sleeping.

### Rollback

Delete `orion/core/jobs/{states,job,queue}.py` (leaving Phase 1's `ports.py`) and
`tests/test_v2_job_system.py`, and revert the Phase 8 block in `PHASE_GATES.json`.

### The limitation that matters most

**Retry after a lost acknowledgement can double-execute unless the target device
honours the idempotency key.** The queue cannot tell "the device never got it"
from "the device did it and the answer was lost". It records which it believes
and retries anyway. Device-side deduplication is a Phase 44 requirement and
nothing enforces it today — registered as a follow-up, because it is the kind of
thing that gets discovered by a file being deleted twice.

Also: `sweep(now)` needs an owner. Core has no runloop by design, so whichever
adapter gains one has to call it or lost leases are never noticed.

### Next

Phase 9, the Security Invariant Test Suite. Sixteen invariants, kept permanent.
Four of them are about systems that do not exist yet (server-side ownership,
multi-user isolation, SSRF, connection deletion) — the honest move there is a
registry that records them as pending with the subject named, rather than a test
that passes because nothing it describes exists.

## 2026-08-24 ORION v2 Phase 7 COMPLETE — the Event System

Nine-field versioned envelope, 25 types across all eleven categories, and the
requirement that actually had teeth: **unrelated systems cannot couple through
the bus**, enforced four ways rather than asserted once.

### The requirement that is not a data structure

Eight of the nine fields are a morning's work. "Do not directly couple unrelated
systems" is a property of the wiring, and a bus can carry a perfectly versioned
envelope while being the exact mechanism by which health ends up driving email.

Four ways it happens, and what stops each:

| How | What stops it |
|---|---|
| a producer calls a consumer | `publish()` takes an envelope and no target — asserted against the signature, not by convention |
| a consumer reaches into a producer | handlers receive an envelope and nothing else |
| a consumer publishes mid-handling | re-entrant `publish()` **raises**, so A→B→C→A cannot form |
| a handler returns an event in another category | allowed, but only through a default-deny matrix, bounded at depth 2 |

That last one is the interesting case, because it is legitimate: a completed task
should be able to raise a notification. So it is governed the way Phase 3
governed context domains — every allowance carries the reason it exists, and a
pair nobody wrote down does not fire.

### Two decisions worth remembering

- **The bus refuses credentials; it does not redact them.** Phase 6 redacts
  because an audit record has to be written even when something in it should not
  be. An event is data moving between subsystems, so a credential in a payload is
  a defect at the producer — redacting it would let the defect ship quietly and
  resurface later as a field nobody can explain. Phase 6's shapes are reused, so
  there is one answer in the codebase to what a credential looks like.
- **Health reaches only notifications.** Phase 38 makes planning health-aware,
  and the way to do that is for the planner to *consume* health events, not for
  health to start emitting task events. Written into the matrix now, with the
  reasoning, so it is argued at the right end.

### One deliberate exception to isolation

A subscriber that raises is recorded in the delivery report and affects neither
the publisher nor the other subscribers. `ReentrantPublish` propagates instead —
isolation protects the publisher from a consumer's *bugs*, not the bus from a
consumer breaking its *contract*, and a quiet report line is exactly the silent
coupling this design exists to prevent.

### Verification

Python **568/568** (was 535). Plugin **146/146**, unchanged. Audit check OK,
policy check 390/390, capability check agrees, secret scan clean after one more
reviewed fixture (the event tests need a credential-shaped string to prove the
bus refuses it).

### Live and installed state

**Nothing live changed.** No plugin edit, no rebuild, no restart. `orion/core/eventbus/`
is inside the Phase 1 import firewall and performs no I/O.

### Rollback

Delete `orion/core/eventbus/` and `tests/test_v2_event_system.py`, revert the
Phase 7 block in `PHASE_GATES.json` and the one allowlist entry.

### The limitation, stated plainly

**Nothing publishes to this bus yet.** It is in the position Phase 3's context
firewall was in before Phase 4 unblocked it: a contract with tests. Phase 8's job
system is the first intended producer, which is why the two `remote_jobs` types
are already registered.

### Next

Phase 8, the Job System. Eleven job fields, twelve states, and the requirement to
watch is the one the manifest states as an absolute: *never allow an expired
command to execute after a device reconnects*. That is not one check — it is a
check at creation, at dispatch, at delivery and at execution, because the whole
point is that time passes between them.

## 2026-08-24 ORION v2 Phase 6 COMPLETE — the Audit System

Structured audit events with the manifest's twelve fields, a redactor that
**cannot be skipped**, and a user-facing record that cannot disagree with the
developer one — plus the whole live task ledger replayed through the contract to
prove it fits reality.

### The finding that shaped it

The manifest asks for twelve fields. The live `TaskRunRecord` already carries ten
of them in some form. The two it does not are **user** and **device**, and they
are missing for the same reason: there is one user on one machine, so nobody had
to say which. Every historical row becomes ambiguous the moment a second device
can propose an action, which is Phase 15.

The deeper mismatch is shape, not fields: **the live record is a task run; the
manifest asks for a decision.** A rejected plan records that something was
refused — and, in 11 of 18 replayed events, not what it was refused *about*,
because the ledger omits `request` on a step that never ran.

### Redaction is in the constructor, not in the middle

"Central redaction middleware" reads as a function every writer calls on the way
to a sink. Every writer that forgets is then a silent leak. So redaction happens
inside `AuditEvent.__post_init__`: there is no way to build an event whose free
text has not been through it, and therefore no way to hand a sink an unredacted
one. A test pins the exact set of free-text fields, so adding a new one fails
until somebody decides whether it is redacted.

The report says **what rule fired and at which path, never the value**. A
redaction report that quotes the secret has made a second copy of it.

### Three things worth remembering

- **Names matter as much as shapes.** `password: "hunter2"` matches no
  credential regex. Name-based rules cover it, in every spelling — `X-Api-Key`,
  `apiKey`, `sessionToken` — while `tokenizer_version` and Phase 2's `tokens`
  counts survive, because over-redaction that hides the router's cost telemetry
  is its own kind of broken record.
- **Secure debug needs two locks.** The event must ask for it and the trail must
  permit it. And even then, credential shapes inside the kept prompt are still
  struck: the manifest's exemption is for the prompt, not for what somebody
  pasted into it.
- **The redactor reshaped the adapter, not the other way round.** The live
  ledger's `authorization` field holds trust provenance — "there was a user turn,
  recently" — and the redactor struck all 18 events because of the name. The fix
  was to record it as `trust_binding`, not to teach the redactor an exception.

### Verification

Python **535/535** (was 486). Plugin **146/146**, unchanged. `orion_v2_audit_check.py`:
12 credential shapes, 12/12 synthetic samples struck with none surviving verbatim,
**17 live ledger rows → 18 audit events, all decoding, zero redaction rules fired**
— the live ledger contains nothing shaped like a credential, which is the honest
form of Phase 9's "credentials cannot appear in logs". Policy check still 390/390.
Capability check agrees. Secret scan clean after adding **17 reviewed synthetic
fixtures** to the allowlist (my new corpus; every entry names the file and says
"no live value").

### Live and installed state

**Nothing live changed.** No plugin edit, no rebuild, no restart, no config write.
The adapter reads `~/.openclaw/orion-controlled/task-ledger.jsonl` read-only.
`orion/core/audit/` is inside the Phase 1 import firewall and performs no I/O at
all — the only sink in Core is in-memory, because writing to a file is an
adapter's job.

### Rollback

Delete `orion/core/audit/`, `orion/mac/audit_ledger.py`,
`tests/test_v2_audit_{redaction,events}.py`, `scripts/orion_v2_audit_check.py`,
and revert the Phase 6 block in `PHASE_GATES.json` plus the 17 allowlist entries.

### The limitation, stated plainly

**The live ledgers are not migrated.** Phase 1's compatibility mapping said they
"remain durable evidence until Phase 6 migration". That migration is deliberately
not done: the ledgers are written by TypeScript on the live route, and swapping a
running system's audit path is a coordinated change on shared plugin files. What
exists is the contract, the redactor, and proof that every live row fits — not the
swap. Recorded as a limitation so this entry cannot later be read as evidence that
the live system audits in the v2 shape.

### Next

Phase 7, the Event System. The envelope is nine fields and eleven event
categories, and the interesting requirement is the structural one — "keep event
producers separate from event consumers, do not directly couple unrelated
systems" — which is a rule about imports, so it wants an AST test rather than a
runtime one.

## 2026-08-24 ORION v2 Phase 5 COMPLETE — the Policy Engine

One deterministic engine, `orion/security/`, that answers ALLOW / DENY /
REQUIRE_APPROVAL for every one of the 78 live actions — and is proven, across
all 390 action×profile combinations, never to be more permissive than the gate
running today.

### Found state, including what the previous record got wrong

- **Phase 4's `side_effects` field is wrong in both directions**, because it was
  derived from `execution.kind`, which is coarser than the action. `reminder_list`,
  `self_plugin_read`, `self_script_read`, `self_config_list` and `self_repair_status`
  are reads that declare `writes_files`; `calendar_event_add`, `calendar_event_remove`
  and `apple_reminder_add` write to Apple Calendar and declare only `reads_user_data`.
  Nothing depended on the field, so nothing was broken — but a risk classifier built
  on it would have over-gated four reads and under-gated three calendar mutations.
  Risk is therefore derived from tier, severity word and reversibility, the three
  facts the Phase 4 drift check actually proves against the live catalog. Registered
  as a Phase 4 follow-up.
- **The manifest fingerprint appears to have drifted and has not.**
  `MANIFEST_PHASES.json` records `f9fceb60…` over 2642 lines; the file on the Desktop
  now hashes to `fef19374…` over 2644. The difference is a two-line wrapper header
  added after Phase 0 fingerprinted it. Verified, not assumed:
  `tail -n +3 '<path>' | shasum -a 256` still gives `f9fceb60…`. The reproduction
  command is now recorded in `MANIFEST_PHASES.json` so the next session does not
  spend the same twenty minutes.
- **`orion_v2_secret_scan.py` has no default allowlist path.** Run without
  `--allowlist docs/planning/v2/secret-scan-allowlist.json` it reports 4 "unexpected"
  findings that are the 4 reviewed synthetic fixtures. Not a regression; the earlier
  "secret scan clean" results were run correctly. Worth knowing before anyone
  concludes a credential landed in the tree at 01:00.
- `docs/planning/v2/MANIFEST_TRACEABILITY.md` still says "Phase 2 in progress" — it has
  been three phases stale since 2026-08-23.
- Python suite was **404**, not what any single earlier number said; plugin **146**;
  HEAD unchanged at `1efd37c`, tree still dirty with Nick's unrelated work.

### What was built

Eight small modules, because the pieces answer different questions and get reused
separately: `vocabulary` (R0–R5, security state, device trust, request source),
`risk`, `profiles`, `devices`, `delegation`, `signing`, `request`, `rules`, and
`decisions` — the engine Phase 1 deliberately left as an empty package, recording
that a "second, premature permission implementation" was worse than nothing there.

Twelve rules, **all of them evaluated, none short-circuiting**, with the most
restrictive verdict winning. A denial therefore lists every reason it was denied
rather than the first one that fired, which is what makes the record worth reading
in an audit six months later.

### Four decisions worth remembering

- **Risk is derived; trust is looked up.** A request may carry `declared_risk`, used
  for exactly one thing: denying on mismatch, the way `validator.ts` already denies
  on `risk_mismatch`. Device trust is not a request field at all — a request that
  states its own trust level has not been checked, it has filled in a field.
- **`MODEL_INITIATED` does not mean "the model emitted the tool call".** It almost
  always does; that is the ordinary path and it is `USER_DIRECT`, because an
  authenticated user turn is behind it. `MODEL_INITIATED` is the narrower case the
  live validator already refuses under `no_authenticated_user_turn`. Getting this
  wrong in the strict direction would make Orion ask permission to change the volume,
  which is how a security control gets switched off.
- **Signatures bind on crossing a device boundary, not on risk alone.** A same-device
  request has no transport to forge over and is authenticated by the local session.
  Requiring a signature there would have denied every destructive local action Orion
  performs today while proving nothing. A signature that *is* present is verified at
  every level.
- **A read stays a read behind a powerful tier.** `self_config_list` sits behind the
  `self_config` tier because it shares a surface with the authority writes. Tier
  alone would have made listing a config key privileged and demanded a signature
  for it.

### What the parity run found

390 combinations, **zero more permissive**, 38 stricter across 14 actions — and the
14 are the interesting output of this phase:

- Four file writes (`desktop_file_write_explicit`, `…_append_confirmed`,
  `…_replace_confirmed`, `scratch_file_write_explicit`) overwrite with no undo,
  are rated `medium`, and ask for no approval; `file_move` and `file_rename` sit
  alongside them.
- `reminder_cancel` destroys a reminder irreversibly at `low` risk.
- **Seven `self_*` actions rewrite Orion's own plugin, scripts, Swift source or
  settings under `consequential_local` with `approvalRequired: false`.** Only the
  three `*_authority_*` variants require approval. The engine rates all of them R5
  and would confirm each one. **This is for Nick to look at** — it is registered in
  `PHASE_GATES.json` follow-ups, not fixed here, because changing live approval
  behaviour is not a thing to do at 01:00 without him.

R3 has no live occupant: `messages_send` is the manifest's external-communication
case and is also irreversible, so it classifies R4. Recorded, so a later connector
phase checks rather than assumes.

### Verification

Python **486/486** (was 404 — 81 new policy tests plus one new traceability test),
plugin **146/146** unchanged, `orion_v2_policy_check.py` 390/390 with zero
more-permissive, capability check agrees, secret scan clean with the reviewed
allowlist, phase gate valid and phase 5 open.

The rule-coverage test was checked by deleting a rule from the engine's loop and
confirming it fails, then restoring it. A test that cannot fail is not evidence.

### Live and installed state

**Nothing live changed.** No plugin edit, no rebuild, no install, no gateway
restart, no config write, no live smoke, no Anthropic spend. The v2 flag is still
false. `orion/security/` is pure Python inside the Phase 1 import firewall — it
cannot reach the filesystem, a socket, or a subprocess even by accident.

### Rollback

Delete `orion/security/{vocabulary,risk,profiles,devices,delegation,signing,request,rules,decisions}.py`,
`tests/test_v2_policy_{primitives,engine}.py`, `scripts/orion_v2_policy_check.py`,
and revert the Phase 5 block in `docs/planning/v2/PHASE_GATES.json`. Nothing else refers
to any of it.

### The deviation this phase inherits, stated rather than assumed

The manifest says "make all current Mac tools pass through this engine". Every live
tool is *evaluated* by it; none is *decided* by it. That is the Phase 1 reading —
Core defines and validates contracts, platform adapters execute them — and Phase 1's
own record requires a later phase to state the inheritance explicitly instead of
absorbing it. Stated, in `PHASE_GATES.json` under
`engine_agrees_with_the_live_gate_rather_than_being_it`, with the exact closing work
(wire the controller to call the engine behind a default-off flag, prove parity
flag-off then flag-on) and the note that **Nick accepted this reading once, for
Phase 1, on Phase 1's evidence — not for Phases 5–10.** Raised in `NICK-TODO.md`.

### Next

Phase 6, the Audit System. Expect the shape a fifth time: the ledgers already record
most of what the manifest lists, `orion/core/events/ports.py` already has an
`AuditRecord`, and the gaps will be the ones nothing currently has a place for —
correlation across a whole decision, a user-facing record separate from the
developer log, and the central redaction middleware that has to exist before any of
it is written anywhere.

## Recovering the 2026-08-19 session

The Codex session that wrote the previous version of this file **kept working for
fifteen minutes after writing it, then ran out of credits mid-verification**
(22:47:09Z, `credits.balance = "0"`). The file therefore listed as "next" a slice
that was already built, tested, installed, and live-proven.

If you ever have to do that reconstruction again, it came from four places:
`~/.codex/sessions/<date>/rollout-*.jsonl` (the auto-review thread carries the
main agent's full tool log), `~/.openclaw/logs/config-audit.jsonl`,
`~/.openclaw/orion-controlled/archive/ledger-*.jsonl.gz`, and file mtimes newer
than the handoff's own timestamp. The general rule is now written down in root
`AGENTS.md` under "Relay protocol" — a handoff's date is when it was written, not
when the work stopped.

## What is complete

**Phase 0** is machine-open and its exit evidence is current:

- the replacement Anthropic key is live and the previous server-side key is
  disabled;
- the exact stale Anthropic Keychain item and invalid, unreferenced `.env.save`
  were removed after verification;
- OpenClaw gateway, Anthropic, and Ollama values use three dedicated login-
  Keychain SecretRefs;
- OpenClaw's live audit resolves all three refs with no plaintext, unresolved,
  shadowed, or legacy findings;
- the legacy gitignored mode-`0600` `.env` remains intentionally because the
  current app and scripts still consume non-OpenClaw provider values from it;
- authority inventory is current at 158 capabilities and both repository and
  history secret scans are clean after the reviewed allowlist.

**Phase 1** has a tested contract foundation and one live-proven integration:

- collision-free `orion.core`, `orion.shared`, `orion.security`, and
  `orion.mac` package boundaries;
- an AST import firewall for Core/Shared/Security, including static and dynamic
  imports;
- strict schema-v1 proposal, decision, and execution-result envelopes;
- matching language-neutral JSON Schemas and a drift test;
- recursively immutable JSON boundary values;
- bounded context, model, policy, authorization-bound tool broker, audit,
  runtime, agent, planning, memory, and authorization-bound job ports;
- a strict, read-only `system_status` compatibility adapter and sanitized
  fixture tests;
- **the TypeScript half**: `src/v2/contracts.ts` and
  `src/v2/system-status-adapter.ts`, a default-`false`
  `enableV2SystemStatusAdapter` config flag, and the single wrapped
  `system_status` route in `src/index.ts`.

No native source, installed app, or Swift file was changed. The locally rebuilt
app bundle (1.2.0, build 119) was never installed; the signing identity is
untouched.

## The fail-open correction — 2026-08-20

The bridge as first written **could refuse a call the legacy route accepts.**
`isSystemStatusContractCandidate` only checks step count and action name, so a
`system_status` call carrying any extra argument reached
`strictSystemStatusArguments`, which threw — before `runLegacy()` ran, with
nothing wrapping the call site. The legacy catalog declares
`requiredArguments: []` (`catalog.ts:2033`) and the validator rejects no unknown
key, so that same call succeeds with the flag off. Output drift had the same
shape: `buildExecution` threw *after* the ledger row was already written.

That broke the plan's own requirement 4 (equivalent visible output flag off and
on) and contradicted `src/index.ts:490` — errors must stay "diagnosable, not
brick the tool with an opaque exception."

**The bridge is now an observer, never a gate.** Every strict check is kept, but
a failure records `contractError` in the non-enumerable evidence, warns through
the host logger, and returns the legacy record untouched. The checks became a
drift detector, which is what they were actually good for. A contract experiment
must never be able to stop Orion from answering a question.

Regression proof: the new host-seam test fails against the pre-fix adapter
(throws out of `runAuthorizedGraph` at `src/index.ts:694`) and passes after.

## Verification snapshot

All of these passed on the current dirty tree on **2026-08-20**:

| Check | Result |
|---|---|
| ORION Control suite | 144/144 (was 142; +2 fail-open cases) |
| ORION Control TypeScript compile | passed with `--noEmit` |
| `openclaw plugins build` + `validate` | metadata regenerated from source; valid |
| Installed plugin vs tested build | `diff -qr` clean; manifest byte-identical |
| Full Python suite | 267/267 |
| Python suite flake | one run out of six failed with a single unnamed failure and did not reproduce in five subsequent runs, including one under concurrent load. The suite contains deliberately timing-sensitive TTS deadline tests, and `PHASE_1_PLAN.md` already warns to run timing-sensitive suites separately. No Python behavior changed in this slice. Worth watching, not worth blocking on. |
| Native SessionDomain/SessionService | 318/318 |
| Phase 0 machine gate | passed and open |
| Authority snapshot | current, 158 capabilities |
| Secret inventory | current, values omitted |
| Working-tree/history secret scan | clean; 8 reviewed findings allowlisted |
| OpenClaw live SecretRef audit | clean; 3 refs resolved, zero findings |
| Installed doctor | all clear; gateway and signed app running; TTS daemon not resident, reported as a warning (pre-existing, also seen 08-19) |
| Live smoke — new build, flag **off** | `orion-6c7fb0773e41c616` |
| Live smoke — flag **on** | `orion-26e75dcb764d3884` |
| Live smoke — rollback, flag **off** | `orion-27f07824fc7291f8` |
| Ledger parity, flag off vs on | structurally identical: same top-level keys, step keys, `verified`/`observed` status, and output field set; no `schema_version`, `proposal_id`, or `contractError` anywhere in the row |
| Host logger during flag-on run | no contract warnings — no drift observed |

The ledger-parity comparison is the evidence the 08-19 session never got to
capture. The bridge is transparent by design, so "the flag was on and it worked"
is on its own indistinguishable from "the bridge silently did not engage"; the
in-process host-seam test is what proves it engages, and the two ledger rows are
what prove engaging costs nothing.

## Architectural decisions that must survive

1. The active product route is Swift Orion -> OpenClaw -> TypeScript ORION
   Control. The Python dataclasses under `orion/core` are executable reference
   validators and fixtures, not a new production process or model hop.
2. The JSON Schemas under `orion/core/schemas` are the language-neutral
   contract for future TypeScript and Swift adapters.
3. Existing OpenClaw provenance, `authorizeTaskGraph`, catalog validation,
   executor restrictions, independent verification, and durable ledgers remain
   authoritative.
4. The live integration is read-only `system_status` only, behind a default-off
   flag. It cannot widen authority or change visible output.
5. **The bridge fails open.** A contract violation is reported, never enforced.
   Anything that wants to *deny* an action belongs in the validator and the
   permission profile, which are the components that already own that authority.
6. Legacy `orion/cloud.py` already owns `import orion.cloud`; do not create an
   `orion/cloud/` package until a reviewed rename/compatibility plan exists.
7. `SessionService` remains the sole focus-session writer.
8. Concrete routing, context-firewall, policy, audit/event, and job behavior
   belong to later manifest phases. Phase 1 defines their boundaries only.

## How Phase 1 was closed, and what that does not mean

Phase 1 is marked complete against the five exit criteria in `PHASE_1_PLAN.md`,
all of which are met and evidenced above.

**It is not complete against the manifest's literal exit gate**, which reads
"Existing desktop ORION must run through ORION Core without meaningful
behavioral regression." Nothing runs through Core. One read-only capability is
envelope-*wrapped* by an observer behind a default-off flag, and the legacy route
still performs every authoritative step. `PHASE_GATES.json` records this
deviation explicitly so Phase 2 entry is a decision someone made, not something
that happened quietly.

Whoever opens Phase 2 should decide first whether to accept that reading or to
widen the bridge until the literal gate is met. The manifest's own rule — "do not
skip implementation phases" — argues for making that call out loud.

## Files owned by this v2 slice

Planning and evidence:

- `docs/planning/v2/ANTHROPIC_ROTATION_EVIDENCE.json`
- `docs/planning/v2/CURRENT_AUTHORITY.json`
- `docs/planning/v2/CURRENT_SECRET_INVENTORY.json`
- `docs/planning/v2/MANIFEST_PHASES.json`
- `docs/planning/v2/MANIFEST_TRACEABILITY.md`
- `docs/planning/v2/PHASE_0_SECRET_MIGRATION.md`
- `docs/planning/v2/PHASE_0_STATUS.md`
- `docs/planning/v2/PHASE_1_PLAN.md`
- `docs/planning/v2/PHASE_1_RUNTIME_DECISION.md`
- `docs/planning/v2/PHASE_GATES.json`
- `docs/planning/v2/HANDOFF.md`

Additive contracts and tests:

- `orion/core/**`, `orion/shared/**`, `orion/security/__init__.py`
- `orion/mac/__init__.py`, `orion/mac/system_status_adapter.py`
- `tests/test_v2_*.py`, the focused `tests/test_phase0_*` updates
- `scripts/orion_v2_secret_inventory.py`

Coordinated shared files (Nick confirmed the integration window):

- `openclaw-plugins/orion-control/src/v2/**`
- `openclaw-plugins/orion-control/src/index.ts` — flag declaration and the single
  wrapped route, plus the `hostWarn` sink
- `openclaw-plugins/orion-control/src/index.test.ts` — two host-seam parity tests
- `openclaw-plugins/orion-control/openclaw.plugin.json` and `package.json` —
  **generated**, never hand-edited; regenerate with
  `openclaw plugins build --entry ./dist/index.js`

## Rollback

Setting the flag false is the whole rollback; there is no state migration. It was
exercised live on 08-20 and left in that state. Deeper undo:

- `.builds/openclaw.json.pre-v2-flag-20260820` — live config before the flag flip
- `.builds/orion-control-installed-pre-failopen-20260820/` — the installed plugin
  as it stood before the fail-open build

Both live in the repo rather than `/private/tmp`, where the 08-19 session left its
only copy. `/private/tmp` does not survive a reboot.

## Current live state

Flag `false`. Gateway healthy on 127.0.0.1:18789 running the 08-20 build.
Orion.app running, signed with the stable identity. Installed plugin matches the
tested build byte for byte.

## Phase 2 — opened 2026-08-20

Nick settled both entry questions before any code was written.

**The Phase 1 gate deviation is accepted**, recorded in `PHASE_GATES.json` with
his name and the date, under the reading that "runs through Core" means the live
route honors Core's contracts rather than that Core's code executes the work. A
test now fails if an accepted deviation loses its acceptance fields.

He also chose to defer amending the manifest text itself. `PHASE_GATES.json`
gained a `pendingGateAmendments` block holding the replacement wording, with the
protocol: never silently reinterpret a gate — record it, keep working under a
recorded deviation, and amend all of them together in one pass he reads end to
end. One entry so far. **Add to it rather than bending a gate in the moment.**

**Router placement: OpenClaw executes, ORION owns the contract.** Live
inspection found ORION does not lack a router — it has two, and three surfaces
that route themselves:

| Surface | Routed by |
|---|---|
| OpenClaw gateway agent | OpenClaw, live |
| `orion/runtime.py` + `cloud.py` | itself — **process is dead** |
| `LocalModel.swift` | nobody; hardcoded model constant |
| `DeepgramSpeech.swift` | nobody; `static let model = "nova-3"` |
| `scripts/orion_tts_daemon.py` | itself |

Building a third router was rejected: it adds a hop to every turn, which the
2026-08-16 latency decision in root `HANDOFF.md` refused. Reviving the dead
Python router was rejected for standing a second live orchestrator beside
OpenClaw. Full derivation in `PHASE_2_PLAN.md`.

### What Phase 2 is actually fixing

OpenClaw already records per turn: `model`, `provider`, `api`, `responseModel`,
`stopReason`, and full token counts. Of the six fields the manifest says to
track, **four are missing**: latency (there is a timestamp, not a duration),
estimated cost (the field exists and every value is `0`), failure reason, and
fallback usage. Plus `DEEPGRAM_API_KEY` and `ELEVENLABS_API_KEY` are still
plaintext in `.env` and read directly — the one manifest requirement currently
answered *false*.

Role names are the small part. Those four fields and those two keys are the work.

### Slice 1 — complete

- `orion/core/schemas/model-roles.schema.json` — the language-neutral contract.
- `orion/core/models/contract.py` — reference validator: strict fields, bounded
  numbers, `provider/model` refs checked against declared providers, a chain
  that cannot list the same model twice, and an unassigned role that refuses to
  resolve rather than substituting a different model.
- `assert_carries_no_secret` walks the whole document and rejects secret-shaped
  values and secret-shaped field names. The contract records where a credential
  lives; the moment it records the credential, every reader of a config file has
  it.
- `tests/test_v2_model_contract.py` — 16/16, including schema-parity tests that
  fail if the Python decoder and the JSON Schema drift apart.

Two departures from the manifest's role list, both deliberate and recorded:
`fallback` is not a role (it is a property of one, so fallbacks live per-role),
and `stt`/`tts` were added (Deepgram and ElevenLabs are model calls with
credentials, latency and cost; omitting them would leave two of five surfaces
unrouted). `vision` is declared and unassigned — a role with no model is honest.

### Verification, 2026-08-20 second pass

| Check | Result |
|---|---|
| Full Python suite | **285/285** (was 267; +16 contract, +2 gate-acceptance) |
| Core import firewall | 3/3 — `orion.core.models.contract` imports only `re`, `dataclasses`, `typing` |
| Phase 0/1 gate tests | 42/42 |

Nothing live was touched in this pass. No gateway restart, no config change, no
paid smoke, no plugin rebuild. The v2 flag remains `false`.

## Addendum, same day — direction confirmed and scope raised

Nick confirmed the router placement after talking it through separately, and
added the intent behind it:

> OpenClaw handles execution while Orion owns high-level roles and contracts. We
> plan to add texting and smart home later, so structure Orion around abstract
> roles so we can swap routing later if we outgrow OpenClaw.

Read that as **A now, B later — and A is what makes B cheap.** It is a
requirement on how Phase 2 is built, not a footnote: the contract and ledger
must be executor-agnostic by construction, or "take routing in-house later"
turns into a rewrite instead of a new executor behind an existing contract.

**One schema change followed from it.** The inference record now separates:

- `source` — which ORION *surface* ran the inference (`agent`, `native_app`,
  `tts_daemon`, `script`). A fact about ORION's own shape; survives a router
  change.
- `executor` — who actually routed and made the call (`openclaw`,
  `orion_router`, `direct`).

Collapsing those into one field would mean a future swap either re-labels every
historical row or loses the distinction between "the agent asked" and "OpenClaw
answered". Kept apart, **the ledger becomes its own migration proof**: rows stop
saying `openclaw` and start saying `orion_router`, everything else unchanged.

Both fields are required. `orion/core/schemas/inference-record.schema.json`
carries them; slice 2's validator must enforce them.

### Texting and smart home are registered, not started

Neither appears anywhere in the manifest's 85 phases. Nearest is PHASE 65, App
Intents and System Integration. Texting is already partly live *ahead of* the
document: `enableMessagesReadActions` / `enableMessagesSendActions` are on in
`openclaw.json`, and `scripts/orion-messages-send` exists.

**Neither is a model role.** They are tool capabilities — which hands act, not
which brain answers — so they do not route through the ModelRouter and are not
Phase 2 work. Routing them through it would be a category error.

`PHASE_GATES.json` gained a `scopeNotInManifest` register holding both, with the
same protocol as `pendingGateAmendments`: when reality outruns the manifest,
record it rather than refusing it or silently building outside the requirements
source. Resolve both registers in the same reviewed pass.

Smart home will need its own capability tier with approval gating when it comes.
A device that unlocks a door or heats a room is consequential in a way reading a
calendar is not, and the existing tier model already knows how to express that.

## The repository changed under this session — noticed 2026-08-23

**Nick committed and pushed the whole repo to GitHub while this work was in
progress.** The commits are authored `Nick Madaio <nmadaio08@gmail.com>` and
dated 2026-08-20 17:36 and 17:38 UTC; the local checkout was found on them on
2026-08-23. This was not an agent. AGENTS.md already warned that something in this repo commits
on its own schedule; now there is a remote, so the stakes of a stray push are
higher than they were this morning.

What changed:

- HEAD moved `1169e5b` -> `1efd37c`; the checkout is now on **`main`**, not
  `orion-v2/phase-0-inventory` (both refs point at the same commit).
- `origin` exists for the first time: `https://github.com/NickMadaio/orion.git`,
  confirmed **private**.
- The previously-uncommitted v2 work is now committed history.

Checked, because a first push is exactly when a credential escapes:

- `.env`, `.env.save`, and the `.builds/openclaw.json.*` backups are **not
  tracked** and did not go up.
- The full working-tree **and history** secret scan is clean: 16 findings, every
  one of them the same four synthetic prompt-injection fixtures already reviewed
  and allowlisted.

This also resolves **NICK-TODO item 3**, "Link GitHub, so updates have somewhere
to live." The Sparkle updater's feed URL is still a placeholder, so the appcast
and first release remain to be cut, but the repo it needs now exists.

### Why the secret-scan count doubled, so nobody re-investigates it

It printed `8 reviewed finding(s)` on 2026-08-20 and `16` on 2026-08-23 with no
change to the allowlist. The explanation is arithmetic, not exposure:
`scan_history` walks `git rev-list --all`, the four fixtures appear in every
commit that touches them, and two commits landed today. 4 fixtures x 2 new
commits = the extra 8. An unexplained number in a secret scan is a trap for the
next session, so it is written down here rather than left to be rediscovered.

## Phase 2 slices 4-7 — 2026-08-23

**Slice 4, agent-path telemetry. The ledger is live and it answers questions
OpenClaw could not.** `orion/core/models/ingest.py` is a pure normalizer over
already-parsed session records -- ORION reads what OpenClaw writes anyway rather
than intercepting its calls, which is the "no second inference path" promise made
literal.

Ingested **1270 rows from 282 sessions**:

| role | calls | estimated cost |
|---|---|---|
| reasoning | 956 | **$6.7151** |
| fast | 245 | $0.0000 (local) |
| local | 69 | $0.0000 (local) |

138 fallbacks fired. 9 failures — 5 `provider_error`, 4 `ENOTFOUND`. Median
latency 1763 ms. **OpenClaw reported $0.00 for every one of those calls**; the
cost above is priced from the contract's rate table, which is why the ledger
exists at all. Rerunning ingests nothing: it dedupes on correlation id.

Two things the ingest found that the contract did not know about, and one design
change each forced:

- **Three undeclared models in real traffic** — `anthropic/claude-haiku-4-5`
  (unversioned alias, Aug 9-13), `ollama/gemma4:31b` (Jul 29 experiment), and
  `openclaw/gateway-injected`. All historical, none current. The contract gained
  a `retired` map so it can describe its own past; without it a telemetry pass
  over old sessions has to invent a role or silently drop rows. Retired entries
  deliberately do NOT require their provider to still be declared.
- **The normalizer raises on an unknown model rather than skipping it.** Skipping
  would let the contract look like the single source of truth while traffic
  flowed past it.

**Slice 5, credentials — half done, and the half that is left has a price.**
ElevenLabs now lives in Keychain item `ORION ElevenLabs`. The TTS daemon's
`read_secret` gained a Keychain lookup positioned *between* environment and
`.env`, deliberately: seeding the item makes the migration a no-op switch, and
the plaintext line comes out only once the new source is proven. It was, so it
did. `.env` backed up to `.builds/env.pre-elevenlabs-keychain-20260823` first,
since it is gitignored and had no other copy.

`plaintext_providers()` went from `("deepgram", "elevenlabs")` to `("deepgram",)`.

**Deepgram cannot follow without Nick.** `VoiceProviders.Secrets.value()` reads
environment then a hardcoded `.env` path and has no Keychain branch at all, so
closing it means a Swift change, a rebuild, and a reinstall — roughly fifteen
Keychain dialogs. Bundled with slice 6 so that cost is spent once rather than
twice, and not spent at all until he says so.

**Slice 7, the TTS surface — adapter built, daemon not yet wired.**
`orion/mac/inference_ledger.py` resolves a role from the live contract and
appends one row, failing soft at every step: a missing contract returns the
caller's compiled-in default, a malformed one does not raise, and an unwritable
ledger returns False. Telemetry must never be why a user cannot hear their
assistant.

It validates every row through Core's own decoder before writing. That was not
the original design — a test caught the adapter happily writing a row with an
unknown role that `decode_record` would later reject. The test was right and the
code was wrong, so the code changed.

The live contract now exists at `~/.openclaw/orion-controlled/model-roles.json`.

### Verification

- Full Python **347/347** (was 319)
- Core import firewall 3/3 — the normalizer is pure, all I/O sits in `orion/mac`
- `orion_v2_model_contract_check.py`: all 9 bindings agree with live config and source
- Ingestion idempotent: second run adds 0 rows

## Phase 2 CLOSED — 2026-08-23

All seven slices done. Every ORION surface that performs inference now resolves
its model through one contract and lands rows in one ledger.

### The Swift half, and what it cost

Nick authorized the rebuild. `native/Orion/Sources/Orion/ModelContract.swift`
reads the live contract and resolves a role to a model, failing soft to the
compiled-in constant at every step -- a missing or malformed contract must never
be why Orion cannot hear or speak. `LocalModel.defaultModel` and
`DeepgramSpeech.model` now resolve by role; both keep a `fallbackModel` constant
as the documented degradation.

`VoiceProviders.Secrets` gained a Keychain branch positioned between environment
and `.env`, so a migration is a no-op switch: seed the item and the app prefers
it with no other change.

Built as **1.2.0 build 121**, identity check passed (`171a72ab…` unchanged, so
permissions and stored secrets survived), installed, relaunched, running.

### Credentials: the manifest requirement that was answered "false" is now true

Both voice credentials moved to the login Keychain -- `ORION ElevenLabs` and
`ORION Deepgram` -- seeded through the Phase 0 seeder, whose `add()` goes via the
Security framework so the secret never appears in a process argument list. The
plaintext lines came out only after the new source was proven, with `.env` backed
up first because it is gitignored and had no other copy.

`contract.plaintext_providers()` returns `()`.

**Two things this surfaced that are worth keeping:**

- **The migration briefly broke `orion-doctor`.** It reported
  `ELEVENLABS_API_KEY not set` while the key sat in the Keychain working fine. A
  diagnostic that is wrong about a working system is worse than the gap it was
  watching, so `key_source()` now checks environment, then Keychain, then `.env`
  -- the same order every consumer uses -- and names which one answered.
- **`plaintext_providers()` reports what the contract DECLARES**, which can be
  true while a stale copy still sits on disk. `orion_v2_model_contract_check.py`
  now separately reports leftovers. It currently flags `ANTHROPIC_API_KEY` in
  `.env` -- reviewed and kept by Phase 0, but the contract could not see it and
  now something can.

### Two tests caught me being wrong

The drift check failed the moment the Swift constants became contract lookups --
correctly, since its probe was reading a pattern that no longer existed. It now
checks the *fallback* constants instead: the live value is the contract's by
construction, so checking it would be circular, but the fallback is what runs
when the contract is missing and it should degrade to the same model.

The gate test then refused a deviation record I had stamped with Nick's name.
He approved the router placement; he was never asked about the role list
departing from the manifest. That is now `recorded_pending_review` and queued in
`pendingGateAmendments` for the sweep, rather than carrying an approval he never
gave.

### Phase 2 exit criteria, all met

| Criterion | Evidence |
|---|---|
| Every surface resolves through the contract | All 9 bindings agree; no model name hardcoded outside it except documented fallbacks |
| Six tracked fields on real rows | 1270+ rows carry model, tokens, latency, cost, failure reason, fallback usage |
| No provider credential in plaintext | `plaintext_providers() == ()`; stale-copy check reports the one Phase 0 kept |
| Provider swappable by editing the contract | Demonstrated: changing the local or STT model is now a one-line edit, not a rebuild |
| Suites green | Python 348/348, native 318/318, plugin 144/144, firewall 3/3, doctor all clear |
| Disableable without migration | Delete the contract and every surface falls back to its constant |

## Phase 3 CLOSED — the Context Firewall, 2026-08-23

### What the phase turned out to be

The manifest's requirement list splits in two, and only one half was missing.

**Least-context already existed.** Selective recall only searches history on a
continuity cue, `contextPruning` in cache-ttl mode drops stale tool output, and
`memorySearch` returns one best result by default. What it lacked was
*visibility* -- a decision nobody records cannot be audited later or argued with
now.

**Domain isolation did not exist at all.** Nothing labelled a piece of context
with a domain, so the manifest's central rule -- health context must not reach an
email task -- was **unenforceable rather than unenforced.** You cannot write a
rule about a property nothing records. That was the phase's real work.

Trust labelling was a third case, already strong and left alone:
`authorizeTaskGraph` rebuilds every input field by field so model-supplied
content becomes `untrusted_external`. Phase 3 adds provenance *alongside* it, not
instead of it -- trust answers "may this authorize an action", provenance answers
"where did this come from and how much should it be believed". Six categories
where trust has three levels.

### Built

- `orion/core/context/domains.py` — the twelve domains, six provenance
  categories, and the nine sources the manifest calls untrusted.
- `orion/core/context/policy.py` — a default-deny cross-domain matrix. Each
  allowance carries its reason (`email -> contacts: a message has a sender`), and
  a test fails if one is added without one.
- `orion/core/context/builder.py` — assembles a bundle for a task domain,
  enforces the matrix, respects the Phase 1 budgets, and records what it refused.
- `orion/core/schemas/context-item.schema.json` — the language-neutral contract,
  with parity tests against the Python enums.
- `ContextEntry` (Phase 1) extended with domain, provenance and confidence. All
  required: an entry that does not say what it is about would be admitted by any
  policy that reasons about domains.

### Three decisions worth keeping

**An unrecognised source is `external_untrusted`.** Not `general`. A new
integration nobody remembered to classify must arrive untrusted, because the
alternative is that forgetting to think about a source silently grants it
credibility.

**Health and security are sealed** to themselves plus `general`. The manifest
names health in both directions, and a security decision that can be argued from
an email is not a security decision.

**Credentials are refused twice.** `ContextEntry` will not construct one, and
`build()` raises `CredentialLeak` if one arrives anyway. Two layers because a
subclass, a pickle, or a future refactor can slip past the first. And a credential
is not a policy decision that could have gone the other way, so it gets its own
exception type rather than being caught by a generic denial handler.

### The limitation that matters most

**Nothing passes through this firewall yet.** OpenClaw still assembles context
for agent turns exactly as it did before. A firewall nothing passes through
protects nothing, and this entry must not later be read as evidence that it does.

That deferral is deliberate, not laziness: deciding which domain each capability
belongs to is the tool registry's job, and Phase 4 is the tool registry. Guessing
the mapping now would only have to be redone. It is recorded as a `limitation` in
`PHASE_GATES.json` so it cannot quietly disappear.

### Verification

Python **381/381** (was 348). Core import firewall 3/3 — the whole firewall is
pure, no I/O. Gate, authority, inventory, secret scan, contract drift all clean.
**Nothing live changed**: no config write, no gateway restart, no rebuild; the
v2 flag is still false and Orion is untouched.

## Phase 4 CLOSED — Tool Contracts, 2026-08-23

**78 live actions** (not 59 — an early grep undercounted; the compiled catalog is
the only reliable source, regex-parsing `catalog.ts` leaked fields between
entries) now each map onto a structured contract.

### The constraint that shaped it

The manifest wants `calendar.events.read`. ORION has `desktop_file_write_explicit`.
**Renaming was never on the table**: those names live in the model's tool
description, in 1000+ ledger rows, in the approval hashes that gate a
`needs_approval` re-call, and in the self-tuning surfaces. So the registry maps
flat names onto dotted ones and `catalog.ts` stays the implementation — the
Phase 2 shape a third time.

### Built

`docs/planning/v2/capability-registry.json`, generated by
`scripts/orion_v2_build_capability_registry.py` rather than hand-typed, because
78 hand-typed entries would be wrong somewhere and would drift the first time the
catalog changed. It derives risk, approval, reversibility and required arguments
from the compiled catalog, and applies a reviewed overlay for the dotted name,
the domain and the effects.

`scripts/orion_v2_capability_check.py` proves registry and catalog still agree,
and asserts the manifest's flat prohibitions: no arbitrary command execution, no
capability in the credentials domain, no argument schema that permits unknown
keys.

**Every capability now names a context domain.** That is what Phase 3's firewall
was waiting on — `registry.domain_of("desktop_list")` answers `files`, so the
isolation matrix can finally be applied to a real request instead of only being
defined.

### Two things the work caught

**A name collision.** `desktop_list` and `home_list` both reduced to `files.list`
under the first naming rule. The registry validator refused it rather than
letting two capabilities answer to one name; they are now `files.desktop.list`
and `files.home.list`.

**Tier is not domain, and I had conflated them.** The read-only `self_*` actions
are tiered `desktop_read`, because reading Orion's own source is permission-gated
like reading the Desktop. That is a sensible gating decision and a terrible
domain proxy: it put `self_plugin_read` in `files` when the material it reads is
Orion's own authority code. Tier answers *how it is gated*; domain answers *what
it is about*. All 18 `self_*` actions are now `security`.

### Strict arguments: built, wired, default off, partial

`enableStrictArguments` rejects arguments an action does not accept — the
manifest's "reject unknown fields by default", and the fix for the hole found on
2026-08-20 that forced the v2 bridge to fail open.

Wired through the **authoritative** controller validation, not just the entry
point's evidence copy. Wiring only the latter would have produced a setting that
looks live and changes nothing.

**It covers 17 of 78 actions.** The other 61 carry a hand-written
`validateArguments` and accept optional keys declared *nowhere machine-readable*;
rejecting everything outside `requiredArguments` there would break working calls
on a guess. Closing that gap means auditing 61 validators and adding an
`optionalArguments` declaration. Named precisely in the gate's `limitations`
rather than hand-waved.

The 17 include `system_status` — the exact action whose behaviour forced the
Phase 2 compromise.

### Verification

Python **404/404**, plugin **146/146** (a manifest-parity test caught the new
config flag before the manifest was regenerated), Core firewall 3/3, capability
check and model contract check both agree, secret scan clean, doctor all clear.
Plugin rebuilt and installed; gateway restarted; **live smoke
`orion-74baa26cf680bd8b` unchanged with the flag off.**

## Exact next step

**Phase 5 — Build the Policy Engine.** Deterministic, outside the LLM, returning
exactly one of ALLOW / DENY / REQUIRE_APPROVAL, with risk levels R0-R5 and every
Mac tool passing through it before remote access exists.

Expect the Phase 2/3/4 shape a fourth time: **much of this already runs.**
`src/validator.ts` already returns `ready` / `needs_approval` / `rejected`, which
is ALLOW / REQUIRE_APPROVAL / DENY under different names. `src/permissions.ts`
has five profiles gating capability tiers. `authorizeTaskGraph` already refuses
model-declared trust.

The gaps I can name from this phase's work:

1. **Risk is 4 levels, the manifest wants 6.** `low|medium|high|critical` versus
   R0-R5, where R0 is observation and R5 is privileged/security-critical. The
   capability registry is the natural place to carry the R-level, and it already
   records `side_effects` and `reversible`, which is most of what distinguishes
   R1 from R2 from R4.
2. **The evaluation inputs the manifest lists are only partly present.**
   Authenticated user, capability, resource, risk, request source and
   external-data involvement exist in some form. Originating device, target
   device, delegation, expiration, device trust and signatures do not — several
   only become meaningful when remote access does, which is why the manifest
   says "before remote access exists".
3. **One engine, not several.** Validation, permission profiles and the taint
   check are three places today. The manifest asks that every proposed action
   receive ONE result from ONE engine.

Phase 3's live integration is also now unblocked, since capabilities finally name
their domain. That is a separate coordinated slice; do not fold it into Phase 5
silently.

Two registers to check first, both in `PHASE_GATES.json`: `pendingGateAmendments`
(2 entries) and `scopeNotInManifest` (texting, smart home).
