# Program correction — what we actually have, and what to do next

Written **2026-09-01** after seven independent fresh-context audits. This
supersedes the *ordering* of the 85-phase manifest. It does not change the
manifest's requirements, renumber it, or reopen closed phases.

Read with `PHASE_32_5_CAPABILITY_CHARTER.md` and `ROADMAP_AMENDMENTS.json`.

---

## 1. The finding

There are **three** systems, not two, and the manifest describes none of them.

| Stack | Size | State |
|---|---|---|
| Mac app (Swift) | 122 files, 35,433 lines, 40 SwiftUI | **LIVE.** v1.2.0 build 121, used daily |
| OpenClaw plugin (TS) | 12,079 lines | **LIVE.** 78 actions, 24 tiers, all reachable |
| Python `orion/*.py` | 74 files, 9,116 lines | **DEAD.** Not the implementation path since 2026-07-28 |
| v2 `backend/` | 69 files, 11,200 lines | Cannot serve a request |
| v2 `MobileCore` | 15 files, 2,023 lines | No views, no app target |

**The manifest contains zero occurrences of "OpenClaw"** in 2,644 lines. Its
Phase 0 says "Document the current Python runtime" and "Document how the current
UI communicates with Python." The UI communicates with a **Node gateway by CLI
subprocess**. The Python package had already been declared not-the-implementation
-path in the running assistant's own memory three weeks before the manifest was
written.

So Phase 0 inventoried a system that was not running, and every phase number
downstream inherits that error. **The requirements are sound. The ordering is
derived from a fiction.**

## 2. The correction that matters most

ORION Core is not missing. **It already exists, in TypeScript, on the live
route**: `permissions.ts` + `validator.ts` + `provenance.ts` + `outcome.ts` +
the append-only ledger. Five ordered layers, battle-tested, with documented
incidents behind each one.

`orion/security/profiles.py` already concedes this in its own docstring:
*"permissions.ts stays the authoritative gate on the live route."*

The Python engine is a **conformance oracle**, and a good one --
`scripts/orion_v2_policy_check.py` shells into the compiled live plugin and
proves the mirror is never more permissive. That is a genuine cross-
implementation parity harness and it should become a blocking CI gate.

**Therefore Phase 1's exit gate should be closed by re-pointing the record, not
by a cross-language rewrite.** Amend Phases 1 and 5 to name the live gate as
Core; demote the Python engine to oracle; port forward the three things only the
mirror has (delegation narrowing, risk ceilings with expiry, canonical signing).

### The trap in the parity harness

`orion_v2_policy_check.py:baseline()` hard-codes `external_data_involved=False`
and `request_source="user_direct"`. Its docstring is honest about this. But the
headline -- "never more permissive across 390 combinations" -- reads as
system-wide parity when it is parity at **one point in a five-dimensional
space**. Measured at `external_connected`:

    baseline  (what the check tests)   stricter= 14   of which DENY=  0
    external_data_involved=True        stricter= 54   of which DENY= 25
    request_source=model_initiated     stricter= 19   of which DENY=  0

The 25 denials include `browser_open_url`, `calendar_event_add`,
`messages_send`, `file_delete` and every `self_*` action. Any convergence work
must widen this harness first.

## 3. Nick's own ranked gaps, re-checked

From `planning/_archive/WHAT_ORION_IS_MISSING.md` (2026-07-30):

| Rank | Gap | Actual state |
|---|---|---|
| 1 | Proactivity | **LIVE.** `orion-focus-guard` every minute, `orion-standing-orders` hourly, `orion-daily-memory` nightly. All `ok`. |
| 2 | Memory retrieval | **DONE.** `orion-recall`, semantic search, `nomic-embed-text` local. The `LIKE '%query%'` he diagnosed is dead code. |
| 3 | Situational awareness | Open. Does **not** need screenshots -- frontmost app via `lsappinfo`, selected text via the already-granted AX API. |
| 4 | Reach beyond the Mac | Outbound live via Discord. Inbound: `scripts/orion-remote` is written and safe by construction, needs one bot token. |
| 5 | Capability ladder + taint | **DONE**, pre-manifest. |
| 6 | Sub-agents | Registered, not built. |

Two of his top four are already delivered -- outside the manifest, on the live
route. The program has been more productive than its own records suggest.

## 4. Live defects, dated

- **Timezone.** All three cron jobs pinned `America/New_York`. `USER.md`:
  *"Moving to London before the end of August 2026"* and *"ask once afterward."*
  It is 2026-09-01 and the machine is EDT. **The system was told to ask a
  question and the deadline passed.**
- **Phase 33 is violated by the live app.** `HealthSummary.swift:71,76` emit raw
  HRV and resting heart rate into a model prompt; `MorningBrief.swift:86-92`
  adds sleep score, recovery %, HRV delta; `:133` instructs the model to tie
  recovery to the calendar. That is Phase 38 shipped before Phase 33's firewall.
- **A focus session has been wedged open since 2026-08-12** -- 120 events, last
  heartbeat 2026-09-01T01:25:46Z. `focus-history.jsonl` holds two completed
  sessions, both abandoned under 25 seconds.
