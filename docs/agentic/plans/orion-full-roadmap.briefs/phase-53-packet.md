# Phase 53: Automation Sessions for Complex Computer Work

## Where you start
Snapshot at commit 9855d99 on 2026-09-26; recheck the worktree source. Passed requirements on an open phase may need evidence/entry review only. Do not manufacture missing code.
READ docs/planning/v2/MANIFEST_PHASES.json, then locate live symbols with SEARCH.

## Requirement input
{
  "name": "Automation Sessions for Complex Computer Work",
  "status": "not_started",
  "entryRequiresPhase": "52",
  "entrySatisfied": false,
  "openedOn": "2026-09-03",
  "openedAgainst": "Entered with entrySatisfied false. Phase 50 is open on its `resources` field and Phase 49 on the iPhone half, neither of which is code this phase depends on. Recorded as a deviation per AGENTS.md rather than asserted true.",
  "evidence": "Surveyed 2026-09-03. No computer-use surface exists to bound.",
  "requirements": [
    {
      "id": "creates_bounded_computer_use_sessions",
      "status": "blocked",
      "evidence": "There is no computer-use capability on this machine: no screen capture, no input synthesis, no application driving beyond `open -a` and `osascript` against named apps. A session type would be a container for nothing.",
      "reason": "Nothing to bound yet. Depends on a computer-use surface that does not exist."
    },
    {
      "id": "every_session_defines_goal_device_apps_directories_domains_capabilities_and_ceilings",
      "status": "blocked",
      "evidence": "Six of the twelve fields now have a working implementation elsewhere and should be reused rather than rebuilt when this is built: risk ceiling, max duration and target device are the strictness delegation (Phase 50); allowed capabilities are the mode plus its floor; allowed directories are the mutable roots; and a session is most honestly a narrower, shorter delegation rather than a parallel concept.",
      "reason": "Depends on the same missing surface."
    },
    {
      "id": "requires_additional_approval_to_expand_scope",
      "status": "blocked",
      "evidence": "The mechanism exists and is tested -- an approval ticket a person grants -- but there is no scope to expand.",
      "reason": "Depends on the same missing surface."
    }
  ],
  "nextPhaseAllowed": false
}

## Interface and decisions
Produce `docs/planning/offline-roadmap-results/phase-53-packet.md` with the exact report interface from common.md. Treat gate evidence as historical claims until matched to source; absent installed access means not re-proven. Preserve entryRequiresPhase and entrySatisfied semantics.

## Tests and failure injection
Name the nearest existing suite and exact command from source. For the smallest missing seam specify an injectable failure (restart, stale revision, unavailable source, replay or denial as applicable), expected durable state and consumer-visible outcome. Native commands are reviewer-run proposals until registered.

## Exchange plan
Exchange 1: ### FILE the report skeleton at your assigned path: the six section headings, and in Requirement matrix one row per requirement id from this brief (status "to verify"). Exchanges 2 onward: SEARCH/READ two or three files, then ### EDIT the section that finding belongs to, in the same exchange. Never spend more than two exchanges in a row without an EDIT. The doc-report check runs after every write and names what is still missing; when it passes and every row is filled, ### DONE.

## Traps and reviewer
Do not copy historical Python paths as the new implementation owner. Distinguish missing code from missing normal-route proof. No automatic gate edits. Reviewer checks cited symbols exist at worktree baseline and proposed scopes cannot expand authority.
