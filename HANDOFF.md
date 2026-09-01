# HANDOFF

## 2026-08-28 Phases 11-20 REVIEWED and repaired -- REC-REVIEW-11-20 closed

**Dates, and why three of them appear.** The review and repairs ran 01:20-23:59
on **2026-08-28** (`date` checked at both ends). The handoff was written at 00:00
on the 29th. The machine then rebooted — `kern.boottime` says Sat 2026-08-29
13:22 — and this session resumed afterwards, so the **commits are stamped
2026-09-01**. Nothing was back-dated and no commit date was faked: the documents
carry the date the work happened, git carries the date it was saved, and they
differ by three days. `AGENTS.md` warns that a long session can span a day
boundary; this one spanned a reboot and three of them, which is the same trap
with more room in it.

Full report: **`planning/v2/PHASE_11_20_REVIEW_REPORT.md`**. Per-claim
corrections: `PHASE_GATES.json` -> each phase -> `postReviewCorrections`, with
every original claim preserved verbatim beside them.

### Found state, and where the previous record was wrong

The 32.5 checkpoint's tail was accurate for once — nothing in the tree was newer
than `planning/v2/HANDOFF.md` at 23:54 on the 27th, and the only later Codex
activity was guardian-review threads for an unrelated project. Both baselines it
claimed reproduced exactly: **1,375 Python, 293 Swift**.

What it could not know: five of the ten phases were not complete as claimed, and
**64 defects** were waiting. Six independent reviewers, one to three phases each,
given the manifest, the exit claims as claims under audit, the tree and the
commands — and none of the implementer's narrative.

### The finding worth carrying forward

Three mechanisms verified themselves **against themselves**, all three cited as
evidence: the migration checksum was assigned from the live checksum (`x == x`),
`is_wall_clock_free` compared two identical objects, and `MIGRATIONS` is
generated from the `SCHEMA` that `drift()` checks it against. A fourth pattern —
counts pinned instead of contents — let two manifest sections be replaced by
"Steps" and "Calories" with all 293 checks green.

That is a different failure from a wrong claim. It is infrastructure built to
produce a green result, and it survives review by looking like evidence. All of
it, plus five other recurring shapes, is now in `AGENTS.md` under "Traps that
have already bitten".

### Worst defects (all repaired, all mutation-proven)

- **13**: `sign_in` verified `account` and minted the session for a separate
  caller-supplied `user_id`. `routes.py` declares that route unauthenticated —
  full account takeover once a handler filled it from a request body.
- **14**: `adopt()` produced a `DeviceTrust.PAIRED` device with no signature and
  no verifier, on the registry where `register()` raises `VerifierUnavailable`.
  The requirement it falsifies is named `nothing_is_trusted_without_a_verifier`.
- **14**: `_key_id` truncation made two device ids collide on `signing_key_id`,
  defeating the origin-device binding in `rules.py:300`.
- **15**: `confirm()` never checked `revoked`, so revoking a compromised Mac
  mid-pairing still handed the attacker a permanent new device.
- **17**: `acknowledge()` silently deleted a re-queued offline edit — the user's
  own correction, on the path the class exists for. `since(cursor)` never
  returned edits at all.
- **18**: untrusted scraped text became durable memory for a year, by three
  independent routes.
- **20**: the classifier auto-saved ambiguous captures at 0.76 against a 0.75
  floor, because `contains("my ")` matches inside "Jimmy", "academy", "enemy".
- **19**: a full Today screen could never be refreshed, and four of eight
  sections could never appear.

### Verification

| | before | after |
|---|---|---|
| Python | 1,375 | **1,437** |
| Swift (MobileCore) | 293 | **335** |

iOS simulator build clean. `schema`, `policy`, `audit`, `capability` and `sync`
checks all OK. Secret scan clean (25 reviewed findings, with
`--allowlist planning/v2/secret-scan-allowlist.json` — without it, it reports
them as unexpected).

Every repair was mutation-tested. Two nearly lied and are recorded in the report:
a Phase 15 mutation first hit the wrong `if offering.revoked:` and an *existing*
test caught it; and the Phase 18 fix is two guards, so the type invariant was
mutated out alone to prove the direct-construction tests stand on their own.

### Live and installed state

**Nothing live changed.** No plugin edit, no rebuild, no install, no gateway
restart, no config write, no account touched. `~/.openclaw` was read only.

### Not repaired, registered instead

Three items in `PHASE_GATES.json` under the review entry: MobileCore's `Message`
has no `revision` field (so the phone resolves conflicts by arrival order while
the server resolves by revision), `Throttle`'s `source_hash` is caller-declared
and needs a request pipeline to fix, and no repository checks that a referenced
row belongs to the same owner.

Two historical claims are irreconcilable and no replacement numbers were
invented: gates 14 and 15 both claim `867/867` though 831 + 36 = 867 means
Phase 14's count already included Phase 15's tests; gates 19 and 20 both claim
`103 Swift checks` on the same day though Phase 20 added 19 after Phase 19.
Neither is reconstructible — the batch is uncommitted.

### Rollback

File-level; nothing was committed. The touched files are listed in the report's
section 7. Note `git checkout` does nothing for the untracked ones (`backend/`,
`native/OrionMobile/`, most of `tests/`) — reverting those means deleting them.

### Exact next step

`REC-REVIEW-11-20` is closed. `REC-OPERATIONS` is not: the mixed-backlog
grouping plan still needs Nick's approval before anything is staged. The
inventory is done — **230 stageable paths**, not the 136 that `git status
--short` shows, because it collapses whole untracked directories into one line.
`native/OrionMobile/.build/` (2,637 files) is correctly gitignored, verified with
`git check-ignore`.

Non-v2 work is tangled in and must be separated, some of it possibly Nick's:
`VoiceProviders.swift` (+42), `orion_tts_daemon.py` (+116), `orion-doctor` (+21)
and 104 added lines across the OpenClaw plugin `src/`.

After that checkpoint: the connected-product batch, which is blocked on Nick's
provider/budget decision and the Google Cloud project in `NICK-TODO.md` item 9.
Phase 33 (Health Privacy Firewall) remains the next numbered phase and is still
not started.

## 2026-08-27 Phase 32.5 COMPLETE — capability charter and product gap review

Documentation and guidance only; no product code, live configuration, install,
restart, account connection, permission, provider choice, Phase 33 work, commit
or push occurred.

The new source of truth is
`planning/v2/PHASE_32_5_CAPABILITY_CHARTER.md`, with stable additive recovery and
capability IDs in `planning/v2/ROADMAP_AMENDMENTS.json`. It records the product
goal and direct-request authorization semantics, gives missing backend/client/
connector/authority work explicit homes, and preserves the original 0-84
numbering and manifest fingerprint. Root `CLAUDE.md` and `AGENTS.md` now route
fresh assistants through it.

The consolidated independent-review array names Phases 5-10, 21-30 and 31-32,
not 11-20. Earlier 0-10 summary wording needs Phase 0-4 review provenance
reconciled; implementation/live proof is not the same as independent review.
`REC-REVIEW-11-20` is the next
recovery item before another implementation batch. Phase 33 remains not started.

Current proof remains narrow: MobileCore passed 293 checks and compiled for the
iOS simulator using per-command `DEVELOPER_DIR`; that is not a working iPhone
UI. The new v2 backend still has no proven deployed API/database, durable
repositories, production crypto adapters, real Google transport or real
HealthKit acquisition. Existing Mac/OpenClaw capabilities predate v2 and are not
erased by those limitations. Approval reuse and missing durable authority state
remain pre-live blockers.

