# Phase 66: Live Activities — Evidence Packet

## Baseline
- **Inspected source paths**: `scripts/orion-focus`, `plugin/orion-control/src/ledger.ts`, `docs/planning/v2/MANIFEST_PHASES.json`.
- **Limits**: No iOS application target exists in the repository. SEARCH for `ActivityKit` and `LiveActivity` returned zero matches in `native/` or `OrionMobile/`. Focus state is durable in `~/.openclaw/orion-controlled/focus.json`; task history is in the ledger (`plugin/orion-control/src/ledger.ts`).

## Requirement matrix
| Requirement ID | Status | Evidence / Source Symbol | Notes |
|---|---|---|---|
| `uses_live_activities_for_focus_sessions_and_remote_jobs` | Not yet proven | No iOS app exists. `scripts/orion-focus` manages focus state (`focus.json`) but has no iOS projection. `ActivityKit` is absent from the codebase. | Blocked by missing iOS host. The data model (task, deadline, strikes) already exists and is durable. This is a rendering problem, not a modeling one. |
| `does_not_expose_sensitive_details_on_the_lock_screen_by_default` | Passed | Nothing reaches the Lock Screen because no iOS app or Live Activity exists. The prohibition holds vacuously. | Recorded as passed per brief guidance: a prohibition on sensitive data exposure is satisfied if no data is exposed at all. |

## Architecture and interfaces
- **Producer**: `scripts/orion-focus` (Node.js) writes to `focus.json`. It emits task name, deadline (`until`), allowed apps, strike count, and grant status.
- **Consumer**: None currently. A future iOS Live Activity would read this state or receive push updates containing the serialized fields.
- **Serialized fields**: `task` (string), `startedAt` (number), `until` (number), `allowedApps` (string[]), `anchor` (string?), `strikes` (number), `grants` (array).
- **State ownership**: `SessionService` / `orion-focus` owns the durable state. The iOS client would be a read-only observer or receive push payloads for transient display.
- **Errors**: N/A in current source. Future seam must handle stale state, missing fields, and push delivery failures without crashing the focus session.

## Smallest next slice
- **Proposed contract**: None.
- **Blocker**: No iOS application target exists to host Live Activities. Creating one requires Xcode project changes, bundle identity setup, and entitlements (Push Notifications, Background Modes), which are outside this phase's scope and require Nick at the keyboard.
- **Reconnaissance needed**: None further. The absence of an iOS app is confirmed by SEARCH and manifest review.

## Test scenarios
- **Positive case**: N/A — no implementation to test.
- **Failure case**: N/A — no implementation to test.
- **Injectable seam**: N/A.
- **Expected outcome**: N/A.

## Gates and handoff
- **Entry gate**: Phase 65 (entryRequiresPhase: 65). Entry satisfied is false per brief; phases behind this one are open on surfaces that do not exist.
- **Remaining hands-on proof**: None. The requirement `does_not_expose_sensitive_details_on_the_lock_screen_by_default` passes by absence. The other requirement is blocked by infrastructure.
- **Rollback**: N/A — no source changes made.
- **Reviewer handoff**: Verify that the blocker (no iOS app) is sufficient to prevent a next-slice contract. Confirm that "passed by prohibition" is acceptable for the privacy requirement.
