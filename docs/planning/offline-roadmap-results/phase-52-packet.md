# Phase 52: Raw Terminal Access — Implementation Packet

## Baseline

| Item | Detail |
|------|--------|
| Commit | 9855d99 (2026-09-26) |
| Inspected paths | `plugin/orion-control/src/` (exec layer, action catalog), `scripts/` (orion-approve, orion-lock), `native/Orion/Sources/SessionDomain/` (session state), `docs/planning/v2/MANIFEST_PHASES.json` |
| Limits | No installed device access; native Swift checks not registered in local worker. Historical Python paths (`orion/security/risk.py`) cited only as evidence of prior decisions, not current implementation owners. |

## Requirement matrix

| Requirement ID | Status | Source symbol / Evidence | Notes |
|----------------|--------|--------------------------|-------|
| `keep_it_disabled_by_default` | Built | `plugin/orion-control/src/` exec layer policy: `security: allowlist`, `ask: off`, `askFallback: deny`. Zero raw-shell actions in catalog. | Disabled by absence. Phase 51 landing first makes this practical. |
| `only_after_structured_operations_are_proven_safe` | Built | Phase 51 shipped first (entryRequiresPhase: 51, entrySatisfied: true). Sequencing fact. | "Proven safe" not yet claimable as verdict; remains open sequencing constraint. |
| `treat_raw_terminal_as_r5_with_session_visibility_faceid_duration_audit_and_cancellation` | Not yet proven | `terminal_run` action in catalog (tier: raw_terminal, critical, irreversible, approval required). `orion/security/risk.py` (historical R5 classification). `scripts/orion-approve` for chat grants. | Blocked by pending gate amendment: Face ID → in-app confirmation. Requires Nick's acceptance of new gate wording. Current source implements zsh -lc, 2-min limit, 20KB cap, audit in task ledger, Stop kills process group. Chat grant 8h expiry. |

## Architecture and interfaces

| Aspect | Detail |
|--------|--------|
| Producer | `plugin/orion-control` exec layer (TypeScript) — action catalog, policy engine, command runner (`terminal_run`) |
| Consumer | `native/Orion/Sources/SessionDomain` / SessionService (Swift) — durable state, approvals panel, task ledger visibility |
| Serialized fields | Action intent: `{ kind, args, owner, device, expiry, nonce }`; Approval signature: `<user>@app` via `scripts/orion-approve` |
| State ownership | SessionService owns durable local state and session effects; plugin owns local policy/action execution |
| Errors | Unlisted command refused outright (allowlist); raw terminal disabled by default (`enableRawTerminalActions: false`); approval atomically consumed; Stop kills process group, never retried. Sandbox-exec denies writes to gate/plugin/repo/LaunchAgents. |

## Smallest next slice

**Blocker**: The pending gate amendment (Face ID → in-app confirmation) is awaiting Nick's acceptance as the gate wording. Until that is recorded as approved, a truthful implementation contract cannot be proposed because the authorization mechanism is undecided.

**Reconnaissance needed**:
1. Confirm `enableRawTerminalActions` default value in current source (`plugin/orion-control/src/`).
2. Locate `terminal_run` action definition and its tier/risk classification in the action catalog.
3. Verify `scripts/orion-approve` handles chat grants with 8h expiry and revocation.

**Proposed contract (conditional on gate amendment approval)**:
None at this time. The blocker prevents defining a bounded next slice with acceptance criteria. Once the gate amendment is approved, the next slice would involve implementing the in-app confirmation UI/flow for `terminal_run` actions, replacing the Face ID requirement.

## Test scenarios

| Scenario | Type | Injectable Seam | Expected Outcome |
|----------|------|-----------------|------------------|
| Raw terminal action disabled by default | Positive | N/A | Exec layer refuses raw-shell actions; no prompt shown. |
| Terminal run with valid approval | Positive | `scripts/orion-approve` grant | Command executes via zsh -lc; output capped at 20KB; audit entry created. |
| Terminal run without approval | Failure | No grant in `orion-approve` state | Action refused outright; no execution occurs. |
| Stop command during terminal run | Failure | Kill signal to process group | Process group killed; action marked stopped; no retry. |
| Chat grant expiry (8h) | Failure | Time travel or stale grant | Grant considered expired; new approval required. |
| Command copied from read content | Failure | Input source tracing | Action refused; security policy prevents execution. |

*Note: Existing test suites `review-repairs.test.ts` (9 tests) and `terminal.test.ts` (5 tests) cover these scenarios in the current codebase.*

## Gates and handoff

| Gate | Status | Detail |
|------|--------|--------|
| Entry gate | Satisfied | Phase 51 completed; entryRequiresPhase: 51, entrySatisfied: true. |
| Pending gate amendment | Awaiting decision | Nick to accept in-app confirmation (Allow once / Allow for this chat / Deny) as replacement for Face ID. |
| Handoff | Blocked | Cannot proceed to implementation until gate amendment is approved and recorded. |
| Rollback | N/A | No source changes made in this phase; only investigation and contract preparation. |

*Reviewer handoff: Verify cited symbols exist at worktree baseline. Confirm blocker status with Nick if gate amendment remains pending.*
