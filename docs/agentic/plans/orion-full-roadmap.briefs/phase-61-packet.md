# Phase 61: Prep Cards

## Where you start
Snapshot at commit 9855d99 on 2026-09-26; recheck the worktree source. Passed requirements on an open phase may need evidence/entry review only. Do not manufacture missing code.
READ docs/planning/v2/MANIFEST_PHASES.json, then locate live symbols with SEARCH.

## Requirement input
{
  "name": "Prep Cards",
  "status": "not_started",
  "entryRequiresPhase": "60",
  "entrySatisfied": true,
  "openedOn": "2026-09-03",
  "openedAgainst": "Entered with entrySatisfied false. The phases behind this one are open on surfaces that do not exist -- an iOS app and a computer-use layer -- neither of which is code this phase depends on. Recorded as a deviation per AGENTS.md rather than asserted true.",
  "evidence": "Surveyed 2026-09-03. Every ingredient exists and nothing assembles them.",
  "requirements": [
    {
      "id": "assembles_threads_notes_tasks_documents_people_and_open_questions",
      "status": "passed",
      "evidence": "CLOSED 2026-09-03. `prep_card` fans out to five sources in parallel -- mail (orion-gmail-search), notes (orion-recall), tasks (orion-agenda), people (the attendees), and open questions (the Phase 62 waiting list, filtered to anyone in the room). Search terms are extracted MECHANICALLY from the event title and attendees, never chosen by the model: an event title is attacker-controllable if anyone can put something on the calendar, and 'search my mail for X' where X was picked by a model reading that title is a worse position than a fixed extraction. A source that cannot be read is a blind spot in the card, never an empty section. DOCUMENTS is the sixth and is reported as unavailable rather than faked: there is no document store to search, and an unbounded filename scan is both useless and a way to read whatever Orion is pointed at."
    },
    {
      "id": "uses_temporary_context_and_does_not_make_everything_permanent_memory",
      "status": "passed",
      "evidence": "Satisfied in advance by how the brain is written to. orion-note REQUIRES an --epistemic value and refuses without one, so nothing becomes a permanent note by accident, and the reads above return text to a turn without writing anything at all. The manifest's warning is about a system that quietly promotes everything it reads into memory; this one cannot, because the only write path is a deliberate wrapper call."
    }
  ],
  "nextPhaseAllowed": true
}

## Interface and decisions
Produce `docs/planning/offline-roadmap-results/phase-61-packet.md` with the exact report interface from common.md. Treat gate evidence as historical claims until matched to source; absent installed access means not re-proven. Preserve entryRequiresPhase and entrySatisfied semantics.

## Tests and failure injection
Name the nearest existing suite and exact command from source. For the smallest missing seam specify an injectable failure (restart, stale revision, unavailable source, replay or denial as applicable), expected durable state and consumer-visible outcome. Native commands are reviewer-run proposals until registered.

## Exchange plan
Exchange 1: ### FILE the report skeleton at your assigned path: the six section headings, and in Requirement matrix one row per requirement id from this brief (status "to verify"). Exchanges 2 onward: SEARCH/READ two or three files, then ### EDIT the section that finding belongs to, in the same exchange. Never spend more than two exchanges in a row without an EDIT. The doc-report check runs after every write and names what is still missing; when it passes and every row is filled, ### DONE.

## Traps and reviewer
Do not copy historical Python paths as the new implementation owner. Distinguish missing code from missing normal-route proof. No automatic gate edits. Reviewer checks cited symbols exist at worktree baseline and proposed scopes cannot expand authority.