The existing phase checker reads the `phases` object, not the separate additive
`REC-*` register. No mechanical enforcement of those checkpoints is claimed.
The charter now specifies the backend/client/read-only integration sequence, UI
acceptance brief, direct-request authorization examples and a mixed-backlog
recovery plan. Future requested batches end with independent review, repairs,
an educational report and authorized local commits; no remote push is implied.
Roll back by removing the three new repository files and only their added
pointers/sections; preserve earlier edits in the dirty tree. Nothing live needs
rollback.

Completed verification after the initial documentation task hit its usage limit:
**10 focused phase/traceability tests passed**, Phase 32's gate passed, document
consistency/fingerprint/link checks passed, and the changed-doc whitespace check
passed. Phase 33 remains unopened, the index is empty and HEAD is unchanged.
See the v2 handoff for reproducible commands. Claude's read path is linked;
an already-running context still needs to explicitly refresh it.

## 2026-08-27 Phases 31-32 COMPLETE — health baselines and derived states, then reviewed

Two phases, then a third independent review. Stopping here at Nick's instruction.

**Dates, corrected before you read this.** The Phase 31 plan was written on
2026-08-26; everything else here -- the review of 21-30, all 36 repairs, both
of Phases 31 and 32, and the review of them -- happened on **2026-08-27**. The
first draft of this entry and the gate records said the 26th, because the
session opened on the 25th and I carried that date forward instead of running
`date`. That is the trap `AGENTS.md` records verbatim, and it caught me. All
affected records are corrected.

### What was built

**Phase 31 — Health Baseline Engine** (`MobileCore/HealthBaseline.swift`). Six
personal baselines, computed locally. Below seven observations there is **no**
baseline — `nil`, not a low-confidence number. Median and MAD throughout, so one
two-hour night after a flight does not move anything. **There is no population
table**: the usual implementation of "do not compare users against generic
population scores" is a fallback, which then gets used every time the personal
baseline is missing — exactly when the comparison is least useful and most likely
to be believed.

**Phase 32 — ORION Health State** (`MobileCore/HealthState.swift`). Six derived
states, all categories, no scores. `reason`, `baseline`, `confidence` and
`freshness` are required — the initialiser is failable and an empty reason
returns nil. "Not a diagnosis" is enforced by a 23-stem clinical word list run
over **ORION's own** vocabulary, values and reasons both. A state that cannot
spell a diagnosis cannot deliver one.

### The review, and what it found

**Verdict: 31 complete with one requirement untrue as written; 32 not complete as
claimed.** Eleven corrections, each mutation-tested.

**A crash.** `trainingLoad` had no `isFinite` filter — unlike `baseline()`
twenty lines above it — so an infinite sample made acute and chronic both
infinite, `chronic > 0` passed, and the ratio was NaN. Phase 32's
`Int((ratio * 100).rounded())` then trapped. The requirement's own sentence says
it: *"a division that can produce a special value is a division that will."*

**A defect that inverted the rule both phases are built around.** The gate said
"values **and spreads** are quantised", which was true and was the bug. A person
sleeping 466–494 minutes has a real spread of 14; quantised at low confidence it
reported **0**, the consumer's `max(spread, 1)` floor made that one minute, and a
fifteen-minute difference became `wellBelowBaseline`. That fabricates
*certainty* — the same sin as fabricating precision, pointed the other way, in
the phase written to prevent it. The spread is no longer quantised;
`reportedSpread` is for display and `comparisonSpread` floors on the kind's own
finest step rather than a bare `1`, because one bpm and one step are not
comparable quantities.

**The structural finding, which is the useful one.** 23 of 42 Phase 32 guards
survived mutation — the whole of `energyState` (hardwiring `.high` went
unnoticed), `stressTrend`'s direction, all four divide-by-zero floors. The cause
was named exactly: **no Phase 32 assertion consumed a Phase 31-produced
`Baseline`.** Every fixture was hand-built with a hand-chosen spread, so nothing
exercised what the engine actually emits — which is also why the quantised-spread
defect was invisible. Forty-one assertions now run over real baselines.

**And a fixture that lied.** The check hedged `acuteSamples == 8 || == 7`. That
OR was covering an off-by-one whose real cause was that the most recent fixture
night *ended seven hours after `now`* — so "twenty sessions" contributed
nineteen, and a baseline made entirely of future-dated samples read as perfectly
fresh. Both the code and every fixture are fixed and the hedge is an equality.

### Three reviews, three times the same lesson

| Review | Scope | Verdict |
|---|---|---|
| 2026-08-25 | Phases 5-10 | 3 not complete as claimed |
| 2026-08-26 | Phases 21-30 | 5 not complete as claimed |
| 2026-08-26 | Phases 31-32 | 1 not complete as claimed, 1 with a false requirement |

Every one has found claims **false at the moment they were written** rather than
code that drifted: a cited test that did not exist, a count that was wrong, a
guard tested for "without either" while claiming "without both". The gate prose
is written by whoever did the work and nothing checks it, which is the whole
reason this ritual exists.

### Verification

| | before this session | now |
|---|---|---|
| Python | 925 | **1,375** |
| Swift checks (MobileCore) | 103 | **293** |
| native/Orion XCTest | 318 | **318** (untouched) |
| Plugin | 146 | **146** (untouched) |

iOS simulator build clean, import boundaries clean, secret scan clean.

### Live and installed state

**Nothing live changed, at any point.** No plugin edit, no rebuild, no install,
no gateway restart, no config write, no live smoke, no Anthropic spend. Nothing
committed; HEAD is still `1efd37c`.

### Rollback

Delete `MobileCore/{HealthBaseline,HealthState}.swift` and
`planning/v2/PHASE_3{1,2}_PLAN.md`, revert the health-baseline and health-state
blocks in `MobileCoreCheck/main.swift`, and the 31-32 blocks in
`PHASE_GATES.json`, `MANIFEST_PHASES.json` and `MANIFEST_TRACEABILITY.md`.

### Next

**Phase 33 — Health Privacy Firewall.** It must pass DERIVED states to the
planner and never a `Baseline`: a Baseline still carries a raw value and a unit,
which is exactly what the firewall exists to stop reaching the planner. Phase 32
already produces the right shape.

Two things ahead of it in importance, neither of them a phase:

1. **An approval is still not consumed by use** (Phases 25 and 29). The same
   approved preview authorises the same action indefinitely, so a retry loop
   becomes a mailing. This should close before any transport exists.
2. **Nothing persists.** Authorization ledgers, baselines, tasks, classifications
   — all in memory. Several rules (incremental permission requests especially)
   are not real until they survive a restart.

`NICK-TODO.md` items 2 and 10 are one purchase: the Apple Developer Program
unlocks both the Keychain fix and the HealthKit entitlement, without which none
of Phases 30-32 can read a single sample.

## 2026-08-27 Independent review of Phases 21-30 — five phases were not complete as claimed

Ran 2026-08-26, repairs applied 2026-08-27. Three oblivious agents were given
the manifest, the repo and the commands, and
told to verify claims rather than trust them. They ran ~190 mutations, fuzzed the
planner over 400 random populations, and attacked both approval fingerprints and
the reply-addressing path directly.

