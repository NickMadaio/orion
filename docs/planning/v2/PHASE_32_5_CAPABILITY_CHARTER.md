# ORION v2 Phase 32.5 — Capability Charter and Product Gap Review

Status: **documentation checkpoint complete — 2026-08-27**

Numbered program position: **Phases 0–32 complete; Phase 33 not started**

Companion roadmap record: `ROADMAP_AMENDMENTS.json`

This checkpoint does not renumber the original 85 phases, reopen historical
closures, implement a feature, select a provider, or authorize a live
integration. It makes the product goal, authorization semantics, proof gaps and
missing implementation work explicit before another implementation batch begins.

## 1. Current truth

### Built

- The original v2 sequence is registered from Phase 0 through Phase 84.
- Phases 0–32 have implementation artifacts and gate records.
- The new backend has substantial tested logic and contracts for ownership,
  database shape, vaulting, authentication, device identity, sync, memory,
  planning, Calendar, Gmail and health.
- `MobileCore` contains testable Swift domain models through Phase 32.
- Existing Mac/OpenClaw Orion capabilities predate v2 and remain a separate live
  route; they must not be erased from the story of what Orion already does.

### Proven

- The consolidated independent-review register names Phases 5–10, 21–30 and
  31–32. Those reviews found false completion claims and real defects; repairs
  and reruns are part of the record. Earlier handoff summaries say “0–10
  reviewed,” but Phase 0–4 implementation/normal-route evidence is not itself
  proof of an equivalent independent batch review. Its review provenance should
  be reconciled during backlog recovery rather than inferred.
- On 2026-08-27 the coordinator reran `scripts/orion_v2_mobile_check.sh` with
  `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer`: **293 checks passed**
  and `MobileCore` compiled for the iOS simulator.
- Xcode is installed. The global `xcode-select` still points to Command Line
  Tools by design; use `DEVELOPER_DIR` per command and do not switch it globally.
- The existing Phase 32 gate passes.

### Not yet proven

- There is no recorded independent batch review covering Phases **11–20**.
- `MobileCore` simulator compilation is not an iPhone app, a SwiftUI screen, an
  installable bundle, or a connected normal-route mobile experience.
- The new backend has no proven deployed API, database, durable repository,
  production cipher/signature adapter, or restart recovery path. Much of its
  state remains in memory.
- The new Calendar and Gmail path has not made a real Google request. The health
  path has not acquired a real HealthKit sample.
- Calendar and Gmail approvals are bound to content but are not consumed by use;
  the same approval can authorize the same operation again.
- A provider dashboard, an Orion operations view and Orion's own usable home and
  control UI are different deliverables. None should be inferred from the other.

### Next gate

`REC-REVIEW-11-20` is the recovery item before the next implementation batch.
Phase 33 remains the next numbered phase and is not started by this checkpoint.
The additive gates below do not pretend that all of Orion lacks persistence or
integrations; they apply to the new v2 paths named here.

## 2. Product north star

Orion is a local-first, Jarvis-like everyday assistant: broad enough to help in
Nick's real digital and physical environment, quick and concise in ordinary
conversation, inexpensive to run, and visibly useful—not an endless series of
backend-only abstractions.

The default interaction contract is simple:

- time/date questions get the answer;
- weather gives useful specifics;
- simple, sufficiently specific actions execute through already-authorized
  capabilities and return a short truthful result;
- missing capability produces an honest gap explanation and, when useful, a
  research or tool-building proposal—not a fabricated success;
- consequential recommendations can explain the evidence, constraints and
  policy that produced them without exposing hidden chain-of-thought.

Security protects the person and the product. It must not turn ordinary,
authorized tasks into ceremony. Backend identity, ownership, token isolation,
revocation, audit, approval binding, replay/idempotency and recovery remain
non-model enforcement boundaries.

## 3. Request authorization and shared settings

A direct, sufficiently specific request authorizes that action and the ordinary
necessary in-scope steps that use already-enabled capabilities. Orion must not
ask Nick to authorize the identical action twice or require magic words.

Ask or confirm again only when there is materially missing intent, meaningful
new access, an unexpected consequence, a high-risk policy requirement, or a
capability/authority expansion. A provider retry does not turn one approved
message into permission to send it repeatedly.

