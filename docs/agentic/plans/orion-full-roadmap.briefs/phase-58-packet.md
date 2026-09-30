# Phase 58: Automation Simulation

## Where you start
Snapshot at commit 9855d99 on 2026-09-26; recheck the worktree source. Existing implementation projects own this phase. Inspect source and identify integration/proof gates; do not propose a duplicate implementation.
READ docs/planning/v2/MANIFEST_PHASES.json, then locate live symbols with SEARCH.

## Requirement input
{
  "name": "Automation Simulation",
  "status": "in_progress",
  "entryRequiresPhase": "57",
  "entrySatisfied": false,
  "openedOn": "2026-09-03",
  "openedAgainst": "Entered with entrySatisfied false. Phase 50 is open on its `resources` field and Phase 49 on the iPhone half, neither of which is code this phase depends on. Recorded as a deviation per AGENTS.md rather than asserted true.",
  "evidence": "The `simulate` function in automation.ts, `automation_simulate` in the catalog, and `orion-automation simulate`.",
  "requirements": [
    {
      "id": "shows_how_often_this_would_trigger_and_what_would_occur",
      "status": "passed",
      "evidence": "Replays the trigger against real clock time over a window and reports firings, suppressions and messages separately. Arithmetic rather than a dry run, deliberately: dry-running `orion-daily` would roll up the day's memory, which is the thing simulation exists to avoid doing. A quiet window that crosses midnight is read as a window -- 22 to 7 is nine hours, not an empty range -- and that has its own test, because reading it wrong is how a quiet-hours rule silently does nothing."
    },
    {
      "id": "says_what_it_cannot_know",
      "status": "passed",
      "evidence": "Every result carries notes, and the first one says the number is a CEILING rather than a forecast: it counts every moment the trigger fires, and the actions stay silent when they have nothing to say. A simulation that quietly reports zero because it had no data is worse than one that refuses to guess. Not a manifest line; added because reporting a bound as a prediction is the specific way this feature would mislead."
    },
    {
      "id": "uses_historical_data_where_available",
      "status": "blocked",
      "evidence": "It replays the CALENDAR, not history. There is no record of past focus sessions or of how often standing orders actually spoke, so 'how often would this have said something' cannot be answered and is reported as unknown instead of estimated. Closing this needs the delivery log orion-cron-deliver already gates on to be retained and queryable.",
      "reason": "No retained history of past firings or suppressions exists to replay against."
    },
    {
      "id": "requires_confirmation_after_simulation_for_higher_risk_automation",
      "status": "passed",
      "evidence": "Every automation requires confirmation, not just higher-risk ones, and the confirmation is a person running a program Orion cannot. `install` re-runs validateProposal before scheduling -- the proposal has been sitting on disk and an expiry that was in the future when it was written may not be now -- and prints the simulation immediately above the decision."
    }
  ],
  "nextPhaseAllowed": false
}

## Interface and decisions
Produce `docs/planning/offline-roadmap-results/phase-58-packet.md` with the exact report interface from common.md. Treat gate evidence as historical claims until matched to source; absent installed access means not re-proven. Preserve entryRequiresPhase and entrySatisfied semantics.

## Tests and failure injection
Name the nearest existing suite and exact command from source. For the smallest missing seam specify an injectable failure (restart, stale revision, unavailable source, replay or denial as applicable), expected durable state and consumer-visible outcome. Native commands are reviewer-run proposals until registered.

## Exchange plan
Exchange 1: ### FILE the report skeleton at your assigned path: the six section headings, and in Requirement matrix one row per requirement id from this brief (status "to verify"). Exchanges 2 onward: SEARCH/READ two or three files, then ### EDIT the section that finding belongs to, in the same exchange. Never spend more than two exchanges in a row without an EDIT. The doc-report check runs after every write and names what is still missing; when it passes and every row is filled, ### DONE.

## Traps and reviewer
Do not copy historical Python paths as the new implementation owner. Distinguish missing code from missing normal-route proof. No automatic gate edits. Reviewer checks cited symbols exist at worktree baseline and proposed scopes cannot expand authority.