**Verdict: 23, 24, 26, 28 and 30 were not complete as claimed.** 36 corrections
applied, each mutation-tested. Python **1375/1375** (was 1322), Swift **152**
(was 140).

### The one that is not a code defect, and matters most

**Phase 26's gate cited evidence that did not exist.** It claimed the URL encoder
was "differential-tested against `quote` on 3,000 random strings". That run
happened — in a shell, in a session that no longer exists — and the repository
contained nine hard-coded cases. The conclusion was right; the reviewer re-ran it
at 5,000 strings and found zero mismatches. But evidence nobody can re-run is not
evidence, and this program's gate prose is written by whoever did the work with
nothing checking it. The test now exists and is seeded.

This is the second review in a row to find claims that were **false at the moment
they were written**, rather than code that drifted.

### The two real bugs

**`plan()` dropped a task whose dependency was in the plan** and told the person
*"waits on a_dep, which is not in this plan"* — while a_dep was right there.
`sort_key` is not topological and `placed_ids` was built in its order. **227 of
400** random populations. The original test missed it by luck: its two objects
had equal durations, so the id tiebreak ordered them correctly. Fixed with Kahn's
algorithm taking the sort_key-smallest ready object, so determinism survives.

**`replan()` deleted an already-placed task from the day after a thirty-minute
meeting** — with eleven free hours in the window. Kept placements went to the
sub-plan as opaque time blockers and never as settled ids, so a dependent of a
kept object was reported BLOCKED and vanished. **20 of 400.** This is the exact
failure the manifest's "avoid reshuffling the user's day" exists to prevent.

### Guards attached to the wrong thing

A pattern across three phases: the guard existed, was mutation-tested, and was
attached to a *function* while the *type* stayed reachable.

- `ReplyContext` was a public dataclass, so
  `ReplyContext(permitted={"attacker@evil.example"})` was three lines and the
  whole "recipients come from headers" property evaporated.
- `revise()` cleared a draft's review; `dataclasses.replace` — the same API
  `revise()` itself calls, and the only way to change recipients — did not.
- Every `Preview` invariant lived in the `preview()` function, so a hand-built
  one could claim a DELETE was undoable.

All three now hold on the type. The draft's review is bound to a fingerprint of
its content, so any path that changes what was read invalidates it.

### The approval that ORION could grant itself

Phase 29's every enumerated requirement was literally true while ORION reviewed
its own draft, approved it as `granted_by="orion"`, and the audit recorded
`actor: "user"`. Nothing checked a person was involved. `require_person` now
refuses system actor names and requires both reviewer and approver to be the
account holder.

### Things that were quietly not what they looked like

- **U+212A KELVIN SIGN lowercases to ASCII "k"**, so `nic\u212a@example.com` in a
  `From` header folded into the permitted set as `nick@example.com` — a real
  third party who was never on the message. `egress.py` names this exact trick in
  its own comments.
- **`json.dumps(ensure_ascii=True)` escapes an astral character as a surrogate
  pair**, so a lone-surrogate string hashed identically to the real one — a
  collision in both approval fingerprints, reaching the recipient field.
- **`$` also matches before a trailing newline in Python**, so `"abc\n"` passed
  `ID_PATTERN` and reached a URL unencoded.
- **`LABEL_PATTERN` admitted 128 characters of hyphen-joined prose**, and nothing
  capped the label count: ~5KB of injection text went into the type whose whole
  purpose is having nowhere to put text.
- **`applies_to` never read `self.scope`** — a constant function of its argument.
- **Swift's `HealthSample` not being Codable** prevents only the *synthesised*
  encoder. A reviewer exfiltrated one four ways, including
  `extension HealthSample: @retroactive Encodable` in another module, which the
  in-process assertion cannot see. Restated rather than repaired: Swift has no
  way to prevent that.

### Eight repairs had no test that bit

Every fix was mutation-tested. Eight passed with the fix removed and were
reworked; two of those needed the scenario rebuilt because something else was
masking the branch — in one case the *cost* check refused a move before the
dependency guard was reached, so the guard was never exercised.

### Live and installed state

Unchanged. Nothing committed, nothing deployed, no spend. HEAD is still
`1efd37c`.

### Next

**Phase 31 — Health Baseline Engine.** `planning/v2/PHASE_31_PLAN.md` is written
and the implementation is drafted but not yet in the tree; it goes in
`native/OrionMobile/Sources/MobileCore/HealthBaseline.swift`.

The highest-priority follow-up is not a phase: **an approval is still not
consumed by use**, in Phases 25 and 29 both. The same approved preview authorises
the same action indefinitely, so a retry loop becomes a mailing. That should
close before any transport exists.

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
  `--allowlist planning/v2/secret-scan-allowlist.json` it says clean. My
  invocation, not a regression.
- `native/Orion` tests need `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer`.
  The 22:15 correction already says why; the test command in isolation does not.

### What was built

| Phase | Where | The rule that carries it |
|---|---|---|
| 21 Task System | `backend/tasks/` | Blocked is derived from the graph, never stored; a learned estimate cannot be recorded as a measurement |
| 22 Calendar Read | `backend/connectors/`, `backend/calendar/` | A webhook `Notification` has no field an event could live in; incremental absence is never deletion |
| 23 Planner v1 | `backend/planning/` | Determinism proven by shuffling; a `Suggestion` has no method that applies it |
| 24 Schedule Stability | `backend/planning/stability.py` | Moving something prices *disturbing a decision*, so a planner's own fallback is cheap to correct |
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
`backend/planning/`, `backend/gmail/`, the seven new `tests/test_v2_*` files
(`task_system`, `calendar_read`, `planner`, `calendar_writes`, `gmail_read`,
`action_inbox`, `gmail_write`), `native/OrionMobile/Sources/MobileCore/Health.swift`,
and `planning/v2/PHASE_{21..30}_PLAN.md`. Revert `Deferred.swift` and the health
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
history. So `planning/v2/sync-ordering-vectors.json` holds six cases whose
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
`planning/v2/sync-ordering-vectors.json`, the three new test files, and revert the
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

So the suite is paired with `planning/v2/SECURITY_INVARIANTS.json`. Every
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
`planning/v2/SECURITY_INVARIANTS.json`, revert the `device` argument on
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
  `--allowlist planning/v2/secret-scan-allowlist.json` it reports 4 "unexpected"
  findings that are the 4 reviewed synthetic fixtures. Not a regression; the earlier
  "secret scan clean" results were run correctly. Worth knowing before anyone
  concludes a credential landed in the tree at 01:00.
- `planning/v2/MANIFEST_TRACEABILITY.md` still says "Phase 2 in progress" — it has
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
and revert the Phase 5 block in `planning/v2/PHASE_GATES.json`. Nothing else refers
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

## 2026-08-23 ORION v2 Phase 4 COMPLETE — Tool Contracts

**78 live actions** — not the 59 an early grep reported; regex-parsing
`catalog.ts` leaked fields between entries, and the compiled catalog is the only
reliable source — now each map onto a structured contract declaring all nine
fields the manifest asks for.

### Nothing was renamed, on purpose

The manifest wants `calendar.events.read`; ORION has
`desktop_file_write_explicit`. Those flat names live in the model's tool
description, in 1000+ ledger rows, in the approval hashes that gate a
`needs_approval` re-call, and in the self-tuning surfaces. Renaming 78 of them
would break all of that for a cosmetic gain, so the registry maps flat onto
dotted and `catalog.ts` stays the implementation.

