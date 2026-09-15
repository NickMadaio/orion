# ORION v2 manifest traceability

Status: **all 85 phases registered; Phases 0-32 complete; Phase 32.5 documentation
checkpoint complete; Phase 33 not started**.
Last updated 2026-08-27. If it disagrees with `PHASE_GATES.json`, the gate file
is authoritative.

`MANIFEST_PHASES.json` is the machine-readable phase index for the full ORION
v2 implementation manifest. It records the exact source fingerprint, every
numbered phase title from 0 through 84, the sequential-entry rule, current
statuses, and program tracks. The original manifest remains the requirements
source; this file explains how implementation evidence is managed.

## Current program position

| Phase | State | Evidence | Entry decision |
|---|---|---|---|
| 0 — Freeze, Inventory, and Understand Existing ORION | complete | `PHASE_0_STATUS.md`, `PHASE_GATES.json` | All exit requirements passed on 2026-08-19 |
| 1 — Establish Repository and Module Boundaries | complete | `PHASE_1_PLAN.md`, `HANDOFF.md`, `PHASE_GATES.json` | Closed 2026-08-20 against the plan's five criteria, with one recorded deviation from the manifest's literal exit gate |
| 2 — Build the Model Router | complete | `PHASE_2_PLAN.md`, `HANDOFF.md` | Closed 2026-08-23. One recorded deviation: the role list differs from the manifest's, awaiting Nick's review |
| 3 — Create the Context Firewall | complete | `PHASE_3_PLAN.md` | Closed 2026-08-23. Twelve domains, six provenance categories, default-deny matrix. Nothing passes through it yet |
| 4 — Formalize Tool Contracts | complete | `PHASE_4_PLAN.md`, `capability-registry.json` | Closed 2026-08-23. 78 live actions mapped onto structured contracts; strict arguments default-off |
| 5 — Build the Policy Engine | complete | `PHASE_5_PLAN.md`, `orion/security/` | Closed 2026-08-24. R0-R5, fourteen inputs, never more permissive than the live gate across 390 combinations. Inherits the Phase 1 reading, restated |
| 6 — Build the Audit System | complete | `PHASE_6_PLAN.md`, `orion/core/audit/` | Closed 2026-08-24. Redaction in the event constructor; all 17 live ledger rows replay clean. Live ledgers not migrated |
| 7 — Build the Event System | complete | `PHASE_7_PLAN.md`, `orion/core/eventbus/` | Closed 2026-08-24. Nine-field envelope, 25 types over 11 categories, default-deny cascade matrix |
| 8 — Build the Job System | complete | `PHASE_8_PLAN.md`, `orion/core/jobs/` | Closed 2026-08-24. Twelve states; expiry re-checked at four moments; first producer on the Phase 7 bus |
| 9 — Security Invariant Test Suite | complete | `PHASE_9_PLAN.md`, `SECURITY_INVARIANTS.json` | Closed 2026-08-24. 18 invariants, 15 enforced then 17; pending ones cannot pass vacuously |
| 10 — Backend Foundation | complete | `PHASE_10_PLAN.md`, `backend/` | Closed 2026-08-24 with a recorded deviation: no server was stood up. 17 modules declared and boundary-checked |
| 11 — Database Foundation | complete | `PHASE_11_PLAN.md`, `backend/db/` | Closed 2026-08-25 after Nick answered the Phase 10 question by asking for 11-15. 26 tables, migrations proven to replay to the declared schema |
| 12 — Secret and Credential Vault | complete | `PHASE_12_PLAN.md`, `backend/vault/` | Closed 2026-08-25. Envelope encryption with a refusing cipher default; closed the last pending security invariant |
| 13 — Authentication | complete | `PHASE_13_PLAN.md`, `backend/auth/` | Closed 2026-08-25. Hashed tokens, rotation with theft detection, throttling that cannot be used as a lockout weapon |
| 14 — Device Identity | complete | `PHASE_14_PLAN.md`, `backend/devices/` | Closed 2026-08-25. Public keys only; gives Phase 5's DeviceDirectory a real source |
| 15 — Device Pairing | complete | `PHASE_15_PLAN.md`, `backend/pairing/` | Closed 2026-08-25 with one recorded deviation: the joining device proves possession once, at claim |
| 16 — ORION Mobile Foundation | complete | `PHASE_16_PLAN.md`, `native/OrionMobile/` | Closed 2026-08-25 at MobileCore/model scope. The original “no Xcode” diagnosis was false: Xcode 26.6 was installed while `xcode-select` pointed to Command Line Tools. MobileCore now compiles for the iOS simulator with per-command `DEVELOPER_DIR`; there is still no SwiftUI app or rendered mobile UI |
| 17 — Conversation and State Sync | complete | `PHASE_17_PLAN.md`, `backend/sync/` | Closed 2026-08-25. Lamport ordering, hand-written vectors checked in both Python and Swift |
| 18 — ORION Memory v2 | complete | `PHASE_18_PLAN.md`, `backend/memory/` | Closed 2026-08-25. Four classes; external content and inference can never become durable |
| 19 — Today Screen | complete | `PHASE_19_PLAN.md`, `MobileCore/Today.swift` | Closed 2026-08-25. A bare number cannot be an item |
| 20 — Unified Capture | complete | `PHASE_20_PLAN.md`, `MobileCore/Capture.swift` | Closed 2026-08-25. An unresolved capture has no durable payload |
| 21 — Task System | complete | `PHASE_21_PLAN.md`, `backend/tasks/` | Closed 2026-08-25. Fourteen typed fields; blocked is derived from the graph, never stored; a learned estimate can never be recorded as a measurement |
| 22 — Calendar Read Integration | complete | `PHASE_22_PLAN.md`, `backend/connectors/`, `backend/calendar/` | Closed 2026-08-25. Ten capabilities; a webhook Notification has no field an event could live in; incremental absence is never deletion |
| 23 — Planner v1 | complete | `PHASE_23_PLAN.md`, `backend/docs/planning/` | Closed 2026-08-25. Determinism proven by shuffling; a Suggestion has no method that applies it |
| 24 — Schedule Stability | complete | `PHASE_24_PLAN.md`, `backend/docs/planning/stability.py` | Closed 2026-08-25. All nine manifest inputs mapped to the function that reads them; forced relocations separated from optional moves after the phase found it was vetoing them |
| 25 — Calendar Writes | complete | `PHASE_25_PLAN.md`, `backend/calendar/writes.py` | Closed 2026-08-26. Approval binds to a fingerprint of the preview; deletion is R3 with no undo and the reason recorded |
| 26 — Gmail Read/Search | complete | `PHASE_26_PLAN.md`, `backend/gmail/` | Closed 2026-08-26. StoredMessage has no text field at all; a 14-payload injection corpus proves nothing changes, using Phase 18's own checker |
| 27 — ORION Action Inbox | complete | `PHASE_27_PLAN.md`, `backend/gmail/inbox.py` | Closed 2026-08-26. Nine classes plus a declinable tenth; correction signals are scoped and ORION_INFERRED, so Phase 18 refuses to make them durable |
| 28 — Gmail Drafting | complete | `PHASE_28_PLAN.md`, `backend/gmail/drafts.py` | Closed 2026-08-26. Recipients come only from structured headers; no injection payload can redirect a draft; a revision clears the review |
| 29 — Gmail Sending | complete | `PHASE_29_PLAN.md`, `backend/gmail/send.py` | Closed 2026-08-26. R3, explicit approval only, all four required fields in the preview and in the fingerprint, no undo |
| 30 — HealthKit Local Layer | complete | `PHASE_30_PLAN.md`, `MobileCore/Health.swift` | Closed 2026-08-26. Eight types on iPhone only; read authorization can be `unknowable`; a sample has no encodable form. Released Phase 16's deferred-feature gate the way it was designed to be |
| 31 — Health Baseline Engine | complete | `PHASE_31_PLAN.md`, `MobileCore/HealthBaseline.swift` | Closed 2026-08-27. Six baselines; below seven observations there is none; the reported value is quantised to a step that widens as confidence falls; no population table exists |
| 32 — ORION Health State | complete | `PHASE_32_PLAN.md`, `MobileCore/HealthState.swift` | Closed 2026-08-27. Six derived states, all categories and no scores; reason/baseline/confidence/freshness are required; a clinical word list is checked against ORION's own vocabulary |
| 33-84 | not started | indexed in `MANIFEST_PHASES.json` | Each phase requires its immediate predecessor's reviewed exit evidence |

