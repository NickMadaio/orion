# HANDOFF — ORION

**Last updated 2026-09-11.** This is the only handoff. If you find another one
that is not `planning/v2/HANDOFF.md` (kept solely because `PHASE_GATES.json`
cites it as evidence for phases 1–33, and marked CLOSED at the top), it is stale
and should be deleted rather than read.

Read this, then `AGENTS.md` for how the codebase works, then `NICK-TODO.md` for
what Nick himself is waiting on.

---

## 2026-09-11 16:48 BST — Installed Today proof and brief repair candidate

The earlier installed-217 statement is superseded. Clean source `187fa15` was
built and installed as signed build 220 with the original designated requirement.
Actual UI checks on 10 September proved real Calendar/Orion Reminders → preview →
accept, pin preservation and conflict refusal, restart persistence, local Finish,
extra time and Undo. Source reminder stayed unfinished; final local revision 8
is unfinished, unpinned and back to 30 minutes. Gateway and permissions unchanged.

Live use exposed a civil-date/activity-day mix-up in the brief and missing standard
Quit/reopen behavior. The repair separates the civil clock from the 4am activity
boundary, invalidates stale narrative, verifies source freshness/window coverage,
handles zone changes and date-only reminders, and restores Quit/reopen. Full native
suite: 455 XCTest cases pass. Independent review is clear; all 40 connection wrapper checks pass. Installed
repair proof is pending.

Evidence, limitations, rollback and exact next gate:
`planning/v2/TODAY_INSTALLED_PROOF_2026-09-11.md`. Build 217 rollback is in
`.builds/today-release-2026-09-08/rollback/Orion.app`; retain a verified build 220
copy before replacing it. Next: finish review, checkpoint only these repairs,
build from a clean checkout, install with the same identity, verify civil-date
brief and standard Quit/reopen, then update this record. No push, phase closure
or phone/backend claim. Exclude unrelated learning-proposals work.

---

## 2026-09-08 22:55 BST — Pinned slots and source reconciliation

Nick said “continue.” The initial Today slice was committed locally as `f597f7f`;
this follow-up adds accepted task-slot pins. Replanning preserves them, including
ongoing blocks. Missed pins and calendar/transition/duration/day-budget conflicts
refuse the proposal instead of moving a pin. Individual unpin, release-all,
completion and undo stay inside the existing preview/accept flow. Confirmed
source completion/deletion releases its pin in a disclosed preview; local undo
cannot reverse that external source change. Older unpinned files decode normally.

Proof: full 448 XCTest cases pass; the last narrow Unpin repair also passed the
14-case app suite. Reviewer independently reran 46 Today cases and confirmed the
final source repair, with no actionable findings left. Eight critical mutants
are caught; MobileCore 693 checks and iOS Simulator build pass. Actual expanded
pinned content rendered with labeled fixtures and inspected. The connection
wrapper's 26 health, nine transport and five menu checks also pass.

Review caught stale pins after completion in Reminders and a remaining visible
Unpin action checking the already-reconciled list. Both are repaired with actual
model regressions. See updated `planning/v2/TODAY_PLAN_IMPLEMENTATION_2026-09-08.md`.
Scoped pinning patch/logs: `.builds/today-plan-2026-09-08/pinning/`.

Installed build remains 217. No install, restart, new permissions, external
calendar/task write or remote push occurred. Next gate is an identity-preserving
candidate and installed real-source acceptance pass, not more pinning scaffolding.
The source pinning gap in the earlier entry is superseded. REC-USABLE-CLIENT still
needs installed Mac evidence plus phone/backend work; no gate or numbered phase
has been marked complete. Keep the unrelated learning-proposals edit excluded.

---

## 2026-09-08 01:29 EDT — Today/Plan source implementation

Nick said “start implementation.” Starting HEAD was `d0eeebb`; the only prior
uncommitted edit was `planning/learning-proposals.md`, left untouched. Installed
build 217 remains installed. No runtime/permission/install change was made.