### The unblock that mattered

**Every capability now names a context domain.** That is precisely what Phase 3's
firewall was waiting on — the isolation matrix existed but could not be applied
to a real request, because nothing said which domain an action belonged to.
`registry.domain_of("desktop_list")` now answers `files`.

### Two things the work caught

- **A name collision.** `desktop_list` and `home_list` both reduced to
  `files.list`. The validator refused it rather than letting two capabilities
  answer to one name.
- **Tier is not domain, and I had conflated them.** The read-only `self_*`
  actions are tiered `desktop_read`, because reading Orion's own source is gated
  like reading the Desktop. Sensible gating, terrible domain proxy — it put
  `self_plugin_read` in `files` when what it reads is Orion's own authority code.
  Tier says how it is gated; domain says what it is about. All 18 `self_*`
  actions are now `security`.

### Strict arguments: real, wired, default off, and partial

`enableStrictArguments` rejects arguments an action does not accept — the fix for
the 2026-08-20 hole that forced the v2 bridge to fail open. Wired through the
**authoritative** controller validation, not just the entry point's evidence
copy; wiring only the latter would have been a setting that looks live and
changes nothing.

**It covers 17 of 78 actions.** The other 61 have hand-written validators
accepting optional keys declared nowhere machine-readable — rejecting there would
break working calls on a guess. Recorded as a limitation with the exact remaining
work: audit 61 validators, add an `optionalArguments` declaration. The 17 include
`system_status`, the action whose behaviour forced the Phase 2 compromise.

### Verification

Python **404/404**, plugin **146/146**, Core firewall 3/3, capability check and
model contract check agree, secret scan clean, doctor all clear. Plugin rebuilt
and installed, gateway restarted, live smoke `orion-74baa26cf680bd8b` unchanged
with the flag off.

### Next

Phase 5, the Policy Engine, in a fresh context. Expect the same shape a fourth
time: `validator.ts` already returns ready/needs_approval/rejected — ALLOW /
REQUIRE_APPROVAL / DENY under other names — and `permissions.ts` has five
profiles. The gaps are the R0-R5 risk vocabulary against today's four levels,
several evaluation inputs that only become meaningful once remote access exists,
and the fact that validation, permission profiles and the taint check are three
places where the manifest asks for one engine.

## 2026-08-23 ORION v2 Phase 3 COMPLETE — the Context Firewall

### The finding that shaped it

The manifest's requirement list split in two, and only half was missing.
**Least-context already existed** — selective recall, cache-ttl pruning,
one-result defaults — it just was not *visible*, and a decision nobody records
cannot be audited later. **Domain isolation did not exist at all.** Nothing
labelled context with a domain, so "health context must not reach an email task"
was unenforceable rather than unenforced. You cannot write a rule about a
property nothing records.

### Built

Twelve domains, six provenance categories, the nine sources the manifest calls
untrusted, a default-deny cross-domain matrix, and a `ContextBuilder` that
enforces it and writes down what it refused. `ContextEntry` gained domain,
provenance and confidence — all required, because an entry that does not say what
it is about would be admitted by any policy that reasons about domains.

Provenance sits *alongside* the existing trust levels rather than replacing them:
trust answers "may this authorize an action", provenance answers "where did this
come from and how much should it be believed".

### Three decisions worth remembering

- **An unrecognised source is `external_untrusted`, not `general`.** A new
  integration nobody classified must arrive untrusted, or forgetting to think
  about a source silently grants it credibility.
- **Health and security are sealed** to themselves plus `general`. A security
  decision that can be argued from an email is not a security decision.
- **Credentials are refused twice** — the entry constructor will not build one,
  and the builder raises if one arrives anyway. Two layers, because a subclass or
  a future refactor can slip past the first.

### The limitation, stated plainly

**Nothing passes through this firewall yet.** OpenClaw still assembles context
for agent turns exactly as before. A firewall nothing passes through protects
nothing, and this entry must not later be read as evidence that it does.

The deferral is deliberate: deciding which domain each capability belongs to is
the tool registry's job, and that is Phase 4. Recorded as a `limitation` in
`PHASE_GATES.json` so it cannot quietly disappear.

### Verification

Python **381/381** (was 348), Core import firewall 3/3, gate/authority/inventory/
secret-scan/contract-drift all clean. **Nothing live changed** — no config write,
no restart, no rebuild; v2 flag still false, Orion untouched.

### Next

Phases 4 and 5, in a fresh context. Phase 4 is the tool registry, and
`openclaw-plugins/orion-control/src/catalog.ts` already does most of it — the
gaps are flat names instead of dotted ones, argument *lists* instead of schemas,
no output schemas, no unknown-argument rejection, and no domain per capability.
That last one is what Phase 3's integration is waiting on.

## 2026-08-23 ORION v2 Phase 2 COMPLETE — the model router

All seven slices. Every ORION surface that performs inference now resolves its
model through one contract and writes rows to one ledger. Phase 2 closed against
its plan's six exit criteria.

### What actually changed for Orion

**A model is now a config edit, not a rebuild.** `LocalModel` and
`DeepgramSpeech` used to carry their model as a compiled-in `static let`. Both
now read `~/.openclaw/orion-controlled/model-roles.json` at runtime, failing soft
to the old constant. Trying a different transcriber costs one line in one file
instead of a rebuild, a re-sign, and a reinstall.

**Both voice credentials left plaintext.** `ORION ElevenLabs` and `ORION Deepgram`
now live in the login Keychain, seeded through Phase 0's seeder (its `add()` goes
via the Security framework, so the secret never touches a process argument list).
The Swift app and the TTS daemon each gained a Keychain lookup positioned between
environment and `.env`, which makes a migration a no-op switch — seed the item,
and the consumer prefers it with no other change. Plaintext lines came out only
after the new source was proven, `.env` backed up first.

**There is a cost ledger where there was none.** 1270 rows normalized from
OpenClaw's own session records — ORION reads what OpenClaw already writes rather
than intercepting its calls. reasoning 956 calls at **$6.7151**, fast 245, local
69, 138 fallbacks fired, 9 failures, median latency 1763 ms. OpenClaw had
reported **$0.00 for every one of those calls**.

App rebuilt as 1.2.0 build 121, identity check passed, installed and running.

### Three times something caught me being wrong

- **The credential migration broke `orion-doctor`**, which began reporting
  `ELEVENLABS_API_KEY not set` while the key sat in the Keychain working fine. A
  diagnostic that is wrong about a working system is worse than the gap it
  watches. `key_source()` now checks environment → Keychain → `.env`, the same
  order every consumer uses, and names which one answered.
- **The drift check failed the moment I changed the Swift constants** — its probe
  was reading a pattern that no longer existed. It now checks the *fallback*
  constants: the live value is the contract's by construction, so checking it
  would be circular, but the fallback is what runs when the contract is missing.
- **A gate test refused a deviation record I had stamped with Nick's name.** He
  approved the router placement; he was never asked whether the role list could
  depart from the manifest. It is now `recorded_pending_review` and queued for the
  amendment sweep rather than carrying an approval he never gave.

### Also worth knowing

`plaintext_providers()` reports what the contract *declares*, which can be true
while a stale copy sits on disk. A separate check now reports leftovers, and
currently flags `ANTHROPIC_API_KEY` in `.env` — reviewed and kept by Phase 0, but
previously invisible to the contract.

