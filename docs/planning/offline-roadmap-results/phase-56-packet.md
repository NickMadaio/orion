# Phase 56 Packet: Remote Session UI

## Baseline
- Inspected source paths:
  - `scripts/orion-remote` — verb handlers, brain integration, approval resolution, audit
  - `native/OrionMobile/Sources/MobileCore/RemoteLink.swift` — presence/link domain types (no renderer)
  - `docs/planning/v2/MANIFEST_PHASES.json` — phase 56 definition and track membership
- Limits: No iOS app or mobile renderer exists. MobileCore carries domain types from Phases 41–45 but no UI layer. All remote interaction today runs over Discord via the file bridge (`inbox.jsonl`/`outbox.jsonl`) inside `scripts/orion-remote`.

## Requirement matrix
| ID | Status | Evidence / Source Symbol | Notes |
|----|--------|--------------------------|-------|
| shows_task_device_step_elapsed_risk_and_capabilities_on_mobile | Not yet proven | No renderer exists. MobileCore/RemoteLink.swift defines `MacAvailability`, `MacPresence`, `HeartbeatPolicy` but no view or controller. The manifest defers the phone half to Phase 49's wall. | Blocked: no iOS app, no mobile UI surface. Next gate: Phase 49 (approval system) and a mobile renderer contract. |
| allows_pause_cancel_inspect_and_approve_next_step | Built | `scripts/orion-remote`: `doPause` (L678), `doCancel` (L702), `doStatus` (L659), `resolveApproval` (L720) — all wired into `HANDLERS` (L784–L789). Verbs reach Nick over Discord via the file bridge; `approve` resolves gate approvals through `plugin/orion-control/dist/approvals.js`. | Capability exists remotely today. The display surface is the requirement above. |
| uses_live_activities_where_appropriate | Not yet proven | SEARCH for `LiveActivity` returned zero matches across the repository. The manifest explicitly defers this ("later where appropriate"). | Blocked: deferred by manifest, requires iOS app and Live Activities framework access. |

## Architecture and interfaces
- **Producer**: `scripts/orion-remote` — handles inbound verbs (`pause`, `cancel`, `status`, `approve`, `deny`, `priority`, `device`, `apps`, `files`) and brain-fallback conversation. Writes replies to `outbox.jsonl` and audit to `remote-audit.jsonl`.
- **Consumer**: Discord bridge (`orion-remote-bridge`) drains `inbox.jsonl`, calls `handle()`, and delivers replies via `openclaw message send`. No mobile consumer exists yet.
- **Proposed seam for next slice**: A status-report endpoint that emits a structured JSON summary of mission state (id, status, priority, elapsed, runner-live flag) to a file or stdout, consumable by a future mobile renderer without touching the verb grammar.
- **Serialized fields** (from `remote.json` state shape): `missions[id].status`, `missions[id].priority`, `missions[id].pausedAt`, `pending[approvalId].status`, `pending[approvalId].request`, `pending[approvalId].missionId`. Runner lock carries `pid`.
- **State ownership**: `scripts/orion-remote` owns `~/.openclaw/orion-controlled/remote.json` via `withStateLock`. The plugin's `approvals.js` owns gate tickets under `~/.openclaw/orion-gate/approvals/`.
- **Errors**: Sender allowlist rejection, LOCK ORION rejection, envelope expiry (>10 min), replay detection, rate limiting (40/10min), argument shape validation, runner signal failures. All recorded in audit.

## Smallest next slice
**Blocker**: No mobile renderer exists. The requirement `shows_task_device_step_elapsed_risk_and_capabilities_on_mobile` cannot be implemented without an iOS view layer. Phase 49 (Remote Approval System) is also open and owns the human-in-the-loop gate that a mobile UI would display approvals against.

**Proposed reconnaissance contract** (not executable — requires review):
```json
{
  "title": "Phase 56 next slice: mission status JSON report",
  "objective": "Add a `scripts/orion-remote report <missionId>` subcommand that emits a single JSON object with id, status, priority, elapsedMs, runnerLive, and pendingApprovals to stdout. No UI change; pure data export for future mobile consumption.",
  "scope": ["scripts/orion-remote"],
  "acceptanceCriteria": [
    "report <id> outputs valid JSON with fields: id, status, priority, elapsedMs, runnerLive (bool), pendingApprovals (array of {id, request})",
    "report on unknown mission exits non-zero with message",
    "report does not modify remote.json or audit",
    "existing verb handlers unchanged"
  ],
  "dependencies": ["scripts/orion-remote check suite"],
  "escalationConditions": ["if report requires reading runner mission.json from disk and that path is outside scope"]
}
```

## Test scenarios
- **Positive**: `orion-remote handle "status m-abc123" --from nick` → returns mission status line including priority and runner-live flag. Existing check: `scripts/orion_v2_remote_check.sh`.
- **Positive**: `orion-remote handle "approve A-7F3K" --from nick` → resolves gate approval via plugin's `approvals.js`, returns confirmation.
- **Failure**: `orion-remote handle "cancel m-unknown" --from nick` → returns "no mission called m-unknown" (argument shape validation in `SHAPES.mission`).
- **Failure**: Approval from `--from local` → refused with "an approval has to come from a person" (`resolveApproval`, L738).
- **Injectable seam**: Set `ORION_REMOTE_MISSION_BIN` to a no-op binary; `doResume` and `doCancel` still write state but runner signal returns null, observable in reply text ("no runner was live").
- **Fixture vs device proof**: All verb tests run locally via CLI handle/poll. No installed-device proof available; mobile renderer evidence requires an iOS build environment.

## Gates and handoff
- **Entry gate**: Phase 55 (Prompt Injection Defense) — entrySatisfied is true per manifest. Phase 56 opened 2026-09-03 with entrySatisfied false recorded as deviation (Phase 50 open on resources, Phase 49 on iPhone half).
- **Remaining hands-on proof**: A mobile renderer must exist before `shows_task_device_step_elapsed_risk_and_capabilities_on_mobile` can be proven. That belongs to a later phase or a separate mobile UI contract. The capability requirement (`allows_pause_cancel_inspect_and_approve_next_step`) is built and reachable over Discord today.
- **Rollback**: This packet writes only documentation. No source changes. If the proposed next-slice contract is accepted and implemented, rollback is reverting `scripts/orion-remote` to HEAD before that change.
- **Reviewer handoff**: Verify cited line numbers in `scripts/orion-remote` match worktree baseline. Confirm no authority expansion in the proposed report subcommand (read-only JSON emission, no state write).