- **Camera presence:** 504 failures, 0 successes, still enabled.
- **Sparkle** points at a literal `ORION_OWNER/ORION_REPO` placeholder; every
  update check has failed.
- **`Info.plist` states calendar access "only reads; never creates or changes
  events."** `AppleCalendarSync.swift` creates, updates and deletes. A false
  privacy disclosure in an installed app.
- **The installed app is 14 commits behind** the repo; the Keychain work
  committed on 2026-09-01 is not in the running binary.

## 5. The corrected sequence

Batches, not phase numbers. Each has a goal.

**A -- Stop the running system lying, and give it an off switch.** (3-5 days)
Merge 33+38: derived health signals into the prompts, raw values out. Phase 43
LOCK ORION reduced to the Mac. Phase 71 data inventory starting with the false
`Info.plist` string. Fix the wedged session, the camera, the Sparkle feed.

**B -- The London batch.** (3-4 days) Phase 40 timezone/IANA. Re-home cron,
weather, `USER.md`. The move as a tracked project. University mode *conditional
on Nick supplying a real timetable* -- the charter forbids inventing one.

**C -- Close the Phase 1/5 gate honestly.** (8-12 days) Re-point the record onto
the live gate. Make the parity check blocking CI. Port forward delegation,
risk ceilings, canonical signing. Approval consumption -- the buildable half of
Phase 49, and a recorded live gap today.

**D -- Situational awareness and explainability.** (4-6 days) Frontmost app,
selected text, audio route, Focus/DND, clipboard behind its own tier. Merge
63+64 into one confidence vocabulary and a generic "Why?".

**E -- Proactivity, widened.** (10-15 days) Merge 57+59 -- an automation rule
and a proactive trigger are one object. `orion-standing` becomes the first
entries in a rule store. Prep cards, waiting-on, the evening half of 39.

**F -- Cost, and reach beyond the Mac.** (4-6 days + credential lead time)
Phase 67 first -- there is no token accounting anywhere and the budget is
$0-10/month. Then attach a real channel to `orion-remote`.

**G -- Delegation and bounded work.** Gated on 67 and a capture decision.

**H -- The register.** Declined: 52, 82, 83, 37. Parked behind a phone: 34-mobile,
42-mobile, 49-device, 56, 65, 66, 84. Behind the $99: 48-signing.

### Why proactivity is fifth even though Nick ranked it first

It already works. What it lacks is the surrounding conditions, and building it
first builds them wrong. Without A's off switch, a proactive assistant has no
stop -- his own document names "gets muted within a day, permanently" as the
failure mode. Without B, every time-based trigger fires on New York time while
he is in London; a 3am brief is the fastest route to being muted. Without D,
Orion cannot tell whether he is on a call or wearing headphones. Batch E is
fifth so that it survives.

## 6. What blocks what, honestly

Closing the Phase 1/5 gate is right, but **it is not what unblocks 44-56.**
Those are blocked by a network transport, a channel credential only Nick can
create, and a phone. Phase 5's precondition is a self-imposed *policy* gate.
Conflating the two would put a large refactor on a critical path it does not sit on.

    NICK: channel bot token --> F(bridge) --> 44, 45, 56-lite, 41-push
    NICK: Apple Dev $99 -----> 48-signing, 49-FaceID, 65, 66, distribution
    NICK: a phone -----------> 34-mobile, 42-mobile, 49-device, 56, 65, 66, 84
    NICK: London/timezone ---> B
    NICK: a timetable -------> university mode

## 7. Stop doing

1. Adding v2 backend modules. Six have zero non-test importers.
2. Treating MobileCore as progress. Freeze it as a domain spec.
3. Building v2 duplicates of live capabilities -- Gmail, Calendar, health,
   memory, tasks are all live. `email_send` in v2 builds what the live system
   deliberately stubs.
4. The numbered march. Phase 33 is not next in any meaningful sense.
5. Deep-reviewing 21-32. Review depth should follow live-ness.
6. Maintaining `orion/*.py`. Archive it.
7. Any plan to rewrite the live gate in Python.

**Keep from v2** (~2,000-2,500 lines): `orion/security/` as oracle and written
spec; `orion/core/context/policy.py` (has a real consumer); `ownership.py`,
`plaintext.py`, `broker.py` as patterns worth re-expressing in TS; and
`orion_v2_policy_check.py`, which becomes Batch C's CI gate.

## 8. Decisions only Nick can make

1. **Have you moved to London?** `USER.md` told Orion to ask. Blocks Batch B.
2. **Is a phone coming?** Six phases and `REC-USABLE-CLIENT` hang on it.
3. **The $99 Apple Developer Program.** Unblocks HealthKit, notarization, the
   Keychain prompt storm, code signing.
4. **A bot token** for the inbound channel. The receiving code is written.
5. **Do you want the focus feature at all?** 1,192 lines, two sessions ever
   completed, both abandoned under 25 seconds.
6. **Accept the re-pointing of Phases 1 and 5** onto the live TypeScript gate.
   `PHASE_GATES.json` records that the Phase 1 reading was "granted once, for
   Phase 1" and that any later phase inheriting it must say so explicitly.