### Verification

Python **348/348**, native **318/318**, plugin **144/144**, Core import firewall
3/3, all 9 contract bindings agree, secret scan clean, inventory current, doctor
all clear, signing identity unchanged.

### Next

Phase 3, the Context Firewall. Expect the Phase 2 shape again: much exists
already (`HarnessProvenance` and `authorizeTaskGraph` mint trust from the real
user turn; conditional recall implements least-context), and the real gap is
domain classification — nothing today stops health context reaching an email
task, because nothing labels context by domain at all.

## 2026-08-20 → 08-23 ORION v2 Phase 2 — slices 1-3 (superseded by the entry above)

*Two days. Phase 2 opened and slice 1 landed on 08-20; slices 2 and 3, and the
discovery below about the repository, landed on 08-23.*

Same day, second pass. Nothing live was touched: no gateway restart, no config
change, no paid smoke, no rebuild. The v2 system_status flag is still `false`.

### Two decisions recorded before any code

**Phase 1's gate deviation is accepted**, stamped with Nick's name and the date
in `PHASE_GATES.json`, under the reading that "runs through Core" means the live
route honors Core's contracts — not that Core's code executes the work. A test
now fails if an accepted deviation ever loses its acceptance fields.

Amending the manifest text was deliberately deferred. `PHASE_GATES.json` gained a
`pendingGateAmendments` block holding the proposed replacement wording, with a
rule attached: never silently reinterpret a gate. Record it, keep working under a
recorded deviation, and amend them all together in one pass Nick reads end to
end. Better than bending one gate at a time under time pressure.

### The finding that shaped Phase 2

ORION does not lack a model router. It has **two**, and **three surfaces that
route themselves**: OpenClaw (live), `orion/runtime.py` (has roles, usage
recording, cost estimation, a $15 budget — and is a dead process),
`LocalModel.swift` (hardcoded constant), `DeepgramSpeech.swift`
(`static let model = "nova-3"`), and the TTS daemon. Building a third was
rejected — it adds a hop per turn, which the 2026-08-16 latency decision above
explicitly refused.

Nick chose: **OpenClaw executes, ORION owns the contract.** One role→model
document everything reads, one telemetry ledger everything writes to, no second
inference path.

And the real gap is not role names. OpenClaw already records model, provider and
full token counts per turn. Of the six fields the manifest says to track, **four
are missing**: latency (a timestamp is not a duration), estimated cost (the field
exists and is always `0`), failure reason, and fallback usage. Separately,
`DEEPGRAM_API_KEY` and `ELEVENLABS_API_KEY` are still plaintext in `.env` and
read directly — the only manifest requirement currently answered *false*.

### Delivered

`planning/v2/PHASE_2_PLAN.md` — every manifest bullet derived, mapped against
what already exists, and split into seven test-gated slices with exit criteria.

Slice 1 complete: the role contract. Language-neutral JSON Schema, a Python
reference validator with strict fields and bounded numbers, refs checked against
declared providers, a chain that cannot list the same model twice (retrying the
same model looks like resilience and is not), and an unassigned role that refuses
to resolve rather than quietly substituting a different model. A secret-walker
rejects secret-shaped values and field names anywhere in the document.

### Verification

- Full Python **285/285** (was 267; +16 contract tests, +2 gate-acceptance tests)
- Core import firewall 3/3 — the new module imports only `re`, `dataclasses`, `typing`
- Phase 0/1 gate tests 42/42

### Direction confirmed, and new scope registered

Nick confirmed the placement afterward and added the intent: *OpenClaw executes;
Orion owns abstract roles so routing can be swapped later if we outgrow
OpenClaw.* Read as **A now, B later, and A is what makes B cheap** — a
requirement on how this is built, not a footnote.

One schema change followed. The inference record now separates `source` (which
ORION surface ran it: agent / native_app / tts_daemon / script) from `executor`
(who routed it: openclaw / orion_router / direct). Collapsing them would mean a
future swap re-labels every historical row. Kept apart, the ledger is its own
migration proof — rows stop saying `openclaw` and start saying `orion_router`.

He also raised **texting** and **smart home**. Neither appears anywhere in the
manifest's 85 phases (nearest: PHASE 65, App Intents and System Integration),
and texting is already partly live ahead of the document. **Neither is a model
role** — they are tool capabilities, so they are not Phase 2 work. Both are
registered in `PHASE_GATES.json` under a new `scopeNotInManifest` block, same
discipline as `pendingGateAmendments`: record it rather than refusing it or
building outside the requirements source.

### Slices 2 and 3 — 2026-08-23

**Slice 2, the inference ledger.** Reference validator plus 22 tests. A row
carries the four fields OpenClaw does not record — latency, real estimated cost,
failure reason, fallback usage — and refuses to be dishonest: an absent token
count stays `null` rather than becoming `0`, a failure must say why, and a row
claiming a fallback fired must name what it fell back from. `estimate_cost`
returns `None` when a role declares no rates, kept distinct from `0.0`, because
"cannot price this" and "priced it, it was free" are different answers and
collapsing them would hide OpenClaw's all-zero cost bug forever.

`assert_carries_no_transcript` is the load-bearing part. A cost ledger is exactly
the file that grows a "first 200 characters of the prompt, for debugging" field
and quietly becomes a conversation log. It rejects conversational field names and
any string over 256 characters, on the way in *and* on the way out. One of its
tests was passing vacuously; that was found and fixed rather than left green.

**Slice 3, the drift check.** `planning/v2/model-roles.seed.json` is the first
real contract, derived from live values rather than invented, and
`scripts/orion_v2_model_contract_check.py` reads live config plus the source
files that still hardcode a model and reports every disagreement. **All 9
bindings currently agree.** Read-only: it never writes config or restarts
anything.

The schema gained an `env_plaintext` credential source — not an endorsement, but
so the contract can state an ugly truth instead of claiming a Keychain reference
that does not exist. `plaintext_providers()` turns "never give models
credentials" from a sentence into an assertion, and it currently returns
`("deepgram", "elevenlabs")`. Slice 5 is done when it returns empty.

### The repo moved under this session — noticed 2026-08-23

**Nick committed and pushed the whole project to GitHub mid-session** — commits
authored by him, not an agent, dated 2026-08-20 17:36 and 17:38 UTC, found on
2026-08-23. HEAD moved `1169e5b` -> `1efd37c`, the
checkout is now on `main`, and `origin` exists for the first time:
`https://github.com/NickMadaio/orion.git`, **private**.

Checked, because a first push is when credentials escape: `.env`, `.env.save`
and the `.builds/openclaw.json.*` backups are untracked and did not go up, and
the full tree-plus-history secret scan is clean — 16 findings, all four synthetic
fixtures already reviewed. The count doubled from 08-20's 8 purely because
`rev-list --all` now sees two more commits containing the same fixtures; that is
written into `planning/v2/HANDOFF.md` so nobody re-investigates it.

This resolves **NICK-TODO item 3**. The updater's feed URL is still a
placeholder, so an appcast and one release remain — but that needs no account
work now.

### Next

Slice 4, agent-path telemetry. Its schema is written but has **no validator and
no tests yet** — finish that first; a schema with no consumer is not a milestone.
It needs a redaction test that fails if prompt text can reach a row: this machine
holds health and financial data, and a cost ledger that quietly became a
transcript would be a privacy regression.