Implemented: actual-day calendar/Orion Reminders adapter; MobileCore real-gap
scheduler with protected off-hours, transitions and free time; Today-first Home;
preview/accept, local Finish block, 15 more minutes, replan from now and one-level
undo. Atomic local snapshot includes revision, undo and replay receipts. Stale
sources cannot become current advice, and a competing writer is reloaded.
Reminders nil snapshots are now unknown instead of an empty task list. Calendar
and source reminder records are not changed by plan operations.

Proof: 437 native XCTest cases pass, including 26 planner/store and nine actual
app model/adapter/view tests; 26 health, nine transport and five menu checks pass.
MobileCore 693 checks and iOS Simulator build pass. Six deliberate source mutants
are caught. Actual TodayPlanView rendered from synthetic inputs and inspected.
Independent review repaired stale advice, elapsed free totals, deadline order and
omitted new-work summaries; final reviewer reran 35 cases, no actionable findings
within this scope. Source/history secret scan clean with the existing allowlist.

Full details and alternatives: `planning/v2/TODAY_PLAN_IMPLEMENTATION_2026-09-08.md`.
Rollback: scoped local source commit/patch and logs in
`.builds/today-plan-2026-09-08/`; nothing installed to roll back. Exclude the old
learning-proposals edit from any checkpoint. No push/remote backup claim.

Next: explicit pinned task slots and conflicts, then identity-preserving candidate
and installed Calendar/Reminders → preview → accept → restart → completion/replan/
undo proof. Task pinning and installed product proof are unmet, so delivery-plan
step 2 is partial. Phone/backend work remains required by REC-USABLE-CLIENT. No
phase counts or recovery gates were advanced. Historical missing-Mac-consumer
statements are superseded by this source implementation, not installed evidence.

---

## 2026-09-07 22:47 EDT — Product vision and first connection repair

Nick asked to assess the supplied product vision and start implementation. The
full delivery map is `planning/v2/PRODUCT_VISION_DELIVERY_2026-09-07.md`; the
first slice and proof record are in
`planning/v2/RUNTIME_CONNECTION_IMPLEMENTATION_2026-09-07.md`.

Found: installed Mac build 217, gateway and remote bridge running, valid live and
ready gateway probes. This supersedes the supplied document's earlier down
snapshot. Gates contain 45 complete, 26 in progress, 14 not started; the old
AGENTS/CLAUDE phase summaries were stale and now route to the canonical records.
No phase was advanced. DayPlan.propose exists but has no Mac app consumer.

Changed: typed bounded gateway health/readiness probe, expiring evidence,
contextual Home connection state, consistent dashboard/menu/preferences labels,
open-menu expiry/recovery refresh, and honest static-readiness labeling. Readiness
is not proof of a complete turn or an individual connector. No service restart,
install, permission/configuration change, credential access or remote push.

Verification: Mac build passes; 402 native XCTest cases, 26 connection checks,
nine real loopback scenarios, five menu checks pass. Five critical mutants are
caught. Component render inspected; production probe passes against the installed
gateway. Independent review findings repaired. Source/history secret scan clean
with the existing reviewed allowlist. Full installed UI/voice/conversation proof
remains outstanding; build 217 is still installed.

Rollback: isolated local source checkpoint; patch and logs at
`.builds/product-vision-2026-09-07/`. Do not reset the mixed tree. The existing
`planning/learning-proposals.md` edit was excluded. Next: finish candidate Home
layout/release proof, then wire real agenda/tasks to a persisted Today/Plan
revision with completion/replan/undo using MobileCore. Follow the delivery plan's
REC-USABLE-CLIENT and REC-LIVE-FOUNDATION path; do not mistake this first repair
for complete runtime recovery or delivery of the whole vision.

---

## 1. Where the program is

**45 of 85 phases complete.** 25 part-done, 15 not started. The manifest is
`planning/v2/MANIFEST_PHASES.json`; the live state is `planning/v2/PHASE_GATES.json`
and that file, not this one, is the source of truth — this table is a snapshot of
it and will drift.

Two things to know before reading the table:

**"part-done" is not a synonym for "nearly done".** Several phases sit there
because one requirement needs Nick at a keyboard — a TCC grant, an OAuth
re-auth, a device — and the rest of the phase is finished and proven. Others sit
there because the work genuinely is not done. The unmet-requirement column is the
only way to tell them apart, which is why it is printed in full.

**The interpretation rule still applies** (see `AGENTS.md`): where a phase's text
refers to the Python runtime or `orion/*.py`, read it against the LIVE stack —
the Swift app in `native/Orion` and the TypeScript plugin in
`openclaw-plugins/orion-control`. That changes how a requirement is READ, never
the order phases are done in.

| # | phase | state | what is still unmet |
| -: | ----- | ----- | ------------------- |
| 0 | Freeze, Inventory, and Understand Existing ORION | **done** | — |
| 1 | Establish Repository and Module Boundaries | **done** | — |
| 2 | Build the Model Router | **done** | — |
| 3 | Create the Context Firewall | **done** | — |
| 4 | Formalize Tool Contracts | **done** | — |
| 5 | Build the Policy Engine | **done** | — |
| 6 | Build the Audit System | **done** | — |
| 7 | Build the Event System | **done** | — |
| 8 | Build the Job System | **done** | — |
| 9 | Security Invariant Test Suite | **done** | — |
| 10 | Backend Foundation | **done** | — |
| 11 | Database Foundation | **done** | — |
| 12 | Secret and Credential Vault | **done** | — |
| 13 | Authentication | **done** | — |
| 14 | Device Identity | **done** | — |
| 15 | Device Pairing | **done** | — |
| 16 | ORION Mobile Foundation | **done** | — |
| 17 | Conversation and State Sync | **done** | — |
| 18 | ORION Memory v2 | **done** | — |
| 19 | Today Screen | **done** | — |
| 20 | Unified Capture | **done** | — |
| 21 | Task System | **done** | — |
| 22 | Calendar Read Integration | **done** | — |
| 23 | Planner v1 | **done** | — |
| 24 | Schedule Stability | **done** | — |
| 25 | Calendar Writes | **done** | — |
| 26 | Gmail Read/Search | **done** | — |
| 27 | ORION Action Inbox | **done** | — |
| 28 | Gmail Drafting | **done** | — |
| 29 | Gmail Sending | **done** | — |
| 30 | HealthKit Local Layer | **done** | — |
| 31 | Health Baseline Engine | **done** | — |
| 32 | ORION Health State | **done** | — |
| 33 | Health Privacy Firewall | **done** | — |
| 34 | ORION Health UI | **done** | — |
| 35 | Natural-Language Health Journal | **done** | — |
| 36 | Behavior Correlations | **done** | — |
| 37 | Experiment Mode | **done** | — |
| 38 | Health-Aware Planning | **done** | — |
| 39 | Daily Planning | **done** | — |
| 40 | Travel and Timezone Support | part-done | the live cron weather and day boundary are re homed |
| 41 | Notification Engine | **done** | — |
| 42 | Security Center | **done** | — |
| 43 | LOCK ORION | part-done | requires reauthentication for sensitive operations |
| 44 | Mac Remote Connection Foundation | part-done | no named requirement recorded |
| 45 | Remote Mac Read-Only | **done** | — |
| 46 | Harmless Mac Actions | part-done | supports mobile cancellation, optional arguments are visible where the model reads its capabilities, a timed out action is retried at least once |
| 47 | File Capabilities | part-done | adds files copy |
| 48 | Mac Privilege Separation | not started | splits execution into user worker and privileged broker, privileged broker exposes only a tiny explicit interface, keeps privileged code minimal, signs and hardens executables, prevents unauthorized replacement or tampering, binds destructive authorization to the requesting turn |
| 49 | Remote Approval System | part-done | shows a human readable approval on iphone, requires face id where appropriate, signs approval with a device authorization key, mac verifies signatures independently |
| 50 | Delegated Policies | part-done | every delegation defines capabilities resources exceptions limits expiration ceiling and devices |
| 51 | Structured Terminal Operations | part-done | the bare git allowlist entry is retired |
| 52 | Raw Terminal Access | part-done | treat raw terminal as r5 with session visibility faceid duration audit and cancellation |
| 53 | Automation Sessions for Complex Computer Work | not started | creates bounded computer use sessions, every session defines goal device apps directories domains capabilities and ceilings, requires additional approval to expand scope |
| 54 | Screen Observation Privacy Layer | **done** | — |
| 55 | Prompt Injection Defense for Computer Use | **done** | — |
| 56 | Remote Session UI | not started | shows task device step elapsed risk and capabilities on mobile, uses live activities where appropriate |
| 57 | Automation Framework | part-done | no named requirement recorded |
| 58 | Automation Simulation | part-done | uses historical data where available |
| 59 | Proactive ORION | not started | scores items by urgency actionability novelty confidence importance and interruptibility, places low priority suggestions in today |
| 60 | Focus Sessions | part-done | no named requirement recorded |
| 61 | Prep Cards | not started | no named requirement recorded |
| 62 | Waiting-On Tracking | not started | no named requirement recorded |
| 63 | Explainability | part-done | no named requirement recorded |
| 64 | Confidence Handling | part-done | no named requirement recorded |
| 65 | App Intents and System Integration | not started | adds ask add start focus whats my day run automation and lock, exposes through siri shortcuts widgets and control center |
| 66 | Live Activities | not started | uses live activities for focus sessions and remote jobs |
| 67 | Cost Controls | part-done | no named requirement recorded |
| 68 | Reliability Testing | not started | no named requirement recorded |
| 69 | Security Attack Testing | part-done | no named requirement recorded |
| 70 | CI/CD Security | part-done | no named requirement recorded |
| 71 | Data Inventory | part-done | no named requirement recorded |
| 72 | Privacy Controls | part-done | no named requirement recorded |
| 73 | Backups and Recovery | part-done | tests the four named recovery scenarios |
| 74 | Incident Response | part-done | no named requirement recorded |
| 75 | Development Workflow | part-done | no named requirement recorded |
| 76 | Features Explicitly Deferred | part-done | no named requirement recorded |
| 77 | Future Apple Watch Expansion | not started | creates a lightweight watch companion |
| 78 | Future Travel Assistant | part-done | adjusts schedule timezone |
| 79 | Future Reservation Capability | not started | discovers inspects presents books and records a reservation |
| 80 | Future Call Capability | part-done | no named requirement recorded |
| 81 | Future Location Context | part-done | maintains retention limits |
| 82 | Public Release Preparation | not started | tests account recovery device loss and secret rotation, performs the external reviews |
| 83 | Multi-User Hardening | not started | enforces tenant isolation and object level authorization, adds rate limits quotas and abuse controls, isolates jobs connectors memories and encryption context |
| 84 | Final ORION Mobile Product Shape | not started | delivers today plan orion health and control surfaces |
---