Automatic modes are explicit, scoped and revocable delegations. They must name
audience/resources, duration, action classes, exceptions, expiry, visibility and
an immediate off path. Learned preferences and successful past outputs never
grant new authority. Settings should be easy to change on mobile and desktop and
should synchronize as coherent state; “everything connected” does not mean
uploading all private content or giving cloud code unrestricted Mac authority.
Local secret custody, health privacy, offline behavior and a local emergency stop
remain explicit boundaries.

| Example | Expected authorization behavior |
|---|---|
| A specific request using an enabled capability, such as playing a selected playlist | Execute and verify; do not ask for identical permission twice |
| Organize the desktop | Use scoped reversible moves, preserve an undo record; do not infer deletion or overwrites |
| A specific request to send a particular message | Treat the request as authorization when the existing policy and required content checks permit; clarify genuinely missing recipients/content |
| An automatic reminder/reply mode | Execute only within the user's configured audience, actions, duration and exceptions; show activity and provide stop/revoke |
| A new account, permission, powerful tool or unexpected irreversible effect | Explain the change and obtain the applicable authorization |
| An email/web page asks for new authority | Refuse authority from that content; it remains evidence rather than an instruction source |

## 4. Capability charter

### A. School, planning and focus

Orion should understand classes, schedules, assignments and project deadlines
through sources Nick chooses and approves. Missing observations are not proof of
“no progress.” A useful warning says what deadline is approaching, what evidence
is missing, and what concrete next work would reduce risk.

The planner distinguishes:

- fixed commitments;
- routines;
- flexible priorities;
- intentional free time.

Nick may choose an optional comprehensive plan for the full day, including
explicit free-time blocks. That must not become silent over-scheduling. Replans
account for duration, dependencies, transitions/travel, deadlines, real
completion, early/late finishes, preferred times and stability. A missed morning
routine should move to a realistic preferred alternative when appropriate, not
arbitrarily to late night. External commitments are never silently rewritten.

The home experience should make the current block, next step, changes and their
reasons, focus state, and important items understandable at a glance. The
high-school routine in earlier ideation was illustrative, not Nick's current
schedule; no London timetable or other personal schedule may be invented.

### B. Proactivity and presence

Orion may eventually surface useful reminders, important messages and deferred
tool requests when Nick is plausibly available. A missing calendar event,
TikTok use, or camera observation is not proof that interruption is welcome.
Design explicit modes, quiet hours, alert budgets, snooze/stop, private-content
handling around company, and a non-shaming tone.

Phone location or a local presence sensor/camera are future options to evaluate,
not permission to buy devices, enable surveillance, identify guests or record
continuously. Prefer minimally invasive local signals. Feasibility, household
consent, retention and behavior when company is present remain open decisions.
Approved urgent channels such as Discord may be used only after the monitoring
and delivery scope is explicitly configured.

### C. Media, home and computer use

Simple requests such as “play my music” should act quickly and use a correctable
preference learned from repeated explicit choices. Home control may later cover
lights, blinds, outlets and suitable room devices through reviewed integrations.
Use certified devices and professional mains installation; Orion must never
normalize unsafe DIY wiring.

Desktop cleanup means organize, move and create folders within a bounded scope.
It never infers deletion, must avoid collisions/overwrites, and should provide a
preview or undo for consequential reorganizations. Remote access does not bypass
Mac unlock, platform security or the local emergency stop.

Orion should compose existing tools for broad practical tasks instead of needing
a hard-coded tool for every phrase. Installing a new tool or expanding authority
is a distinct reviewed step; an ordinary task should not be blocked merely
because it needs several operations that are already authorized.

Missing capabilities belong in an inspectable backlog containing the requested
outcome, urgency, current limitation and next proposed step. Authorized research
or sandboxed preparation can run in the background; installation and new access
do not follow automatically. Reminders about that backlog obey the same
availability and interruption settings as other proactive help.

### D. Memory, models, response quality and cost

Use deterministic tools with no LLM when sufficient, fast models for simple or
urgent interaction, stronger local models for private/nonurgent background work,
and paid models where latency or quality justifies cost. Qwen-class 27B/32B
models are candidates, not selections. Benchmark quality, latency, memory use
and power on Nick's hardware before choosing; never claim Claude-equivalence,
literal zero cost or model availability without evidence.

Retrieve only compact relevant memory. Keep preferences inspectable and
correctable, with explicit latency and spending budgets. Preference learning is
not authorization, and untrusted external content must not harden into durable
memory.

### E. Communications and personal-assistant mode