## Additive checkpoint after Phase 32

`P32.5 — Capability Charter and Product Gap Review` closed as documentation on
2026-08-27. Its evidence is `PHASE_32_5_CAPABILITY_CHARTER.md` and the
machine-readable `ROADMAP_AMENDMENTS.json`. It does not renumber the original 85
phases, change their fingerprint, reopen historical closures, select providers,
authorize live work, or advance the numbered program. Phase 33 remains not
started.

The amendment record gives missing implementation work stable homes:

| ID | Purpose | Current state |
|---|---|---|
| `REC-REVIEW-11-20` | recover the independent-review gap for Phases 11-20 | required before the next implementation batch |
| `REC-LIVE-FOUNDATION` | running API/database/auth, durable repositories, production crypto, restart/rollback proof | required before enabling real v2 connector/automation/control paths |
| `REC-AUTHORITY-REPLAY` | direct-request semantics, single-use approvals, idempotency, durable audit and revocable modes | required before writes/control |
| `REC-READONLY-CONNECTOR` | first real least-privilege connector; HealthKit is a separate proof for that feature | required before enabling broader connector actions |
| `REC-USABLE-CLIENT` | real rendered mobile/desktop slice and normal-route proof | scheduled in the first connected-product batch, before broad live automation |
| `REC-OPERATIONS` | batch report, review/repair, secret scan, commit-vs-push and recovery evidence | required at reviewed batch/release checkpoints |

