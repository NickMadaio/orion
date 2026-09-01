# ORION v2 handoff

Updated: **2026-09-01**. Phases 1-2 spanned 2026-08-20 and 2026-08-23; Phases 3
and 4 closed 2026-08-23; Phase 5 closed 2026-08-24 in a session that began on the
23rd; Phases 21-24 closed 2026-08-25, 25-30 on 2026-08-26 and 31-32 on
2026-08-27. Dates below identify each batch.

Branch: **`orion-v2/backlog-checkpoint`** (was `main`, was `orion-v2/phase-0-inventory`)

Observed HEAD: `6261878` (`fix: correct my own overstatement about the Keychain...`)
on `orion-v2/backlog-checkpoint`, read 2026-09-01. This is an observation, not a
claim about now — run `git fetch && git status -sb` yourself.

Remote: **`https://github.com/NickMadaio/orion.git`, private**

Program position: **Phases 0-33 complete; Phase 40 in progress, opened out of
numeric order; Phases 34-39 not started. Next work is Phase 34 onward in numeric
order.** Independent-review records cover 5-10, 11-20 and 21-32.

The three 2026-09-01 entries below are titled "Batch A" and "Batch B" — the names
that day's sessions gave to two bundles of work. **They are labels on history,
not a plan, and there is no Batch C onward.** A lettered re-sequencing of the
whole program was proposed on 2026-09-01 and withdrawn the same day; what
survived it is one interpretation rule, recorded in `AGENTS.md` and in
`planning/v2/PROGRAM_CORRECTION_2026-09-01.md`. In phase numbers, Batch A was
Phase 33 plus Phase 43, and Batch B was Phase 40.

Each dated entry ends with the "Exact next step" that was true when it was
written. **Only the topmost one is live**; the others are kept so the reasoning
of the day survives.

One-page summary of the 08-23 -> 08-25 session: **`planning/v2/SESSION_LOG_2026-08-25.md`**

## 2026-09-01 BATCH B — London and the timezone, and a day key that was already wrong

Written 2026-09-01, same day as Batch A; the machine last booted 2026-08-29 13:22
and this session did not span a reboot or a day boundary.

Full reasoning: `planning/v2/PROGRAM_CORRECTION_2026-09-01.md`, Batch B.

### The state I found, and where the record was imprecise

**Only ONE of the three cron jobs actually fires at the wrong hour.** The Batch A
handoff and the program correction both say "all three cron jobs are pinned
`America/New_York`", which is true, and then read that as "his morning brief
fires at the wrong hour in London", which is not. Measured:

    orion-focus-guard      * * * * *     every minute — zone-independent
    orion-standing-orders  0 * * * *     hourly — zone-independent for FIRING
    orion-daily-memory     10 2 * * *    02:10 New York = 07:10 London  <- the real one

`orion-standing`'s morning/evening choice and its quiet hours read the MACHINE's
clock, and macOS auto-timezone is on (`com.apple.timezone.auto Active = 1`), so
that half self-corrects on landing. The nightly memory rollup does not: it moves
from the dead of night to breakfast. Smaller than recorded, and worth stating
precisely so the next reader does not go looking for three bugs.

### A real defect, found while building the vocabulary and dormant until the move

`CutoffDayKeys` computed the 4am day boundary in its INJECTED calendar's zone and
then rendered it with a shared static `DateFormatter` that set a locale and **no
time zone** — so it rendered in the machine's. Measured, London calendar on this
New York machine:

    instant  2026-09-08T04:30Z   (05:30 in London, past the cutoff)
    dayStart 2026-09-08T03:00Z   key() -> "2026-09-07"     off by one

It survived 322 tests because those tests inject `America/New_York` on a machine
that IS `America/New_York`. The injection proved nothing — the same
self-verifying shape `AGENTS.md` already records three times. It goes live the
moment Orion's home zone and the machine's zone differ.

Fixed by deleting the formatter: the key goes through `CivilDay`, which has no
instant to render and therefore no zone to pick wrongly. The regression test
sweeps all 443 zones this system knows, so it fails on any machine rather than
only on one in the wrong zone.

