# Phase 57: Automation Framework — Evidence and Next Slice

## Baseline
Inspected source paths:
- `plugin/orion-control/src/automation.ts` — defines `AutomationProposal`, `validateProposal`, `AUTOMATION_ACTIONS`, `simulate`.
- `scripts/orion-automation` — CLI for list/show/simulate/schedule-plan/remove; install is gated.
- `plugin/orion-control/src/gate.test.ts` — test suite covering automation tier boundaries (cited in brief).
- `scripts/orion_v2_strictness_check.sh` — live-machine strictness checks (cited in brief).

Limits: No installed device access; native Swift checks not registered. Existing implementation projects own Phase 57/58 execution.

## Requirement Matrix

| ID | Status | Evidence / Source Symbol | Notes |
|----|--------|--------------------------|-------|
| defines_automation_as_structured_rules | Built | `plugin/orion-control/src/automation.ts`: `AutomationProposal` interface carries all 7 fields (trigger, conditions, action, permissions, expiration, riskLimits, failureBehavior). `validateProposal` returns every problem at once. Trigger is a closed set (`daily`/`hourly`/`weekly`), never raw cron. | Source confirms brief claim. |
| model_may_propose_automation | Built | `plugin/orion-control/src/automation.ts`: `AUTOMATION_ROOT` points to `~/.openclaw/orion-controlled/automations`. Brief states `automation_propose` writes into `automations/proposed`, which nothing schedules from. `scripts/orion-automation` reads from `PROPOSED` dir for list/show/simulate. | Proposal half exists; scheduling is separate. |
| model_may_not_silently_install_permanent_automation | Built | `plugin/orion-control/src/automation.ts`: no install export. `scripts/orion-automation`: `install` command fails with "unavailable until guarded scheduler registration is connected". Script is in `FORBIDDEN_SCRIPTS` and absent from exec allowlist per brief. | Structural enforcement confirmed. |
| actions_are_drawn_from_a_closed_table | Built | `plugin/orion-control/src/automation.ts`: `AUTOMATION_ACTIONS` is a `Readonly<Record<string, ...>>` with 5 entries. `validateProposal` uses `Object.hasOwn(AUTOMATION_ACTIONS, p.action)` (fixed per postReviewCorrections). | Closed table enforced at validation. |
| an_automation_ends_on_its_own | Blocked | `plugin/orion-control/src/automation.ts`: `expiresOn` is validated (required, future, within 180 days) but not enforced by the scheduler. `scripts/orion-automation`: `install` is unavailable; no runtime expiry enforcement exists in current source. | Brief records blocker: "expiresOn is validated but not enforced by the scheduled command." |

## Architecture and Interfaces

**Producer**: `plugin/orion-control/src/automation.ts` — exports `AutomationProposal` type, `validateProposal`, `simulate`, `AUTOMATION_ACTIONS`. The model proposes via `automation_propose` action (not in this file but referenced in brief), which writes JSON to `~/.openclaw/orion-controlled/automations/proposed/`.

**Consumer**: `scripts/orion-automation` — Node CLI that reads proposed/installed JSON files, runs simulation, and manages scheduler registration (via `orion-automation-schedule.mjs` and `orion-automation-removal.mjs`). Nick is the human consumer who reviews proposals.

**Serialized fields**: `AutomationProposal` interface: `name`, `intent`, `trigger` (closed shape), `conditions` (quietHours, skipDuringFocus), `action` (key of AUTOMATION_ACTIONS), `permissions.expectsMode`, `expiresOn` (ISO date), `riskLimits` (maxRunsPerDay, maxMessagesPerDay), `failureBehavior`, `proposedAt`, `installedAt` (set by installer).

**State ownership**: `~/.openclaw/orion-controlled/automations/proposed/` (model-writable, scheduler-ignored) and `~/.openclaw/orion-controlled/automations/installed/` (installer-only, drives scheduler). Orion plugin cannot write to installed.

**Errors**: `validateProposal` returns string array of all issues. `scripts/orion-automation` uses `fail()` with exit codes. Scheduler removal failures retain local installation record rather than deleting it.

## Smallest Next Slice

**Blocker**: Runtime expiry enforcement is missing. `expiresOn` is validated but the scheduler does not enforce it. The `install` command in `scripts/orion-automation` is unavailable pending "guarded scheduler registration". Existing implementation projects (advance-orion-capabilities, Automation history) own Phase 57/58 execution; this report must not duplicate their work.

