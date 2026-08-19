# ORION v2 manifest traceability

Status: **all 85 phases registered; Phase 0 blocked; Phase 1 planned**.

`MANIFEST_PHASES.json` is the machine-readable phase index for the full ORION
v2 implementation manifest. It records the exact source fingerprint, every
numbered phase title from 0 through 84, the sequential-entry rule, current
statuses, and program tracks. The original manifest remains the requirements
source; this file explains how implementation evidence is managed.

## Current program position

| Phase | State | Evidence | Entry decision |
|---|---|---|---|
| 0 — Freeze, Inventory, and Understand Existing ORION | blocked | `PHASE_0_STATUS.md`, `PHASE_GATES.json` | Complete every exit requirement before opening Phase 1 |
| 1 — Establish Repository and Module Boundaries | planned | `PHASE_1_PLAN.md` | No implementation while Phase 0 is blocked |
| 2-84 | not started | indexed in `MANIFEST_PHASES.json` | Each phase requires its immediate predecessor's reviewed exit evidence |

The Phase 0 blocker is narrow but real: live OpenClaw credentials remain
plaintext. Nick approved the coordinated migration and conditional `.env.save`
deletion, and confirmed the exposed Anthropic key was not rotated. Anthropic
console rotation, visible macOS Keychain authorization, SecretRef apply/reload,
and obsolescence proof remain. This gate must not be reinterpreted as permission
to begin Core integration.

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

Until Phase 0 opens Phase 1, Codex remains confined to `planning/v2/**`, new
`scripts/orion_v2_*`, and Phase 0 tests. Native Swift/UI, SessionService,
OpenClaw Control, legacy scripts, live configuration, and installed runtime
remain read-only unless Nick explicitly coordinates an integration window.
