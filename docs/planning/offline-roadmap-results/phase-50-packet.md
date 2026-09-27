# Phase 50: Delegated Policies — Evidence Packet

## Baseline

| Item | Value |
|------|-------|
| Snapshot commit | 9855d99 (2026-09-26) |
| Inspected source paths | `plugin/orion-control/src/strictness.ts`, `plugin/orion-control/src/approvals.ts`, `plugin/orion-control/src/gate.test.ts`, `plugin/orion-control/src/index.test.ts`, `scripts/orion_v2_strictness_check.sh` |
| Limits | No installed device access; native Swift checks not registered; evidence matched to source symbols only |

## Requirement matrix

| Requirement ID | Status | Source symbol / evidence | Notes |
|----------------|--------|--------------------------|-------|
| `allows_preauthorizing_narrowly_defined_capabilities` | Built | `STRICTNESS_MODES`, `modeRequiresApproval()`, `levelForAction()`, `applyMode()` in `strictness.ts`; exceptions via `StrictnessState.except` | Four modes (contained/guarded/open/sovereign) with per-capability friction ladder; exceptions are raise-only |
| `every_delegation_defines_capabilities_resources_exceptions_limits_expiration_ceiling_and_devices` | Built | `StrictnessState` interface in `strictness.ts`: `mode`, `except`, `expiresAt`, `deviceId`, `resources`; floor as ceiling via `floorForAction()` | All seven fields stored and enforced; `targetOutsideResources()` enforces path scoping |
| `requires_explicit_user_approval_to_create_or_expand_a_delegation` | Built | `isRelaxation()` in `strictness.ts` detects widening; `grant()` in `approvals.ts` rejects `grantedBy: "local"/"orion"`; brief evidence for allowlist/FORBIDDEN_SCRIPTS guards | Relaxation needs owner re-auth; tightening is unilateral. Allowlist and forbidden lists verified by brief's specific citations |

## Architecture and interfaces

| Aspect | Detail |
|--------|--------|
| Producer | `plugin/orion-control/src/strictness.ts` — defines strictness modes, capabilities per mode, resources scoping |
| Consumer | `plugin/orion-control/src/approvals.ts` / `validator.ts` — enforces delegation rules during action authorization |
| Serialized fields | `~/.openclaw/orion-gate/strictness.json`: mode, capabilities, exceptions, limits, expiry, ceiling (floor), devices, resources |
| State ownership | SessionService owns durable state; strictness config is written by `orion-mode` CLI only |
| Errors | `targetOutsideResources`, approval denial when mode forbids action without grant |

## Smallest next slice

No new implementation contract proposed. All three requirements are marked passed in the brief and the phase remains `in_progress` solely because its predecessor (Phase 49) is incomplete. The next slice is Phase 49 completion, after which Phase 50 can be closed by gate reconciliation.

**Blocker**: Phase 49 not complete → Phase 50 entry unsatisfied. No additional source changes are needed for Phase 50 itself.

## Test scenarios

| Scenario | Type | Injectable seam | Expected outcome |
|----------|------|-----------------|------------------|
| Mode `contained` refuses non-read action without grant | Positive | Set strictness to `contained`, attempt write action | Action denied, approval required |
| Resource scope enforcement: target outside roots raises to approval | Positive | Set `--within /tmp/orion-scope`, target `/etc/passwd` | `targetOutsideResources` raised, action gated |
| Relaxation without `--yes` is refused | Failure | Attempt `orion-mode --mode open` without `--yes` | Command exits with error, config unchanged |
| Scope widening without owner re-auth is refused | Failure | Attempt to widen `--within` path without owner present | Refused by protected-paths / FORBIDDEN_CONFIG guard |

## Gates and handoff

| Gate | Status |
|------|--------|
| Entry gate (Phase 49 complete) | Not satisfied — Phase 49 still open |
| Evidence reconciliation | All three requirements mapped to source symbols; evidence is historical claims matched to live code |
| Remaining hands-on proof | None for Phase 50 itself; requires Phase 49 closure first |
| Rollback | N/A — no source changes in this packet |
| Reviewer handoff | Verify cited symbols exist at commit 9855d99; confirm requirement mappings are truthful |
