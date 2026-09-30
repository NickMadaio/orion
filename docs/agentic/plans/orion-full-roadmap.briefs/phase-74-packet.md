# Phase 74: Incident Response

## Where you start
Snapshot at commit 9855d99 on 2026-09-26; recheck the worktree source. Passed requirements on an open phase may need evidence/entry review only. Do not manufacture missing code.
READ docs/planning/v2/MANIFEST_PHASES.json, then locate live symbols with SEARCH.

## Requirement input
{
  "name": "Incident Response",
  "status": "in_progress",
  "entryRequiresPhase": "73",
  "entrySatisfied": false,
  "openedOn": "2026-09-04",
  "openedAgainst": "Entered with entrySatisfied false. Phases 65 and 66 are open on the app bundle's designated requirement, which is deliberately parked until Nick is at the keyboard, and neither is code this phase depends on. Recorded as a deviation per AGENTS.md rather than asserted true.",
  "evidence": "scripts/orion-incident. The containment and thaw path was exercised live; the bridge removal deliberately was not, since Nick is away and it is his remote access.",
  "requirements": [
    {
      "id": "provides_procedures_for_the_seven_incident_kinds",
      "status": "passed",
      "evidence": "All seven, in `orion-incident runbook`, and two of them say the honest thing: there is no backend and no database, which removes those classes rather than answering them. Each of the rest is numbered steps with the exact URL, because at 3am a URL beats a paragraph."
    },
    {
      "id": "provides_the_seven_revocation_mechanisms",
      "status": "passed",
      "evidence": "`orion-incident freeze` does the four that are local, LOUDEST FIRST \u2014 remote access, then automation, then strictness, then the floor \u2014 so that if it dies halfway the half that ran is the half that mattered. The three that live with an issuer are printed as a checklist rather than automated: a script that revoked an OAuth grant would be a script holding Nick's Google session."
    },
    {
      "id": "freeze_is_one_command_because_an_incident_is_when_you_remember_least",
      "status": "passed",
      "evidence": "Every mechanism already existed separately \u2014 orion-lock, orion-mode, orion-remote-install --remove, orion-automation remove. What did not exist was doing all of them at once, and that is the only version that matters. orion-lock is deliberately NOT run automatically: `contained` already stops every write, and dropping the profile to the floor is the one step that should need a person to mean it."
    },
    {
      "id": "thaw_actually_thaws",
      "status": "passed",
      "evidence": "CLOSED after finding it did not. The first version ran `orion-mode guarded` without --yes, orion-mode refused it as an unexpiring relaxation, and thaw printed 'Lifting containment only' while Orion stayed contained \u2014 a script reporting success while doing nothing, which is the exact failure this whole system is built against. Two fixes: thaw passes --yes and then CHECKS the mode afterwards rather than assuming, and orion-mode no longer treats a return to the DEFAULT as a standing grant needing an expiry. Thaw is also deliberately not the inverse of freeze \u2014 it lifts containment and leaves remote access and automations off, to be turned back on one at a time."
    }
  ],
  "nextPhaseAllowed": true,
  "postReviewCorrections": [
    {
      "on": "2026-09-04",
      "review": "Phases 49-80, oblivious",
      "note": "The freeze step declined to run orion-lock on the stated grounds that 'contained already stops every write'. That was false \u2014 the mode was not wired to anything. It is now, and the text is corrected to say what contained does cover (every typed action that is not a read) and what it does not (the exec allowlist, so the orion-* wrappers still run). orion-lock remains a deliberate manual step, but for the honest reason rather than the false one."
    }
  ]
}

## Interface and decisions
Produce `docs/planning/offline-roadmap-results/phase-74-packet.md` with the exact report interface from common.md. Treat gate evidence as historical claims until matched to source; absent installed access means not re-proven. Preserve entryRequiresPhase and entrySatisfied semantics.

## Tests and failure injection
Name the nearest existing suite and exact command from source. For the smallest missing seam specify an injectable failure (restart, stale revision, unavailable source, replay or denial as applicable), expected durable state and consumer-visible outcome. Native commands are reviewer-run proposals until registered.

## Exchange plan
Exchange 1: ### FILE the report skeleton at your assigned path: the six section headings, and in Requirement matrix one row per requirement id from this brief (status "to verify"). Exchanges 2 onward: SEARCH/READ two or three files, then ### EDIT the section that finding belongs to, in the same exchange. Never spend more than two exchanges in a row without an EDIT. The doc-report check runs after every write and names what is still missing; when it passes and every row is filled, ### DONE.

## Traps and reviewer
Do not copy historical Python paths as the new implementation owner. Distinguish missing code from missing normal-route proof. No automatic gate edits. Reviewer checks cited symbols exist at worktree baseline and proposed scopes cannot expand authority.