### Phase 40 — the vocabulary, in SessionDomain

`ZonedTime` is a sum type and the enforcement is that **it has no `instant`
property**. A `.moment` carries `ZonedInstant` (UTC instant + anchoring zone +
original zone); a `.day` carries `AllDaySpan`, which has no instant at all.
Getting time out of an all-day value requires naming a zone at the call site,
where it can be reviewed. That is "never rely on plain local datetime strings"
made structural rather than aspirational.

`rezoned(to:)` keeps the moment and `reanchored(to:)` keeps the wall clock. Both
exist, with names that cannot be confused, because picking the wrong one shifts
an appointment by the offset between the zones and nothing complains.

**Alternatives rejected.** An `isAllDay` flag beside an instant is the obvious
model and it is the bug: an all-day value that has an instant has already had a
zone chosen for it invisibly. Storing a fixed offset instead of an IANA name is
the other one — `GMT+0500` is right for half the year.

### Five facts measured rather than assumed, each now pinned by a test

- **Foundation's `JSONEncoder` escapes forward slashes**, so a stored zone reads
  `Europe\/London`. Legal JSON, but this format is a cross-language contract and
  anything reaching for a substring rather than parsing will miss it.
- **`TimeZone(identifier: "UTC").identifier` answers `"GMT"`.** Storing `UTC`
  means reading back a name nobody wrote, so it is refused. All 443 accepted
  names round-trip byte for byte; that is the invariant the strict set buys.
- **Foundation and ICU canonicalise 47 zone names differently, in BOTH
  directions.** ICU says `America/Buenos_Aires` and has never heard of
  `America/Argentina/Buenos_Aires`; Foundation is the exact opposite, and ICU
  rewrites Foundation's `America/Nuuk` to `America/Godthab`. The safe direction
  is that Foundation preserves everything ICU canonicalises, but not vice versa.
- **Round-tripping is not a safe validation rule in Foundation**: `GMT+0500`,
  `EST`, `Zulu` and `Etc/GMT+5` all round-trip. So the accepted set stays the
  strict known list.
- **`Calendar.date(from:)` is lenient**: 2026-02-29 rolls forward to 1 March, and
  then asking that date's month whether it has a 29th says yes — so the obvious
  validation accepted every invalid date it was written to reject.

### The operational half

`scripts/orion-timezone` — `status`, `plan`, `set`, `expect`, `clear-expected`.
Idempotent, dry-runnable, and it verifies by RE-READING the cron jobs rather than
trusting exit codes; if any job did not move, the record is not written, because
a record ahead of the world is the failure this whole batch is about.

`location.json` holds home, place and an `expectedMove`, in exactly
`TimeZonePolicy`'s Codable shape. A trip and a move are indistinguishable to the
OS, so the move is a fact recorded in advance and arriving at the recorded
destination is what makes a mismatch a move.

`orion-standing` now reports a home-versus-machine mismatch — in the morning and
evening checks only, **never** in the hourly one. An hourly "your timezone is
wrong" is exactly the nag that gets a proactive assistant muted.

`orion-weather-alert` no longer hardcodes `"Montvale, New Jersey"`; it reads
`location.json`'s place, with Montvale kept only as the no-record fallback.

`scripts/orion-project` plus `projects.json` — the London move with four dated
milestones, surfaced by the morning check three days out and reported as
unaccounted-for rather than silently rescheduled if a date passes. Kept
deliberately tiny (milestones with dates; no dependency graph, no scheduling) and
registered in `scopeNotInManifest`, because no phase defines a project and adding
modules with no live consumer is how this repo got three stacks.

`USER.md`, both copies — **Northeastern restored.** The 2026-08-14 rewrite lost
the university; the archive says "Eastern University" because it was dictated by
voice. The timezone line now points at the record instead of promising to ask
once, since the 2026-07-31 promise expired in silence: a date written in prose
has nothing watching it.

### Verification

native/Orion **367** (was 322), location contract **20**, timezone set **18**,
Python **1,437**, plugin **146/146**, phase-gate validator clean.

