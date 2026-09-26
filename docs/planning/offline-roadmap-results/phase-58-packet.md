# Phase 58: Automation Simulation — Evidence Packet

## Baseline

| Item | Value |
|------|-------|
| Snapshot commit | `9855d99` (2026-09-26) |
| Inspected source paths | `plugin/orion-control/src/automation.ts`, `plugin/orion-control/src/catalog.ts`, `scripts/orion-automation` |
| Limits | No installed Mac access; cannot run native checks. Evidence is structural (source inspection), not execution-based. |

## Requirement matrix

| Requirement ID | Status | Source symbol / evidence | Notes |
|----------------|--------|--------------------------|-------|
| `shows_how_often_this_would_trigger_and_what_would_occur` | Built | `simulate()` in `plugin/orion-control/src/automation.ts`; `orion-automation simulate` in `scripts/orion-automation`; `automation_simulate` action in `ACTION_CATALOG` (`catalog.ts`) | Replays trigger against real clock time over a window (default 30 days). Reports `fireCount`, `suppressedCount`, `messageCount` separately. Wrapping quiet-hours windows handled correctly (22→7 = nine hours, not empty). Test exists in automation.test.ts for midnight-crossing window. |
| `says_what_it_cannot_know` | Built | `simulate()` in `plugin/orion-control/src/automation.ts` — first note always states "This is a CEILING, not a forecast". When `skipDuringFocus` is set, adds note: "Firings during a focus session are not modelled — there is no history of past sessions to replay against." | Ceiling semantics enforced by design; notes array carries uncertainty explicitly. |
| `uses_historical_data_where_available` | Blocked | No retained history of past firings or suppressions exists. `simulate()` replays the CALENDAR (trigger arithmetic), not actual execution history. Cannot answer "how often would this have SAID something" because standing orders' content depends on calendar state at fire time. | Blocker: delivery log from `orion-cron-deliver` is not retained or queryable. Needs that log to exist before this can move past "blocked". |
| `requires_confirmation_after_simulation_for_higher_risk_automation` | Built | Every automation requires confirmation — `scripts/orion-automation install` is the only path to scheduling, and it is a separate program Orion cannot run (absent from exec allowlist). `install` re-runs `validateProposal` before scheduling. Simulation output prints immediately above the decision point in the CLI flow. | Confirmation is universal, not just for higher-risk automations. The proposal sits on disk with an expiry that may have passed by install time. |

## Architecture and interfaces

**Producer**: `simulate(proposal, options)` in `plugin/orion-control/src/automation.ts`. Takes an `AutomationProposal` and optional `{ windowDays?, from? }`. Returns a `Simulation` object with `fireCount`, `suppressedCount`, `messageCount`, `windowDays`, `cappedByRiskLimit`, and `notes: string[]`.

**Consumer**: `scripts/orion-automation` loads the plugin via `loadPlugin()`, destructures `{ describeTrigger, simulate }` from `plugin.automation`, and calls `simulate(proposal)` in its `simulate` command handler. Prints results to stdout with notes.

**Catalog seam**: `automation_simulate` action in `ACTION_CATALOG` (`catalog.ts`) has execution policy `{ kind: "automation", operation: "simulate" }`. The plugin routes this to the simulate function. No install action exists in the catalog — installing is `scripts/orion-automation install`, which is off the exec allowlist.

**Serialized fields**: `AutomationProposal` JSON stored in `~/.openclaw/orion-controlled/automations/proposed/<name>.json`. Simulation result is not persisted; it is computed on demand and printed to stdout.

**State ownership**: Proposals are written by Orion (via `automation_propose`) but installed only by Nick (via `scripts/orion-automation install`). The `installedAt` field is set at install time, not proposal time.

**Errors**: `validateProposal()` returns all issues at once. `simulate()` does not throw; it computes arithmetic and adds notes for uncertainty.

## Smallest next slice

Three of four requirements are Built. The fourth (`uses_historical_data_where_available`) is Blocked on infrastructure that does not exist: a retained, queryable delivery log from `orion-cron-deliver`. No bounded implementation contract can be written for it without that prerequisite.

**Blocker**: `uses_historical_data_where_available` cannot move past "blocked" until there is a record of past automation firings and suppressions to replay against. The current simulation replays the TRIGGER (calendar arithmetic), not actual execution history. Whether `orion-standing check` would have SAID anything depends on calendar content at fire time, which is not recorded.

**Reconnaissance needed**:
1. Confirm whether `orion-cron-deliver` or any other component retains a delivery log. SEARCH for `orion-cron-deliver` and any logging of automation execution results.
2. If no such log exists, determine whether creating one is in scope for a future phase or requires a provider decision.

**No proposed contracts**: All implementable work for Phase 58 is already done. The remaining requirement is blocked on missing infrastructure, not on missing code in this phase's scope.

## Test scenarios

**Existing suite**: `plugin/orion-control/src/automation.test.ts` (cited in the source header comment regarding midnight-crossing quiet-hours window).

**Positive cases**:
1. Daily trigger over 30-day window: `simulate()` returns `fireCount === 30`, `suppressedCount` matches quiet-hours overlap, `messageCount` respects `maxMessagesPerDay`.
2. Hourly trigger with quiet hours [22, 7]: fires 24×30 = 720 times; suppressed count covers hours 22-6 each day (9 hours × 30 days = 270).
3. Weekly trigger on Monday: fires 4 or 5 times depending on window alignment.

**Failure/uncertainty cases**:
1. `skipDuringFocus` set: simulation adds note about unmodelled focus sessions; does not crash or guess.
2. `maxMessagesPerDay` ceiling hit: `cappedByRiskLimit` is true, note added about ceiling doing real work.
3. Empty proposal fields: `validateProposal()` returns all issues at once (not first-only).

**Injectable seam for reviewer**: Replace `simulate` with a stub that returns `{ fireCount: 0, suppressedCount: 0, messageCount: 0, windowDays: 30, cappedByRiskLimit: false, notes: ["stub"] }` and verify the CLI prints zero firings with the stub note. Expected durable state: no file changes (simulation is read-only computation). Consumer-visible outcome: stdout shows zero counts and the stub note.

## Gates and handoff

**Entry gate**: Phase 57 exit evidence required. Per PHASE_GATES.json, entrySatisfied is false (recorded deviation: Phase 50 open on `resources`, Phase 49 open on iPhone half — neither blocks this phase's code). Proceeding with investigation despite entrySatisfied=false per AGENTS.md deviation recording.

**Remaining hands-on proof**:
1. Reviewer confirms cited symbols (`simulate`, `automation_simulate`, `orion-automation simulate`) exist at worktree baseline commit 9855d99.
2. Reviewer confirms no proposed scope expands authority — this packet proposes zero implementation contracts because all implementable work is done.
3. Reviewer confirms the blocker for `uses_historical_data_where_available` is genuine: no delivery log exists to replay against.

**Rollback**: This packet is documentation only; no source changes were made. Delete or revert `docs/planning/offline-roadmap-results/phase-58-packet.md`.

**Reviewer handoff**: Four requirements mapped. Three Built with source citations. One Blocked with specific reconnaissance needed. No proposed contracts because there is nothing left to implement in this phase's scope — the missing piece requires infrastructure from a different phase or provider decision.
