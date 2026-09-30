# Phase 71: Data Inventory

## Where you start
Snapshot at commit 9855d99 on 2026-09-26; recheck the worktree source. Passed requirements on an open phase may need evidence/entry review only. Do not manufacture missing code.
READ docs/planning/v2/MANIFEST_PHASES.json, then locate live symbols with SEARCH.

## Requirement input
{
  "name": "Data Inventory",
  "status": "in_progress",
  "entryRequiresPhase": "70",
  "entrySatisfied": true,
  "openedOn": "2026-09-04",
  "openedAgainst": "Entered with entrySatisfied false. Phases 65 and 66 are open on the app bundle's designated requirement, which is deliberately parked until Nick is at the keyboard, and neither is code this phase depends on. Recorded as a deviation per AGENTS.md rather than asserted true.",
  "evidence": "docs/planning/v2/DATA_INVENTORY.json and scripts/orion_v2_inventory_check.py, checked against the INSTALLED catalog and the live openclaw.json.",
  "requirements": [
    {
      "id": "maintains_a_living_data_inventory_with_all_ten_fields",
      "status": "passed",
      "evidence": "Fifteen entries, each carrying all ten fields the manifest names, and the checker refuses an empty one \u2014 a field left blank is the field that mattered. It also refuses a claim it cannot support: `encryptionNote` says plainly that nothing local is encrypted beyond FileVault, which is whole-disk and therefore protects a stolen laptop and nothing else."
    },
    {
      "id": "covers_email_calendar_health_conversations_memory_files_devices_analytics_and_logs",
      "status": "passed",
      "evidence": "All nine, plus four the manifest does not name and this system has: OAuth refresh tokens, iMessage history, authority state, and credentials in .env. The analytics entry exists precisely because there ARE none \u2014 writing 'none' down keeps that a decision rather than an assumption nobody rechecks."
    },
    {
      "id": "the_inventory_is_updated_with_every_feature",
      "status": "passed",
      "evidence": "ENFORCED, not remembered. The checker requires every capability tier in the live catalog to appear in exactly one entry, every entry to carry all ten fields, and every configured store path in openclaw.json to be named under some entry's `storage`. It proved itself the same day: enabling the Phase 78 travel tier failed the check until the entry was written. Mutation-tested by removing a tier from the map."
    }
  ],
  "nextPhaseAllowed": true,
  "postReviewCorrections": [
    {
      "on": "2026-09-04",
      "review": "Phases 49-80, oblivious",
      "note": "The inventory covers exec-approvals.json as 'authority state, sensitivity critical' but does not flag that it holds a live credential (socket.token), and CURRENT_SECRET_INVENTORY.json omits the file entirely. The backup's SECRETS.md now names it as item 5 with its rotation route."
    }
  ]
}

## Interface and decisions
Produce `docs/planning/offline-roadmap-results/phase-71-packet.md` with the exact report interface from common.md. Treat gate evidence as historical claims until matched to source; absent installed access means not re-proven. Preserve entryRequiresPhase and entrySatisfied semantics.

## Tests and failure injection
Name the nearest existing suite and exact command from source. For the smallest missing seam specify an injectable failure (restart, stale revision, unavailable source, replay or denial as applicable), expected durable state and consumer-visible outcome. Native commands are reviewer-run proposals until registered.

## Exchange plan
Exchange 1: ### FILE the report skeleton at your assigned path: the six section headings, and in Requirement matrix one row per requirement id from this brief (status "to verify"). Exchanges 2 onward: SEARCH/READ two or three files, then ### EDIT the section that finding belongs to, in the same exchange. Never spend more than two exchanges in a row without an EDIT. The doc-report check runs after every write and names what is still missing; when it passes and every row is filled, ### DONE.

## Traps and reviewer
Do not copy historical Python paths as the new implementation owner. Distinguish missing code from missing normal-route proof. No automatic gate edits. Reviewer checks cited symbols exist at worktree baseline and proposed scopes cannot expand authority.