**The one command Nick actually runs was exercised, not just written.**
`run-timezone-set-test.sh` drives the real script against a fake gateway over 18
checks — happy path, idempotence, a job the gateway refuses, and five zones that
must be refused before anything is touched. The load-bearing assertion is that a
failed re-home **does not write the record**; both mutations of that path are
caught.

And once for real, reversibly, against the live gateway at 12:41–12:43 EDT,
because a fake cannot prove `openclaw cron edit --tz` does what I assumed:

    set Europe/London     -> all three moved; orion-daily-memory's next run went
                             from 02:10 to 21:10 New York local, which IS 02:10
                             London. The gateway honours the pin.
    set America/New_York  -> all three back; next run 2026-09-02 02:10 local
    expect ... restored   -> location.json diffs byte-identical to the pre-test copy

This is the lesson `orion-lock` already paid for: a command nobody has run is a
command with a bug in it.

**Mutation tested, eight mutations.** Seven caught. The one that survived was a
flaw in my code, not a gap in the tests: `verdict` had two identical branches,
which made `arrivedOnTime` look like it gated the destination case when it never
did, and made a comment claiming the device-zone reading was load-bearing simply
false. Collapsed to one branch, comment corrected to say what is actually true,
and the collapsed branch is now itself mutation-covered.

The contract harness is mutation-proven in the way that matters: removing the
zone translation table makes `orion-timezone` write `America/Buenos_Aires` and
the Mac app then REFUSES the file — the exact silent breakage it exists to stop.

### Live and installed state

Changed on the live machine: `location.json` and `projects.json` created,
`~/.openclaw/workspace/USER.md` rewritten. **No cron job was touched, no
permission changed, no rebuild, no install.** The installed app is still build
121 and contains none of today's Swift changes — Batch A's or Batch B's.

Rollback, all in-repo:

    git revert <this commit>                       # the code
    git show 184c4a5:openclaw-workspace/USER.md > ~/.openclaw/workspace/USER.md
    rm ~/.openclaw/orion-controlled/location.json ~/.openclaw/orion-controlled/projects.json

`location-audit.jsonl` records every change with its previous value, and
`orion-timezone` prints the undo command after every `set`.

### What is deliberately NOT done, and why

**The cron jobs are still on `America/New_York`.** Nick is in New York until
about 09-07; re-homing today would be wrong for six days. The single command is
`orion-timezone set Europe/London --place "London, United Kingdom"`, it is
dry-runnable with `plan`, and `orion-standing` will raise it the morning after he
lands. Recorded as a blocked requirement, not quietly omitted.

Also blocked and registered: the existing calendar UI still uses
`Calendar.current` and a bare `Date` plus an `isAllDay` flag — the vocabulary
exists, migrating the app to it is bigger than Batch B; and flights, an event
anchored to two different zones, which the travel tests do NOT cover (they cover
a device changing zones, which is a different thing).

### Exact next step

**Phase 34 — ORION Health UI**, then 35, 36, 37, 38, 39 in order. Phase 33 closed
on 2026-09-01, so 34 is next by the sequence rule and nothing exempts it. Read
the manifest text at `~/Desktop/Orion v two implementation plan.md` line 1200,
write `planning/v2/PHASE_34_PLAN.md`, record the gate, then build.

Read the phase's requirements against the LIVE stack, not the Python package —
the interpretation rule in `AGENTS.md`. Phases 34-39 are health and planning
surfaces, and the health data, the firewall and the planner they attach to are
all in `native/Orion`. None of them has a Python dependency to inherit.

Carry one thing into Phase 34: the 2026-09-01 health work built Phase 33's
firewall against the live Mac app and delivered some of the shape Phase 38 asks
for while doing it. Phase 38 has **no** record in `PHASE_GATES.json`, so it is
not started — but check what `PlanningSignal.swift` already does before building
it twice.

Two open items that are NOT next, and must not be read as the head of the queue:

