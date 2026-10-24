# 02b — History, 2026-09-01 to 2026-09-20: from backlog checkpoint to a guarded automation runtime

> Part of the ORION Learning Guide. Snapshot: 6c93032 (2026-10-14).
> Covers: the 136 commits authored 2026-09-01 through 2026-09-20 (`c26272f` … `04cbc1a`), plus
> `HANDOFF.md`, `docs/planning/v2/PROGRAM_CORRECTION_2026-09-01.md`, `docs/planning/v2/PHASE_GATES.json`,
> `docs/planning/v2/ROADMAP_AMENDMENTS.json`, `docs/planning/v2/PHASE_32_5_CAPABILITY_CHARTER.md`.
> Read after: the earlier history chapter(s) (02a, covering everything up to 2026-08-31) and the
> architecture overview. Read before: 02c (2026-09-21 onward: the local agentic runtime).

This chapter is a narrative. It tells you what was built in these twenty days, why, what went wrong,
what was walked back, and what the project learned. It has no runtime component of its own, so the
STYLE "section template" is used per **era** instead of per component: each era has *What was built*,
*Why*, *Key commits*, *Steps back*, *Lessons*, *Walk it yourself*, and *Questions to ask your tutor*.

## In this file

| § | Section |
|---|---|
| 0 | [How to read this chapter](#0-how-to-read-this-chapter) |
| 1 | [Where things stood on the morning of 2026-09-01](#1-where-things-stood-on-the-morning-of-2026-09-01) |
| 2 | [Era 1 — The backlog checkpoint (09-01, 00:47–00:54)](#2-era-1--the-backlog-checkpoint-09-01-0047-0054) |
| 3 | [Era 2 — The program correction and the lettered batches (09-01, 06:51–12:43)](#3-era-2--the-program-correction-and-the-lettered-batches-09-01-0651-1243) |
| 4 | [Era 3 — Back to the numbers: the health block, and 40–45 on paper (09-01, 17:29–23:45)](#4-era-3--back-to-the-numbers-09-01-1729-2345) |
| 5 | [Era 4 — Discord goes live, and the brain gets a phone line (09-02)](#5-era-4--discord-goes-live-and-the-brain-gets-a-phone-line-09-02) |
| 6 | [Era 5 — The sprint to Phase 84 (09-03 – 09-04)](#6-era-5--the-sprint-to-phase-84-09-03--09-04) |
| 7 | [Era 6 — Night run, capability repair, and the offline coder (09-05 – 09-07)](#7-era-6--night-run-capability-repair-and-the-offline-coder-09-05--09-07) |
| 8 | [Era 7 — Astra takes the product route: Today, the brief, Health truth (09-07 – 09-14)](#8-era-7--astra-takes-the-product-route-09-07-2248--09-14) |
| 9 | [Era 8 — The great reorganisation (09-15, 02:11–03:37)](#9-era-8--the-great-reorganisation-09-15-0211-0337) |
| 10 | [Era 9 — A phone you can pair, in the Simulator (09-14 – 09-17)](#10-era-9--a-phone-you-can-pair-in-the-simulator-09-14--09-17) |
| 11 | [Era 10 — Back to numbered gaps: file copy, Phase 76, the Phase 57 guard (09-18 – 09-20)](#11-era-10--back-to-numbered-gaps-09-18--09-20) |
| 12 | [The phase-by-phase story (33–84)](#12-the-phase-by-phase-story-3384) |
| 13 | [Steps back, catalogued](#13-steps-back-catalogued) |
| 14 | [Lessons that recur across eras](#14-lessons-that-recur-across-eras) |
| 15 | [Walk the whole period yourself](#15-walk-the-whole-period-yourself) |
| 16 | [Every commit in range](#16-every-commit-in-range) |

---

## 0. How to read this chapter

### 0.1 The range, checked

The brief asked for "about 136 commits" from 2026-09-01 through 2026-09-20. The suggested command
`git log --since=2026-08-31T23:59 --until=2026-09-21` returns **137**, because git's `--until` with a
bare date uses the *current time of day* and filters on *committer* date, so it lets in `8ef85c8`
(authored 2026-09-21 09:22 +0100). Filtering on **author date** instead gives exactly **136**:

```bash
git log --reverse --format='%h %ad %s' --date=short --since=2026-08-25 --until=2026-09-25 \
  | awk '$2>="2026-09-01" && $2<="2026-09-20"' | wc -l      # 136
```

First: `c26272f` (2026-09-01 00:47 -0400). Last: `04cbc1a` (2026-09-20 01:45 +0100).

Commits per day: 09-01 **34**, 09-02 **22**, 09-03 5, 09-04 4, 09-05 3, 09-06 6, 09-07 **19**, 09-08 2,
09-09/10 0, 09-11 2, 09-12 2, 09-13 2, 09-14 9, 09-15 10, 09-16 7, 09-17 1, 09-18 4, 09-19 2, 09-20 2.

By conventional-commit type: `feat` 61, `fix` 26, `docs` 18, `chore` 4, `test` 3, `refactor` 3, and
**21 with no type prefix** (one merge, `049b0d3`, and twenty commits from 2026-09-07 22:48 onward whose
style is different — see 0.3).

Net size: from the parent `1efd37c` to `04cbc1a`, `git diff --shortstat` reports **816 files, +123,984 /
−3,582 lines**. About 49k of those lines are the first ten minutes (Era 1), which committed weeks of
work that had never been committed.

### 0.2 Two clocks in the timestamps

Every commit up to `d0eeebb` (2026-09-07 22:48) is stamped **-0400** (New York, EDT). From `f597f7f`
(2026-09-08 22:46) every commit is **+0100** (London, BST). That flip is Nick's move to London for
Northeastern University's London campus, which landed on 2026-09-08 — a date that matters to Phase 40
(§3, §12). When this chapter says "09-07 22:48" it means New York time; "09-08 22:46" means London time.
They are only 23 hours apart in wall-clock terms but 28 hours apart in reality.

### 0.3 Who wrote what (two assistants)

The repo is worked by two AI assistants who cannot see each other's chats and communicate only through
`AGENTS.md`, `HANDOFF.md` and the other docs (`AGENTS.md`, "Relay protocol"). Over this period:

- **Claude sessions** (the long, explanatory conventional-commit messages). From `0e0036d`
  (2026-09-02 23:07) these carry `Co-Authored-By: Claude Opus 5`; the earlier 09-01/09-02 Claude
  commits do not. That trailer later became forbidden ("No Co-Authored-By lines", `AGENTS.md`, rule
  dated 2026-09-30), so the trailers in this range pre-date the rule.
- **Astra** — the project's name for ChatGPT/Codex ("Astra (ChatGPT/Codex) is the most capable reviewer
  on this project", `docs/agentic/LOCAL_AGENTIC_DEVELOPMENT_MISSION.md:31`). The twenty untyped
  commits from `d0eeebb` to `f830742`, and the terse typed ones after them (`afc1a18`, `964fd64`,
  `58e93ca`, `e08c128`…`04cbc1a`), are written in Astra's style (short imperative title, dense
  one-paragraph body, "Independent review", "Rollback scoped checkpoint"), and the 2026-09-14 15:57
  HANDOFF entry refers to "this Codex task" **(inferred: these are Astra commits; git records Nick as
  the author of all 136)**. The exception inside that stretch is the reorganisation (`a064dcc`,
  `355ec9f`, `8cc9cbe`, `ceb6b79`, `3941e8f`), which carries the Claude trailer.

Why it matters for study: the two assistants have different habits. Claude's commits explain the *why*
at length and frequently record their own mistakes; Astra's commits are small, numerous, record
"milestone N%" progress, and keep pushing a single product route through to installed proof. Several of
the "steps back" in this chapter are one assistant correcting the other.

### 0.4 Paths moved in the middle of the range

On 2026-09-15 (Era 8) the repo was reorganised. When you read a commit from before that date, translate:

| Before 2026-09-15 | After |
|---|---|
| `planning/…` | `docs/planning/…` |
| `openclaw-plugins/orion-control/…` | `plugin/orion-control/…` |
| `openclaw-workspace/…` (Orion's runtime prompt files) | `plugin/workspace/…` |
| `brain/…` (git mirror of the Obsidian vault) | `var/brain/…` |
| `data/…` (untracked local state) | `var/data/…` |
| `launchers/`, `web/`, `vault/`, `archive/orion-ui-prototype/`, `main.py`, `uv.lock` | deleted (`a064dcc`) |

All code citations in this chapter use **current** paths (as of `6c93032`). Commit stats quoted from the
time use the paths of the time.

### 0.5 Jargon you need before Era 1

- **Phase / the manifest.** The program is 85 numbered phases (0–84), listed in
  `docs/planning/v2/MANIFEST_PHASES.json`, generated from Nick's "Orion v two implementation plan". Phase
  numbers are the project's only scheduling vocabulary (`CLAUDE.md`).
- **Gate / `PHASE_GATES.json`.** Each phase has a record in `docs/planning/v2/PHASE_GATES.json` with
  `requirements` (each `passed` or `blocked`, each with evidence), `entrySatisfied` (were the previous
  phase's requirements all passed when this one was entered?) and `nextPhaseAllowed` (are all of this
  phase's requirements passed?). The checker `scripts/orion_v2_phase_gate.py:64-75` enforces only that
  those two booleans agree with the requirement statuses. The `status` string (`complete`,
  `in_progress`, `not_started`) is **not** checked against anything — keep that in mind every time a
  commit says a phase "closed" (see §12.1).
- **Deviation.** A phase entered before its predecessor's requirements all passed is recorded with
  `entrySatisfied: false` plus a written reason. That is the honest way to work out of order.
- **`pendingGateAmendments` / `scopeNotInManifest`.** Two registers in `PHASE_GATES.json`. The first
  records a gate whose wording conflicts with reality (proposed new wording, decided later in one
  reviewed pass). The second records something Nick wants that no phase covers (`AGENTS.md`, "When the
  manifest and reality disagree").
- **Phase 32.5 / `REC-*` gates.** Phase 32.5 is an additive documentation checkpoint, not a numbered
  phase: a capability charter (`PHASE_32_5_CAPABILITY_CHARTER.md`) and six "recovery gates" in
  `ROADMAP_AMENDMENTS.json` (`REC-REVIEW-11-20`, `REC-LIVE-FOUNDATION`, `REC-AUTHORITY-REPLAY`,
  `REC-READONLY-CONNECTOR`, `REC-USABLE-CLIENT`, `REC-OPERATIONS`). The phase-gate script does **not**
  read them; they must be checked by hand.
- **The live stack vs the v2 stack.** The *running* assistant is (a) a Swift macOS app in
  `native/Orion` and (b) a TypeScript plugin, `orion-control`, loaded by the **OpenClaw** gateway (a
  Node agent host that runs the model, tools and cron jobs and lives in `~/.openclaw`). The *v2* work of
  phases 1–32 produced a Python package `orion/` and a Python `backend/`, plus a Swift domain library
  `MobileCore` in `native/OrionMobile` — none of which served a real request on 2026-09-01.
- **Mutation testing / "mutation-proven".** Deliberately break the code (delete a guard, flip a
  comparison) and check that a test fails. A test that still passes under the mutation was not testing
  what it claimed. Nearly every Claude commit in this range reports mutations.
- **Independent / "oblivious" review.** A reviewer agent given the manifest, the tree and the commands,
  but *not* the implementer's success narrative (`PHASE_32_5_CAPABILITY_CHARTER.md` §6). This range has
  four big ones: 11–20 (recorded in `2ca9e9c`), 34–40 (`4c800d9`), 43–45 (`0d67b37`), 49–80 (`f8f69d2`).

---

## 1. Where things stood on the morning of 2026-09-01

What the records said (from `docs/planning/v2/ROADMAP_AMENDMENTS.json` `checkpoint` and the Phase 32.5
charter): **Phases 0–32 complete, Phase 33 not started**, Phase 32.5 closed 2026-08-27.

What the machine actually held, measured by the 09-01 program correction
(`PROGRAM_CORRECTION_2026-09-01.md` §1):

| Stack | Size | State on 2026-09-01 |
|---|---|---|
| Mac app (Swift) | 122 files, 35,433 lines | **Live**, v1.2.0 build 121 installed |
| OpenClaw plugin (TS) | 12,079 lines | **Live**, 78 actions in 24 tiers |
| Python `orion/*.py` | 74 files, 9,116 lines | Dead — "not the implementation path since 2026-07-28" |
| v2 `backend/` | 69 files, 11,200 lines | Could not serve a request |
| v2 `MobileCore` | 15 files, 2,023 lines | No views, no app target |

And, crucially, **most of phases 2–32 had never been committed.** The working tree carried weeks of
uncommitted work from more than one session. The Phase 32.5 charter §6 ("Existing mixed-backlog
recovery") had already written the plan for committing it: group by phase range, explain inseparable
hunks rather than invent history, review 11–20 first, scan for secrets, then make detailed local
commits. It also explicitly said no such recovery commit had yet been made. That is where Era 1 begins.

A stale `.git/index.lock` (zero bytes, dated 2026-08-20 13:57) had been blocking index writes for twelve
days (`b198d7f`). Nobody had noticed because nobody had tried to commit.

---

## 2. Era 1 — The backlog checkpoint (09-01, 00:47–00:54)

Ten commits in seven minutes: `c26272f`, `5819ca8`, `4ab0f9a`, `6899867`, `e1651a3`, `2ca9e9c`,
`1c9c503`, `b198d7f`, `049b0d3`, `0479439`.

### What was built

Nothing new — this era *committed* what existed, in the grouping the charter prescribed:

| Commit | Group | Size |
|---|---|---|
| `c26272f` | Phases 2–10 local core: context firewall, event bus, job system, model contract, inference ingest, schemas, tool registry, security layer (`orion/core/*`, `orion/security/*`, `orion/mac/*`) | 39 files, +6,042 |
| `5819ca8` | Phases 11–20 server side: `backend/` db, vault, auth, devices, pairing, sync, memory — in its *post-review* state | 38 files, +5,020 |
| `4ab0f9a` | Phases 21–30 server side: tasks, planner, connector broker, calendar, Gmail (request builders with no transport) | 31 files, +6,180 |
| `6899867` | `MobileCore` domain layer + `MobileCoreCheck` self-check (Foundation-only, no UI) | 17 files, +3,445 |
| `e1651a3` | Six read-only check scripts and the `test_v2_*` suites (1,437 Python tests, 335 Swift checks) | 38 files, +13,318 |
| `2ca9e9c` | Paper trail: phase plans 2–32, `PHASE_GATES.json`, manifest, charter, `ROADMAP_AMENDMENTS.json`, capability registry, and the **Phases 11–20 review report** | 50 files, +14,590 |
| `1c9c503` | Live app/plugin work by *the other assistant*: Keychain-backed provider secrets, `enableStrictArguments`, TTS daemon changes — committed separately "because they are not part of the v2 phase work and should be revertable on their own" | 18 files |
| `b198d7f` | Records the checkpoint in both handoffs, the stale index lock, and the secret-scan result | docs |
| `049b0d3` | Merge `origin/main` into the branch | merge |
| `0479439` | Allowlists a secret-scan false positive the merge brought in | 1 file |

### Why

Three reasons stated in the messages:

1. **Nothing was recoverable.** "Committed in one piece because none of it was ever committed: there is no
   earlier state to reconstruct a per-phase history from, and inventing one would be a fiction about work
   that did not happen that way" (`c26272f`). The phase records in `PHASE_GATES.json` carry the real
   sequence instead.
2. **The review had to land with the code.** The Phases 11–20 review (six reviewers, each given the
   manifest and the recorded exit claims *as claims under audit*) found **five of ten phases not complete
   as claimed, 64 defects, 62 repaired and mutation-tested, 3 registered** (`2ca9e9c`). Because nothing had
   been committed, the fixes were inseparable from the code, so `5819ca8` is "the post-repair state, not the
   state the phases closed in". The original claims are preserved verbatim under `postReviewCorrections` in
   each phase record; "rewriting them would have read better and destroyed the most useful thing the review
   produced: evidence that self-assessment in this program is unreliable."
3. **REC-REVIEW-11-20** could close; **REC-OPERATIONS** could not ("this is a local checkpoint on a branch,
   not a remote backup").

Repairs worth knowing from `5819ca8` (each mutation-tested): `auth/service.py` minted a session for a
caller-supplied `user_id` separate from the verified account; `devices/registry.py` `adopt()` produced a
PAIRED device with no signature, and `_key_id` truncation made two device ids collide; `sync/engine.py`
`since(cursor)` never returned edits; `db/migrations.py` assigned `APPLIED_CHECKSUMS` *from the live
checksum*, so "was this edited?" was `x == x`.

### Key commits

- `2ca9e9c` (09-01) — the review report and the program's whole paper trail, plus ten new traps in
  `AGENTS.md`, the most useful being "a mechanism which verifies itself against itself always passes."
- `049b0d3` (09-01) — the merge. The branch had been cut from `1efd37c` and worked a whole session
  against a stale `main`: `origin/main` was four commits ahead (Nick's own, from 2026-08-20). The session
  "checked `git log` at the start and never fetched", and `git log` reads the *local* ref. Merged, not
  rebased, because the branch had been pushed minutes earlier and rebase on a pushed branch is banned.
- `1c9c503` (09-01) — the `enableStrictArguments` flag (`plugin/orion-control/src/index.ts:430`, read at
  `:842`): rejects arguments an action does not declare, only for actions with no hand-written validator,
  **default off** because turning it on would break calls that work today.

### Steps back

- **Wrong dates, recorded honestly.** "This work ran 2026-08-28, the handoff was written 00:00 on the
  29th, the machine rebooted at 13:22, and these commits are stamped 2026-09-01. Three dates, none
  back-dated, all recorded" (`2ca9e9c`). Two historical numbers could not be reconciled and were *left*
  unreconciled: gates 14 and 15 both claim 867/867 tests; gates 19 and 20 both claim 103 Swift checks.
- **Stale `main` / fetch-not-log** (`049b0d3`). This repeated an 08-20 trap already in `AGENTS.md`.
- **Self-verifying tests** found by the review: a checksum assigned from the value it checked, a wall-clock
  guard comparing two identical objects, a migration set generated from the schema it was checked against,
  and four enum guards that pinned a *count* — which let two manifest sections be replaced by "Steps" and
  "Calories" with everything green (`e1651a3`).

### Lessons

- When history is missing, commit the truth as one honest lump and put the sequence in the records; do not
  fabricate per-phase commits.
- A count is not a content check. Pin contents.
- `git fetch` before trusting `git log`.

### Walk it yourself

```bash
git show --stat c26272f 5819ca8 4ab0f9a | less            # what "Phases 2-30" physically are
sed -n 1,80p docs/planning/v2/PHASE_11_20_REVIEW_REPORT.md # the review that started the habit
python3 -c "import json;p=json.load(open('docs/planning/v2/PHASE_GATES.json'))['phases'];print(json.dumps(p['14'].get('postReviewCorrections'),indent=1)[:1500])"
```

### Questions to ask your tutor

1. Why is "post-repair state committed in one piece" more honest than a reconstructed per-phase history?
2. What exactly is wrong with `APPLIED_CHECKSUMS = live_checksum`? Write a one-line test that would catch it.
3. Why does rebasing a pushed branch break this repo specifically? (Hint: `CFBundleVersion` is a commit count.)
4. Why keep the original false claims verbatim instead of correcting them in place?

---

## 3. Era 2 — The program correction and the lettered batches (09-01, 06:51–12:43)

Nine commits: `250c0ed`, `3143c50`, `9c511d2`, `7c69a47`, `d9cc23d`, `184c4a5`, `168351c`, `50f7110`,
`0eb1d00`.

### What was built

**A diagnosis.** `250c0ed` (06:51) is the result of seven fresh-context audits (Mac app, live execution
path, v2 stack, manifest 33–84, plan lineage, core convergence, re-sequencing). It wrote
`PROGRAM_CORRECTION_2026-09-01.md` and changed `ROADMAP_AMENDMENTS.json`, `AGENTS.md`, `CLAUDE.md`,
`NICK-TODO.md` and both handoffs. No code. Its findings:

- The manifest contains **zero** occurrences of "OpenClaw" in 2,644 lines; its Phase 0 says "Document
  the current Python runtime" three weeks after the running assistant's own memory had recorded that the
  Python package is not the implementation path.
- **ORION Core already exists in TypeScript** on the live route — `permissions.ts` + `validator.ts` +
  `provenance.ts` + `outcome.ts` + the append-only ledger — and `orion/security/profiles.py` concedes it in
  its own docstring. So Phase 1/5's exit gate should be closed by *re-pointing the record*, not by a rewrite.
- The parity harness `scripts/orion_v2_policy_check.py` ("never more permissive across 390 combinations")
  tests **one point in a five-dimensional space**: with `external_data_involved=True` it found 54 stricter
  outcomes and 25 denials, including `messages_send` and every `self_*` action.
- Two of Nick's four top-ranked gaps were already delivered off-manifest: proactivity (three live cron
  jobs) and memory retrieval (`orion-recall`, local embeddings).
- **Live defects:** the Mac app *violated* Phase 33 (raw HRV and resting heart rate in a model prompt,
  `HealthSummary.swift:71,76` at the time); all three cron jobs pinned to `America/New_York` while
  `USER.md` said Nick was moving to London before the end of August and Orion should "ask once"; a focus
  session wedged open since 2026-08-12; camera presence 504 failures/0 successes; Sparkle pointing at a
  literal `ORION_OWNER/ORION_REPO` placeholder; `Info.plist` claiming calendar access "only reads".

**And a plan — the part that was later withdrawn.** §5 of the document replaced the numbered phases with
**lettered batches A–H**, each a goal with a day estimate: A "stop the running system lying, and give it an
off switch"; B "the London batch"; C "close the Phase 1/5 gate honestly"; D situational awareness; E
proactivity widened; F cost and reach; G delegation; H "the register" of declined/parked work. The original
header claimed the document "supersedes the *ordering* of the 85-phase manifest", and the commit title says
"the manifest's ordering was derived from a fiction".

**Batch A** (09-01, 11:42–12:03):

- `9c511d2` — a paused focus session now **expires**: `SessionStatus.readyToAbandon`
  (`native/Orion/Sources/SessionDomain/Reconcile.swift:55`), measured 18 hours from the *last event* so
  heartbeats can only delay it. A real session paused 2026-08-12 had accrued 60 heartbeats and 48 process
  starts over twenty days. Also fixed the false `Info.plist` calendar promise (Orion can only change events
  it created, tracked in `orion-created-events.json`), and diagnosed ElevenLabs with no code change: the TTS
  daemon had been killed 2026-08-18 and nothing restarted it, because **launchd cannot read `~/Desktop`**,
  and it also needed `ORION_TTS_CLOUD_VOICE=1` (`scripts/orion_tts_daemon.py:343`).
- `7c69a47` — **Phase 33, the health privacy firewall, built into the live Mac app.** `PlanningSignal`
  (`native/Orion/Sources/Orion/PlanningSignal.swift:69-80`) carries categories and a reason, never a
  number a person could read as a measurement. This added `.package(path: "../OrionMobile")` to the Mac
  app — "the first real wire between the two stacks".
- `d9cc23d` — **`scripts/orion-lock` (LOCK ORION, Phase 43):** drops the permission profile to
  `restricted_read_only` and disables every cron job, through the plugin's own `changePermissionProfile`
  so the audit is written first. Also: camera diagnosed and deliberately *not* fixed (see Steps back), and
  Sparkle stops blaming the network for a placeholder feed (`UpdateController.swift:90` `feedIsPlaceholder`).
- `184c4a5` — records Batch A closed, **Phase 33 complete** with two registered deviations, manifest
  position "Phases 0-33 complete; Phase 34 not started", and `ROADMAP_AMENDMENTS.json` naming B and C next.

```swift
// native/Orion/Sources/Orion/PlanningSignal.swift:69
struct PlanningSignal: Equatable {
    var sleep: SleepState = .unknown
    var physicalRecovery: PhysicalRecovery = .unknown
    var physicalLoad: PhysicalLoad = .unknown
    var cognitiveCapacity: EnergyState = .unknown
    var stressTrend: StressTrend = .unknown
    var confidence: BaselineConfidence = .low
    var freshness: SignalFreshness = .unknown

    /// A sentence with no numbers in it. Built here rather than forwarded from
    /// MobileCore, for the reason in the header.
    var plannerReason: String = "no health readings yet"
```

**Batch B** (09-01, 12:24–12:43) — "the London batch":

- `168351c` — **Phase 40's time model as types** in `SessionDomain`: `CivilDay` (a date with no instant),
  `ZonedInstant` (UTC instant + anchoring IANA zone + original zone, with `rezoned(to:)` vs
  `reanchored(to:)`), `AllDaySpan`, `ZonedTime` (a sum type with **no** `instant` property), and
  `TimeZonePolicy` with an `ExpectedMove` recorded in advance. Tests 322 → 367. And a **live dormant
  bug**: `CutoffDayKeys` computed the 4 am day boundary in the injected calendar's zone, then rendered it
  with a static `DateFormatter` that had no time zone — i.e. in the *machine's* zone.

```swift
// native/Orion/Sources/SessionDomain/Identifiers.swift:124
    public func key(at instant: Date) -> String {
        CivilDay(of: dayStart(at: instant), in: calendar.timeZone).key
    }
```

  The deleted formatter is explained in the comment left in its place: measured on a New York machine with
  a London calendar, instant `2026-09-08T04:30Z` gave `key() → "2026-09-07"`. "It survived 322 tests
  because the tests inject `America/New_York` on a machine that IS `America/New_York`."
- `50f7110` — **the operational half**: `scripts/orion-timezone` (`status / plan / set / expect /
  clear-expected`, verifies by *re-reading* the cron jobs, `scripts/orion-timezone:386`); `location.json`
  (home, place, `expectedMove`) in exactly `TimeZonePolicy`'s Codable shape; `orion-standing` reporting a
  home-vs-machine mismatch in the morning and evening checks but **never hourly**; `orion-weather-alert`
  reading the place instead of a hard-coded "Montvale, New Jersey"; `scripts/orion-project` (milestones
  with dates — registered in `scopeNotInManifest` because no phase defines a project); `USER.md` regains
  the university (Northeastern) lost in an 08-14 rewrite. It also corrected the correction: only **one**
  cron job (`orion-daily-memory`, 02:10 NY = 07:10 London) actually moves; the other two are
  zone-independent.
- `0eb1d00` — `run-timezone-set-test.sh` drives the real `orion-timezone set` against a fake gateway (18
  checks), with the load-bearing assertion that **a failed re-home does not write the record**; and then
  once *for real* against the live gateway at 12:41–12:43 EDT, there and back, ending byte-identical.

### Why

The correction's diagnosis was the trigger: if the manifest's inventory was wrong, maybe its order was
too. The batches were grouped by *goal*, and §5's "Why proactivity is fifth" argued a genuinely true point
about prerequisites: a proactive assistant with no off switch (A), on the wrong timezone (B), that cannot
tell whether Nick is on a call (D), "gets muted within a day, permanently".

Batch A and B were also driven by real dates: Nick was moving on ~09-07 and landing 09-08, and Phase 33
was being violated in the installed app that morning.

### Key commits

- `250c0ed` (09-01 06:51) — the correction (findings + the withdrawn re-sequencing).
- `7c69a47` (09-01 11:50) — Phase 33 in the live app; numeric firewall test.
- `d9cc23d` (09-01 12:00) — `orion-lock`.
- `168351c` (09-01 12:24) — the time model and the day-key bug.
- `50f7110` (09-01 12:39) — `orion-timezone`, `location.json`, `orion-project`.

### Steps back

- **The lettered batches.** See §4 for the withdrawal, which came five hours later. Note that `50f7110`
  still ends "NEXT: Batch C — close the Phase 1/5 gate by RE-POINTING the record"; that next step never
  happened as a batch.
- **The camera fix that was reverted by its own tests** (`d9cc23d`). Raising camera presence's sample
  window from 1.5 s to 4 s broke `testTheDutyCycleIsUnderTwoPercentAsClaimed`, which asserts
  `sampleDuration / sampleInterval < 0.02` — a number shown to the user in a privacy disclosure. 4 s
  against 90 s is 4.4 %. Reverted; the two real fixes are recorded at the constant
  (`native/Orion/Sources/SessionService/CameraPresence.swift:56-68`).
- **`orion-lock` checked for a status the writer never returns.** It treated `"applied"` as success;
  `changePermissionProfile` never says that, so a *successful* lockdown would have reported failure. Caught
  only by running it against copies of live state (`d9cc23d`).
- **Imprecise defect report.** "All three cron jobs are pinned" was true; "his morning brief fires at the
  wrong hour" did not follow (`50f7110` correcting `250c0ed`).
- **The re-home that waited too long (later).** The cron jobs were deliberately left on New York until he
  landed: "One command on the day he lands, and orion-standing raises it the morning after." He landed
  2026-09-08. The command was actually run on **2026-09-25 20:35 BST** (PHASE_GATES Phase 40 evidence;
  `~/.openclaw/orion-controlled/location-audit.jsonl`). For all of Eras 7–10, `orion-daily-memory` ran on
  New York time in London. The mechanism worked; the "raise it the morning after" nudge did not produce
  action for 17 days **(inferred: no record shows why; the HANDOFF entries of 09-08 to 09-20 never mention
  it)**.

### Lessons

- A finding about the *inventory* is not a finding about the *order*. (The withdrawal's own words: "a wrong
  inventory at the front of a document is a reason to re-read what follows it, not a reason to throw away
  the sequence.")
- Grep the tests before changing a constant that appears in user-facing text — "under two percent" was a
  tested invariant, not prose.
- Check a writer's actual return vocabulary.
- A date written in prose ("ask once after the move") has nothing watching it. Record it as data
  (`expectedMove`) and give it a reader.
- Injecting a dependency proves nothing when the injected value equals the ambient one.

### Walk it yourself

```bash
sed -n 1,60p docs/planning/v2/PROGRAM_CORRECTION_2026-09-01.md   # the withdrawal header
sed -n 172,233p docs/planning/v2/PROGRAM_CORRECTION_2026-09-01.md # §5, the batches, as a record
git show 168351c -- native/Orion/Sources/SessionDomain/Identifiers.swift
scripts/orion-timezone status        # read-only: home, machine zone, cron zones, verdict
```

### Questions to ask your tutor

1. In `ZonedInstant`, what is the difference between `rezoned(to:)` and `reanchored(to:)`, and which one
   would silently move a dentist appointment by five hours?
2. Why does `ZonedTime` deliberately have no `instant` property?
3. Why should `orion-timezone set` refuse to write `location.json` if one cron job did not move?
4. Why must the mismatch warning in `orion-standing` be morning/evening only, never hourly?
5. What does "parity at one point in a five-dimensional space" mean for `orion_v2_policy_check.py`?

---

## 4. Era 3 — Back to the numbers (09-01, 17:29–23:45)

Fifteen commits: `79623cd`, `6261878`, `8caec71`, `53cd339`, `f01c161`, `86b0f62`, `9846307`, `1fa0e9f`,
`36ae8a0`, `4b49482`, `0fd0f6b`, `40ee6e3`, `9dda027`, `3a06d1f`, `a0123aa`.

### The withdrawal of the batches

There is no commit titled "withdraw the batches". Here is how it actually happened, from the diffs:

- 12:39 — `50f7110` says "NEXT: Batch C".
- 17:49 — `8caec71` (Phase 34) opens "**Back to numbered phases.** 34 is the first of the health block
  (34-39), none of which touches the dead Python runtime -- which is the evidence that the 'ordering is
  superseded' conclusion was over-generalised from a real finding about Phase 0."
- 17:58 — `53cd339`, titled only "feat(phase-35): the natural-language health journal", **also** rewrote
  `PROGRAM_CORRECTION_2026-09-01.md` (+114 lines: the "Read this first: half of this document was withdrawn"
  header, §5 relabelled "WITHDRAWN, kept as a record", §7 item 4 struck through), rewrote
  `ROADMAP_AMENDMENTS.json` (311 lines changed; `programCorrection.supersedes` now says "NOTHING in the
  manifest's ordering…"), rewrote `AGENTS.md` and `CLAUDE.md`, and moved all pre-2026-08-27 handoff entries
  into `planning/_archive/` (≈3,800 lines). None of that is mentioned in the commit message.

So the decision was made in Nick's conversation some time between 12:43 and 17:49 **(inferred)**, and
landed as a side-car inside a feature commit. The reasons, from the header that commit added
(`PROGRAM_CORRECTION_2026-09-01.md:5-49`):

1. The inference was never checked against the downstream phases, and it does not survive checking:
   Phases 34–39 (Health UI, Health Journal, Behavior Correlations, Experiment Mode, Health-Aware Planning,
   Daily Planning) all attach to health data, a firewall and a planner in `native/Orion`; none has a Python
   dependency.
2. It "failed the person it was for. Nick tracks numbered phases; 'Batch C' named nothing he could locate in
   the manifest, and a plan whose owner cannot find himself in it is not a plan."

What survived is **the interpretation rule** now quoted in both `AGENTS.md` and `CLAUDE.md`: where a phase
refers to the Python runtime, read it against the live Swift app and TS plugin — "This changes how
requirements are READ; it does not change their ORDER." "Batch A" and "Batch B" survive only as labels for
two bundles of 09-01 work (Phase 33 + Phase 43, and Phase 40). "There is no Batch C."

### What was built

**Two Keychain decisions** first (17:29–17:32):

- `79623cd` — the $99 Apple Developer Program is **closed as a question**: Nick's words, it comes "at the
  very end of all the phases… it will not exist for the time being. we can still create the app without
  it." Also answers "what is a bot token": `.env` already held a Discord *webhook* (one-way), and reading a
  reply needs a bot account whose secret is a bot token — free, unrelated to the $99.
- `6261878` — **correction twenty minutes later.** `79623cd` had said there was "no seam for the Keychain
  at all"; wrong — its grep looked for `protocol.*Secret` and missed `enum SecretStore`. The whole app
  touches the Keychain in exactly two places, four `SecItem*` calls. Instead of a speculative refactor, it
  added `tests/test_keychain_call_sites.py`, which pins *which* files and calls exist and refuses
  `kSecUseDataProtectionKeychain`/`keychain-access-groups` while self-signed (claiming them gets the process
  SIGKILLed).

**The health block, 34–39, in numeric order, in about 25 minutes of commit time** (17:49–18:13). Every one
puts the manifest's prohibitions *into a type* in `MobileCore`:

| Phase | Commit | The type that enforces the rule | Notable defect found |
|---|---|---|---|
| 34 Health UI | `8caec71` | `SectionNarrative` refuses clinical terms, >3 figures (`figureBudget`), and interpretation below 7 days of history ("low confidence may OBSERVE and may not INTERPRET") | `WhoopWeek.points` is oldest→newest, the model's series newest-first; a bare `.reversed()` would invert every trend silently → named `newestFirst` |
| 35 Journal | `53cd339` | Deterministic `JournalExtractor`, not an LLM; ORION's vocabulary filtered, Nick's notes stored verbatim | Unreachable clarification branch; "Big breakfast this morning" resolved to 8 PM; a near-miss assertion (`hour != 2`) |
| 36 Correlations | `f01c161` | `AssociationPhrase` closed type — it "cannot spell" a causal claim; below the sample floor the effect is not even *computed* | A code comment claimed pooled spread prevents inflation; a fixture showed MAD is resistant anyway — comment rewritten as a judgement |
| 37 Experiments | `86b0f62` | `ExperimentResult` has no success boolean; >⅓ confounded days → inconclusive | (found later by review: computed over all history, not the window) |
| 38 Health-aware planning | `86b0f62` | `PlanningAction` has `moveLater/shorten/protectRest` and **no** cancel/skip; `Recommendation.init` refuses a required commitment | Half of 38 had already shipped under 33 (`PlanningSignal`) — recorded rather than rebuilt |
| 39 Daily planning | `9846307` | `DayPlan.propose` defers by name when the budget is spent; `EstimateCalibration` = median ratio, 5-sample floor, clamp | `estimateAccuracy` is `nil` with no data, not 1.0 |

`9846307` also records the sequence rule working: Phase 40 had been opened out of order with
`entrySatisfied: false`; closing 39 made the gate validator *refuse the whole document* until that flag was
corrected, "the entry is now legitimate because the phases before it are actually done".

`1fa0e9f` then wrote `.claude/skills/orion-phase/SKILL.md`, naming the two most expensive mistakes first:
re-planning instead of building (the batch scheme), and building what already exists (Phase 38's half).

**Phases 40–45 at night** (23:10–23:45):

- `36ae8a0` (40) — `AgendaPlacement`: all-day events compared by **civil day**, timed ones by instant. A
  live defect: "8 September, all day" written in London is stored as `2026-09-07T23:00Z`, which a New York
  calendar read as the 7th. The old rule fails 445 assertions across all 443 zones. `Journey` (a flight) is
  two `ZonedInstant`s; duration from instants (NY 18:00 → London 06:00 is 7 hours, not 12). Travel Mode is
  a *reading layer* that never re-homes anything. "Written and verified in the previous session; committing
  was blocked by a TCC failure, not by the code."
- `4b49482` (41) — three notification levels (immediate/brief/ambient). Ambient has no code path to a push;
  `NotificationItem` has no payload field (pinned by reflection); `plan()` is idempotent and
  order-independent. The DST mutant that *survived*: 23:30 GMT + 86,400 s on the London spring-forward night
  lands on the 30th, so the naive brief "simply never fires" on 29 March. Entered out of order with
  `entrySatisfied: false` because 40's last requirement was a calendar date.
- `0fd0f6b` (42) — Security Center: eight panels, seven actions, and every action **removes** authority or
  reads; `SecurityActionEffect` has no `grantsAuthority`. A cross-language check fed the *real*
  `CURRENT_AUTHORITY.json` and found `"flag": null` on the `simulation` tier crashing a non-optional Swift
  `String` — which would have rendered a **blank** permission panel, i.e. "nothing is allowed", the most
  dangerous wrong answer on a security screen.
- `40ee6e3` (43) — `scripts/orion_v2_lock_check.sh`, 14 assertions against the real `orion-lock` in a
  scratch HOME. The gate stays open: no dispatcher to stop, no queue to cancel, no lease to expire, no
  reauthentication, and "locked" was only an *inference* (`profile == restricted_read_only`).
- `9dda027` (44) — the remote link's policies proven with **no transport stubbed** ("a fake connector that
  pretended to connect would make every test here meaningless"). "Unknown is not offline"; backoff bounded at
  both ends; key pinning fails closed. Its own security test first flagged `orion/web.py`'s SSRF denylist for
  containing `0.0.0.0` — "a test that reports a security control as a vulnerability is worse than no test".
- `3a06d1f` (45) — read-only remote jobs. Replay (same id twice → refused) vs duplicate (same request, new
  id → accepted, only because every capability is a read). Wrong-device jobs refused *and not recorded*.
  Found that live `scripts/orion-remote` stamps an `at` timestamp and **never reads it back**, and has no
  device routing.
- `a0123aa` — summary: 41, 42 complete; 43, 44, 45 open, and "the one credential that unblocks three of
  them" is a Discord bot token.

### Why

The withdrawal returned the program to the manifest's order, and the health block was the cleanest proof
that the order was fine. The night's 40–45 were driven by the remote channel: three phases were waiting on
one credential, so the session built every part that did not need it and recorded each blocked requirement
by name.

### Steps back

- The **batches withdrawn** (above), landed silently inside `53cd339`.
- `6261878` **reversing `79623cd`** after 20 minutes — an overstatement "in the direction that makes the
  remaining work look bigger than it is".
- Phase 38 "half built twice": the cleanup pass flagged it in time.
- Phases 41–45 were entered with `entrySatisfied: false` (deviations), because 40 was waiting on a date and
  43 needed 44's machinery ("waiting for 43 to close would deadlock", `9dda027`).

### Lessons

- **A prohibition is best implemented as an absent enum member.** This era's signature move: no `cancel` in
  `PlanningAction`, no causal phrase in `AssociationPhrase`, no `grantsAuthority`, no payload on a push.
- **Feed checks the real file, not a hand-written fixture** (the `"flag": null` find).
- **Low confidence may observe, may not interpret.**
- **Grep before designing** — three phases in a row found most of their work already existed.

### Walk it yourself

```bash
sed -n 88,100p native/OrionMobile/Sources/MobileCore/HealthPlanning.swift   # PlanningAction: no cancel
grep -n "enum SecurityActionEffect" -A6 native/OrionMobile/Sources/MobileCore/SecurityCenter.swift
git show 53cd339 --stat      # notice what a "Phase 35" commit actually touched
python3 scripts/orion_v2_phase_gate.py --phase 39
```

### Questions to ask your tutor

1. Why is "the type cannot represent it" stronger than "the code checks for it"? Where does it break down?
2. Replay vs duplicate in Phase 45: why is it safe to accept a duplicate only because every capability is a read?
3. Why should a wrong-device job *not* consume a replay slot?
4. What does the `orion_v2_phase_gate.py` validator actually check, and what does it not check?

---

## 5. Era 4 — Discord goes live, and the brain gets a phone line (09-02)

Twenty-two commits, `4c800d9` through `703e301`. The busiest day for *reversals*.

### What was built

**Morning: review of 34–40** (`4c800d9`, `12e2c1f`). An oblivious reviewer found no dropped requirements,
judged 34/38/39/40 sound, and found real defects in 35, 36, 37:

- **Phase 37's finding was not computed over the experiment.** The association was built from `days` (the
  whole history), not `observed` (the window). Measured: a 14-day experiment printed "34 with, 14 without"
  beside "14 days observed", and out-of-window data **inverted the sign** of the finding. Mutating `days:` to
  `window:` left the suite at 665/0 — no test could tell.
- **Phase 35: "late" contains "ate".** "Really stressed and worked late." → *meal*. The vocabulary already
  had `"ran "`, `"run "`, `"saw "` with trailing spaces — "the same bug, patched one word at a time". Now word
  boundaries at both ends, with one ordinary inflection allowed.
- Four tests that could not fail, and the grammar bug "Caffeine is tends to coincide with lower recovery."

**Midday: the transport arrives** (`0af5235`, 13:31). Nick created the Discord bot token, so:

- `scripts/orion-remote-bridge` connects **out** to `wss://gateway.discord.gg/?v=10&encoding=json`
  (`scripts/orion-remote-bridge:55`), no listening socket, and refuses to start if
  `NODE_TLS_REJECT_UNAUTHORIZED` is `0` (`:585-586`). It holds no authority: it injects an envelope and lets
  `orion-remote` judge it.
- Phase 45's capabilities: `device.status.read`, `application.list`, `files.safe_metadata` — `files` takes one
  of three directory **names**, never a path. "Running application" took three definitions (62 agents; then
  widget extensions making News/Stocks/Home look "running"; finally "an executable directly in a top-level
  bundle's MacOS").
- `orion-remote` finally reads back its own `at` timestamp (expiry) and refuses envelopes addressed to
  another Mac *before touching state*.
- Phase 43: a real `lock.json` flag (`scripts/orion-remote:59`, `scripts/orion-lock:65`), cursor advanced
  past queued jobs, pending approvals expired, gateway session dropped. `release` restores listening but
  **not** authority.

**Afternoon: review of 43–45** (`0d67b37`, 13:59) judged 43 "no" and 44/45 "partly", and was right:

- **Sender forgery.** The bridge built `inject <text> --from <id>`; the parser treated any argv entry starting
  with `--` as a flag. A message of `--x` swallowed the `--from`, the sender fell back to `local`, and where
  `local` is allowlisted the message was authorised as the local account. Thirteen such messages also
  exhausted the rate budget and locked Nick out. Fixed four independent ways.
- **LOCK ORION failed open.** The comment said the flag goes up first; the code wrote it last, after a
  `changePermissionProfile` that exits 1 on `stale` — exactly what a concurrent write produces during the
  ~15 s `cron list` can take. The current code still carries the explanation:

```js
// scripts/orion-lock:139
  /*
   THE REMOTE STOP HAPPENS FIRST, AND UNCONDITIONALLY.

   It used to happen after the permission change, and a comment claimed it went
   first. It did not, and the consequence was a panic button that FAILED OPEN:
   if `changePermissionProfile` returned `stale` -- which it does whenever
   anything else writes the profile during the fifteen seconds `cron list` can
   take -- this function exited 1 before writing the flag, and five of the six
   things a lockdown is supposed to do silently did not happen. ...
  */
  await stopTheChannel();
  await stopActionsAndGrants();
```

- The Phase 44 security invariant **skipped every extensionless file** — 51 executables, including the
  whole bridge. A wildcard listener planted in the bridge passed all 57 tests.
- A TTS-socket flake (1 in 6 runs) traced to `client.connect` returning `None` for any `OSError`.
- **Nick's reversal of a least-privilege call:** `0af5235` had dropped Discord's privileged
  `MESSAGE_CONTENT` intent (after close code 4014) so the bot would be "deaf to everything else". Nick
  reversed it: the guild exists for Orion and he is its only member. Kept: a message is an *instruction*
  only as a DM or @mention.

**14:14 — Phase 45 closed by a real round trip** (`750322e`): Nick DM'd `device`; the audit shows the
forged `--x` attempt refused immediately before the legitimate message accepted. Two things only the live
test found: Orion showed OFFLINE (nothing supervises the bridge), and an un-mentioned channel message was
dropped *silently* — "a rule that cannot be seen working gets debugged as a bug".

**14:35 — the brain gets a phone line** (`c5c5175`). Nick: "the idea isnt i just say a word or two, the idea
is that its a remote way to directly speak to the orion brain." This **reverses a documented design
property** of `orion-remote` ("seven verbs, no fuzzy matching, NO FALLTHROUGH TO A MODEL"). Nick was shown
the trade — "whoever holds that Discord account holds the Mac" — and chose full authority and one shared
memory. Registered as `scopeNotInManifest` entry `remote_conversation_with_the_brain`. All six guards still
run first (allowlist, lock, routing, replay, expiry, rate limit); the message reaches the model as a
**file**, via `openclaw agent --session-key <orion-app-v2> --json --message-file <path>`
(`scripts/orion-remote:802-811`), the same session key the Mac app uses so a DM lands in the same
conversation. The reply is in `result.payloads[].text`; the first guess at the envelope shape
(`result.reply`, `result.text`…) would have answered every question with "(Orion had nothing to say)".

**Evening: making it persistent and honest.**

- `ea71395` — **the launchd/`~/Desktop` constraint solved**: install a *copy* outside Desktop
  (`~/.openclaw/orion-remote`), the way the OpenClaw gateway itself runs. `kill -9` → restart in ~12 s;
  `ThrottleInterval` 30 s. `--status` prints both fingerprints and says DRIFTED when the copy differs. The
  installed `.env` holds 2 values (bot token, allowlist), not the repo's 8.
- `f2c1c34` — **attaching the brain made the channel less honest.** Orion described his own configuration
  from documents ("orion-remote is live and gated at R1/R2"), offered to "enable exec to reach remote" while
  answering over it, and invented slash-command syntax. Fix: a short factual `CHANNEL_BRIEF` before every
  remote message (`scripts/orion-remote:493`).
- `031c46d` — `SOUL.md`'s "Runtime truth" section told Orion to use `TOOLS.md`/`SELF.md` "before claiming a
  limitation" — *files*, nineteen days stale. Now: call `orion_permission_status` every time. Regenerated
  `TOOLS.md` (78 live, 0 off) — and named the remaining gap: nothing reruns `orion-selfdoc` automatically.
- `5655b0b` — Nick: "expand his exec command abilities. its starting to pmo how little he can do." The exec
  allowlist had 35 read-only commands and 13 of 50 wrappers, and **no way to write a file**. +17 commands
  (including `git`); withheld `orion-keys`, `orion-forge`, `orion-repair`, `orion-timezone` (the allowlist
  matches the binary, not the subcommand), `orion-messages-send`. New `scripts/orion-skill` writes only under
  `~/.openclaw/workspace/skills/<name>/` (`scripts/orion-skill:43`), refuses credential shapes, keeps `.bak`,
  and has **no delete**. `orion-agenda-change` was added and removed in the same commit after reading its
  header.
- `52462f4` — `orion-recall` strips frontmatter and prints one note's first eight body lines, so every
  provenance field in the vault was invisible: Orion read his own July synthesis back as fact. Nine notes
  got a body-line provenance stamp; new `scripts/orion-note` writes to `~/Documents/orionBrain`
  (`scripts/orion-note:44`) with a required `--epistemic` kind.
- `80a6e46` — "a lot just happened and nothing worked the way i wanted." `pause` meant the music, and the
  verb parser captured it ("pause needs a mission id"). **This reverses `2dc51fd` from four hours earlier**
  ("a recognised verb with bad arguments… gets a straight answer") — right for a command channel, wrong once
  the brain was attached. Rate limit 12 → 40 per 10 min (`scripts/orion-remote:144`). Orion invented approval
  ids twice; the brief now names the real format.
- `68d1b5e` — **"my own brief was disarming a security gate."** The host records `CHANNEL_BRIEF` + Nick's
  message as one user turn; the plugin's `AUTHORITY_INSTRUCTION` regex (`plugin/orion-control/src/catalog.ts:728`,
  used at `validator.ts:493`) looks in the user's words for "enable/allow/grant/permission…" before allowing
  self-modification; the brief contained "enable" and "permission". So one of four self-modification gates
  passed on **every** Discord turn. The remote check now reads the regex out of the plugin and asserts no
  brief word matches (comment block at `scripts/orion-remote:476-491`).
- `aa8e95d` (Phase 46) — pausing Apple Music: a pre-flight `playerSnapshot` for evidence took **120 s** on
  this Mac, so the action died at 10.07 s without sending `playpause`: "verification was costing the action
  it verified". Bounded to 3 s. Also: Music was not answering AppleEvents at all (-1712), and a 291 ms
  "media key" route was deliberately *not* shipped because `key code 16` is plausibly the letter y. The
  manifest was **amended** on Nick's instruction (requirements added to 46, 48, 49).
- `2cf0445` — "get to phase 50 and stop": manifest re-fingerprinted (sha `f9fceb60` → `7cb01a57`, both
  recorded in `source.amendments`); 47 mostly already built (one gap: `files.copy`); 48 empty; **49's gate
  was satisfiable by the agent** — Orion passed `approvalHash` himself, "so the exchange Nick was walked
  through was theatre"; 50 had a vocabulary and no producer.
- `0e0036d` (23:07) — **the approval gate had nobody in it.** `validateTaskGraph` accepted
  `approval.canonicalHash` from the step, and the value it wanted was the one it had just handed back in the
  refusal. Now a **grant file written only by a person** opens the gate (`scripts/orion-approve`; grants and
  tickets under the plugin's approvals root, `plugin/orion-control/src/approvals.ts:135-136`); the hash
  still binds the approval to exact arguments. And a second axis: **strictness modes**
  `contained | guarded | open | sovereign` (`scripts/orion-mode`, `plugin/orion-control/src/strictness.ts:58`)
  — 62/114/123/124 actions run unannounced, 82/15/15/6 still ask — with a **floor no mode can lower**:
  changing what Orion may do, reaching someone not Nick, and anything irreversible
  (`strictness.ts:123-150`). `guarded` is the default and is held against `GUARDED_BASELINE.json`, a fixture
  pinned from `2cf0445`, "rather than against CURRENT_AUTHORITY.json, which the same command regenerates and
  which would therefore have agreed with anything". Approval ids became `A-7F3K` (no 0/O/1/I/L).
- `703e301` — `orion-authority explain` (the voice answer) now names the strictness mode too.

### Why

Remote access was Nick's #4 gap and the one credential he could provide. Once it existed he immediately
wanted *conversation*, not verbs, and *persistence*, not a demo ("the idea is that i can be far from my
computer and still get something done on it"). Each repair after that was the cost of giving a model a
remote ear.

### Key commits

`0af5235` (bridge), `0d67b37` (review: forgery, fail-open lock), `750322e` (first round trip), `c5c5175`
(brain attached), `ea71395` (launchd), `68d1b5e` (brief disarming the gate), `2cf0445` (manifest amended),
`0e0036d` (grants + strictness).

### Steps back

- **Four design reversals in one day:** least-privilege intent → full `MESSAGE_CONTENT` (Nick); "no
  fallthrough to a model" → brain attached (Nick); "a known verb with bad args is a typo" (`2dc51fd`) →
  "a bare verb is conversation" (`80a6e46`); 12 → 40 messages/10 min.
- **Pushed while red:** `0affc6d` — "Introduced in the previous commit, which I pushed while the remote check
  was failing -- the check had already caught this and I did not gate on it."
- **A fix to honesty that broke security** (`f2c1c34` → `68d1b5e`).
- **The Phase 49 "approval" exchange was theatre** until `0e0036d`.
- **Assertions that checked *that* something happened, not *what*** — twice in one day (`grep -qv` in
  `0af5235`; "STUBBRAIN saw" in `f2c1c34`).

### Lessons

- Every word you prepend to a user turn is, to the gate, something the user said.
- An authenticated transport with unchecked certificates is unauthenticated.
- A panic button must do the step that needs no cooperation first, and guard each step separately.
- Self-knowledge must come from a live tool call, not from a file in context.
- Never let the party being gated compute the gate's answer.

### Walk it yourself

```bash
sed -n 476,540p scripts/orion-remote          # the brief and the vocabulary it may not use
sed -n 136,170p scripts/orion-lock            # stop-first ordering
sed -n 88,150p plugin/orion-control/src/strictness.ts   # the floor
scripts/orion-mode status 2>/dev/null || true  # read-only: current mode
```

### Questions to ask your tutor

1. Walk through the `--x` sender forgery step by step. Which of the four fixes would have been enough alone?
2. Why does a grant *file in a directory Orion cannot write* close the Phase 49 hole when a hash did not?
3. What is the difference between the permission profile ("what exists") and the strictness mode ("what it costs")?
4. Why is `guarded` pinned against a fixture from `2cf0445` rather than the live authority snapshot?
5. Why did attaching the model to Discord make Orion *less* truthful, and what is the general fix?

---

## 6. Era 5 — The sprint to Phase 84 (09-03 – 09-04)

Nine commits: `b3d2cf5`, `05f661c`, `caf2333`, `e701537`, `3f05780`, `4b8915b`, `81d1744`, `f8f69d2`,
`b78391d`.

### What was built

- `b3d2cf5` — **voice approval** without speaker verification. `SpeakerVerifier.swift`'s own header refuses
  to be used for authentication ("A recording of his voice defeats it"). Instead, `authorizeTaskGraph`
  already mints `trusted_user` inputs from OpenClaw host provenance; so if *Nick's own turn* says "approve
  A-7F3K" a person said yes, whether typed, spoken or DM'd. A mention ("what does A-7F3K do?") is not a
  decision; ambiguity returns nothing.
- `05f661c` / `caf2333` — **Phase 51, structured dev operations**: seven typed actions over a closed table of
  repositories (`devops.ts`): repo named by key, cwd not an argument, constant argv (`git pull --ff-only`,
  `npm ci` never `npm install <x>`), environment from five allowlisted variables, SIGKILL timeouts, output cut
  in the *middle*. `caf2333` adds **57/58 automation as a proposal** (propose/list/simulate/withdraw; no
  install operation — installing is `scripts/orion-automation`, off the exec allowlist), records 52 and 54
  "passed by absence", and surveys 53–60.
- `e701537` — Phase 60 (`orion-focus start` prepares apps, git status, agenda), 63/64 (`orion-why` assembles
  recorded facts, does no reasoning; confidence derived, weakest step wins, `unable_to_verify` ≠
  `uncertain`), 67 (`orion-budget`; found a 6.4M-token day on 2026-08-09; dollar rates ship at **zero** rather
  than invented), 69 (19 attack classes mapped; the list lives in the *checker*), 70 (CI with security
  invariants first). Two wrong secret scans before reusing `orion_v2_secret_scan.py`.
- `3f05780` — "Last round I listed four things as 'cheapest next builds' instead of building them. That was
  wrong." Builds 62 (waiting-on, every item names an `expect`), 61 (prep cards; search terms extracted
  mechanically, never chosen by the model from an attacker-controllable title), 60's calendar half, 64, 67,
  68 (the hang test found a real bug: `npm test` spawns vitest; SIGKILL on npm left vitest holding stdout, so
  `close` never fired — fixed with a detached process group), 70 (`scripts/orion-deploy`, whose first load
  check rolled back a healthy deploy). 65/66 left for Nick at the keyboard because adding an app target
  touches the signing identity.
- `4b8915b` — 71 data inventory with a checker; 72 `orion-privacy`; 73 `orion-backup` (encrypted, no secrets
  — and the first version piped the passphrase *through* tar's pipe, producing a plausible 12K archive of
  nothing); 74 `orion-incident` (`thaw` did not thaw: ran `orion-mode` without `--yes`, got refused, printed
  success); 75 **left failing on purpose** ("one model designed, implemented, tested, reviewed and approved"
  the approval gate, ladder, terminal ops, automation, backup encryption); 76 deferral smoke alarm; 78
  travel (proposes, never creates); 80 call policy (recording "a flat no").
- `81d1744` — 81–84, and the three unnumbered closing sections. **The 24 permanent architectural rules**
  become assertions (`scripts/orion_v2_rules_check.py`): 21 held, 2 judgement, 1 violated (rule 24, one agent
  as sole designer+reviewer). First run found the installed extension **shipping compiled test files with
  credential-shaped fixtures**. `scripts/orion-readiness` scores the 16 final success conditions: 8 met, 5
  partly, 1 not, 2 n/a.
- `f8f69d2` — **independent review of 49–80** found two real safety problems:
  1. **The strictness ladder was never wired to enforcement.** `strictness.ts` was imported only by
     `index.ts` (status readout) and `orion-authority` (docs); `validator.ts` had never seen a mode.
     `orion-mode contained` "gated nothing", and `orion-incident freeze` declined to drop the profile on
     the grounds that `contained` "already stops every write". Now threaded through `runAuthorizedGraph`.
  2. **A live credential in the backup**: `exec-approvals.json` holds `socket.token`; both exclusion layers
     matched filenames only, and the manifest asserted "No secret is in this archive".
  Also: `trusted_user` was minted from any `role:user` line, and the transport's own briefing contained the
  literal words "yes, approve A-7F3K" — saved only by match ordering; `automation.ts` used `in` (prototype
  chain: `constructor`, `__proto__` passed). Phase 75 closes because the review happened; rules now 22/2/0.
- `b78391d` — **two contract checks had been failing since Phase 51** (three days) because nothing ran them:
  the registry builder correctly refused to guess a domain for `dev_operations`, and `orion/security/risk.py`
  correctly raised `UnknownTier`. Wired into CI. `dev_operations` graded R5. The secret inventory was missing
  `socket.token`. `planning/v2/HANDOFF.md` marked CLOSED.

### Why

Nick's instruction across 09-02/03 was to "build the phases, not to enumerate what building them would
involve" (`3f05780`). The session took it literally and recorded all 85 phases in two days, closing what
could be closed and writing `blocked` with reasons for the rest.

### Steps back

- **Enumerating instead of building** (corrected in `3f05780`).
- **The ladder that was a description** — two days between `0e0036d` and `f8f69d2` during which
  `orion-mode` reported protection it did not provide.
- **The backup that leaked the thing it said it excluded.**
- **Checks nobody ran** (`b78391d`).
- **Overclaimed closures.** The messages say "63 and 69 fully closed", "nine of eleven phases closed",
  "Phase 75 closes". In `PHASE_GATES.json` at `f8f69d2` and still at `04cbc1a`, 63, 69 and 75 have all
  requirements `passed` but `status: "in_progress"`, and 61/62/68 have all requirements passed but
  `status: "not_started"`. See §12.1 — "closed" in these commits means `nextPhaseAllowed: true`, not
  `status: complete`, and an Astra audit on 09-17 warned "Do not close those from historical passed
  requirement rows" for 57/63/67/75 (HANDOFF 2026-09-17 09:07).

### Lessons

- **A module imported only by its documentation is not enforcing anything.** Trace the import graph from the
  gate.
- Content-redact, don't filename-exclude; and never let a manifest assert its own correctness.
- `Object.hasOwn`, not `in`, for a closed table.
- One agent reviewing its own security work is a recorded violation, not a style issue (rule 24).

### Walk it yourself

```bash
python3 scripts/orion_v2_rules_check.py 2>/dev/null | tail -30    # the 24 rules, live (read-only checks)
grep -n "strictness" plugin/orion-control/src/validator.ts | head  # the wiring f8f69d2 added
git show f8f69d2 -- scripts/orion-backup | head -80
```

### Questions to ask your tutor

1. How would you have detected, *before* review, that `strictness.ts` was not on the enforcement path?
2. Why is "the review happened" a legitimate reason for Phase 75 to pass?
3. What exactly went wrong with `tar | passphrase | openssl -pass stdin`?
4. Why does `orion-budget` ship dollar rates at zero?

---

## 7. Era 6 — Night run, capability repair, and the offline coder (09-05 – 09-07)

Twenty-seven commits, `ac4efc8` through `407b517`.

### What was built

**The night run (09-05 02:43 → 09-06 15:01).** Nick set seven priorities in his own order; multiple agents
worked them and a "moderating session" re-ran every check and mutation rather than trusting agent reports
(`3e14200`; HANDOFF §2, "several agent reports were wrong in ways that only re-running caught").

| # | Item | Commit | What it found |
|---|---|---|---|
| 1 | Discord dispatch | `a13ad45` | Route works; a crashed brain call put raw exec output — absolute paths, the message-file location and the **live session key** — into a Discord DM. Fixed; not installed (`orion-remote-install` DRIFTED; restarting his only remote route while he slept "is his call") |
| 2 | "Do actual tests" | `e3c336f`, `5ec8125` | "I have something this Friday" on a Saturday: Sep 5, Sep 12, Sep 5, "Sep 5 – that's today". Right answer Sep 11. Orion had no grounded clock and no `orion-agenda day`. Added `day <date|weekday|today|tomorrow>`, a dated header, a "## Dates" rule, and reminders alongside calendar. Score **57.5 → 91.7 → 100** over eleven runs. The harness was more broken than Orion (four ways) |
| 3 | Timeouts & progress | `3e14200` | Two of three timeouts were *equal* (210 s), so one failure surfaced as either of two errors at random. `RunTimeouts` states the ordering; `RunProgressModel` ("Ran two commands." / "Still working — nothing new for 14s.") |
| 4 | "He STILL cuts me off" | `0e006c0` | `OrionVoiceEndpointingMs` (`VoiceTuning.swift:22`) was read only by the Deepgram query and the Settings row; a hard-coded 1.3 s `handsFreeHangover` always fired first. "He was turning a knob wired to a label." → `AdaptiveEndpointModel`, spoken barge-in |
| 5 | Personalities | `d51dd71` | `PersonalityProfile` has no capability field; the test runs the real TypeScript compiler and asserts `TS2353` on a fixture that tries to add one. Coder model measured: `gpt-oss:20b` 8/8 in 29 s; `llama3.2:3b` 0/8 |
| 6 | Audio quality | `3e14200` | Headset mic collapses output 44100/2ch → 16000/1ch; capture from the built-in mic instead, holding the lease for the app's run |
| 7 | Permissions | — | Already shipped 09-02 as the strictness axis |

`41cdddf` wired the new workspace-drift check into CI "instead of only owning one": Orion reads
`~/.openclaw/workspace/AGENTS.md`, not the repo copy, so two same-day edits had been inert.

**Capability repair (09-07, 02:06–03:00).**

- `5dcb4d1` — the Atlas notes capability built by a *concurrent session* and left uncommitted since 09-06
  01:57, committed unchanged "because… leaving finished work uncommitted in a shared tree is the riskier
  direction".
- `a71d59e` — `orion-learn` had analysed **263 sessions, 157 findings, none ever applied.** Top one:
  `episodic.ts` did not recognise "before I forget". Seven live skills existed in no repo; one told Orion to
  `npm install` a non-allowlisted binary.
- `32b9a3f` — **computer use** (phases 53-control/54/55): `screen_observe` (AX tree), `screen_capture`
  (pixel fallback), `screen_click/type/key` floored at APPROVAL in every mode, earned by `reversible:false` +
  `risk:critical`. Sensitive-window denylist; everything returned in an untrusted envelope. Both behind
  config flags (`enableComputerObserveActions`, `enableComputerControlActions`,
  `plugin/orion-control/src/index.ts:412-418`), default off. A first `profiles.py` fix made the Python engine
  *more permissive* than the live gate; the policy check caught it.
- `88a5468` — **11,826,304 tokens** burned in 26 retry loops across 10 sessions, all one shape: a refusal
  that taught nothing ("grep isn't allowlisted" — it was; the *pipe* was refused). `routeForDoomedExec`
  (`plugin/orion-control/src/exec-routing.ts`, hooked via `before_tool_call`) names the right route on the
  first call.
- `b5987f5` — Gmail's refresh token was dead (`invalid_grant`) for ~3 weeks while every local check said
  CONNECTED. `orion-doctor` now makes one real read (`scripts/orion-doctor:318-323`).

**The offline coder (09-07 17:58–21:11), for Nick's flight.**

- `6602853` — `scripts/orion-code`: one file, in a git worktree, on a local model via Ollama
  (`scripts/orion-code:54`, `http://127.0.0.1:11434/api/generate`), check, feed failure back, checkpoint.
  Whole files not diffs. **Thinking ON** after "empty response" was traced to `num_predict 900` being spent on
  reasoning. Uses the **installed** plugin's forbidden-surface table so a change cannot authorise itself.
- `cfece0c` — conversation **modes** (trunk and branches); a mode's folder is an **ID**, not a path, resolved
  against already-granted roots. Roles `local_deep` (qwen3:30b) and `unrestricted` (declared, deliberately
  unassigned).
- `4189ba2` / `0353057` — **wrong metric.** Recommended `qwen3.6:27b` on wall-clock over a tiny prompt;
  Ollama's own log says ~30 tok/s for `gpt-oss:20b` vs 5.2 for the 27B (MXFP4 is natively accelerated on
  Apple silicon, Q4_K_M is not). Flight default switched. Also: asked to "spend the flight making exec routing
  smarter", Orion said "Mission queued" and queued nothing — wrong system.
- `a51fd9c` — `selfdev_queue` typed actions; file inference grep-first, model-second.
- `4b8b76a` — `orion-code loop`: surveys 44 unmet requirement ids + `orion-learn` findings + TODOs (92 items),
  two tries per item, stops when nothing unattempted remains.
- `3cef4f2` — **"a typecheck rewards dead code."** The first autonomous cycle added a correctly typed,
  documented `isTypedActionOrSubcommand` that nothing called, and it was committed as progress. The bar is now
  `npm test`, plus `orphan_exports`:

```python
# scripts/orion-code:373
def orphan_exports(tree: Path, relative_path: str, before: str, after: str) -> list[str]:
    """Exported names the edit ADDED that nothing anywhere else refers to.

    This exists because of what the first autonomous cycle actually did. Asked to
    stop typed actions reaching the shell, it added
    `export function isTypedActionOrSubcommand(...)`, wrote a correct doc comment
    for it, and called it from nowhere. It compiled, so the check passed, so it
    was committed as progress. It was not progress; it was a function.
```

- `165c3ce` — **one handoff.** Four files each claimed to say where the program stood (`HANDOFF.md`,
  `planning/HANDOFF.md`, `planning/v2/HANDOFF.md`, `OVERNIGHT-LOG.md`) plus five session narratives; all
  folded into `HANDOFF.md` (−4,306 lines). Also marks 54 and 55 passed (built during the run but left
  `not_started`/blocked) → **45 complete**.
- `f4069f7`, `f1a19e0`, `407b517` — `orion-code status` (RUNNING / FINISHED / STOPPED WITHOUT FINISHING), a
  Project tab in the Mac app reading `selfdev-state.json` (`scripts/orion-code:507`), and SIGPIPE.

### Why

Nick had a week of real-life deadlines: London, a flight with no network, and an assistant he was using
daily and finding wrong. The night run was his priority list; the offline coder existed so "progress
continues with no network".

### Steps back

- **Harness bugs scoring correct answers as wrong** (four in `e3c336f`, two more in `5ec8125`); the first
  regex fix "caught nothing at all".
- **Model choice reversed by measuring the right thing** (`4189ba2`); the coder role note's claim that Qwen
  "never answered" corrected (`cfece0c`). (Later reversed again: on 2026-09-22, `c9ddbec`, the agentic runtime
  chose `qwen3.6:27b` for both roles after an eval over eight candidates — outside this chapter.)
- **Thinking off → on** (`6602853`).
- **typecheck → test suite** (`3cef4f2`).
- **Documents deleted within a day of being written**: `165c3ce` removed `NIGHT_RUN_2026-09-05.md`,
  `CAPABILITY_REPAIR_2026-09-07.md`, `FLIGHT_SETUP_2026-09-07.md`, `ORION_STATE_2026-09-07.md`,
  `REMOTE_DISPATCH_AUDIT_2026-09-05.md` after folding them into HANDOFF (still in git history).
- **A count assertion broke on a correct change for the third time** (`a51fd9c`, `expect(dev.length).toBe(7)`).

### Lessons

- A check nobody runs, a learning ledger nobody applies, and a workspace copy nobody syncs all fail the same way.
- Measure throughput, and never benchmark beside a running job on the same Ollama model.
- "The tool did not throw" is not "the thing is true".
- An unattended coder optimises for green; make green mean *reached*.

### Walk it yourself

```bash
scripts/orion-code status | head -5
sed -n 373,392p scripts/orion-code
scripts/orion_v2_workspace_sync.sh          # read-only drift report
git show 165c3ce --stat                     # what the consolidation deleted
```

### Questions to ask your tutor

1. Why was `handsFreeHangover = 1.3` able to defeat a user setting of 1400 ms?
2. How does `routeForDoomedExec` avoid becoming a second permission system?
3. Why must `orion-code` load the *installed* forbidden-surface table rather than the repo's?
4. What is wrong with judging a local model by wall-clock time on a tiny prompt?

---

## 8. Era 7 — Astra takes the product route (09-07 22:48 – 09-14)

Sixteen commits: `d0eeebb`, `f597f7f`, `187fa15`, `12583fc`, `bbeaa58`, `dfcaee2`, `7542905`, `becb18c`,
`5400763`, `7fdba72`, `0fc257a`, `882681a`, `0e599df`, `8330dcc`, `0404632`, `b7ea7d6`.

### What was built

Nick supplied a product vision document and asked for it to be assessed and implemented. Astra wrote
`docs/planning/v2/PRODUCT_VISION_DELIVERY_2026-09-07.md`, whose key finding is blunt: `DayPlan.propose`
existed in `MobileCore/DailyPlanning.swift` but **nothing in `native/Orion` called it**; Phase 39 had closed
on a planner no user could reach. "None of these gaps is solved by a phase completion count." From here the
work is organised by the product route and the REC gates (`REC-USABLE-CLIENT`, `REC-LIVE-FOUNDATION`), not
by phase numbers, and **no phase was advanced** in this era.

- `d0eeebb` — Mac availability tied to *verified* gateway readiness: bounded loopback `/healthz` and
  `/readyz` probes (`GatewayHealth.swift`), expiring observations, honest degraded/stale labels in Home, menu
  and preferences. Also replaced stale phase snapshots in `AGENTS.md`/`CLAUDE.md` with pointers to the gate file.
- `f597f7f` / `187fa15` (09-08) — **the Today plan**: real Calendar + Orion Reminders adapters, a MobileCore
  real-gap scheduler (`TodayPlanScheduler.swift`) with protected off-hours and transitions, preview → accept →
  Finish / +15 min / replan / one-level undo, atomic revisioned snapshots (`TodayPlanStore.swift`), stale-source
  and stale-writer refusal; then **pinned slots** that replanning preserves or refuses to break. 437 → 448 tests.
- `12583fc` / `bbeaa58` (09-11) — installed build 220 then 221; live use exposed the brief mixing the civil
  date with the 4 am activity day, and missing Command-Q / reopen. `BriefClock.swift` separates them.
- `dfcaee2` / `7542905` (09-12) — **grounded brief**: a deterministic factual summary rendered locally, with at
  most one model-*selected* detail validated against a versioned catalogue; hostile title delimiters and bidi
  controls normalised. Build 223 installed; verification blocked because the Mac was locked.
- `becb18c` / `5400763` (09-13) — the live brief's model selection failed because the shared `LocalModel`
  client required sentence punctuation on a JSON reply; a `selectionJSON` style fixes it. Build 225.
  Verification then stuck on a macOS Keychain prompt (SecurityAgent), which the agent deliberately did not try
  to operate.
- `7fdba72`, `0fc257a`, `882681a`, `0e599df`, `8330dcc` (09-14) — **Health source truth**: missing WHOOP
  readings stay *unknown* (not "no sleep"), "time in bed" labelled honestly, per-measurement history and age;
  the freeform Health summary had turned an empty water log into hydration advice — replaced by app-owned
  factual rows plus an optional validated model selection. Builds 227 and 229. Raw health values still never
  reach the prompt (Phase 33 preserved).
- `0404632` / `b7ea7d6` — Today rejects changed or unauthorised sources between preview and acceptance (late
  EventKit callbacks). Build 232 installed.

### Why

The phases said "complete" while the product route was missing. Astra's rule, visible in every HANDOFF entry:
**installed proof or it is not done** — signed clean build, same designated requirement, rollback copy in
`.builds/`, then the real UI route.

### Steps back

- Phase 39 "complete" with no consumer (found `d0eeebb`); Phase 34's Health sections mislabelling pending
  readings as "no recorded sleep" with high confidence (found 09-13, fixed `7fdba72`).
- Two verification stalls on human-only steps (locked screen, Keychain dialog) — recorded, not bypassed.
- Percentages proliferate: "milestone 100%", "repair 95%", against a formal 45/85 (53%) that did not move.
- The New York cron pin from Era 2 stayed in place throughout (see §3 Steps back).

### Lessons

- A closed phase whose code has no caller is a library, not a feature.
- Let the model *select* from facts the app rendered; never let it author the facts.
- "Unknown" must stay a distinct value all the way to the screen.

### Walk it yourself

```bash
sed -n 1,30p docs/planning/v2/PRODUCT_VISION_DELIVERY_2026-09-07.md
grep -rn "DayPlan\|TodayPlanScheduler" native/Orion/Sources/Orion/*.swift | head
sed -n 1,40p docs/planning/v2/BRIEF_GROUNDING_2026-09-12.md
```

### Questions to ask your tutor

1. Why is a deterministic summary plus a validated model *selection* safer than model prose?
2. What does the Today plan's "stale writer" refusal protect against?
3. Why does Astra re-verify against the installed build rather than test results?

---

## 9. Era 8 — The great reorganisation (09-15, 02:11–03:37)

Five Claude commits: `a064dcc`, `355ec9f`, `8cc9cbe`, `ceb6b79`, `3941e8f`.

### What was built

- `a064dcc` — deleted `launchers/`, `web/`, `vault/`, `archive/orion-ui-prototype/`, `main.py` (the dead
  Python runtime's entry point), `uv.lock`. Deliberately **kept** `orion/` and `backend/` because CI checks
  import them.
- `355ec9f` — `data/` and `brain/` → `var/`.
- `8cc9cbe` — `planning/` → `docs/planning/` (420 slash-form refs, plus 8 *segment-form* paths like
  `REPO_ROOT / "planning" / "v2"` that a text search for `planning/` cannot find; six CI checks broke until found).
- `ceb6b79` — `openclaw-plugins/` + `openclaw-workspace/` → `plugin/orion-control` + `plugin/workspace`.
  Slash-*preceded* references (`f"{repo}/planning/v2/…"`) were missed by the boundary-guarded search and
  silently broke `orion_v2_strictness_check.sh` and `orion-privacy`. Top level 17 → 14 entries.
- `3941e8f` — the repair commit, "five classes of damage, four of them mine": the blanket rewrite turned the
  real Python packages `orion/core/planning/` and `backend/planning/` into `…/docs/planning/`; the fix-up regex
  `([A-Za-z0-9_])/docs/planning/` also matched the **N of ORION** and reverted eight absolute paths; the
  installed plugin still pointed at `openclaw-plugins/…` so it was rebuilt and redeployed (gateway restarted);
  and the redeploy's `cp dist/*.js` shipped eleven `.test.js` files — violating architectural rule 17, caught
  by the rules check. Pre-existing: `gate.test.ts` "uses a local civil date" fails under BST.

### Steps back

The whole era is a step back and forward in 86 minutes. Astra's 09-15 14:09 HANDOFF entry adds one more
casualty: the move dropped six historical fixture-path entries from the secret-scan allowlist, restored in
`e08c128`. Astra also recorded the reorg as "unrelated … landed through 3941e8f. Do not undo those commits" —
one assistant reorganised the tree while the other was mid-task.

### Lessons

- Path rewrites need three searches: slash form, segment form, and unguarded bare string.
- A regex fix-up to a regex rewrite is two chances to be wrong.
- Never deploy with `cp dist/*.js`; the deploy script exists to exclude tests.

### Walk it yourself

```bash
git show 3941e8f | head -60
git log --follow --oneline -- docs/planning/v2/PHASE_GATES.json | head
```

### Questions to ask your tutor

1. Why did `([A-Za-z0-9_])/docs/planning/` match `ORION/docs/planning/`?
2. Why was it right to keep `orion/` and `backend/` even though the Python runtime is dead?

---

## 10. Era 9 — A phone you can pair, in the Simulator (09-14 – 09-17)

Fifteen commits: `afc1a18`, `964fd64`, `58e93ca`, `e08c128`, `f03fbd7`, `74e3571`, `1076c2b`, `f068e6f`,
`fc76f25`, `165e624`, `f830742`, `f8012ed`, `2f8e1f5`, `74bb0a2`, `62b76fb`.

### What was built

A chain of small, each-proven milestones toward `REC-USABLE-CLIENT`:

1. `afc1a18` — **the first real iPhone target**: `OrionMobile.xcodeproj`, SwiftUI `OrionPhone`, five tabs,
   labelled sample Today data. The "no iPhone app" gap narrowed for the first time.
2. `964fd64` — `backend/local_today/`: private SQLite, owner-scoped snapshots, loopback-only `GET /plan`.
3. `58e93ca` — Simulator reads it over real loopback HTTP; stale/outage/recovery/revocation scenarios.
4. `e08c128` — the *personal* accepted plan published to a bounded, timed Simulator preview.
5. `f03fbd7` — persistent P-256 device key in the Keychain (Secure Enclave on hardware, software in Simulator).
6. `74e3571` — real P-256 signature verification of pairing claims (`backend/devices/p256.py`, optional
   `cryptography` dependency); fixed an adoption guard that let a new key overwrite an existing or revoked device id.
7. `1076c2b` — `DurableDeviceRegistry` (`backend/devices/durable.py:82`): SQLite, refuses missing/corrupt
   stores, serialises pairing with revocation.
8. `f068e6f` — explicit pairing-approval UI showing the exact key fingerprint.
9. `fc76f25` → `165e624` → `f830742` — device-bound read sessions: single-use signed challenges, durable
   trust re-checked on every read, then exchanged over strict loopback HTTP (`backend/local_today/session_exchange.py:32`).
10. `f8012ed`, `2f8e1f5`, `74bb0a2`, `62b76fb` — authenticated personal preview, immediate disconnect
    (late callbacks rejected by a connection generation), reviewed/cancellable setup, remember/forget of
    non-secret connection details.

### Why

`REC-USABLE-CLIENT` and six phases hung on a phone. With the $99 developer account deferred, everything was
built up to the point a Team ID and a physical device would be needed ("Physical iOS compiles unsigned only").

### Steps back

- **It revived the Python `backend/`**, which the 09-01 correction §7 told the program to stop adding modules
  to and called a stack that "cannot serve a request". This era made part of it serve one.
- **Superseded within two weeks**: on 2026-09-30 (`b59bdca`, outside this chapter) the iPhone app shipped with
  **CloudKit** sync, and `README.md:58` now lists this Python pairing service as "superseded by CloudKit, still
  covered by its tests".
- Every entry says "roadmap 53% unchanged": two weeks of proven work moved no numbered phase.

### Lessons

- Proving a security property in a Simulator with fixture accounts is real progress on the property and none
  on the product; say which one you made.
- Check the program's own "stop doing" list before choosing the substrate.

### Walk it yourself

```bash
sed -n 1,40p native/OrionMobile/README.md
sed -n 82,140p backend/devices/durable.py
```

### Questions to ask your tutor

1. Why must durable trust be re-checked on *every* read rather than at session creation?
2. What does a "connection generation" protect against in the disconnect fix?
3. What would CloudKit replace in this design, and what would it not?

---

## 11. Era 10 — Back to numbered gaps (09-18 – 09-20)

Eight commits: `d7d80e8`, `c07dc48`, `bc0bb47`, `eda7551`, `ef41ab5`, `3c657b8`, `7354e07`, `04cbc1a`.

### What was built

On 09-17 Nick asked for "substantial total-percent progress"; Astra audited the numbered phases rather than
counting phone sub-milestones (HANDOFF 2026-09-17 09:07).

- `d7d80e8` — **Phase 76 closed** (the deferral checker had ignored deploy's `ORION_CATALOG_DIST`,
  `scripts/orion_v2_deferred_check.py:36`) → **46/85 (54%)**. And `file_copy` for Phase 47: regular files
  ≤ 64 MiB, same mutable root, no overwrite, descriptor-relative no-symlink I/O, hash verification
  (`plugin/orion-control/src/file-copy-helper.py`). 114 actions.
- `c07dc48` — deployed from a clean checkout, real copy proven through the gateway. Review **reopened** Trash
  recovery: the earlier `passed` row showed implementation, not recovered bytes. A human-only approval ticket
  (A-QZV3) expired ungranted; "Do not treat continue as granting the human-only action."
- `bc0bb47` — Phase 57 `remove` had reported success after scheduler errors; now verifies absence
  (`scripts/lib/orion-automation-removal.mjs:3`). Also corrected evidence: `expiresOn` metadata is not runtime
  expiry enforcement → requirement back to blocked.
- `eda7551` → `ef41ab5` → `3c657b8` → `7354e07` → `04cbc1a` — the **Phase 57 candidate automation runtime**,
  one guard at a time: durable admission (daily budgets, zoned expiry, quiet/focus/mode checks, fail-closed
  reservations, `scripts/lib/orion-automation-admission.mjs:71-93`); a dispatcher with a fixed action table,
  replay receipts and unknown-outcome states (`orion-automation-dispatch.mjs:59`); separate message budgets
  that refuse uncertain resends; live read-only host authority/focus checks (`orion-automation-host.mjs:23`);
  and an executor bound to the installed policy, re-checking authority after context (`orion-automation-runtime.mjs:19`).
  74 automation tests. **Nothing scheduled, nothing installed**; "Overall 46/85 (54%) unchanged".

### Steps back

- Two `passed` requirement rows downgraded on evidence (Trash recovery; Phase 57 expiry).
- Each automation slice's independent review reproduced a real race (quota replenishment from
  inconsistent day/timestamp; a "ready" state during retry; a cross-ledger clock regression; revocation during a
  slow probe).

### Lessons

- A requirement row is evidence of what was *observed*, not what was implemented.
- Build the guard before the trigger: the scheduler entrypoint (`8ef85c8`, 09-21) came only after five guards.

### Walk it yourself

```bash
node --test tests/automation-*.test.mjs 2>&1 | tail -5    # local, disposable fixtures
sed -n 1,60p docs/planning/v2/PHASE_57_RUNTIME_2026-09-20.md
```

### Questions to ask your tutor

1. Why reserve a run attempt durably *before* executing it?
2. Why is an unknown outcome never retried automatically?
3. Why re-check authority last, after the slower context probe?

---

## 12. The phase-by-phase story (33–84)

### 12.1 What "closed" means

`scripts/orion_v2_phase_gate.py:64-75` checks only that `nextPhaseAllowed` equals "all requirements passed"
and `entrySatisfied` equals the predecessor's value. `status` is a free label. So commit messages saying a
phase "closed" usually mean *its requirements all passed*; `status: complete` was set separately and less
often. Snapshot counts of `status` for phases 33+:

| Commit (date) | complete |
|---|---|
| `184c4a5` (09-01) | 33 |
| `a0123aa` (09-01) | 33–39, 41, 42 |
| `2cf0445` (09-02) | + 45 |
| `165c3ce` (09-07) | + 54, 55 → program total 45/85 |
| `d7d80e8` (09-18) / `04cbc1a` (09-20) | + 76 → 46/85 |

### 12.2 Ledger

| Phase | What happened in range | Evidence | Deviation / note |
|---|---|---|---|
| 33 Health firewall | Built into live Mac app | `7c69a47`, numeric firewall test (38 checks) | 2 registered deviations (decimal confidence; `cognitiveCapacity` as projection) |
| 34–39 Health block | Built in order, 09-01 evening | `8caec71`–`9846307`; review `4c800d9` fixed 35/36/37 | 39 had no Mac consumer until `f597f7f` |
| 40 Travel/timezone | Types `168351c`, ops `50f7110`, placement/travel `36ae8a0` | 9 of 10 passed by 09-01 | **Opened out of order** for the London move (`entrySatisfied: false`, corrected when 39 closed); last requirement (re-home cron) done 09-25 |
| 41 Notifications | `4b49482` | MobileCore checks | Entered out of order |
| 42 Security Center | `0fd0f6b` | authority contract check | nothing renders it yet |
| 43 LOCK ORION | `d9cc23d`, `40ee6e3`, `0af5235`, `0d67b37` | lock check | reauthentication blocked (closed 09-25) |
| 44 Remote link | `9dda027`, `0af5235` | live gateway connection | entered out of order (deadlock with 43) |
| 45 Remote read-only | `3a06d1f`, `0af5235`, `750322e` | **real Discord round trip** | complete 09-02 |
| 46 Harmless actions | `aa8e95d` | manifest amended | 3 requirements blocked (closed 09-26) |
| 47 Files | surveyed `2cf0445`; `file_copy` `d7d80e8`/`c07dc48` | live copy proof | Trash recovery reopened (closed 09-26) |
| 48–50 | surveyed `2cf0445`; 49/50 approvals and strictness `0e0036d`, `b3d2cf5` | strictness check | entered with `entrySatisfied: false`; 49's "theatre" fixed |
| 51–60 | `05f661c`, `caf2333`, `e701537`, `3f05780`; 57 runtime `bc0bb47`…`04cbc1a` | gate tests | 52/54 "passed by absence"; 54/55 complete 09-07 after computer use (`32b9a3f`) |
| 61–70 | `e701537`, `3f05780` | CI, attack map | 61/62/68 all-passed but `not_started`; 63/69 all-passed but `in_progress` |
| 71–80 | `4b8915b`, `f8f69d2` | inventory, backup, rules | 75 failing deliberately until review; 76 complete 09-17 |
| 81–84 | `81d1744` | rules check, readiness | 82–84 correctly not started |

Deviations that matter most: **Phase 40 and the London move** (opened first because of a real date, recorded
honestly, and the validator forced the flag to be corrected once 34–39 caught up); **41 and 44** entered ahead
of predecessors; **the lettered batches**, which were a deviation from the whole scheme and were withdrawn.

---

## 13. Steps back, catalogued

| Date | Step back | Commits |
|---|---|---|
| 09-01 | Stale `main` — worked a session without fetching | `049b0d3` |
| 09-01 | Lettered batches A–H proposed, withdrawn the same day (silently, inside a Phase 35 commit) | `250c0ed` → `53cd339` |
| 09-01 | Camera fix reverted by a privacy-invariant test | `d9cc23d` |
| 09-01 | `orion-lock` tested for a status never returned | `d9cc23d` |
| 09-01 | Keychain "no seam" overstatement corrected in 20 min | `79623cd` → `6261878` |
| 09-01→25 | Cron re-home promised for landing day, done 17 days late | `50f7110` → (09-25) |
| 09-02 | Phase 37 computed over all history; "late" → meal | `4c800d9` |
| 09-02 | Sender forgery via `--`; LOCK fails open | `0d67b37` |
| 09-02 | Least-privilege intent reversed by Nick | `0af5235` → `0d67b37` |
| 09-02 | "No fallthrough to a model" reversed | `c5c5175` |
| 09-02 | Bad-args rule reversed in 4 hours; pushed while red | `2dc51fd`, `0affc6d` → `80a6e46` |
| 09-02 | Honesty brief disarmed the self-modification gate | `f2c1c34` → `68d1b5e` |
| 09-02 | Approval gate satisfiable by the agent | `2cf0445` → `0e0036d` |
| 09-03 | Enumerated phases instead of building them | `3f05780` |
| 09-02→04 | Strictness ladder unwired; live token in backup | `0e0036d` → `f8f69d2` |
| 09-01→04 | Two contract checks failing unheard for 3 days | `b78391d` |
| 09-07 | Wrong model metric; typecheck rewarding dead code | `4189ba2`, `3cef4f2` |
| 09-07 | Docs written 09-05/07 deleted into one handoff | `165c3ce` |
| 09-07 | Phase 39 "complete" with no consumer | `d0eeebb` |
| 09-15 | Reorg broke packages, paths, shipped tests | `3941e8f` |
| 09-14→30 | Python phone backend built, then superseded by CloudKit | `964fd64`… → `b59bdca` |
| 09-18 | Two `passed` rows downgraded on evidence | `c07dc48`, `bc0bb47` |

---

## 14. Lessons that recur across eras

1. **Self-verification always passes** — injected zone equals machine zone; checksum from itself; gate
   answer handed back by the gate.
2. **Pin contents, not counts** — bitten three times in range.
3. **A check nobody runs is not a check** (contract checks, `orion-learn`, workspace sync).
4. **The repo copy is not the live copy** (workspace `AGENTS.md`, installed bridge, installed plugin).
5. **Absent enum members beat runtime checks** for prohibitions.
6. **Independent review finds what self-review cannot** — each of four reviews found a security-relevant defect.
7. **Requirements are read against the live stack; order is not changed** — the surviving half of the correction.
8. **Installed proof is the bar** (Astra's contribution from 09-07).
9. **Check the date and the clock**: three-date commits, NY/London stamps, civil day vs activity day.

---

## 15. Walk the whole period yourself

```bash
git log --reverse --format='%h %ad %s' --date=short --since=2026-08-25 --until=2026-09-25 \
  | awk '$2>="2026-09-01" && $2<="2026-09-20"'
git show 04cbc1a:docs/planning/v2/PHASE_GATES.json | python3 -c "import json,sys;p=json.load(sys.stdin)['phases'];print([k for k in p if p[k]['status']=='complete'])"
grep -n '^## 2026-09-' HANDOFF.md | head -40
```

Questions: Which single defect in this range would have hurt Nick most had it shipped unnoticed? Which
reversal was right, and which was cost? What would you change about how "complete" is recorded?

---

## 16. Every commit in range

Era key: E1 backlog · E2 correction & batches · E3 back to numbers · E4 Discord & brain · E5 sprint to 84 ·
E6 night run & coder · E7 Astra Mac route · E8 reorg · E9 phone · E10 numbered gaps.

| Hash | Date | Type | Meaning | Era |
|---|---|---|---|---|
| c26272f | 09-01 | feat | Commit Phases 2–10 Python core and security layer | E1 |
| 5819ca8 | 09-01 | feat | Commit Phases 11–20 backend in post-review state | E1 |
| 4ab0f9a | 09-01 | feat | Commit Phases 21–30 task/calendar/Gmail backends (no transport) | E1 |
| 6899867 | 09-01 | feat | Commit MobileCore domain layer and self-check | E1 |
| e1651a3 | 09-01 | test | Commit check scripts and v2 unit suites | E1 |
| 2ca9e9c | 09-01 | docs | Phase records, charter, Phases 11–20 review | E1 |
| 1c9c503 | 09-01 | feat | Other assistant's Keychain secrets, strict-args flag, TTS work | E1 |
| b198d7f | 09-01 | docs | Record the checkpoint and stale index lock | E1 |
| 049b0d3 | 09-01 | merge | Merge origin/main the session never fetched | E1 |
| 0479439 | 09-01 | chore | Allowlist a secret-scan false positive from the merge | E1 |
| 250c0ed | 09-01 | docs | Program correction; propose lettered batches | E2 |
| 3143c50 | 09-01 | chore | Gitignore worktrees; note lost university in USER.md | E2 |
| 9c511d2 | 09-01 | fix | Expire stale focus sessions; true calendar disclosure | E2 |
| 7c69a47 | 09-01 | feat | Phase 33 health firewall in live app | E2 |
| d9cc23d | 09-01 | feat | LOCK ORION; honest camera and updater failures | E2 |
| 184c4a5 | 09-01 | docs | Close Batch A; Phase 33 complete | E2 |
| 168351c | 09-01 | feat | Phase 40 time types; fix day-key zone bug | E2 |
| 50f7110 | 09-01 | feat | Batch B: orion-timezone, location.json, orion-project | E2 |
| 0eb1d00 | 09-01 | test | Test orion-timezone set, fake and live round trip | E2 |
| 79623cd | 09-01 | docs | Close the $99 question; explain bot tokens | E3 |
| 6261878 | 09-01 | fix | Correct Keychain overstatement; pin call sites | E3 |
| 8caec71 | 09-01 | feat | Phase 34 health UI sections | E3 |
| 53cd339 | 09-01 | feat | Phase 35 journal (also withdraws batches, archives handoffs) | E3 |
| f01c161 | 09-01 | feat | Phase 36 correlations that cannot claim cause | E3 |
| 86b0f62 | 09-01 | feat | Phases 37–38 experiments and one-way planning | E3 |
| 9846307 | 09-01 | feat | Phase 39 day plan and estimate calibration | E3 |
| 1fa0e9f | 09-01 | docs | orion-phase skill | E3 |
| 36ae8a0 | 09-01 | feat | Phase 40 civil-day placement, Travel Mode | E3 |
| 4b49482 | 09-01 | feat | Phase 41 notification levels | E3 |
| 0fd0f6b | 09-01 | feat | Phase 42 security screen that only removes | E3 |
| 40ee6e3 | 09-01 | test | Phase 43 lock check, honest open gate | E3 |
| 9dda027 | 09-01 | feat | Phase 44 link policies, no transport | E3 |
| 3a06d1f | 09-01 | feat | Phase 45 read-only job gate | E3 |
| a0123aa | 09-01 | docs | Summarise 41–45; one credential needed | E3 |
| 4c800d9 | 09-02 | fix | Repairs from 34–40 review | E4 |
| 12e2c1f | 09-02 | docs | Record 34–40 review | E4 |
| 0af5235 | 09-02 | feat | Discord bridge, read-only verbs, lock reaches channel | E4 |
| 274d6f4 | 09-02 | docs | Bridge live; allowlist line pending | E4 |
| 0d67b37 | 09-02 | fix | Fix sender forgery and fail-open lock | E4 |
| f33f92c | 09-02 | fix | Clear stale bridge error on success | E4 |
| 750322e | 09-02 | feat | Phase 45 closed by real Discord round trip | E4 |
| 2dc51fd | 09-02 | fix | Usage line for known verb with bad args | E4 |
| 0affc6d | 09-02 | fix | Fix half-sentence usage pushed while red | E4 |
| c5c5175 | 09-02 | feat | DMs reach the Orion brain | E4 |
| 8618174 | 09-02 | fix | Diagnosable empty brain turn | E4 |
| ea71395 | 09-02 | feat | Bridge persistent under launchd outside Desktop | E4 |
| f2c1c34 | 09-02 | fix | Channel brief so brain knows its channel | E4 |
| 031c46d | 09-02 | fix | Self-knowledge from live tool, not stale file | E4 |
| 5655b0b | 09-02 | feat | orion-skill and 17 more exec commands | E4 |
| 52462f4 | 09-02 | feat | Provenance stamps; orion-note | E4 |
| 80a6e46 | 09-02 | fix | Bare verbs are conversation; rate limit 40 | E4 |
| 68d1b5e | 09-02 | fix | Brief words disarmed self-mod gate | E4 |
| aa8e95d | 09-02 | fix | Phase 46 media pause verification budget | E4 |
| 2cf0445 | 09-02 | docs | Survey 47–50; manifest amended | E4 |
| 0e0036d | 09-02 | feat | Human grants for approvals; strictness modes | E4 |
| 703e301 | 09-02 | fix | Spoken authority answer names the mode | E4 |
| b3d2cf5 | 09-03 | feat | Voice approval via host provenance | E5 |
| 05f661c | 09-03 | feat | Phase 51 typed dev operations | E5 |
| caf2333 | 09-03 | feat | Automation as proposal; survey 51–60 | E5 |
| e701537 | 09-03 | feat | Phases 60–70: why, confidence, budget, attack map, CI | E5 |
| 3f05780 | 09-03 | feat | Build rest of 60–70; deploy script | E5 |
| 4b8915b | 09-04 | feat | Phases 71–80 inventory, privacy, backup, incident | E5 |
| 81d1744 | 09-04 | feat | Phases 81–84; 24 rules as assertions | E5 |
| f8f69d2 | 09-04 | fix | Wire strictness; redact live token in backup | E5 |
| b78391d | 09-04 | fix | Run two silently failing contract checks | E5 |
| ac4efc8 | 09-05 | docs | Night run log | E6 |
| 3e14200 | 09-05 | feat | Watchable turns; audio route fix | E6 |
| a13ad45 | 09-05 | fix | Discord crash leaked paths/session key | E6 |
| e3c336f | 09-06 | feat | Friday eval; orion-agenda day; harness fixes | E6 |
| 5ec8125 | 09-06 | feat | Reminders routing; rubric fixes | E6 |
| 0e006c0 | 09-06 | feat | Adaptive endpointing actually reads setting | E6 |
| d51dd71 | 09-06 | feat | Personalities cannot hold authority | E6 |
| 41cdddf | 09-06 | chore | Run workspace-drift check in CI | E6 |
| 1cd48f3 | 09-06 | docs | Close night run | E6 |
| 5dcb4d1 | 09-07 | feat | Commit concurrent session's Atlas notes | E6 |
| a71d59e | 09-07 | fix | Apply learning ledger; track live skills | E6 |
| 32b9a3f | 09-07 | feat | Computer use observe/control, gated | E6 |
| c592c54 | 09-07 | docs | Screen data in inventory | E6 |
| 88a5468 | 09-07 | fix | Route doomed exec calls on first refusal | E6 |
| 9ebc866 | 09-07 | docs | Measured state of Orion | E6 |
| b5987f5 | 09-07 | fix | Live Gmail probe in doctor | E6 |
| 6602853 | 09-07 | feat | Offline coder orion-code | E6 |
| cfece0c | 09-07 | feat | Conversation modes; folder as capability ID | E6 |
| 4189ba2 | 09-07 | docs | Flight setup; wrong metric corrected | E6 |
| a51fd9c | 09-07 | feat | selfdev_queue from conversation | E6 |
| 0353057 | 09-07 | fix | Route to selfdev; switch flight model | E6 |
| 4b8b76a | 09-07 | feat | Agentic loop over unfinished work | E6 |
| 3cef4f2 | 09-07 | fix | Test suite bar; reject orphan exports | E6 |
| 165c3ce | 09-07 | docs | Consolidate to one handoff; 54/55 passed | E6 |
| f4069f7 | 09-07 | feat | orion-code status states | E6 |
| f1a19e0 | 09-07 | feat | Project tab in Mac app | E6 |
| 407b517 | 09-07 | fix | Quiet SIGPIPE in status | E6 |
| d0eeebb | 09-07 | (none) | Verified gateway readiness in Mac UI | E7 |
| f597f7f | 09-08 | (none) | Today plan with calendar, undo | E7 |
| 187fa15 | 09-08 | (none) | Pinned Today slots | E7 |
| 12583fc | 09-11 | (none) | Brief civil-date fix; Quit/reopen | E7 |
| bbeaa58 | 09-11 | (none) | Record build 221 proof | E7 |
| dfcaee2 | 09-12 | (none) | Grounded factual brief | E7 |
| 7542905 | 09-12 | (none) | Record build 223; Mac locked | E7 |
| becb18c | 09-13 | (none) | JSON selection through model client | E7 |
| 5400763 | 09-13 | (none) | Record build 225; Keychain prompt | E7 |
| 7fdba72 | 09-14 | (none) | Health unknowns stay unknown | E7 |
| 0fc257a | 09-14 | (none) | Record Health source proof | E7 |
| 882681a | 09-14 | (none) | Grounded Health summaries | E7 |
| 0e599df | 09-14 | (none) | Record build 229 fallback | E7 |
| 8330dcc | 09-14 | (none) | Record build 229 live selection | E7 |
| 0404632 | 09-14 | fix | Today rejects changed sources | E7 |
| b7ea7d6 | 09-14 | docs | Record source recovery proof | E7 |
| afc1a18 | 09-14 | feat | First iPhone Simulator app shell | E9 |
| 964fd64 | 09-14 | feat | Local owner-scoped Today read service | E9 |
| 58e93ca | 09-15 | feat | Simulator reads Today over HTTP | E9 |
| a064dcc | 09-15 | chore | Delete dead top-level dirs and main.py | E8 |
| 355ec9f | 09-15 | refactor | data/brain → var/ | E8 |
| 8cc9cbe | 09-15 | refactor | planning → docs/planning | E8 |
| ceb6b79 | 09-15 | refactor | Plugin and workspace → plugin/ | E8 |
| 3941e8f | 09-15 | fix | Repair reorg damage | E8 |
| e08c128 | 09-15 | feat | Publish personal plan to Simulator | E9 |
| f03fbd7 | 09-15 | feat | Persistent phone device key | E9 |
| 74e3571 | 09-15 | (none) | Real P-256 pairing signatures | E9 |
| 1076c2b | 09-15 | (none) | Durable device registry, revocation | E9 |
| f068e6f | 09-16 | (none) | Pairing approval UI | E9 |
| fc76f25 | 09-16 | (none) | Device-bound read sessions | E9 |
| 165e624 | 09-16 | (none) | Phone key opens read session | E9 |
| f830742 | 09-16 | (none) | Session exchange over loopback HTTP | E9 |
| f8012ed | 09-16 | feat | Authenticated timed personal preview | E9 |
| 2f8e1f5 | 09-16 | feat | Phone disconnect; reject late callbacks | E9 |
| 74bb0a2 | 09-16 | feat | Review/cancel connection setup | E9 |
| 62b76fb | 09-17 | feat | Remember/forget non-secret connection | E9 |
| d7d80e8 | 09-18 | feat | file_copy; close Phase 76 | E10 |
| c07dc48 | 09-18 | docs | Installed copy proof; Trash gate reopened | E10 |
| bc0bb47 | 09-18 | fix | Verify scheduler removal | E10 |
| eda7551 | 09-18 | feat | Durable automation admission guard | E10 |
| ef41ab5 | 09-19 | feat | Guarded candidate dispatcher | E10 |
| 3c657b8 | 09-19 | feat | Notification budgets | E10 |
| 7354e07 | 09-20 | feat | Live host authority/focus checks | E10 |
| 04cbc1a | 09-20 | feat | Executor bound to installed policy | E10 |
