# Phase 56: Remote Session UI

## Where you start
Snapshot at commit 9855d99 on 2026-09-26; recheck the worktree source. Passed requirements on an open phase may need evidence/entry review only. Do not manufacture missing code.
READ docs/planning/v2/MANIFEST_PHASES.json, then locate live symbols with SEARCH.

## Requirement input
{
  "name": "Remote Session UI",
  "status": "not_started",
  "entryRequiresPhase": "55",
  "entrySatisfied": true,
  "openedOn": "2026-09-03",
  "openedAgainst": "Entered with entrySatisfied false. Phase 50 is open on its `resources` field and Phase 49 on the iPhone half, neither of which is code this phase depends on. Recorded as a deviation per AGENTS.md rather than asserted true.",
  "evidence": "Surveyed 2026-09-03. The verbs exist over Discord; the display does not exist anywhere.",
  "requirements": [
    {
      "id": "shows_task_device_step_elapsed_risk_and_capabilities_on_mobile",
      "status": "blocked",
      "evidence": "There is no mobile app. MobileCore carries the types from Phases 41-45 and no renderer, which is the same wall Phase 49's approval screen hit.",
      "reason": "No iOS app exists."
    },
    {
      "id": "allows_pause_cancel_inspect_and_approve_next_step",
      "status": "passed",
      "evidence": "All four exist and are reachable remotely today, over Discord rather than over a phone app: `pause`, `cancel` and `status` are verbs in orion-remote handled by the transport before a model turn is spent, and approve is the gate ticket -- `approve A-7F3K`, refused from the local process so Orion cannot answer for Nick. Recorded passed because the requirement is the capability; the surface it is displayed on is the requirement above."
    },
    {
      "id": "uses_live_activities_where_appropriate",
      "status": "blocked",
      "evidence": "Explicitly deferred by the manifest itself ('later where appropriate') and needs the phone.",
      "reason": "Deferred by the manifest, and needs an iOS app."
    }
  ],
  "nextPhaseAllowed": false
}

## Interface and decisions
Produce `docs/planning/offline-roadmap-results/phase-56-packet.md` with the exact report interface from common.md. Treat gate evidence as historical claims until matched to source; absent installed access means not re-proven. Preserve entryRequiresPhase and entrySatisfied semantics.

## Tests and failure injection
Name the nearest existing suite and exact command from source. For the smallest missing seam specify an injectable failure (restart, stale revision, unavailable source, replay or denial as applicable), expected durable state and consumer-visible outcome. Native commands are reviewer-run proposals until registered.

## Exchange plan
Exchange 1: ### FILE the report skeleton at your assigned path: the six section headings, and in Requirement matrix one row per requirement id from this brief (status "to verify"). Exchanges 2 onward: SEARCH/READ two or three files, then ### EDIT the section that finding belongs to, in the same exchange. Never spend more than two exchanges in a row without an EDIT. The doc-report check runs after every write and names what is still missing; when it passes and every row is filled, ### DONE.

## Traps and reviewer
Do not copy historical Python paths as the new implementation owner. Distinguish missing code from missing normal-route proof. No automatic gate edits. Reviewer checks cited symbols exist at worktree baseline and proposed scopes cannot expand authority.