- **Re-pointing the Phase 1 and Phase 5 records** onto the live TypeScript gate
  (`permissions.ts` + `validator.ts` + `provenance.ts` + `outcome.ts` + the
  ledger), demoting `orion/security` to a conformance oracle. Nick delegated this
  call on 2026-09-01. It corrects the record of two CLOSED phases, so it sits
  outside the sequence: it neither blocks Phase 34 nor is blocked by it. Do NOT
  route the live route through the Python engine —
  `planning/v2/PHASE_1_RUNTIME_DECISION.md` forbids it. Widen
  `orion_v2_policy_check.py` first: its "390 combinations" is parity at ONE point
  in a five-dimensional space, and at `external_connected` with
  `external_data_involved=True` it gives 54 stricter and 25 DENY, including
  `messages_send` and every `self_*` action. Files it needs:
  `planning/v2/PHASE_GATES.json`, `PHASE_1_RUNTIME_DECISION.md`,
  `PROGRAM_CORRECTION_2026-09-01.md`, `scripts/orion_v2_policy_check.py`.
- **The 2026-09-08 re-homing**, which is on a clock rather than in the queue. The
  London milestone comes due that day and
  `orion-timezone set Europe/London --place "London, United Kingdom"` moves the
  cron jobs, the weather default and the record in one command. Whatever phase is
  running then, do not let it swallow this — it is the reason the timezone work
  was pulled out of numeric order in the first place.

## 2026-09-01 BATCH A COMPLETE — Phase 33 built against the live app, and an off switch

Everything here was verified against the running system, not the v2 backend.
Full reasoning: `planning/v2/PROGRAM_CORRECTION_2026-09-01.md`.

### ElevenLabs, fixed — and it was never the credential

Two faults. The TTS daemon was killed 2026-08-18 (`signal 15 -> shutting down`)
and nothing restarted it: its launch agent has never been installable, because
**launchd cannot read `~/Desktop`** and that is where the repo lives. And even
running, it needs `ORION_TTS_CLOUD_VOICE=1` — without it the daemon logs
`elevenlabs key found but not selected` and quietly serves the local MLX voice,
which is why it sounded wrong rather than silent. Started the way
`launchers/Choose Orion Voice.command` does. First success since 2026-08-13:
`ok provider=elevenlabs engine=elevenlabs first_ms=633`.

**Still open:** nothing supervises that daemon. It will stay dead next time.

### Phase 33 — the health privacy firewall, against v1

The live Mac app was violating it. `HealthSummary.swift:71,76` emitted
`"- HRV 116ms"` and `"- Resting heart rate 54"` into a model prompt;
`MorningBrief.swift:86-92` added sleep score, recovery and an HRV delta and then
asked the model to tie recovery to the calendar — Phase 38 shipped before Phase
33's firewall existed, fed exactly what the firewall withholds.

`PlanningSignal` is the boundary. Categories cross it; numbers do not.

- Vocabulary is MobileCore's **by type**, which required adding
  `.package(path: "../OrionMobile")` to the Mac app — **the first real wire
  between the two stacks.** MobileCore had no consumer but its own harness.
- The reason string is deliberately NOT `HealthStateReading.reason`, which embeds
  raw values and would have leaked through the reason field after the numbers
  were stripped everywhere else.
- Type-narrowed: `HealthFacts` no longer HAS the raw fields. `BriefFacts` keeps
  them nested under `.readings` for the ring meter, and `prompt()` never mentions
  `readings`.
- Two deviations REGISTERED rather than improvised: the manifest's
  `confidence = 0.81` would reopen Phase 32's categorical gate, and
  `cognitive_capacity` is a projection of `EnergyState`, not a seventh state.

Enforcement is numeric: `run-health-firewall-test.sh` pulls every number out of
the generated prompt and compares it against the day's measurements. 38 checks,
mutation-proven. It also asserts a POSITIVE, so deleting the health block fails.

### Focus sessions expire

Yours was not stuck — it was **paused**, and a paused session waits forever by
design. Right for an hour, wrong for twenty days: started 2026-08-12, last
state-change 08-19, still accruing heartbeats on 09-01. `SessionStatus` gains
`readyToAbandon`, mirroring `readyToComplete`. Measured from the last event, not
`dayKey`, because a day key needs a timezone. 318 -> 322 tests, mutation-proven.

