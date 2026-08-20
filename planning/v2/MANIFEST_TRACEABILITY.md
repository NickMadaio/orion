# ORION v2 manifest traceability

Status: **all 85 phases registered; Phases 0 and 1 complete; Phase 2 not started**.

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
| 2 — Build the Model Router | not started | none yet | Blocked on `PHASE_2_PLAN.md`, on settling the Phase 1 deviation, and on re-confirming shared-file ownership |
| 3-84 | not started | indexed in `MANIFEST_PHASES.json` | Each phase requires its immediate predecessor's reviewed exit evidence |

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
accident. `planning/v2/HANDOFF.md` holds the full verification table, the live
task ids, and the rollback path.

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

## Collaboration rule

Codex and Claude both stay confined to `planning/v2/**`, new manifest packages,
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
