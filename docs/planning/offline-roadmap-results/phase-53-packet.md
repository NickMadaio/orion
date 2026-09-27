# Phase 53: Automation Sessions for Complex Computer Work

## Baseline
Inspected source paths (worktree at commit 9855d99):
- `docs/planning/v2/MANIFEST_PHASES.json` — phase 53 record, status `not_started`, entryRequiresPhase 52, entrySatisfied false.
- `orion/security/delegation.py` — `Delegation` dataclass: capabilities tuple, max_risk, profile, expires_at, covers/expired_at/permits_risk/effective_profile methods. This is the narrowing delegation primitive Phase 50 builds on.
- `plugin/orion-control/src/strictness.ts` — `StrictnessState` (mode, version, setAt, setBy, reason, expiresAt, except, deviceId, resources), `floorForAction`, `resolveStrictness`, `writeStrictness`. Four strictness modes; floor prevents relaxation of authority_change, third_party_reach, irreversible actions.
- `native/OrionMobile/Sources/MobileCore/SecurityCenter.swift` — `Delegation` struct (id, what, grantedAt, expiresAt, revoked), `isActive(at:)`, `SecurityAction.revokeDelegation`. Decodes `CURRENT_AUTHORITY.json` via `AuthoritySnapshot`.

Inspected limits: no `AutomationSession` symbol exists anywhere in the tree. No screen capture, input synthesis, or application-driving capability beyond `open -a` and `osascript` against named apps. Phase 53's computer-use surface does not exist yet.

## Requirement matrix
| Requirement ID | Status | Evidence / Source Symbol | Notes |
|---|---|---|---|
| creates_bounded_computer_use_sessions | Not yet proven | No symbol found. `SEARCH "AutomationSession"` returned zero matches. The manifest evidence states: "No computer-use surface exists to bound." | Blocked on absence of computer-use capability (screen capture, input synthesis, app driving). A session type would be a container for nothing. Depends on Phase 52 exit and a computer-use surface being built first. |
| every_session_defines_goal_device_apps_directories_domains_capabilities_and_ceilings | Not yet proven | Six of twelve fields have working implementations elsewhere: `orion/security/delegation.py::Delegation` (capabilities, max_risk/profile as ceiling), `plugin/orion-control/src/strictness.ts::StrictnessState` (deviceId via `deviceId`, directories via `resources`, expiry via `expiresAt`). These should be reused, not rebuilt. | Blocked on same missing surface. The delegation vocabulary exists but is not yet stored or enforced as a live session container. |
| requires_additional_approval_to_expand_scope | Not yet proven | Approval mechanism exists and is tested: `plugin/orion-control/src/strictness.ts::floorForAction` floors authority_change at APPROVAL in every mode. `native/OrionMobile/Sources/MobileCore/SecurityCenter.swift::SecurityAction.revokeDelegation` allows revocation. But there is no scope to expand because the computer-use surface does not exist. | Blocked on same missing surface. The gate exists; the thing to gate does not. |

## Architecture and interfaces
- **Producer**: `plugin/orion-control/src/strictness.ts` — `StrictnessState` serializes mode, deviceId, resources (directory prefixes), except (per-tier exceptions), expiresAt. Written atomically via `writeStrictness`. Read via `resolveStrictness` with guarded fallback on every failure path.
- **Consumer**: Future automation session layer (not yet built). Would read the strictness state and delegation to bound what a session may do, on which device, in which directories, for how long.
- **Seam**: The missing computer-use surface. Phase 52 (Structured Terminal Operations) must exit first; Phase 53 then wraps those operations into time-bounded, scope-narrowed sessions. Without Phase 52's terminal capability or any screen/input capability, there is nothing to wrap.
- **State ownership**: `StrictnessState` lives on disk at a path resolved by the plugin. `orion/security/delegation.py::Delegation` is the Python-side domain model. `SecurityCenter.swift::Delegation` is the mobile display model. No session state is stored yet.
- **Serialized fields** (from `StrictnessState`): mode, version, setAt, setBy, reason, expiresAt, except, deviceId, resources.
- **Errors**: `resolveStrictness` returns `degraded` string on unreadable file, unknown mode, wrong deviceId, or expired delegation — all falling back to `guarded`.

## Smallest next slice
**Evidenced blocker.** Phase 53 cannot produce a bounded implementation contract because its prerequisite surface does not exist:

1. No computer-use capability is built (no screen capture, no input synthesis, no application driving beyond trivial `open -a`/`osascript`).
2. Phase 52 (Structured Terminal Operations) is the declared entry prerequisite and is itself `not_started` per MANIFEST_PHASES.json.
3. The delegation vocabulary (`Delegation`, `StrictnessState`) exists but is not yet wired to any session container.

**Exact reconnaissance needed before a contract can be written:**
- Phase 52 must exit with evidence that structured terminal operations are live and bounded.
- A computer-use surface (screen observation or input synthesis) must exist, even in minimal form, so a session has something to bound.
- Only then can the next slice contract name 1–3 write paths for a session wrapper that reuses `StrictnessState` fields (deviceId, resources, expiresAt, except) as session boundaries.

No proposed contracts are supplied because prerequisites prevent truthful ones. Invent an API now and it will be wrong when the surface arrives.

## Test scenarios
Nearest existing suite: `plugin/orion-control/src/strictness.test.ts` (strictness mode derivation, floor enforcement, resolveStrictness fallback paths).

| Scenario | Type | Injectable seam | Expected outcome |
|---|---|---|---|
| Delegation expires and session falls back to guarded | Positive | Inject `expiresAt` in the past into `StrictnessState`; call `resolveStrictness`. | Returns `expired: true`, mode reverts to `guarded`. Session cannot act under expired delegation. |
| Scope expansion without additional approval is refused | Failure | Attempt to widen `resources` or lower `except` levels via a session that does not carry a new approval signature. | `floorForAction` keeps authority_change at APPROVAL; mode relaxation is refused. State on disk is unchanged. |
| Session target outside delegation resources is blocked | Failure | Inject file action with `path` outside every prefix in `StrictnessState.resources`; call `targetOutsideResources`. | Returns the offending path string; action requires approval before proceeding. |
| Wrong deviceId causes guarded fallback | Failure | Write `StrictnessState.deviceId` to a hostname that does not match `os.hostname()`. | `resolveStrictness` returns `degraded` with message, mode is `guarded`. Session cannot use foreign delegation. |

Note: these scenarios exercise the existing strictness/delegation machinery that Phase 53 would reuse. They are fixture-level tests; installed/device proof requires a live computer-use surface which does not yet exist.

## Gates and handoff
- **Entry gate**: Phase 52 (Structured Terminal Operations) must exit with evidence. Phase 53's `entryRequiresPhase` is 52; `entrySatisfied` is currently false.
- **Remaining hands-on proof**: A live computer-use surface (screen capture or input synthesis) that a session can bound. Without it, Phase 53 has nothing to wrap and cannot close.
- **User decisions**: Nick must decide whether to build the computer-use surface before Phase 53, or defer Phase 53 until after Phase 54–56 (Screen Observation Privacy Layer, Prompt Injection Defense, Remote Session UI) provide it.
- **Native-check registration**: None needed for this report task. Future implementation contracts will need strictness.test.ts extensions reviewed and registered.
- **Rollback**: This report writes only `phase-53-packet.md`. No source changes. Rollback is deletion of this file.
- **Reviewer handoff**: Reviewer should verify that every cited symbol exists at the baseline commit, that the blocker evidence is truthful (no AutomationSession symbol, no computer-use surface), and that no proposed contract was invented to hide the gap.