### LOCK ORION (Phase 43) — `scripts/orion-lock`

The manifest's own precondition for anything dangerous, and it did not exist.
Drops the profile to `restricted_read_only` and disables every cron job. It does
NOT kill the gateway (a dead gateway cannot be asked why it is dead) and does NOT
write `permission-state.json` itself — it calls the plugin's own
`changePermissionProfile`, so the audit lands before the state under the same
lock. Verified against COPIES: `external_connected v3 -> restricted_read_only
v4`, audit written, second run `unchanged`.

That test caught a bug in the script: it checked for a status of `"applied"`,
which the writer never returns. A successful lockdown would have reported failure.

### Two things I deliberately did not "fix"

**Camera presence.** 504 failures, 0 successes, authorised throughout. The
likely cause is that 1.5s covers both warm-up and first frame. Raising it to 4s
broke `testTheDutyCycleIsUnderTwoPercentAsClaimed` — the privacy promise is a
TESTED invariant, not prose. Reverted; the diagnosis and the two real fixes are
recorded at the constant. Kept the improved failure message, which now names the
device.

**Sparkle.** The feed is a literal `ORION_OWNER/ORION_REPO`. Pointing it at the
real repo would not help — it is private and there is no appcast or release. So
automatic checks are now left off when the feed is a placeholder, and the log
says what is actually missing rather than blaming the network.

### Verification

native/Orion **322**, health firewall **38**, MobileCore **335**, Python
**1,437**, plugin **146/146**, secret scan clean over full history.

### Live and installed state

The TTS daemon is now RUNNING (started by this session, serving ElevenLabs). No
rebuild, no install, no gateway restart, no permission change — the lockdown path
was proven against copies, never against live state. The installed app is still
build 121 and does NOT contain any of today's Swift changes; they take effect on
the next `make_app_bundle.sh`.

### Exact next step

**Batch B — London and the timezone**, and it has a real deadline. Nick moves
around 2026-09-07, Northeastern starts 09-07, he lands 09-08 with welcome week as
buffer. All three cron jobs are pinned `America/New_York`. Also: the archived
`USER.md` recorded the move as being to attend **Northeastern** — the current one
lost the university entirely in the 2026-08-14 rewrite, and the archived copy
says "Eastern University" because it was dictated by voice.

## 2026-09-01 PROGRAM CORRECTION — the ordering was derived from a fiction

Seven independent fresh-context audits: the Mac app, the live execution path, the
v2 stack, manifest phases 33-84, the plan lineage, a Core-convergence design and
a full re-sequencing. Full record: **`planning/v2/PROGRAM_CORRECTION_2026-09-01.md`**.

Nothing live was changed. No code was written. This is a re-planning pass.

### Found state, and where the previous record was wrong

There are **three** systems and the manifest describes none of them. The Mac app
(35,433 lines, 40 SwiftUI files) plus the OpenClaw plugin (12,079 lines, 78
actions, 24 tiers all reachable) is the live product. The Python package is dead
-- the running assistant's own `MEMORY.md` declared it "not the implementation
path" on 2026-07-28. The v2 backend cannot serve a request.

**The manifest contains zero occurrences of "OpenClaw" in 2,644 lines.** Its
Phase 0 says "Document the current Python runtime" and "Document how the current
UI communicates with Python." The UI talks to a Node gateway by CLI subprocess.
Phase 0 inventoried a system that was not running, three weeks after the
assistant had recorded that fact. Every phase number downstream inherits it.

**The requirements are sound. The ordering is not.**

### The correction that matters most

ORION Core is not missing. It exists, in TypeScript, on the live route:
`permissions.ts` + `validator.ts` + `provenance.ts` + `outcome.ts` + the
append-only ledger. Five ordered layers with documented incidents behind each.
`orion/security/profiles.py` already concedes it: *"permissions.ts stays the
authoritative gate on the live route."*

