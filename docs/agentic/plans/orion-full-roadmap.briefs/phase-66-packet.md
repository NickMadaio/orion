# Phase 66: Live Activities

## Where you start
Snapshot at commit 9855d99 on 2026-09-26; recheck the worktree source. Passed requirements on an open phase may need evidence/entry review only. Do not manufacture missing code.
READ docs/planning/v2/MANIFEST_PHASES.json, then locate live symbols with SEARCH.

## Requirement input
{
  "name": "Live Activities",
  "status": "not_started",
  "entryRequiresPhase": "65",
  "entrySatisfied": false,
  "openedOn": "2026-09-03",
  "openedAgainst": "Entered with entrySatisfied false. The phases behind this one are open on surfaces that do not exist -- an iOS app and a computer-use layer -- neither of which is code this phase depends on. Recorded as a deviation per AGENTS.md rather than asserted true.",
  "evidence": "Surveyed 2026-09-03. No ActivityKit anywhere; no iOS app to host one.",
  "requirements": [
    {
      "id": "uses_live_activities_for_focus_sessions_and_remote_jobs",
      "status": "blocked",
      "evidence": "No iOS app. The STATE a Live Activity would display already exists and is durable -- focus.json carries the task, the deadline and the strike count, and the task ledger carries every run -- so this is a rendering problem rather than a modelling one.",
      "reason": "No iOS app exists."
    },
    {
      "id": "does_not_expose_sensitive_details_on_the_lock_screen_by_default",
      "status": "passed",
      "evidence": "Nothing reaches a Lock Screen, so nothing sensitive does. Recorded passed rather than blocked because the requirement is a PROHIBITION and the prohibition holds -- the same reading used for Phase 54's block list and for Phase 45's absent enum member. It is worth writing down now because the obvious first Live Activity is a focus session whose title is the task, and a task title is exactly the kind of thing that should not be on a lock screen by default."
    }
  ],
  "nextPhaseAllowed": false
}

## Interface and decisions
Produce `docs/planning/offline-roadmap-results/phase-66-packet.md` with the exact report interface from common.md. Treat gate evidence as historical claims until matched to source; absent installed access means not re-proven. Preserve entryRequiresPhase and entrySatisfied semantics.

## Tests and failure injection
Name the nearest existing suite and exact command from source. For the smallest missing seam specify an injectable failure (restart, stale revision, unavailable source, replay or denial as applicable), expected durable state and consumer-visible outcome. Native commands are reviewer-run proposals until registered.

## Exchange plan
Exchange 1: ### FILE the report skeleton at your assigned path: the six section headings, and in Requirement matrix one row per requirement id from this brief (status "to verify"). Exchanges 2 onward: SEARCH/READ two or three files, then ### EDIT the section that finding belongs to, in the same exchange. Never spend more than two exchanges in a row without an EDIT. The doc-report check runs after every write and names what is still missing; when it passes and every row is filled, ### DONE.

## Traps and reviewer
Do not copy historical Python paths as the new implementation owner. Distinguish missing code from missing normal-route proof. No automatic gate edits. Reviewer checks cited symbols exist at worktree baseline and proposed scopes cannot expand authority.