## 2. What happened in the 2026-09-05 → 09-07 run

Nick set seven priorities in his own order, then extended them. Every claim below
was verified in the moderating session by re-running the check or the mutation,
not taken from an agent's report — several agent reports were wrong in ways that
only re-running caught, and that is recorded where it happened.

### 2.1 The seven

**1 — Discord dispatch.** It works. `files desktop` was driven end to end through
`inject` → `poll` → outbox against the *installed* bridge with the real
allowlisted sender. Non-allowlisted senders, replays, `local` approvals and
fabricated gate ids were each refused by exercise rather than by reading.

The defect was on the failure path: a crashed or timed-out brain call put raw
exec output into the Discord reply — absolute paths, the message-file location,
and the live session key, in a DM, on every crash. Discord is a third party, so
that is a disclosure. It answers in one plain sentence now.

**Still not installed.** `orion-remote-install --status` reported DRIFTED.
Installing restarts Nick's only proven remote route, and that script is off the
exec allowlist deliberately.

**2 — "Do actual tests."** Asked "I have something this Friday" four times from
identical state on a Saturday, Orion answered Sep 5, Sep 12, Sep 5, and "Sep 5 —
that's today". The answer was Friday **Sep 11**; Sep 5 and Sep 12 are both
Saturdays. He had no grounded clock and was doing weekday arithmetic from memory,
which is why every wrong answer sounded confident.

