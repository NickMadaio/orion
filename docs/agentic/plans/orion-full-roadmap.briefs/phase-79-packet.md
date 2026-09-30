# Phase 79: Future Reservation Capability

## Where you start
Snapshot at commit 9855d99 on 2026-09-26; recheck the worktree source. Passed requirements on an open phase may need evidence/entry review only. Do not manufacture missing code.
READ docs/planning/v2/MANIFEST_PHASES.json, then locate live symbols with SEARCH.

## Requirement input
{
  "name": "Future Reservation Capability",
  "status": "not_started",
  "entryRequiresPhase": "78",
  "entrySatisfied": false,
  "openedOn": "2026-09-04",
  "openedAgainst": "Entered with entrySatisfied false. Phases 65 and 66 are open on the app bundle's designated requirement, which is deliberately parked until Nick is at the keyboard, and neither is code this phase depends on. Recorded as a deviation per AGENTS.md rather than asserted true.",
  "evidence": "Surveyed 2026-09-04. The manifest's own precondition is unmet.",
  "requirements": [
    {
      "id": "waits_until_connectors_and_computer_use_are_safe",
      "status": "passed",
      "evidence": "The precondition is honoured because there is no computer-use surface at all: no screen capture, no input synthesis, no fetch primitive Orion can point at a URL. Phases 53, 54 and 55 record the same wall from their own angles."
    },
    {
      "id": "discovers_inspects_presents_books_and_records_a_reservation",
      "status": "blocked",
      "evidence": "None of it built, and correctly ordered after the capability it would need. Building a booking flow before there is a safe way to drive a browser produces a flow nobody can test against a real site.",
      "reason": "Depends on a browser/computer-use surface that does not exist."
    },
    {
      "id": "never_allows_an_ambiguous_high_cost_booking_without_clear_intent",
      "status": "passed",
      "evidence": "A PROHIBITION, and it holds structurally today: nothing in this system spends money, no action names a price, and no payment rail is reachable. Phase 76's deferral check watches four separate patterns for it \u2014 autonomous purchasing, banking automation, autonomous payments, and the checkout shapes \u2014 and fails if any appears in the catalog, the scripts or the allowlist."
    }
  ],
  "nextPhaseAllowed": false
}

## Interface and decisions
Produce `docs/planning/offline-roadmap-results/phase-79-packet.md` with the exact report interface from common.md. Treat gate evidence as historical claims until matched to source; absent installed access means not re-proven. Preserve entryRequiresPhase and entrySatisfied semantics.

## Tests and failure injection
Name the nearest existing suite and exact command from source. For the smallest missing seam specify an injectable failure (restart, stale revision, unavailable source, replay or denial as applicable), expected durable state and consumer-visible outcome. Native commands are reviewer-run proposals until registered.

## Exchange plan
Exchange 1: ### FILE the report skeleton at your assigned path: the six section headings, and in Requirement matrix one row per requirement id from this brief (status "to verify"). Exchanges 2 onward: SEARCH/READ two or three files, then ### EDIT the section that finding belongs to, in the same exchange. Never spend more than two exchanges in a row without an EDIT. The doc-report check runs after every write and names what is still missing; when it passes and every row is filled, ### DONE.

## Traps and reviewer
Do not copy historical Python paths as the new implementation owner. Distinguish missing code from missing normal-route proof. No automatic gate edits. Reviewer checks cited symbols exist at worktree baseline and proposed scopes cannot expand authority.