So Phase 1's exit gate closes by **re-pointing the record**, not by a
cross-language rewrite -- which `planning/v2/PHASE_1_RUNTIME_DECISION.md`
already forbids ("must not make every live turn cross into a second Python
process"). The Python engine becomes a conformance oracle, and
`orion_v2_policy_check.py` -- which already shells into the compiled live plugin
-- becomes a blocking CI gate.

### A third self-verifying mechanism, and the sharpest one yet

`orion_v2_policy_check.py:baseline()` pins `external_data_involved=False` and
`request_source="user_direct"`. Its docstring is honest. The headline is not
wrong either -- but "never more permissive across 390 combinations" reads as
system-wide parity when it is parity at one point in a five-dimensional space.
Measured at `external_connected`:

    baseline                        stricter= 14   DENY=  0
    external_data_involved=True     stricter= 54   DENY= 25
    request_source=model_initiated  stricter= 19   DENY=  0

The 25 denials include `browser_open_url`, `messages_send`, `calendar_event_add`,
`file_delete` and every `self_*` action. Recorded in `AGENTS.md`: state the SCOPE
of a parity result, not just its verdict.

### Nick's own ranked gaps, re-checked -- two are already done

From `WHAT_ORION_IS_MISSING.md` (2026-07-30). #1 proactivity is **LIVE**:
`orion-focus-guard` every minute, `orion-standing-orders` hourly,
`orion-daily-memory` nightly, all reporting `ok`. #2 memory retrieval is **DONE**:
`orion-recall` does semantic search with `nomic-embed-text` local; the
`content LIKE '%query%'` he diagnosed is dead code in the dead package. #5 taint
was done pre-manifest. The program has delivered more than its records show --
just not through the manifest.

### Live defects found, dated

- **Timezone.** Three cron jobs pinned `America/New_York`. `USER.md`: "Moving to
  London before the end of August 2026" / "ask once afterward." It is 2026-09-01,
  machine still EDT. Orion was told to ask and the deadline passed.
- **The live app violates Phase 33.** `HealthSummary.swift:71,76` emit raw HRV
  and resting heart rate into a model prompt; `MorningBrief.swift:86-92` adds
  sleep score, recovery %, HRV delta; `:133` ties recovery to the calendar. That
  is Phase 38 shipped before Phase 33's firewall exists.
- **A focus session wedged open since 2026-08-12**, last heartbeat
  2026-09-01T01:25:46Z. Two completed sessions ever, both abandoned under 25s.
- Camera presence: 504 failures, 0 successes, enabled. Sparkle on a placeholder
  feed. `Info.plist` claims calendar is read-only while the code deletes events.
  Installed app 14 commits behind.

### The corrected sequence

A stop the lying + an off switch (3-5d) · B London/timezone (3-4d) · C close the
1/5 gate honestly (8-12d) · D situational awareness + explainability (4-6d) ·
E proactivity widened (10-15d) · F cost then reach (4-6d + credential) ·
G delegation, gated · H the register.

Proactivity is fifth **because it already works** and building it before the off
switch, the timezone fix and the interruptibility signals would ship the version
that gets muted -- which his own document names as the failure mode.

### Corrected, from the previous session's framing

I had said closing the Phase 1/5 gate unblocks 44-56. It does not. Those are
blocked by a transport, a credential only Nick can create, and a phone. Phase 5's
precondition is a self-imposed policy gate. Conflating them would put a large
refactor on a critical path it does not sit on.

### Live and installed state

Unchanged. No plugin edit, no rebuild, no install, no gateway restart, no config
write. `~/.openclaw` was read only. The gateway is running (PID observed) and the
three cron jobs continue.

### Exact next step

Nick answers the six questions now at the top of `NICK-TODO.md`. Batch A needs
none of them and can start immediately; Batch B needs question (a).

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

### Commit checkpoint — 2026-09-01

Seven commits on branch **`orion-v2/backlog-checkpoint`**. `main` is untouched
at `1efd37c`, so this is reversible with `git branch -D` and nothing else.

```
1c9c503 feat: Keychain-backed provider secrets, a strict-argument flag, and TTS work
2ca9e9c docs(v2): phase records, capability charter, and the Phases 11-20 review
e1651a3 test(v2): read-only check scripts and the unit suites
6899867 feat(v2): MobileCore domain layer and its self-check
4ab0f9a feat(v2): task, planning, calendar, Gmail and connector backends
5819ca8 feat(v2): backend foundations -- database, vault, auth, devices, pairing, sync, memory
c26272f feat(v2): core contracts, security vocabulary and Mac ledger adapters
```

231 files, 49,061 insertions. Working tree is clean for the first time in this
program's history.

**This is a LOCAL commit, not a remote backup.** Nothing was pushed. If this Mac
dies, this work dies with it. Pushing is a separate decision Nick has not made.

Grouped by subsystem rather than by phase, deliberately. Nothing here was ever
committed, so there is no earlier state to reconstruct a per-phase history from,
and manufacturing one would fabricate a sequence that did not happen — which the
Phase 32.5 charter explicitly forbids. The real sequence lives in
`PHASE_GATES.json`.

The non-v2 work (Keychain secrets, the strict-argument flag, TTS and
orion-doctor) is the other assistant's, committed last and alone so it can be
reverted on its own. Nick confirmed it was in scope. Verified rather than
assumed before committing: plugin **146/146**, native/Orion **318/318**, and
`openclaw.plugin.json` matches its source, so the generated manifest was
regenerated properly rather than hand-edited.

Also cleared on the way: a **zero-byte `.git/index.lock` dated 2026-08-20 13:57**
had been blocking every write to the index for twelve days. No git process was
holding it -- it is a leftover from the crash-era commits `AGENTS.md` records
around the 18th-20th. Checked for a live process before removing it.

Secret scans clean before and after: source, and full history across all
reachable commits (37 reviewed findings allowlisted). `.env`, `.env.save` and
`.builds/openclaw.json.*` remain untracked; only `.env.example` is in history,
which is the intended template.

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

This was a **documentation/guidance checkpoint only**. It did not change product
code, install or restart anything, connect an account, enable a permission,
choose a provider, start Phase 33, stage, commit or push.

### What changed

- `PHASE_32_5_CAPABILITY_CHARTER.md` now states the Jarvis-like local-first
  product goal, the direct-request authorization rule, the school/day planner,
  proactivity/presence, media/home/computer, memory/model/cost, communications,
  UI/backend and review-history requirements.
- `ROADMAP_AMENDMENTS.json` gives missing work stable `REC-*` and `CAP-*` homes
  without renumbering the original 85 phases or changing its fingerprint.
- `MANIFEST_PHASES.json`, `MANIFEST_TRACEABILITY.md` and `PHASE_GATES.json` point
  to the additive checkpoint and preserve the numbered position: **0-32
  complete; 33 not started**.
- Root `CLAUDE.md` now routes a fresh Claude context through `AGENTS.md`, both
  handoffs, the charter and the amendment record. `AGENTS.md` carries the same
  routing and warns that the integer checker does not enforce additive IDs.

### Findings that change the next handoff

The consolidated `reviews` array names batches 5-10, 21-30 and 31-32. Earlier
summaries say 0-10 were reviewed, but Phase 0-4 implementation and normal-route
proofs do not by themselves establish an equivalent independent review; resolve
that provenance in the backlog report. There is **no equivalent independent review
record for Phases 11-20**; individual mutation checks during implementation are
not the same thing. `REC-REVIEW-11-20` is the recovery item before the next
implementation batch.

The live evidence is narrower than several historical phrases imply:

- Xcode 26.6 is installed; use per-command
  `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer`. Do not change the
  global `xcode-select` setting.
- MobileCore passed **293 checks** and compiled for the iOS simulator on the
  coordinator's fresh 2026-08-27 run. That is not a SwiftUI iPhone app, a
  rendered screen, an app bundle or a connected client.
- The new v2 backend remains tested logic/contracts with in-memory state. It has
  no proven deployed API/database, production cipher/signature adapter or real
  Google transport. No real HealthKit sample has been acquired.
- Existing Mac/OpenClaw integrations predate v2; do not collapse that fact into
  “all of Orion has no persistence or integrations.”
- Calendar/Gmail approval reuse and missing durable authority/audit state are
  explicit pre-live blockers under `REC-AUTHORITY-REPLAY`.

### Enforcement limitation

The phase validator reads records inside `PHASE_GATES.json`'s `phases` object;
it does not read `programCheckpoints` or `ROADMAP_AMENDMENTS.json`. Keys are
strings, so this is not an inherent integer-only restriction. Phase 32.5 remains
separate to preserve the original sequence. The repository read protocol
requires checking the additive gates, but the current script does not enforce
them. It still reports Phase 32 open; that result does not approve starting a
batch past the required review recovery.

### Verification and completion — 2026-08-27

The first documentation task reached its usage limit after writing the main
files. The coordinator resumed from those edits, corrected the checker wording,
added the continuation order and UI acceptance brief, reconciled the reviewed-
batch commit authorization, and completed verification. This is not an
independent implementation/security review of the underlying phases.

- `PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=.:tests ./.venv/bin/python -B -m unittest test_phase0_gate test_phase0_manifest_traceability -v`
  — **10 tests passed**.
- `./.venv/bin/python -B scripts/orion_v2_phase_gate.py --phase 32 --require-open`
  — **passed**; Phase 33 remains `not_started` in both records.
- The read-only consistency check at
  `/Users/nickmadaio/Documents/Codex/2026-08-25/realtime-voice-chat-3/work/verify_phase_32_5.py`
  — **passed**: original manifest fingerprint, all 85 titles, all recorded phase
  names/statuses, checkpoint agreement, required file links, six recovery IDs,
  seven capability mappings, continuation references and agent read paths.
- `git diff --check` over the changed documentation — **passed**.
- Index remains empty and HEAD is unchanged; nothing was staged, committed or
  pushed. No product code, provider setup, global skill/config or live service
  was changed by this checkpoint.

Root `CLAUDE.md` now directs Claude to the shared guidance. This is verified
file routing only, not proof that an already-running Claude context reread it.
The copyable refresh handoff is
`/Users/nickmadaio/Documents/Codex/2026-08-25/realtime-voice-chat-3/outputs/ORION_PHASE_32_5_CLAUDE_REFRESH.md`;
the same folder contains `ORION_PHASE_32_5_OVERVIEW.md` for Nick.

### Rollback

Remove `CLAUDE.md`, `planning/v2/PHASE_32_5_CAPABILITY_CHARTER.md` and
`planning/v2/ROADMAP_AMENDMENTS.json`, then revert only the 2026-08-27 Phase 32.5
sections/pointers in `AGENTS.md`, `HANDOFF.md`, this file,
`MANIFEST_PHASES.json`, `MANIFEST_TRACEABILITY.md`, `PHASE_GATES.json`,
`NICK-TODO.md` and the historical pointer in `planning/HANDOFF.md`. The two
user-facing handoff/overview files under the coordinator's `outputs/` may be
archived separately. Preserve all earlier edits in those files. No
runtime rollback exists because nothing live changed.

### Exact continuation

Start a **fresh-context independent review of Phases 11-20** using the manifest,
product charter, current tree and reproducible commands, without carrying the
implementer's success narrative. Repair and rerun any findings, then write a
durable batch report. Only after that recovery checkpoint should Claude plan the
first connected-product batch: provider/budget decision, API/auth/durable state,
minimal home/planner, then one real read-only integration and restart/offline
proof. Approval consumption and durable audit precede writes/control. The
charter includes the mixed-backlog checkpoint procedure and the standing
authorization for future reviewed-batch local commits; no push is implied.
Phase 33 remains the next numbered phase and is not started here.

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


---

Entries before 2026-08-27 were moved to
`planning/_archive/HANDOFF-v2-pre-2026-08-27.md` on 2026-09-01, covering Phases
1-30 as they were closed. Nothing was deleted.
