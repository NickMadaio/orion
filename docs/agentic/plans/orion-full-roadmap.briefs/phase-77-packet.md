# Phase 77: Future Apple Watch Expansion

## Where you start
Snapshot at commit 9855d99 on 2026-09-26; recheck the worktree source. Passed requirements on an open phase may need evidence/entry review only. Do not manufacture missing code.
READ docs/planning/v2/MANIFEST_PHASES.json, then locate live symbols with SEARCH.

## Requirement input
{
  "name": "Future Apple Watch Expansion",
  "status": "not_started",
  "entryRequiresPhase": "76",
  "entrySatisfied": true,
  "openedOn": "2026-09-04",
  "openedAgainst": "Entered with entrySatisfied false. Phases 65 and 66 are open on the app bundle's designated requirement, which is deliberately parked until Nick is at the keyboard, and neither is code this phase depends on. Recorded as a deviation per AGENTS.md rather than asserted true.",
  "evidence": "Surveyed 2026-09-04. Blocked on the same wall as Phases 65 and 66, and parked with Nick's agreement until he is at the keyboard.",
  "requirements": [
    {
      "id": "creates_a_lightweight_watch_companion",
      "status": "blocked",
      "evidence": "The manifest's own precondition is 'after mobile health and ORION Mobile are stable', and there is no ORION Mobile \u2014 no app target, no SwiftUI layer, no Keychain adapter. Adding one changes the app bundle's designated requirement, which every TCC grant and Keychain item on this machine is bound to. Parked deliberately, not skipped.",
      "reason": "No iOS app exists, and creating the target risks the designated requirement. Parked until Nick is present."
    },
    {
      "id": "does_not_make_watch_the_source_of_truth",
      "status": "passed",
      "evidence": "A PROHIBITION, and it holds \u2014 by absence today, and by architecture afterwards. Every store this system has lives on the Mac and the phone half (MobileCore, Phases 41-45) was deliberately built with no platform framework and no persistence of its own. A Watch reading those is a view; a Watch writing them would need a store that does not exist and would have to be built on purpose."
    }
  ],
  "nextPhaseAllowed": false
}

## Interface and decisions
Produce `docs/planning/offline-roadmap-results/phase-77-packet.md` with the exact report interface from common.md. Treat gate evidence as historical claims until matched to source; absent installed access means not re-proven. Preserve entryRequiresPhase and entrySatisfied semantics.

## Tests and failure injection
Name the nearest existing suite and exact command from source. For the smallest missing seam specify an injectable failure (restart, stale revision, unavailable source, replay or denial as applicable), expected durable state and consumer-visible outcome. Native commands are reviewer-run proposals until registered.

## Exchange plan
Exchange 1: ### FILE the report skeleton at your assigned path: the six section headings, and in Requirement matrix one row per requirement id from this brief (status "to verify"). Exchanges 2 onward: SEARCH/READ two or three files, then ### EDIT the section that finding belongs to, in the same exchange. Never spend more than two exchanges in a row without an EDIT. The doc-report check runs after every write and names what is still missing; when it passes and every row is filled, ### DONE.

## Traps and reviewer
Do not copy historical Python paths as the new implementation owner. Distinguish missing code from missing normal-route proof. No automatic gate edits. Reviewer checks cited symbols exist at worktree baseline and proposed scopes cannot expand authority.
