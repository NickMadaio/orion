# Phase 72: Privacy Controls

## Where you start
Snapshot at commit 9855d99 on 2026-09-26; recheck the worktree source. Passed requirements on an open phase may need evidence/entry review only. Do not manufacture missing code.
READ docs/planning/v2/MANIFEST_PHASES.json, then locate live symbols with SEARCH.

## Requirement input
{
  "name": "Privacy Controls",
  "status": "in_progress",
  "entryRequiresPhase": "71",
  "entrySatisfied": true,
  "openedOn": "2026-09-04",
  "openedAgainst": "Entered with entrySatisfied false. Phases 65 and 66 are open on the app bundle's designated requirement, which is deliberately parked until Nick is at the keyboard, and neither is code this phase depends on. Recorded as a deviation per AGENTS.md rather than asserted true.",
  "evidence": "scripts/orion-privacy. Verified live: it lists all ten, and nothing destructive runs without --yes.",
  "requirements": [
    {
      "id": "offers_all_ten_controls",
      "status": "passed",
      "evidence": "All ten are listed with their current state and how to exercise them. The four that are not this machine's to do \u2014 disconnecting Google, revoking scopes, and so on \u2014 are LISTED rather than omitted, with the URL where they happen, because a control people cannot see is worse than one they cannot use here. A script that clicked through an OAuth revocation would be a script holding Nick's Google session, which is the thing this system is built not to be."
    },
    {
      "id": "deletion_is_real",
      "status": "passed",
      "evidence": "`forget` and `purge` remove files outright. A delete control that moves things aside is not a delete control, and this is the one place in the program where destructive is the correct answer. Every path names exactly what it will remove, weighs it, and requires --yes; a bare invocation deletes nothing, which was checked live. The AUDIT ledgers are deliberately NOT purgeable in one command: an audit trail you can clear in one command is one an attacker clears in one command."
    },
    {
      "id": "privacy_settings_are_not_obscure",
      "status": "passed",
      "evidence": "The manifest's actual brief. Every one of these was already possible before this file \u2014 rm a path, edit a flag, revoke in a browser \u2014 and that is what obscure means. `orion-privacy inspect` reports 179.9 MB across five stores with each one's retention and third-party exposure read out of the Phase 71 inventory, so the two cannot disagree."
    },
    {
      "id": "export_omits_credentials",
      "status": "passed",
      "evidence": "`export` copies conversations, memory, the brain and Orion's own state, and writes a README saying what it left out and why: an export is a copy that leaves the machine, and a copy of a secret is a second thing that can leak."
    }
  ],
  "nextPhaseAllowed": true
}

## Interface and decisions
Produce `docs/planning/offline-roadmap-results/phase-72-packet.md` with the exact report interface from common.md. Treat gate evidence as historical claims until matched to source; absent installed access means not re-proven. Preserve entryRequiresPhase and entrySatisfied semantics.

## Tests and failure injection
Name the nearest existing suite and exact command from source. For the smallest missing seam specify an injectable failure (restart, stale revision, unavailable source, replay or denial as applicable), expected durable state and consumer-visible outcome. Native commands are reviewer-run proposals until registered.

## Exchange plan
Exchange 1: ### FILE the report skeleton at your assigned path: the six section headings, and in Requirement matrix one row per requirement id from this brief (status "to verify"). Exchanges 2 onward: SEARCH/READ two or three files, then ### EDIT the section that finding belongs to, in the same exchange. Never spend more than two exchanges in a row without an EDIT. The doc-report check runs after every write and names what is still missing; when it passes and every row is filled, ### DONE.

## Traps and reviewer
Do not copy historical Python paths as the new implementation owner. Distinguish missing code from missing normal-route proof. No automatic gate edits. Reviewer checks cited symbols exist at worktree baseline and proposed scopes cannot expand authority.
