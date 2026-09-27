# Phase 83: Multi-User Hardening — Evidence Packet

## Baseline

| Item | Detail |
|------|--------|
| Snapshot commit | `9855d99` (2026-09-26) |
| Inspected source paths | `plugin/orion-control/src/approvals.ts`, `plugin/orion-control/src/catalog.ts`, `scripts/orion-remote` |
| Limits | No installed device access; native Swift checks not registered in local worker. Single-tenant system. |

## Requirement matrix

| Req ID | Status | Source symbol / evidence | Notes |
|--------|--------|--------------------------|-------|
| `does_not_rely_on_uuid_secrecy` | Built | `plugin/orion-control/src/approvals.ts::ApprovalTicket` | Ticket ID is 4 chars (readable aloud). Authorization requires matching `canonicalHash`, 128-bit `nonce`, `deviceId`, unexpired window, and `grantedBy` != local process. Guessing ID grants nothing. |
| `enforces_tenant_isolation_and_object_level_authorization` | Not yet proven | N/A (single tenant) | No second identity exists in the system. Building isolation before a second user produces code that has never separated anything. Blocked until multi-identity is introduced. |
| `adds_rate_limits_quotas_and_abuse_controls` | Not yet proven | `scripts/orion-remote::RATE_CAP` (40/sender); plugin duplicate tool call refusal; Phase 67 budgets | These are runaway controls for a trusted user, not abuse controls against an adversary. No untrusted user exists to rate-limit. |
| `isolates_jobs_connectors_memories_and_encryption_context` | Not yet proven | `plugin/orion-control/src/catalog.ts::CapabilityTier` | Capability tiers exist as a closed enum. Profiles are intersections of tiers. This is the natural shape for per-user profiles when a second user arrives, but no isolation exists now. |

## Architecture and interfaces

- **Proposed seam**: Approval ticket validation chain (`ApprovalTicket` structure) and Capability Tier profile intersection.
- **Producer**: `plugin/orion-control/src/approvals.ts` (creates tickets with nonce/hash); `plugin/orion-control/src/catalog.ts` (defines tiers).
- **Consumer**: `plugin/orion-control/src/controller.ts` (validates enabled tiers); `scripts/orion-remote` (enforces rate cap).
- **Serialized fields**: `ApprovalTicket`: `id`, `canonicalHash`, `nonce`, `action`, `summary`, `deviceId`, `expiresAt`. `CapabilityTier`: closed string enum.
- **State ownership**: Tickets are durable JSON files on disk. Tiers are compile-time constants in TypeScript. Rate cap state is in-memory per sender in `orion-remote`.
- **Errors**: Ticket validation fails if hash, nonce, device, or expiry mismatch. Tier check fails if action's required tier not in `enabledTiers`. Rate cap rejects further messages from sender.

## Smallest next slice

**Evidenced blocker.** All four Phase 83 requirements are either already satisfied by existing single-tenant design (`does_not_rely_on_uuid_secrecy`) or blocked on the absence of a second identity:

| Requirement | Status | Blocker |
|-------------|--------|---------|
| `does_not_rely_on_uuid_secrecy` | Built | None — verified in source. |
| `enforces_tenant_isolation_and_object_level_authorization` | Blocked | No second tenant/identity exists. Building isolation before a second user produces code that has never separated anything. Requires Phase 84+ to introduce multi-identity. |
| `adds_rate_limits_quotas_and_abuse_controls` | Blocked | Runaway controls exist (RATE_CAP, Phase 67 budgets) but abuse controls presuppose an untrusted user. None exists. |
| `isolates_jobs_connectors_memories_and_encryption_context` | Blocked | Nothing is shared with anyone. Capability tiers provide the shape for future per-user profiles but no isolation to enforce. |

**No proposed implementation contract.** A truthful next slice would require a second identity to exist, which is outside this phase's scope and authority. The prerequisite reconnaissance needed is: introduction of a second tenant/identity in a later phase (Phase 84 or beyond), after which isolation seams can be bounded and contracted.

## Test scenarios

| Scenario | Type | Injectable seam | Expected outcome |
|----------|------|-----------------|------------------|
| Approval ticket with guessed 4-char ID but wrong nonce/hash | Failure | `plugin/orion-control/src/approvals.ts::grant()` — supply valid `id` but mismatched `nonce` or `canonicalHash` | Grant refused; ticket not created. Guessing the ID alone grants nothing. |
| Approval from local process (`sender === "local"`) | Failure | `scripts/orion-remote::resolveApproval()` — inject `sender: "local"` | Refused with "an approval has to come from a person". Local self-approval blocked. |
| Rate cap exceeded (41st message in 10 min window) | Failure | `scripts/orion-remote::handle()` — send 41 messages from same sender | 41st message rejected with "too many commands in the last ten minutes". Runaway control verified. |
| Capability tier check for unenabled tier | Failure | `plugin/orion-control/src/controller.ts` — action requires tier not in `enabledTiers` | Action refused; tier mismatch error returned. Closed enum prevents unknown tiers. |
| Valid approval with all fields matching (id, nonce, hash, device, expiry, grantedBy) | Positive | `plugin/orion-control/src/approvals.ts::grant()` — supply complete valid ticket | Ticket created and grant succeeds. Full chain verified. |

## Gates and handoff

- **Entry gate**: Phase 82 (per `entryRequiresPhase`). `entrySatisfied` is false, recorded as deviation per AGENTS.md.
- **Remaining hands-on proof**: Native Swift checks not registered in local worker; installed device proof unavailable. The verifiable requirement (`does_not_rely_on_uuid_secrecy`) is source-grounded and can be reviewed by symbol inspection. Blocked requirements require multi-identity introduction before any testable seam exists.
- **Rollback**: Report-only; no source changes were made.
- **Reviewer handoff**: Verify cited symbols (`ApprovalTicket` in `approvals.ts`, `CapabilityTier` in `catalog.ts`, `RATE_CAP` and `resolveApproval` in `orion-remote`) exist at worktree baseline 9855d99. Confirm proposed scopes (none) do not expand authority. Confirm blocker evidence is truthful: single tenant, no second identity.
