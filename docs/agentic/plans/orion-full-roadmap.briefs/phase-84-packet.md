# Phase 84: Final ORION Mobile Product Shape

## Where you start
Snapshot at commit 9855d99 on 2026-09-26; recheck the worktree source. Passed requirements on an open phase may need evidence/entry review only. Do not manufacture missing code.
READ docs/planning/v2/MANIFEST_PHASES.json, then locate live symbols with SEARCH.

## Requirement input
{
  "name": "Final ORION Mobile Product Shape",
  "status": "not_started",
  "entryRequiresPhase": "83",
  "entrySatisfied": false,
  "openedOn": "2026-09-04",
  "openedAgainst": "Entered with entrySatisfied false. Phase 80's neighbours are open on an iOS app and on an independent review, neither of which is code this phase depends on. Recorded as a deviation per AGENTS.md rather than asserted true.",
  "evidence": "Surveyed 2026-09-04. Five surfaces named; none exists as a mobile surface, and most of the DATA behind them does.",
  "requirements": [
    {
      "id": "delivers_today_plan_orion_health_and_control_surfaces",
      "status": "blocked",
      "evidence": "No mobile app, the same wall as Phases 65, 66 and 77, parked with Nick until he is at the keyboard because adding a target changes the bundle's designated requirement. What is worth recording is how much of the CONTENT already exists and is reachable: TODAY is orion-standing plus the waiting list; PLAN is orion-agenda plus focus sessions; ORION is text and voice through the gateway and Discord; HEALTH is the health log and the Whoop client; CONTROL is orion-authority, orion-mode, orion-privacy, orion-why and orion-budget. The gap is a renderer, not a model.",
      "reason": "No iOS app. The data behind all five surfaces exists; the surfaces do not."
    },
    {
      "id": "is_not_considered_complete_merely_because_the_app_exists",
      "status": "passed",
      "evidence": "The manifest's own warning, and scripts/orion-readiness is the answer to it: the sixteen final conditions, each with MET, PARTLY, NOT MET or N/A YET and the evidence for the verdict. Today: 8 met, 5 partly, 1 not met, 2 not applicable yet. The one NOT MET is the iPhone as trusted approval device, which is this phase. A report that rounded 'no cloud exists' up to 'the cloud is not omnipotent' would be exactly the scoring this condition warns against."
    }
  ],
  "nextPhaseAllowed": false
}

## Interface and decisions
Produce `docs/planning/offline-roadmap-results/phase-84-packet.md` with the exact report interface from common.md. Treat gate evidence as historical claims until matched to source; absent installed access means not re-proven. Preserve entryRequiresPhase and entrySatisfied semantics.

## Tests and failure injection
Name the nearest existing suite and exact command from source. For the smallest missing seam specify an injectable failure (restart, stale revision, unavailable source, replay or denial as applicable), expected durable state and consumer-visible outcome. Native commands are reviewer-run proposals until registered.

## Exchange plan
Exchange 1: ### FILE the report skeleton at your assigned path: the six section headings, and in Requirement matrix one row per requirement id from this brief (status "to verify"). Exchanges 2 onward: SEARCH/READ two or three files, then ### EDIT the section that finding belongs to, in the same exchange. Never spend more than two exchanges in a row without an EDIT. The doc-report check runs after every write and names what is still missing; when it passes and every row is filled, ### DONE.

## Traps and reviewer
Do not copy historical Python paths as the new implementation owner. Distinguish missing code from missing normal-route proof. No automatic gate edits. Reviewer checks cited symbols exist at worktree baseline and proposed scopes cannot expand authority.
