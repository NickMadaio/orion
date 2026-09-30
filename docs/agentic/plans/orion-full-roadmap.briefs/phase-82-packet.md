# Phase 82: Public Release Preparation

## Where you start
Snapshot at commit 9855d99 on 2026-09-26; recheck the worktree source. Passed requirements on an open phase may need evidence/entry review only. Do not manufacture missing code.
READ docs/planning/v2/MANIFEST_PHASES.json, then locate live symbols with SEARCH.

## Requirement input
{
  "name": "Public Release Preparation",
  "status": "not_started",
  "entryRequiresPhase": "81",
  "entrySatisfied": false,
  "openedOn": "2026-09-04",
  "openedAgainst": "Entered with entrySatisfied false. Phase 80's neighbours are open on an iOS app and on an independent review, neither of which is code this phase depends on. Recorded as a deviation per AGENTS.md rather than asserted true.",
  "evidence": "Surveyed 2026-09-04. scripts/orion-readiness answers the manifest's final success condition; the reviews this phase requires are not this system's to perform.",
  "requirements": [
    {
      "id": "documents_retention_deletion_and_incident_response",
      "status": "passed",
      "evidence": "Three of the thirteen items are documentation and all three exist and are checked: RETENTION per data kind in docs/planning/v2/DATA_INVENTORY.json, enforced by orion_v2_inventory_check.py against the live catalog; DELETION as working controls in orion-privacy rather than as prose; INCIDENT RESPONSE as seven runbooks plus a one-command freeze in orion-incident."
    },
    {
      "id": "tests_account_recovery_device_loss_and_secret_rotation",
      "status": "blocked",
      "evidence": "ACCOUNT RECOVERY is not applicable and says so \u2014 there is no account, no server and no user record. DEVICE LOSS and SECRET ROTATION are documented as procedures in orion-incident's runbook and orion-backup --secrets, and neither has been exercised: one cannot be tested without losing the device, and the other needs credentials rotated at four issuers, which is Nick's to do and not something to rehearse casually.",
      "reason": "Two of three are documented procedures that have never been exercised; the third does not apply."
    },
    {
      "id": "performs_the_external_reviews",
      "status": "blocked",
      "evidence": "None performed, and none of them is something this system can perform on itself \u2014 that is the point of the list. Penetration testing, architecture review, privacy review, health regulatory review, Google OAuth verification, App Store privacy review and supply-chain review all require people who did not build it. The nearest internal analogue is Phase 75's independent review, which is itself outstanding.",
      "reason": "Seven external reviews, none performed. By construction they need outside parties."
    },
    {
      "id": "no_one_beyond_trusted_development_users_has_it",
      "status": "passed",
      "evidence": "The precondition this whole phase is gated on. One user, one machine, a private GitHub repository, no distribution, no signing for release, no App Store record. The phase is correctly not started because its trigger has not occurred."
    }
  ],
  "nextPhaseAllowed": false
}

## Interface and decisions
Produce `docs/planning/offline-roadmap-results/phase-82-packet.md` with the exact report interface from common.md. Treat gate evidence as historical claims until matched to source; absent installed access means not re-proven. Preserve entryRequiresPhase and entrySatisfied semantics.

## Tests and failure injection
Name the nearest existing suite and exact command from source. For the smallest missing seam specify an injectable failure (restart, stale revision, unavailable source, replay or denial as applicable), expected durable state and consumer-visible outcome. Native commands are reviewer-run proposals until registered.

## Exchange plan
Exchange 1: ### FILE the report skeleton at your assigned path: the six section headings, and in Requirement matrix one row per requirement id from this brief (status "to verify"). Exchanges 2 onward: SEARCH/READ two or three files, then ### EDIT the section that finding belongs to, in the same exchange. Never spend more than two exchanges in a row without an EDIT. The doc-report check runs after every write and names what is still missing; when it passes and every row is filled, ### DONE.

## Traps and reviewer
Do not copy historical Python paths as the new implementation owner. Distinguish missing code from missing normal-route proof. No automatic gate edits. Reviewer checks cited symbols exist at worktree baseline and proposed scopes cannot expand authority.