**Proposed contract 1**: Guarded scheduler registration with expiry enforcement
- **Scope**: `scripts/lib/orion-automation-schedule.mjs` (or equivalent new file), `scripts/orion-automation` install command re-enablement.
- **Acceptance criteria**:
  1. Scheduler registration accepts only proposals from the closed `AUTOMATION_ACTIONS` table.
  2. Registered automation stops firing after `expiresOn` date without manual removal.
  3. Installation requires explicit human approval (Face ID or equivalent device authorization).
  4. Cron expression is derived from trigger shape, never accepted as input.
  5. Failed registration leaves no partial state.
  6. Existing installed automations are not affected by new registration logic.
  7. Error on duplicate name.
  8. Evidence of expiry enforcement in test or simulation.
- **Dependencies**: Guarded scheduler implementation (owned by existing projects).
- **Escalation**: If guarded scheduler is not available, remain blocked with evidence.

**Proposed contract 2**: Expiry proof and runtime runner bounds
- **Scope**: Test file for expiry enforcement, `scripts/orion-automation` integration test.
- **Acceptance criteria**:
  1. Positive: automation fires before expiry, stops after expiry.
  2. Failure: proposal with past expiry is rejected at validation.
  3. Failure: proposal with >180 day expiry is rejected at validation.
  4. Runtime runner respects `riskLimits.maxRunsPerDay`.
  5. Runtime runner respects `failureBehavior` setting.
  6. Scheduler error does not delete local installation record.
  7. Removal returns proposal to proposed state.
  8. No automation can run arbitrary commands.
- **Dependencies**: Contract 1 or equivalent scheduler implementation.
- **Escalation**: If runtime runner is not accessible for testing, specify exact reconnaissance needed.

## Test Scenarios

**Nearest existing suite**: `plugin/orion-control/src/gate.test.ts` (vitest), `scripts/orion_v2_strictness_check.sh` (live-machine checks). These are not re-run here; evidence is matched to source.

**Positive cases**:
1. `validateProposal` accepts a complete proposal with all 7 fields → returns empty array.
2. `simulate` returns fire count matching trigger shape over window days.
3. `automation_list` shows proposed and installed automations separately.
4. `automation_remove` moves installed automation back to proposed, deletes installed record.

**Failure cases**:
1. `validateProposal` rejects proposal with raw cron string in trigger → issue about trigger.kind.
2. `validateProposal` rejects proposal with action not in `AUTOMATION_ACTIONS` → issue naming valid actions.
3. `validateProposal` rejects proposal with past `expiresOn` → issue about future date.
4. `validateProposal` rejects proposal with >180 day `expiresOn` → issue about 180-day limit.
5. `automation_install` fails with "unavailable" message → exit code 1, nothing scheduled.
6. `automation_remove` on non-installed name → failure with clear message.
7. Scheduler removal failure retains local installation record (per source comment).

**Injectable seam for next slice**: Mock scheduler registration in `scripts/lib/orion-automation-schedule.mjs` to verify expiry enforcement without live cron. Expected durable state: installed JSON removed or marked expired after expiry date passes. Consumer-visible outcome: automation no longer appears in running list.

## Gates and Handoff

**Entry gate**: Phase 56 (`entryRequiresPhase: 56`, `entrySatisfied: false` per brief). Phase 50 is open on `resources` field and Phase 49 on iPhone half; neither blocks this phase's code dependencies. Recorded as deviation per AGENTS.md.

**Remaining hands-on proof**:
1. Guarded scheduler registration implementation (owned by existing projects, not this report).
2. Runtime expiry enforcement test — automation stops after `expiresOn`.
3. Live-machine strictness check that `scripts/orion-automation` remains in `FORBIDDEN_SCRIPTS` and absent from exec allowlist.
4. Proof that no action in `ACTION_CATALOG` can write a LaunchAgent or crontab.

**Rollback**: Remove installed automation JSON files; scheduler registration is idempotent per brief. Proposal files in `proposed/` are preserved on removal. No source changes in this phase affect existing automations.

**Reviewer handoff**: This report maps requirements to source, identifies the blocker (runtime expiry enforcement), and proposes bounded contracts for the next slice. Reviewer should verify cited symbols exist at worktree baseline and that proposed scopes do not expand authority beyond what the brief permits.