Slices 5 and 6 carry real cost and must be announced before starting — slice 5
moves live credentials, slice 6 rebuilds the app, and installing that build costs
~15 Keychain dialogs.

## 2026-08-20 ORION v2 Phase 1 closed — DONE + LIVE VERIFIED

Picked up a Codex session that ran out of credits mid-verification on 08-19 at
22:47:09Z. Nothing was committed or pushed; the dirty worktree was preserved.

### What the handoff did not say

Codex wrote `AGENTS.md` and `planning/v2/HANDOFF.md` at 18:32, then **kept
working for another fifteen minutes**. Those files listed as the "next
coordinated slice" work that was already built, tested, installed, and proven
live. Reconstructed from `~/.codex/sessions/2026/08/19/rollout-*.jsonl` (the
auto-review thread carries the main agent's full tool log),
`~/.openclaw/logs/config-audit.jsonl`, the archived task ledger, and file mtimes.
That lesson is now a written rule — see "Relay protocol" in `AGENTS.md`.

Already done when I arrived: the TypeScript v2 contracts and `system_status`
bridge, the default-off `enableV2SystemStatusAdapter` flag, 142/142 plugin tests,
generated-and-validated plugin metadata, installation into
`~/.openclaw/extensions/orion-control`, and three live smokes including a
flag-on run and a rollback. The rollback smoke's result was never read.

### The bug that made it worth re-opening

The bridge could refuse a call the legacy route accepts. `system_status` declares
`requiredArguments: []` and the validator rejects no unknown key, so
`{"action":"system_status","arguments":{"verbose":true}}` succeeds normally. With
the flag on it threw out of the tool before `runLegacy()` ran — nothing wrapped
the call site. Output drift had the same shape, throwing *after* the ledger row
was written.

Fixed by making the bridge an observer, never a gate: every strict check is kept,
but a failure records `contractError` in non-enumerable evidence, warns through
the host logger, and returns the legacy record untouched. A contract experiment
must not be able to stop Orion from answering a question. The new host-seam test
fails against the old adapter and passes against the new one.

### Verification

- ORION Control 144/144 (was 142; +2 fail-open cases), `tsc --noEmit` clean,
  `openclaw plugins build` + `validate` clean, installed copy byte-identical.
- Full Python 267/267. Native SessionDomain/SessionService 318/318.
  One Python run out of six failed with a single unnamed failure and did not
  reproduce across five reruns, one of them under concurrent load. The suite
  has deliberately timing-sensitive TTS deadline tests and no Python behavior
  changed here, so it reads as a load flake — flagging it rather than
  rounding it off.
- Phase 0 gate open, authority current at 158 capabilities, secret inventory
  current, working-tree + history secret scan clean (8 allowlisted), live
  SecretRef audit clean (3 refs, 0 findings).
- `orion-doctor`: all clear. One pre-existing warning — the TTS daemon was not
  resident for the status probe, same as on 08-19.
- Live: flag-off `orion-6c7fb0773e41c616`, flag-on `orion-26e75dcb764d3884`,
  rollback `orion-27f07824fc7291f8`. The flag-off and flag-on ledger rows are
  structurally identical, with no `schema_version`, `proposal_id`, or
  `contractError` anywhere in the row. That parity comparison is the durable
  evidence the 08-19 session never got to capture.

### Phase 1 is closed, with a deviation on the record

Closed against `PHASE_1_PLAN.md`'s five exit criteria, all met. It is **not**
closed against the manifest's literal gate ("Existing desktop ORION must run
through ORION Core") — nothing runs through Core; one read-only capability is
observed behind a default-off flag. `PHASE_GATES.json` carries that deviation in
machine-readable form and a test asserts it stays there, so Phase 2 cannot
inherit it quietly. Whoever opens Phase 2 accepts that reading in writing or
widens the bridge first.

### Live state and rollback

Flag `false`, gateway healthy on 127.0.0.1:18789, Orion.app running on the stable
signing identity. No Swift changed; no bundle rebuilt or installed.

Rollback is the flag alone — no state migration. Deeper undo:
`.builds/openclaw.json.pre-v2-flag-20260820` and
`.builds/orion-control-installed-pre-failopen-20260820/`. Both in the repo, not
`/private/tmp`, where 08-19 left its only copy — that path does not survive a
reboot.

## 2026-08-16 token-efficiency and selective-recall pass — DONE + LIVE

- Root cause confirmed in the live app session: `orion-app-v2` had reached
  42,923 tokens and was carrying old tool results forward. It was rotated with
  the supported `sessions.reset` RPC, which archived the full transcript and
  created fresh session `c4672a63-19f3-463c-a00e-5aad48a366de` at 0 tokens.
- Live policy now uses a 45-minute real-idle reset, `continuation-skip` bootstrap
  injection, and cache-TTL context pruning. The newest three assistant turns are
  preserved; old large tool results are shortened or replaced in model context,
  while stored transcripts remain intact.
- Past user/assistant conversations are indexed with local Ollama embeddings.
  The valid index contains 271 session files / 482 session chunks plus the
  existing memory and Brain sources. Session visibility is same-agent only.
- Recall is conditional: self-contained requests do not trigger history search.
  Continuity cues or relevant uncertainty use 3–8 keywords and one best result.
  `orion-recall` searches extra local candidates, filters diagnostic/probe/smoke
  session noise unless explicitly requested, and returns one match by default.
- The normal `orion-doctor` no longer makes a paid agent turn. Use
  `orion-doctor --live-agent` only when an end-to-end cloud-model proof is
  intentionally needed. Its normal no-cloud run reported all clear.
- Routing decision: keep Haiku as the single conversational/tool orchestrator
  for now; do not add a local-model classification hop to every utterance. Local
  embeddings handle recall selection, maintained fast routes handle known tools,
  and the cloud model reasons only after relevant context/tool schemas are
  selected. This preserves the Jarvis response feel while removing repeated
  context rather than adding another latency-producing model call.
- Verification: full Python suite 218/218; focused recall regression 2/2; live
  config validation, local index build, recall proof, app/gateway/voice/signing
  doctor checks, and archive-preserving session rotation passed.
- Rollback config:
  `.builds/openclaw.json.pre-token-efficiency-20260816`. Extra transcript copy:
  `.builds/orion-app-v2-pre-token-efficiency-20260816.jsonl`.

## 2026-08-14 full diagnostic and capability pass — DONE + LIVE VERIFIED

This section supersedes older counts and loose ends below. The dirty worktree was
preserved; nothing was reset, committed, or pushed.

### Automatic episodic learning

- Added deterministic, zero-model-call capture of high-signal user preferences,
  corrections, and durable decisions. Questions and likely secrets are skipped;
  repeated facts are deduplicated.
- Enabled the conversation hook explicitly with
  `plugins.entries.orion-control.hooks.allowConversationAccess=true`.
- Live proof: a normal Orion turn wrote an `[auto]` project decision into
  `~/.openclaw/workspace/memory/2026-08-14.md` without an `orion-remember` call.
- Refreshed the memory index after adding the episode and the Brain architecture
  note. The architecture is layered: compact working context, episodic stream,
  semantic memory, procedural memory, selective retrieval, and consolidation.

### Token and loop control

- Added a runtime repeat guard: block the third identical consecutive tool call
  or fifth identical call anywhere in a turn; reset at `agent_end`.
- `orion-learn` now identifies typed-action-vs-shell routing mistakes and no
  longer suggests unsafe allowlist expansion. It found historical loops totaling
  about 2.41M tokens across five loops in three sessions.
- Compacted startup instructions and moved detail into routed Brain/playbook
  material. All 25 skills remain available.
- System prompt measured 44,672 -> about 34,635 characters (-22.5%). A comparable
  normal service turn measured 17,617 -> 12,272 (-30.3%).
- Related actions are now batched in one TaskGraph. The host accepts concise
  `{steps:[{action,arguments}]}` input, normalizes step IDs/arguments, and keeps
  the same safety gates. Fixed missing default home-root propagation and added
  default `.` paths for Desktop/Home listing.

### Capabilities and live service checks

- Live authority map: 157 cataloged entries — 99 AUTO, 14 NOTIFY, 13 APPROVAL,
  and 31 INTERNAL/OFF wrapper commands. The 31 are not 31 missing user features;
  their supported typed routes remain available. Fixed the spoken report so it
  now explains this instead of silently omitting the internal group.
- Normal-agent-route reads passed: Gmail, Calendar, Apple Reminders, Messages,
  Apple Contacts status, browser, Desktop, home folder, Orion reminders, health,
  system status, self-plugin, and self-repair.
- Apple Contacts is the contact source for texting. The new contact diagnostic
  reports only counts, not names/numbers. Message reads returned normally.
- Added typed `calendar_event_add`, approval-gated `calendar_event_remove`, and
  `apple_reminder_add`. The old agenda wrapper is read-only; mutations go through
  an argv-only, EventKit-verified wrapper.
- Gmail sending was intentionally not expanded. Real outbound Messages, Calendar
  writes/deletes, and Reminder creation were not fired during diagnostics because
  that would create/send real user data without a specific request. Their typed
  routes and gates are covered by tests.

### Data safety, native app, and scheduler

- Health schema is now v3 and forward-safe: unknown fields survive, corrupt/future
  files are refused, and Swift/Node writers lock correctly. Race proof: unlocked
  lost 1245/5516 updates; locked lost 0/2004, refused 0/0.
- Manifest/runtime config parity is exact at 43 keys. Native Capabilities covers
  all 24 live boolean switches.
- Installed Orion.app rebuilt, signed by `Orion Local Signing`, and passed strict
  deep signature verification. Doctor confirms gateway, live agent turn, warm
  voice service, cloud TTS, Deepgram STT, app bundle, and running process.
- Exactly three OpenClaw jobs remain: focus guard, standing orders, daily memory.
  All are enabled and last status is OK. The duplicate LaunchAgent was retired to
  a recoverable backup and setup will not recreate it.

### Verification

- Orion Control plugin: 134/134 tests.
- Native session/domain suite: 287/287 tests.
- Capability harness: 24/24; watchdog: 15/15; layout/focus UI/MacBridge/health
  race checks passed; script syntax checks passed.
- Installed plugin dist matches the tested repo dist; manifest matches; plugin
  doctor reports no issues; episodic capture and strict inline exec parsing are
  live-enabled.

### Remaining explicit decisions / limitations

- Deep security audit is 1 critical / 3 warnings / 2 info. The static critical is
  the scanner seeing Node `child_process` in `executors.js`; source review confirms
  fixed Orion wrappers are launched with argv and no `shell:` option. Keep reviewing
  any future executor additions, but do not remove the controlled-wrapper system.
- `gateway.trustedProxies` is empty because the gateway is loopback-only; keep it
  that way unless a reverse proxy is deliberately added.
- The deep CLI probe token lacks `operator.read`; normal live turns and the regular
  gateway read probe work. Do not widen that token silently.
- Haiku remains the primary model, so the audit warns about model tier. Choosing a
  stronger model is a real cost/quality/security decision, not an automatic fix.
- ChatGPT-Pro-like work mode is the product target: broad tools, planning, learning,
  repair, and capability building. Consequential effects still require notification
  or approval; raw unrestricted shell is not the definition of capability.

## Agent status — decoder/truncation/gmail/workshop

Session of 2026-08-14 (overnight). Gateway pid 79818 healthy, `plugins inspect
orion-control` → `Status: loaded`, Orion answering turns, Orion.app + TTS +
voice-id daemons all up. Plugin suite **126/126 green** (95 pre-existing,
unchanged; 31 added). Nothing left half-applied. No git commit or push.

### FIX 1 — message bodies decoding to `NSObject` — **DONE + VERIFIED**

Evidence: `messages_recent` on the real chat.db now returns twelve of twelve
real sentences, zero `NSObject` — e.g. `23:04 Dad: Want any more salad before I
toss it?`, cross-checked identically via `messages_search "salad"` and
`messages_from "Dad"`.

Cause: the reader never parsed the format — it took the longest run of printable
bytes out of the blob, and a typedstream stores its class names as ASCII, so
`NSObject` (8 chars) beat `ok` (2). Reproduced exactly with fixtures generated by
Foundation's own `NSArchiver`: 9 of 16 returned a class name.

Fix: real parser at `scripts/lib/imessage-typedstream.mjs` — validates the
`04 0b streamtyped` signature, finds the `84 01 2B` token, decodes the length
(1-byte / `0x81`+int16 / `0x82`+int32 / `0x83`+int64) and reads exactly that many
bytes. A class name is now structurally impossible; unreadable blobs return
`[unreadable message body]`, attachments return `[attachment]`.

Also fixed the same class of bug on the `text` column: a photo from Dad printed
as a bare U+FFFC (`Dad: ￼`), now `[attachment]`.

### FIX 2 — AGENTS.md silently truncated — **DONE + VERIFIED**

Evidence: 24,722 → **18,961 chars** (limit 20,000). Zero
`truncating in injected context` warnings across two restarts and several live
turns. Asked Orion about Apple Reminders — a rule that lived in the *dropped
tail* — and he answered it verbatim.

Method: removed command listings that duplicate the generated `TOOLS.md`, merged
the `orion-remember` rule that was stated twice, compressed narrative, and moved
reference material to a new `workspace/PLAYBOOK.md` (mail detail,
capability-building, Discord, music/smart home, the dated gap list). A scripted
check of 102 probes covering every original rule reports
`102/102 rules still present — none lost`, including all six previously-dropped
sections and the whole `## Voice` section.

Note for whoever looks next: these warnings never reach
`~/Library/Logs/openclaw/gateway.log` because the launchd plist sends stderr to
`/dev/null`. They are in `/tmp/openclaw/openclaw-YYYY-MM-DD.log`, reachable via
`openclaw logs`.

### FIX 3 — email search flooding context — **DONE + VERIFIED**

Evidence: `orion-gmail-search "in:inbox"` went from ~15,000 chars to **1,608**;
`orion-gmail-latest` from ~2,500 to **440**. Orion still answers "who emailed me
last and what about" correctly.

Default output is sender, subject, date, snippet, thread id. Full bodies only on
`--full` or `--thread <id>`, with quoted-printable decoded, boilerplate stripped
and a 2,000-char cap. `--readonly` and `--gmail-no-send` are applied inside the
shared client so no caller can drop them. Original invocation unchanged.

New shared libs `scripts/lib/gmail-client.mjs` and `scripts/lib/gmail-format.mjs`
— the two wrappers had been carrying byte-identical duplicated plumbing, which is
how they drifted apart in the first place.

### FIX 4 — three workshop tools misconfigured — **DONE + VERIFIED**

Evidence, live through the gateway: `tool_search "orion_tool"` now returns all
three; `orion_tool_list` → `{"tools": []}`; `orion_tool_propose` →
`status: "awaiting_review", id: "clock_check-6cc5b6a951"`; `orion_tool_run` →
correctly `rejected` for an unapproved name. Zero
`must declare contracts.tools` warnings since restart.

**There were two defects, not one.** Declaring `contracts.tools` cleared the log
warning but the tools were still unreachable: `tools.alsoAllow` in
`openclaw.json` is an explicit allowlist and never named them. They have been
non-functional since they were written — `workshop.json` had never been created.
Both fixed (manifest + `openclaw config patch`, validated).

Not verified live: `orion_tool_run` *executing* an approved tool, because
approving one is Nick's decision and I would not manufacture it. That path is
covered by the existing suite ("runs an approved tool through the normal pipeline
when the tier is on"). To close it yourself: `orion-tools review`, approve, then
call `orion_tool_run`.

I proposed a throwaway `clock_check` tool to test the pipeline and **removed it
afterwards** — `workshop.json` is back to absent, so nothing spurious is sitting
in the review queue.

### The question Nick is owed

**Both earlier "empty" results were GENUINE, not decode failures.**

- `messages_search "Orion send test"` — genuine. `messages_search "Orion"`
  returns nothing at all; no message in the database has ever contained that
  word. The send test that actually happened used the text `diagnostic test`,
  which the fixed reader finds at 2026-08-13 22:34.
- `messages_from nmadaio@icloud.com` — genuine. `messages_whoami` confirms that
  is Nick's *own* handle, so the query asks for a thread with himself. It now
  returns the one 22:34 self-send. A decode bug could not have caused that empty
  regardless: `from` filters on handle in SQL, and the old decoder returned
  non-empty text (`NSObject`) for every row, so nothing was dropped at render.

The decode bug was real and severe. It was not the cause of either empty.

### Loose ends (not blocking, not started)

- `openclaw.plugin.json`'s `configSchema` has drifted well beyond `workshopPath`:
  roughly 14 keys the code accepts and Nick's config actively sets
  (`enableMessagesReadActions`, `enableSelfConfigActions`, `browserPreference`,
  `healthLogPath`, …) are undeclared. I added only `workshopPath` and left the
  rest rather than touch config validation mid-session.
- Pre-existing, harmless: Orion sometimes calls `tool_call` with a catalog
  *action* name (`messages_recent`) instead of a tool id, gets
  `Unknown tool id`, then self-corrects via `orion_task_run`. Present in the logs
  before any of this work.

### Backups

- `~/Desktop/ORION/.builds/backup-20260814-001531` — scripts, AGENTS.md, plugin src + manifest
- `~/Desktop/ORION/.builds/backup-installed-20260814-004603` — full installed extension
- `~/.openclaw/openclaw.json.pre-workshop-tools-20260814-004923`
- `~/Desktop/ORION/.builds/Orion-KNOWNGOOD.app`, `Orion-LATEST.app`, plus several `~/.openclaw/openclaw.json.pre-*`

---

# Wider session context (2026-08-12 → 08-14)

The four fixes above were the tail end. Earlier, all verified:

| Area | State |
|---|---|
| **Brain** | Was falling back to a LOCAL model on every single turn — an OpenClaw update made `plugins.allow` gate provider discovery, so Anthropic never loaded. Fixed via `doctor --fix` (`bundledDiscovery: "compat"`). Now `anthropic/claude-haiku-4-5-20251001`, ~4s. This was the cause of the original "errors and timeouts" complaint. |
| **Self-propagation** | Falsely reported disabled by drifted tier tables in `orion-selfdoc`; fixed at source. `self_tuning` + `health_tracking` were collateral, also recovered. |
| **Obsidian** | `memorySearch.extraPaths` → `~/Documents/orionBrain`, 48 files. He reaches for it unprompted. |
| **Ear / thinking stall** | Cause was a stuck `.thinking` phase + subprocess hang in `GatewayClient`, not a dead mic. Watchdog added. |
| **Keychain deadlock** | Keychain reads moved off the main thread; any rebuild used to freeze the app before it opened a window. |
| **Messages — send** | Profile raised to `external_connected` (v3, audited). Approval→re-run fixed: the compact call form had no field for the approval hash, so it was mechanically impossible, not skipped. |
| **Self-repair beyond Swift** | Deployed — config + scripts + plugin surfaces, four gates, rollback. All flags on incl. `enableSelfPluginActions`. |
| **Proactive delivery** | Cron jobs were failing `Channel is required` ~592×/day into the void. Routed via `orion-cron-deliver` → Discord with filtering/dedup/rate limits. |
| **Google auth** | Re-authed by Nick; verified working through the gateway (Gmail + Calendar). |
| **Distractions** | Now reasoned per-app, not a list, with a mechanical never-quit floor (unsaved work, Electron apps unreadable → never closed). |

## Open — needs Nick

1. **Focus shortcut** not saved under a findable name (`shortcuts list` shows "New Shortcut"). Contract: ONE shortcut, input is one line `on <mode>` / `off <mode>` lowercase. **`shortcuts run -i` takes a FILE PATH, not text.** Test: `printf 'on work' > /tmp/f.txt && shortcuts run "ORION Focus Toggle" -i /tmp/f.txt`. Custom modes: add `on <name>`/`off <name>` If-blocks + list the name in Settings ▸ Focus session.
2. **Settings capability panel has never been clicked by a human.** Flip something harmless first.
3. **`enableSelfPluginActions` is ON** — lets Orion edit the source of the plugin that defines what he may do (in-process code execution). Gated by compile + full suite + health probe + rollback. Reverse: `openclaw config set plugins.entries.orion-control.config.enableSelfPluginActions false` + restart.

## Open — engineering, highest value first

1. **He barely learns.** `orion-remember` works but fired ~once in four days; 08-12 recorded nothing despite hours of conversation. Daily files are ledger-generated (what tools ran), not episodic (what Nick said). **This is the gap between a tool and something that knows him.**
2. **Sandboxing before trusting plugin self-edit** — only structural fix is making `openclaw.json` + `permission-state.json` unwritable by the gateway uid (root-own or `chflags`). Needs sudo + a design decision.
3. **Gateway memory** 1.05 GiB vs 512 MiB threshold.
4. **Wake-word auto-disable** (`AppState.swift:336/341`) persists `OrionWakeWordEnabled = 0` on any transient mic failure, no retry. Nick turned it off manually on 08-12 so it was NOT the cause then — but the latent path is real.
5. **Music vs distraction-closer conflict** — closer quits Music while the pauser wants to resume it.

## Parked idea — twin agent

Higher-reasoning model, own persona, audits Orion objectively. Full note at
`~/.claude/projects/-Users-nickmadaio/memory/orion-twin-agent-idea.md`.
Motivation is concrete: Orion claimed a text was sent when the task sat at
`needs_approval`, and couldn't inspect his own permissions. A same-model
self-audit inherits the same blind spots. Design tension: the twin needs
authority to repair Orion, which is a second path around the trusted_user gate.
Recommendation given: **one boundary, many models behind it** — twin reads
everything, writes nothing without Nick.