The existing phase validator reads the `phases` records in
`PHASE_GATES.json`. It ignores `programCheckpoints` and the separate `REC-*` register. The
repository read protocol makes them visible, but this documentation-only pass
does not claim mechanical enforcement.

Continuation order and the reviewed-backlog recovery procedure are in the
charter, sections 5 and 6. These checkpoints gate actual activation, not merely
the wording of completion claims. The first visible client work need not wait
until Phase 84, and HealthKit is not a dependency of a first Google read.

Phase 0 closed after Anthropic rotation, three dedicated login-Keychain items,
an OpenClaw SecretRef apply, a clean three-reference audit, deletion of the
invalid unreferenced `.env.save`, doctor health, and a fresh authenticated
normal-route ledger smoke. The legacy `.env` remains a mode-`0600`, gitignored,
accounted compatibility input until its separate adapter migration.

Phase 1 delivered collision-free package markers, an AST import firewall,
strict versioned envelopes, canonical language-neutral JSON Schemas,
authorization-bound Core port protocols, a read-only `system_status`
compatibility adapter, and the coordinated TypeScript integration behind a
default-off flag. Live inspection found that the manifest's proposed
`orion/cloud/` package would shadow legacy `orion/cloud.py`; that marker is
deliberately deferred rather than changing existing import behavior.

Phase 1 closed on 2026-08-20 with one deviation carried forward in machine-
readable form: nothing runs *through* Core. A fail-open observer wraps one
read-only capability while the legacy OpenClaw route keeps every authority. A
test asserts that deviation stays recorded, so Phase 2 cannot inherit it by
accident. `docs/planning/v2/HANDOFF.md` holds the full verification table, the live
task ids, and the rollback path.

## Two registers for when the manifest and reality disagree

The manifest is the requirements source and stays that way. But it was written
before the system existed, so it will sometimes describe a world the built system
contradicts, and it will sometimes lack something Nick wants. Neither is a reason
to quietly improvise. `PHASE_GATES.json` carries two registers for exactly this:

**`pendingGateAmendments`** — a gate whose text rests on an assumption the built
system contradicts. Record it with proposed replacement wording, keep working
under a recorded deviation, and amend them all together in one pass Nick reads
end to end. Never bend a gate in the moment. Two entries so far: Phase 1's exit
gate, which assumed ORION Core is a running program the live route executes, and
Phase 2's role list. Three further deviations are recorded against their own
phases rather than as amendments, because the gate text is right and the system
has not met it yet: Phase 5's engine agrees with the live gate rather than being
it, Phase 6 did not migrate the live ledgers, Phase 10 stood up no server, and
Phase 15's joining device proves possession once rather than twice, and
Phase 16 built no SwiftUI. Its original plan blamed a missing iOS SDK, but the
postscript and current machine evidence correct that diagnosis: Xcode is
installed, and MobileCore compiles for the simulator under a per-command
`DEVELOPER_DIR`. The remaining UI gap is unimplemented work, not an environment
impossibility.

**`scopeNotInManifest`** — something Nick wants that no phase covers. Record what
already exists, which layer it belongs to, and where it would fit, rather than
either refusing it or building outside the document. Two entries so far, both
raised 2026-08-20: **texting** (already partly live, ahead of the manifest) and
**smart home** (nothing live yet). Both are tool capabilities rather than model
roles, so neither belongs to Phase 2.

Tests enforce that entries in both registers stay well formed — an "accepted"
deviation without a name and a date is an unreviewed one wearing the word
accepted, and a deferred amendment without replacement text cannot be reviewed
in one sitting.

Resolve both registers in the same reviewed pass.

## Program tracks

