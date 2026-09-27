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

| Scenario | Existing Suite / Command | Injectable Failure | Expected Durable State | Consumer-Visible Outcome |
|---|---|---|---|---|
| **Positive: Focus session starts and persists** | `scripts/orion-focus` (Node.js). Run `node scripts/orion-focus start "test task" 10 Zed` then `cat ~/.openclaw/orion-controlled/focus.json`. The file must contain a valid JSON object with `session.task`, `session.until`, and `session.strikes === 0`. | N/A (positive path) | `focus.json` contains a complete session object with `startedAt`, `until`, `allowedApps`, `strikes: 0`, and `grants: []`. | Console output shows "locked on: test task for 10 min" and "allowed: Zed, Orion, Finder...". The file on disk is valid JSON. |
| **Failure: Stale or corrupt focus.json** | `scripts/orion-focus` handles this in `readState()`. Inject by writing invalid JSON (e.g., `{bad`) to `~/.openclaw/orion-controlled/focus.json`, then run `node scripts/orion-focus status`. | Write malformed JSON to `focus.json` before invoking any command. | `readState()` catches the parse error and returns `{}`. No crash; no partial state. Subsequent commands behave as if no session exists. | `status` prints "no active focus session". The script does not exit with an unhandled exception. |
| **Failure: Ledger append failure** | `plugin/orion-control/src/ledger.ts`. The `appendReporting` method is designed to fail gracefully. Inject by making the ledger directory read-only or the file unwritable. | Set permissions on the ledger file/directory to deny write access, then call `ledger.appendReporting(...)`. | The record is NOT appended to the file. The method returns `{ appended: false, error: "Ledger append failed: ..." }`. | The caller receives the error object and can surface it; the primary task result is not destroyed by the audit failure. |
| **Injectable seam** | `~/.openclaw/orion-controlled/focus.json` (data path). Read/written by `scripts/orion-focus` via `readState()`/`writeState()`. Can be manually edited, truncated, or permission-changed to test resilience. Also: `plugin/orion-control/src/ledger.ts` — the ledger file path can be made unwritable to test `appendReporting` graceful failure. | — | — | — |

## Gates and handoff
- **Entry gate**: Phase 65 (entryRequiresPhase: 65). Entry satisfied is false per brief; phases behind this one are open on surfaces that do not exist.
- **Remaining hands-on proof**: None. The requirement `does_not_expose_sensitive_details_on_the_lock_screen_by_default` passes by absence. The other requirement is blocked by infrastructure.
- **Rollback**: N/A — no source changes made.
- **Reviewer handoff**: Verify that the blocker (no iOS app) is sufficient to prevent a next-slice contract. Confirm that "passed by prohibition" is acceptable for the privacy requirement.
