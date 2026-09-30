# Phase 75: Development Workflow

## Where you start
Snapshot at commit 9855d99 on 2026-09-26; recheck the worktree source. Passed requirements on an open phase may need evidence/entry review only. Do not manufacture missing code.
READ docs/planning/v2/MANIFEST_PHASES.json, then locate live symbols with SEARCH.

## Requirement input
{
  "name": "Development Workflow",
  "status": "in_progress",
  "entryRequiresPhase": "74",
  "entrySatisfied": true,
  "openedOn": "2026-09-04",
  "openedAgainst": "Entered with entrySatisfied false. Phases 65 and 66 are open on the app bundle's designated requirement, which is deliberately parked until Nick is at the keyboard, and neither is code this phase depends on. Recorded as a deviation per AGENTS.md rather than asserted true.",
  "evidence": "scripts/orion_v2_workflow_check.py, which grades the five mechanical steps of the eighteen and prints the rest.",
  "requirements": [
    {
      "id": "checks_the_mechanically_checkable_steps",
      "status": "passed",
      "evidence": "Five of eighteen are mechanical and they are the five a tired person skips: tests moved with the source (8/10), documentation moved (14), the data inventory moved with the capability surface (15), the phase gate passes (18), and a change to the ENFORCEMENT path has a recorded review (12). The other thirteen are printed as a checklist, because a step nobody can see is a step nobody does. The enforcement file list is duplicated from selfrepair.ts and the checker verifies it has not drifted, rather than trusting the copy."
    },
    {
      "id": "does_not_let_one_model_design_implement_review_and_approve_its_own_security_work",
      "status": "passed",
      "evidence": "CLOSED 2026-09-04, by an independent review actually happening rather than by anything being written down. An agent was given the manifest, the repository and the commands, and no narrative \u2014 told to verify claims rather than trust them, and to say what it tried so that 'found nothing' would carry weight. It reported two findings with real safety cost, and both were things this session had written and believed: the strictness ladder was never wired to enforcement, so `contained` reported containment and gated nothing; and a live credential was inside the backup while its own manifest asserted the opposite. It also found four smaller ones, including a mutation count in Phase 49's evidence that was off by one. Every finding is recorded under its phase in postReviewCorrections rather than by editing the original evidence \u2014 the fact that a claim was wrong is itself evidence about the evidence \u2014 and each repair has a named failing test, mutation-verified. The reviewer left the tree clean (git status --porcelain empty, 222/222 at baseline)."
    }
  ],
  "nextPhaseAllowed": true
}

## Interface and decisions
Produce `docs/planning/offline-roadmap-results/phase-75-packet.md` with the exact report interface from common.md. Treat gate evidence as historical claims until matched to source; absent installed access means not re-proven. Preserve entryRequiresPhase and entrySatisfied semantics.

## Tests and failure injection
Name the nearest existing suite and exact command from source. For the smallest missing seam specify an injectable failure (restart, stale revision, unavailable source, replay or denial as applicable), expected durable state and consumer-visible outcome. Native commands are reviewer-run proposals until registered.

## Exchange plan
Exchange 1: ### FILE the report skeleton at your assigned path: the six section headings, and in Requirement matrix one row per requirement id from this brief (status "to verify"). Exchanges 2 onward: SEARCH/READ two or three files, then ### EDIT the section that finding belongs to, in the same exchange. Never spend more than two exchanges in a row without an EDIT. The doc-report check runs after every write and names what is still missing; when it passes and every row is filled, ### DONE.

## Traps and reviewer
Do not copy historical Python paths as the new implementation owner. Distinguish missing code from missing normal-route proof. No automatic gate edits. Reviewer checks cited symbols exist at worktree baseline and proposed scopes cannot expand authority.