| Phases | Track | Earliest governing outcome |
|---|---|---|
| 0-9 | Local Core and security foundation | Model proposes; deterministic policy authorizes; broker executes; audit records |
| 10-15 | Cloud, identity, and pairing foundation | Multi-user ownership, credential vault, account auth, device keys, secure pairing |
| 16-21 | Mobile, sync, memory, capture, and tasks | Native mobile shell with secure identity and conflict-safe state |
| 22-29 | Calendar, planning, and Gmail | Minimal-scope connectors, deterministic planning, reviewed external writes |
| 30-38 | Local health and health-aware planning | Raw HealthKit stays local; only derived, confidence-bearing signals cross domains |
| 39-43 | Daily planning, time, notifications, and safety controls | Timezone correctness, restrained notifications, Security Center, LOCK ORION |
| 44-56 | Remote Mac control and bounded computer use | Outbound Mac connection, signed/expiring jobs, narrow capabilities, privacy firewall |
| 57-66 | Automation and proactive product surfaces | Reviewed structured automations, simulation, explainability, bounded interruption |
| 67-75 | Cost, reliability, security, privacy, and operations | Budgets, failure/attack tests, protected delivery, data controls, recovery |
| 76-84 | Deferred features, expansion, and release hardening | Explicit deferrals remain deferred until prerequisites and release reviews pass |

## Evidence protocol for every phase

Before a phase changes from `not_started` to `planned`, add a dedicated
`PHASE_<N>_PLAN.md` that derives every requirement and exit condition from the
manifest. Before implementation begins, update the predecessor's machine gate
with passing evidence and independently verify it.

During implementation:

1. Keep changes in the owning module lane and list any shared integration files.
2. Add contract, security, failure, and regression tests before widening authority.
3. Record sensitive data, permissions, network surfaces, and rollback behavior.
4. Keep a default-off compatibility path until behavioral parity is proven.
5. Update this register, `PHASE_GATES.json`, and the phase plan in the same
   checkpoint that changes program status.

A phase is not complete because its directory exists or unit tests pass. Its
manifest-wide exit behavior must be demonstrated through the normal route with
the relevant durable artifacts, policy/audit evidence, and rollback proof.

## Independent review

Batched phase work is reviewed by agents given the manifest, the repo and the
commands, and no narrative account of how the work was done. The consolidated
review register below names Phases 5-10, 21-30 and 31-32. Earlier handoffs report
0-10 reviewed; Phase 0-4 review provenance needs reconciliation during backlog
recovery, since implementation and normal-route proof alone do not establish
an independent review. The three consolidated reviews all found claims that
were **false at the moment they were written** rather than code that drifted.
There is no equivalent independent review record for Phases 11-20;
`REC-REVIEW-11-20` records that gap rather than inferring coverage from per-phase
implementation checks:

| Review | Scope | Verdict |
|---|---|---|
| 2026-08-25 | Phases 5-10 | 3 phases not complete as claimed; 26 findings, 17 corrections recorded |
| 2026-08-26/27 | Phases 21-30 | 5 phases not complete as claimed; 36 corrections recorded |
| 2026-08-27 | Phases 31-32 | 1 not complete as claimed, 1 with a false requirement; 11 corrections recorded |

The second review's most serious finding was not a code defect: a gate cited a
3,000-random-string differential test that did not exist in the repository. The
run had happened in a shell and the conclusion was correct. **Evidence nobody can
re-run is not evidence**, and this program's gate prose is written by whoever did
the work with nothing checking it.

All three reviews found claims that were false when written rather than code that
drifted — a cited test that did not exist, a count that was wrong ("22 stems",
actually 23), a guard tested for "without either" while claiming "without both".
The third also named a structural cause worth remembering: **Phase 32's fixtures
never consumed a Phase 31-produced value**, which is why 23 of its 42 guards were
unenforced and why a defect in the producer was invisible to the consumer's
tests. When one phase builds on another, its checks must run over what the
earlier phase actually emits, not over hand-built stand-ins.

Corrections are recorded per phase under `postReviewCorrections` rather than
edited into the original evidence — the fact that a claim was wrong is itself
evidence about the evidence. Every repair is mutation-tested: remove the fix and
a test must fail.

## Collaboration rule

Codex and Claude both stay confined to `docs/planning/v2/**`, new manifest packages,
`scripts/orion_v2_*`, and `tests/test_v2_*`/`test_phase0_*`. Native Swift/UI,
SessionService, OpenClaw Control, legacy scripts, live configuration, and
installed runtime remain read-only unless Nick explicitly coordinates an
integration window. Two such windows have been opened so far, both for the
`system_status` bridge: 2026-08-19 (build and first live proof) and 2026-08-20
(fail-open correction and Phase 1 close-out).

Whichever assistant works next reads root `AGENTS.md` first — its "Relay
protocol" section defines how the two of us hand work back and forth, including
the rule that a handoff's date is when it was written, not when the work
stopped.