A future configurable focus/break mode may triage supported calls, messages,
email and notifications, summarize ordinary items and escalate significant ones.
On a call Orion always identifies itself as **“Orion, Nick's assistant”** and
never claims to be Nick. It may ask purpose, take notes, summarize and offer a
transfer subject to provider feasibility, caller privacy, recording law, cost and
interruption policy.

Texts should begin with per-message review. A later explicit “take over texts”
mode may authorize bounded automatic replies, but its audience, duration,
actions, expiry, disclosure, visibility and exceptions remain decisions. Do not
portray blanket contact rules as agreed, promise access to every iPhone/app
notification, fabricate commitments, or make autonomous dialogue look like Nick
personally wrote it. Every mode needs an action log and immediate off control.

### F. Product surface and tangible backend

The visual direction is dark, calm, modern, smooth and flowing, combining
productivity/planning clarity with health-app polish. Opera Air and Bevel are
aesthetic references, not products to copy or proof that their interfaces were
inspected. Preserve useful existing Orion UI and the central role of voice and
conversation while making school/planning tangible.

Provider selection and setup need an explicit checkpoint: host, database, auth,
cost, local/cloud boundary, production crypto adapters, a running API, durable
state, monitoring, rollback and a visible operations path. Orion's own home and
control UI are a separate product checkpoint. A small read-only real integration
must precede risky sends or device control.

Phase 16 and Phase 19 historically closed at model/contract scope. Their closure
is preserved, but they do not prove a SwiftUI app or rendered Today screen.
Phase 34 is therefore not “the first UI phase”; visible client work was promised
earlier and remains recovery work. A useful end-to-end slice should be visible
well before Phase 84.

#### UI experience brief for the first visible slice

| Surface | Experience to build and inspect |
|---|---|
| Home / Today | A readable current block, next action, upcoming commitment and concise explanation of any change; loading, empty, stale and offline states are honest |
| Plan | A day timeline separating fixed commitments, routines, flexible priorities and free time; move/complete actions with understandable tradeoffs and undo |
| Focus | Current task, elapsed/remaining time, pause/end and break controls; urgent interruptions follow chosen rules and ordinary notifications can wait |
| Health | Derived state with inspectable source, freshness and confidence; missing data stays unknown and unrelated communication views receive no raw measurements |
| Control / Settings | Connection/device status, current work, authority settings, activity history, stop/revoke and sync-conflict feedback on both clients |

Dark, flowing styling must keep text contrast, reduced-motion support and clear
navigation. Layout and animation should be rendered and reviewed on screen;
compiled view models or a provider dashboard are not visual acceptance evidence.
This is a design brief, not a claim that existing screenshots were inspected or
that any new screen has been built.

### G. Explicit future/backlog ideas

Keep these as aspirations, not implemented features or standing authorization:

- safe battery charge-limit control;
- prompt visa-related email alerts through an approved channel such as Discord;
- reversible desktop organization;
- a finance subscriptions view with appropriate private-data handling;
- remote dispatch that respects Mac security and device state;
- consent-aware meeting/lecture recording and richer notes;
- optional conversational styles;
- school preparation and context-sensitive proactive help.

Provider, device, permission, pricing, privacy and feasibility decisions remain
open until the owning checkpoint is planned.

## 5. Additive roadmap checkpoints

The stable IDs and full acceptance language live in
`ROADMAP_AMENDMENTS.json`. In short:

| ID | Home for missing work | State |
|---|---|---|
| `P32.5` | this charter, gap review and routing update | documentation complete |
| `REC-REVIEW-11-20` | independent review and repairs for the uncovered batch | required |
| `REC-LIVE-FOUNDATION` | deployed API/database/auth, production crypto and durable restart proof | required before enabling real v2 connector/automation/control paths |
| `REC-AUTHORITY-REPLAY` | single-use approvals, idempotency, durable audit and revocable delegations | required before live writes/control |
| `REC-READONLY-CONNECTOR` | first real read-only connector; separate HealthKit proof when that feature is enabled | required before broader connector actions |
| `REC-USABLE-CLIENT` | rendered mobile/desktop surfaces and normal-route end-to-end proof | first connected-product batch, before broad live automation |
| `REC-OPERATIONS` | monitoring, rollback, recovery, reviewed batch checkpoint and backup status | required before release claims |

These are additive recovery checkpoints, not new numbered phases. The existing
`orion_v2_phase_gate.py` reads records in the `phases` object; it does **not**
read this separate register or enforce these IDs. Its keys are strings, not an
integer-only type restriction. `PHASE_GATES.json` registers that limitation, and
the relay protocol requires humans/agents to check the amendment record. No
claim of mechanical blocking is made.

