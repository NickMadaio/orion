# Phase 59 Packet: Proactive ORION

## Baseline
Inspected source paths and limits for this phase.
- `scripts/orion-standing`: Node.js proactive system entry point. Implements "say only what changed" rule, quiet hours (`QUIET_FROM`/`QUIET_UNTIL`), and source status reporting (ok/empty/unavailable/degraded).
- `plugin/orion-control/dist/automation.js`: Automation proposal and simulation layer. Defines `AUTOMATION_ACTIONS` including `standing_check`, `standing_morning`, `standing_evening`. Contains `simulate()` for Phase 58 replay arithmetic.
- `native/Orion/Sources/SessionDomain/TravelMode.swift`: Domain model for timezone-aware readings. Used by proactive system to determine "home" vs "device" context via `TimeZonePolicy`.
- Limits: No write path from `orion-standing` to Swift Today surface exists. Scoring logic (urgency/actionability/importance) is deliberately absent per brief.

## Requirement matrix
| ID | Status | Evidence / Source Symbol | Notes |
|---|---|---|---|
| implemented_only_after_other_systems_are_stable | Built | `scripts/orion-standing` header comments list 3 paid-for failure modes (blind spots, stale numbers, UTC dates). Dependencies on memory/agenda/delivery are structural. | Ordering satisfied by history; source confirms defensive coding for prior phase defects. |
| scores_items_by_urgency_actionability_novelty_confidence_importance_and_interruptibility | Blocked | No scoring function in `scripts/orion-standing`. Uses deterministic thresholds (`IMMINENT_MINUTES`, `POOR_RECOVERY`). Brief states 3/6 factors (urgency, actionability, importance) have no input. | Deliberately not faked. Novelty/confidence/interruptibility enforced structurally via "changed-only" rule, stale-data rejection, and quiet hours. |
| does_not_interrupt_for_low_value_observations | Built | `scripts/orion-standing`: `main()` returns early if `speaking.length === 0`. Quiet hours filter non-urgent findings. `--explain` sends diagnostics to stderr only. | Silence is default. Every line must answer "what changed, why it matters, what to do". |
| places_low_priority_suggestions_in_today | Blocked | No API in `native/Orion/Sources/SessionService` or bridge for accepting proactive text items. `orion-standing` outputs to stdout only. | Missing seam: write path from standing orders to day model. Not a scoring problem; an integration problem. |

## Architecture and interfaces
Producer, consumer, serialized fields, state ownership, and errors for the proposed seam.
- **Producer**: `scripts/orion-standing`. Generates text findings via `morningFindings()`, `eveningFindings()`, `imminentFindings()`. Output is plain text to stdout.
- **Consumer**: Currently none for "Today" placement. `plugin/orion-control/dist/automation.js` executes standing orders as cron-like actions but does not parse output into domain state.
- **Proposed Seam**: A bridge or SessionService API that accepts structured proactive items and places them in the Today view with low priority.
- **State Ownership**: `SessionService` owns durable local state. `orion-standing` is an ephemeral runner with no persistent state writes.
- **Errors**: Source unavailability reported as "blind spots" (status: unavailable/degraded) rather than flattened to silence. Stale health data rejected if `ageHours > HEALTH_MAX_AGE_HOURS`.

## Smallest next slice
Proposed contracts or evidenced blockers for the next implementation step.
- **Blocker**: No write path exists from `orion-standing` to Today surface. `orion-standing` outputs text; Swift app expects domain objects.
- **Reconnaissance needed**: Identify if a generic "suggestion" model exists in SessionDomain, or if one must be created. Verify if Node-to-Swift bridge supports arbitrary JSON payloads.
- **Proposed Contract 1**: Define `ProactiveItem` struct in SessionDomain with fields: `source`, `severity`, `text`, `expiresAt`. Add `SessionService.addProactiveItem()` method.
- **Proposed Contract 2**: Modify `scripts/orion-standing` to emit JSON sidecar for low-priority items when `--notify` is used, or create a new `orion-today-ingest` script that parses standing output and calls bridge.
- **Dependencies**: Phase 58 (Automation Simulation) complete; `automation.js` provides execution framework but not data ingestion.

## Test scenarios
Positive and failure cases with injectable seams and expected outcomes.
- **Positive**: Run `scripts/orion-standing morning --explain`. Verify stdout contains findings only if changes detected. Stderr shows source statuses.
- **Failure (Blind Spot)**: Set `ORION_STANDING_AGENDA` to non-existent path. Verify output reports "Calendar: no access" rather than "nothing scheduled".
- **Failure (Stale Data)**: Create `health-log.json` with yesterday's date. Verify health finding is suppressed (status: stale) rather than printed.
- **Inject**: Mock `readHealth()` to return `unavailable`. Verify blind spot reported in morning/evening checks but not in hourly `check` mode (per code logic).

## Gates and handoff
Entry gate and remaining hands-on proof.
- **Entry Gate**: Phase 58 satisfied. Evidence: `plugin/orion-control/dist/automation.js` contains `simulate()` function for automation replay, fulfilling Phase 58 "Automation Simulation" requirement.
- **Hands-on Proof**: Run `node scripts/orion-standing check --now 2026-09-26T10:00` to verify proactive system executes without error against current source state.
- **Rollback**: No source changes in this phase; report only. If future implementation fails, revert bridge additions.
- **Reviewer Handoff**: Verify cited symbols (`morningFindings`, `simulate`, `TravelMode`) exist at worktree baseline. Confirm proposed scope does not expand authority (no new permissions/secrets).