One baseline run is the whole diagnosis: it tried `orion-agenda friday`, got an
exec failure, and fell back to `upcoming`. He was asking for the capability that
was missing — the tool had three subcommands and no way to ask about a named day.

Four repairs: a real `orion-agenda day <date|weekday|today|tomorrow>`; a dated
header printed by every subcommand (suppressed under `--json`, since a
fingerprint carrying today's date changes at midnight); a `## Dates` rule saying
dates are read from tool output, never worked out; and reminders checked
alongside the calendar, because "something on Friday" is as likely to be a task.
Eleven runs under one rubric: **57.5 → 91.7 → 100**.

**The harness needed more repair than Orion did.** It accused him of mutating the
calendar by string-comparing JSON whose key order is not stable; it read
`replayInvalid` as "untrustworthy" when OpenClaw defines it as *unsafe to replay
after compaction*, which every tool-using run sets; its tool parser looked for
`tool_use`/`input` while OpenClaw writes `toolCall`/`arguments`, so the
tool-selection dimension scored real behaviour against an empty list; and its
misdate regex passed the exact answers it existed to catch. The first correction
to that regex also caught nothing — `sept` never matches "Sep 5", and a trailing
`\b` fails on "12th" — which is why the replacement was verified against all
nine stored answers *before* being written.

**3 — Timeouts and visible progress.** Three ceilings, and two were exactly
equal: the client's hard read deadline (180+30) and the thinking watchdog were
both 210s. A tie, not an ordering, so one failure produced either the gateway's
specific error or the watchdog's generic one at random — which is why the same
symptom never looked the same twice. `RunTimeouts` states the ordering as a check
rather than three literals in three files. The agent's own budget went 180s →
300s, because "update yourself" is a build, a copy and a relaunch.

`RunProgressModel` gives the feed Nick asked for by name — "Ran two commands." —
and says so honestly when it knows nothing: "Still working — nothing new for
14s." **`openclaw audit` cannot distinguish domain actions**: calendar, mail and
health all dispatch through `orion_task_run` with the action in arguments audit
never records, so "Checking your calendar" was left unbuilt rather than faked.
**Cancellation did not exist at all** before this run; Escape was not even armed
during `.thinking`.

**4 — "He STILL cuts me off."** The setting Nick raised from 900 to 1400 ms was
never read in hands-free mode. Two independent end-of-turn decisions existed:
Deepgram's server-side endpointing, which honours it, and `AppState.checkHandsFree`,
which ended the turn on a hardcoded `handsFreeHangover = 1.3` and consulted the
setting nowhere. 1.3 fires before 1.4. Across the whole app that setting was read
in exactly two places: the Deepgram query string, and the Settings row that
displays it back to him. He was turning a knob wired to a label.

It is an adaptive model now — transcript stability, terminal punctuation,
confidence, and a continuation vocabulary — and a preserved fragment is appended
to what follows, so a premature endpoint costs a late sentence instead of a lost
one. Spoken barge-in exists, gated on the audio route.

**Unmeasured, and the design note says so:** the confidence floor (0.55), speaker
energy floor (0.22) and extension multiplier (1.8×) are reasoned, not measured;
whether Deepgram populates `confidence` for this account is unverified; wired
headphones are not distinguished from speakers.

**5 — Local models and personalities.** A personality cannot express authority,
and the compiler proves it: `PersonalityProfile` has seven fields and no
capability, tier, profile or strictness field exists to be set. The test runs the
real TypeScript compiler over the actual source plus a fixture that tries to add
`capabilityTier`, and asserts TS2353 — with a clean fixture asserted to compile
with zero diagnostics, so it cannot pass vacuously.

**6 — "The audio is terrible the second I talk to him."** He asked us to mask it.
It was avoidable. His headset is both default input and default output; opening
its mic collapses output 44100/2ch → **16000/1ch** and leaves it there four
seconds after he stops. Capturing from the built-in mic held **44100 stereo
through three full turns**. And restoring the route politely between utterances
*re-triggers* the collapse, because `AVAudioEngine`'s input node tracks the
system default for as long as the engine object exists — so the lease is held for
the app's run. The media duck now spans listening, thinking *and* speaking.

**7 — Permissions.** Already shipped 2026-09-02 as the strictness axis
(`contained | guarded | open | sovereign`), composing with the five-rung
permission profile, with a floor no mode can lower. The machine sits on `guarded`.

### 2.2 Capability and permission repair

`scripts/orion-learn` had been reading Orion's sessions the whole time: **263
sessions, 157 findings, none ever applied.** Retry loops alone had burned
**11,826,304 tokens**.

The top finding was not a prompt problem. `episodic.ts`'s durable-signal
classifier did not recognise "before I forget", so the harness's own live test
for capturing a fact stated in passing failed regardless of the instructions. Two
lines. `orion-bench --live` went 2/4 → 3/4 and P4, P5, P6 and P7 now report zero.

**The 11.8M-token loop had a cause.** Every transcript was the same shape: a
correct refusal that taught nothing, answered by guessing a different command.
`grep` **is** allowlisted; the *pipe* was refused, so the second guess reasoned
from a false premise the error itself supplied. That message comes from the
vendored openclaw package and cannot be patched here — but `before_tool_call`
fires first, so `routeForDoomedExec` now names the route before the unhelpful
refusal happens.

**Web search was dead.** It was in the tool profile all along; the free
DuckDuckGo provider was one of 61 disabled plugins and `plugins.allow` blocked
enabling it. Fixed at all three layers and verified with a live query. `web_fetch`
and readability extraction are on. Orion did not know he had any of it, so his
operating rules say so now.

**Computer use exists.** `screen_observe` walks the AX tree; `screen_capture` is
the pixel fallback, because AX metadata is text — cheap, redactable, and it does
not carry pixels of a bank balance. `screen_click`/`screen_type`/`screen_key` are
floored at APPROVAL in every mode including `sovereign`, and that floor is earned
by `reversible: false` + `risk: critical` rather than by `approvalRequired`
alone. **Both capabilities are behind config flags; observe is on, control is
off.** Neither works until the TCC grants land (§4).

### 2.3 The offline coder

`scripts/orion-code` — Orion changes his own code with no network. Ollama on
loopback, git local, tests local.

- **`orion-code loop --hours N`** is the agentic one: it surveys what this
  repository records as unfinished — 44 unmet phase requirements, the
  `orion-learn` findings, TODO markers; 92 items on the first run — picks one,
  writes its own concrete task, works out which file that means, edits, checks,
  commits, and asks again. It stops only when the survey returns nothing
  unattempted, two tries per item.
- **`orion-code flight --hours N`** works a fixed queue instead.
- **`selfdev_queue`** is the typed action, so Nick says it in a sentence.

**Model: `gpt-oss:20b`**, on throughput. Ollama's server log gives it directly:
~30–53 tokens/sec against `qwen3.6:27b`'s **5.2**, because MXFP4 is natively
accelerated on Apple silicon and Q4_K_M is not. Over seven hours that is twenty
tasks versus a hundred. Both wrote correct code for the same real task; the 27b's
regex was more careful, at 392s against 106s.

**It is bounded by:** a git worktree on `orion-selfdev`; whole files rather than
diffs; the **installed** plugin's forbidden-surface table, so it cannot edit the
approval verifier or policy evaluator and cannot widen that list without a human
deploying first; a check that must pass; and it never pushes and never installs.

---

## 3. Lessons this program keeps re-learning

Written down because each of these has cost real time more than once.

**A count goes stale; pin contents.** `expect(dev.length).toBe(7)` broke the
moment a dev action was added — the third time a stale count has reported a
correct change as a regression. Assert the names.

**A line that MENTIONS an effect is not a line that performs one.** This has bitten
the `orion-authority` regex declarations, a secret scan on a comment, and a
deferred check reading source prose.

**The repo copy is not always the live copy.** `openclaw-workspace/AGENTS.md` is
tracked; Orion reads `~/.openclaw/workspace/AGENTS.md`. Nothing kept them in
step, so two same-day edits were inert while looking authoritative. Seven live
*skills* existed in no repo at all, one of them actively telling Orion to
`npm install` a binary that is not allowlisted.
`scripts/orion_v2_workspace_sync.sh` reports both, and CI runs it.

**A check nobody runs is not a check.** Two Python contract checks refused
correctly for three days with no listener. So did `orion-learn`, for 263 sessions.

**A test whose verdict depends on the page cache proves nothing.** Four
compile-time proofs had no stated timeout: 1–3s warm, 8–16s cold, against
Vitest's 5s default. They passed here and failed in a fresh worktree.

**A refusal that teaches nothing invites a guess.** See the 11.8M tokens above.

**Measure the right thing.** Model choice was made on wall-clock over a tiny
prompt and was wrong; tokens/sec reversed it. Two jobs against one Ollama model
also serialise — a benchmark running beside the coder makes both crawl, which was
misread as the model being slow.

**A typecheck rewards dead code.** The first autonomous cycle passed by adding a
well-documented, correctly-typed function that nothing calls. The bar is the test
suite, and an added export that nothing references now fails the attempt.

---

## 4. What only Nick can do

1. **`gog auth manage`** — Gmail's refresh token is dead (`invalid_grant`). Click
   **"Add more permissions"** on the account row; that is the re-grant path,
   despite the label. Everything local reports healthy because a token *exists* —
   only Google can say it works. It has died twice and sat dead for three weeks.
   `orion-doctor` now makes a real read and says which failure it is.
2. **`scripts/orion-remote-install`** — the Discord leak fix is written, not live.
3. **TCC grants for computer use** — Accessibility, and Screen Recording for
   `screen_capture`, on `/Users/nickmadaio/.openclaw/tools/node-v24.15.0/bin/node`,
   then relaunch the gateway. Note that granting Accessibility to a bare `node`
   binary is a broad grant. Then, if wanted:
   `openclaw config set plugins.entries.orion-control.config.enableComputerControlActions true --strict-json`
4. **Talk to him with headphones on, and play music while you do.** Three voice
   thresholds are reasoned rather than measured, and whether the audio route
   *sounds* right is a judgement only he can make.
5. **Assign the `unrestricted` role** if he wants it. It is declared and
   deliberately unassigned in `model-roles.seed.json`; no uncensored model is
   installed and choosing one is his call. It inherits the permanent rule either
   way: unrestricted *speech*, never unrestricted capability.

---

## 5. Known-not-done, stated plainly

- **There is no iPhone app.** `native/OrionMobile` is a `MobileCore` library and
  a check executable. No app target, no `.xcodeproj`, nothing installable.
  Phases 49, 56, 65, 66 and 84 are written against an app that does not exist.
- **Phase 53's bounded automation sessions** are not built. 54 and 55 are.
- **Computer use has no click-by-element** — coordinates only — and no scroll or
  drag.
- **No clipboard capability.** `pbpaste` is refused and now says so rather than
  inviting a retry.
- **Phase 68 reliability testing**: 7 of 23 scenarios uncovered.
- **The remote bridge's reconnect log has no timestamps**, so its 36 socket
  errors and 36 session invalidations cannot be correlated to wall-clock time.
  That churn is the most likely explanation for "sometimes it doesn't work" and
  is currently unmeasurable.

---

## 6. Running things

```bash
scripts/orion_v2_ci_check.sh          # everything that can run without the Mac
scripts/orion-doctor                  # the live stack, including a real Gmail read
scripts/orion-deploy                  # build, full suites, install, prove, auto-rollback
scripts/orion_v2_workspace_sync.sh    # is the tracked copy what Orion reads
scripts/orion-eval replay             # re-score every stored eval run, offline
scripts/orion-learn                   # what his own sessions say he gets wrong
scripts/orion-code loop --hours 7     # he works on himself until nothing is left
```

Six suites assert against the live Mac and cannot run in CI — strictness, lock,
remote, backup, authority contract, mobile. `orion-deploy` runs them, which is
why a deploy is the real gate and "CI was green" is not a sufficient answer here.