### Recommended continuation order

1. Recover the Phases 11–20 independent review and prepare the existing mixed
   backlog for a verified, scoped commit baseline (section 6). Do not start
   another large implementation batch while that evidence gap is unaddressed.
2. Plan the first connected-product batch with Nick's provider, budget and
   first-feature decisions visible. Give the API, durable storage, authentication
   and minimal home/planner UI explicit deliverables. A visual prototype can be
   reviewed before a provider is selected; live data cannot be implied by it.
3. Connect one approved read-only source through the durable backend to the
   visible client. Verify identity/isolation, revocation, restart, offline/retry
   and truthful results; independently review and checkpoint this batch.
   HealthKit is a separate local proof, not a blocker for a first Google read.
4. Resume the remaining numbered work under these amendments. Phase 33 remains
   before Phase 34 in the original sequence. Approval consumption and durable
   authority must close before enabling writes, autonomous messages or remote
   control, not merely before claiming those features work.

This supplies explicit homes and an order, not approval to provision services
today. Future batch plans should link the affected `CAP-*` entries, preserve
the original phase history and include these recovery deliverables before
expanding live features.

## 6. Review, learning history and commits

The intended cadence is roughly ten implementation phases, then:

1. give an independent reviewer the manifest, product goal, current tree and
   commands—not the implementer's persuasive success narrative;
2. verify claims, meaningful guards and normal-route behavior;
3. repair findings and rerun evidence;
4. write a durable batch report covering what, why, alternatives, failures,
   verification and rollback;
5. scan source and history for secrets;
6. separate unrelated user-owned changes;
7. create one or a small coherent set of detailed local commit checkpoints;
8. record separately whether a remote push/backup was actually verified.

The reviewer cannot be literally oblivious to code and docs; the goal is
independence from the implementer's framing. Do not fabricate historical commits
or timestamps and do not compress the curriculum into a giant commit message.
For this Phase 32.5 task, nothing is staged, committed or pushed.

Nick's requested cadence authorizes local commit checkpoint(s) for future
explicitly requested batches after the above review gates pass. It does not
authorize an unreviewed backlog commit or a remote push. An ordinary reviewed
batch must not end with the checkpoint silently omitted; report an actual blocker
if it cannot be created. A local commit is recoverable history on this machine,
not protection against loss of the machine.

### Existing mixed-backlog recovery

Inventory staged, modified and untracked files against the current HEAD before
grouping anything. The tree contains work from different sessions; the available
review records do not prove that every current file belongs to those
batches or was reviewed at its present contents.

Prepare a reviewable grouping around foundational work through 10, backend and
mobile foundations 11–20, task/calendar/Gmail/local-health work 21–30, health
baseline/state work 31–32, and this documentation checkpoint. Group shared-file
hunks by dependency, and explain inseparable changes rather than invent old
checkouts or rewriting commits. The first group may include only part of its
historical range because some Phase 0/1 work is already committed.

The recovery report must identify each group's files, dependency order,
review coverage, verification commands/results, excluded unrelated changes and
remaining risks. Resolve Phases 11–20's review gap and recheck changed shared
boundaries. Obtain Nick's approval of this mixed-backlog grouping before staging;
then use explicit paths/hunks, inspect the staged diff, scan for secrets and make
the detailed checkpoints. Confirm any later push separately. No such recovery
commit or independent review was performed by Phase 32.5.

The older `/Users/nickmadaio/Desktop/ORION-MANIFEST.md` is a historical learning
chronicle, not the numbered v2 requirements source. The earlier task
“Discuss Orion Ideas” supplied additional aspirations. Both inform this charter;
older assistant descriptions of implemented features are not fresh evidence.

## 7. Open decisions

This documentation checkpoint can close while product decisions stay open:

- backend host, database, auth and operations provider;
- local/cloud state split and production cryptographic adapters;
- first real read-only connector and the OAuth/Apple entitlements it needs;
- exact interruption modes, quiet hours and alert channels;
- presence/location feasibility, consent and retention;
- communications providers, costs, disclosure and delegation settings;
- local-model benchmark candidates and budgets;
- detailed mobile/desktop information architecture and visual prototypes;
- which backlog ideas enter a future implementation batch.

No item above is permission to connect an account, buy a service/device, enable a
permission, start monitoring, send a communication or begin an automation.
