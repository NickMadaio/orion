# Phase 59: Proactive ORION

## Where you start
Snapshot at commit 9855d99 on 2026-09-26; recheck the worktree source. Passed requirements on an open phase may need evidence/entry review only. Do not manufacture missing code.
READ docs/planning/v2/MANIFEST_PHASES.json, then locate live symbols with SEARCH.

## Requirement input
{
  "name": "Proactive ORION",
  "status": "not_started",
  "entryRequiresPhase": "58",
  "entrySatisfied": false,
  "openedOn": "2026-09-03",
  "openedAgainst": "Entered with entrySatisfied false. Phase 50 is open on its `resources` field and Phase 49 on the iPhone half, neither of which is code this phase depends on. Recorded as a deviation per AGENTS.md rather than asserted true.",
  "evidence": "Surveyed 2026-09-03. scripts/orion-standing is the proactive system and has been running hourly for weeks; it has no scoring in it.",
  "requirements": [
    {
      "id": "implemented_only_after_other_systems_are_stable",
      "status": "passed",
      "evidence": "Ordering satisfied by accident of history rather than by plan: standing orders were built after the memory, agenda and delivery paths, and its header records the three failure modes that were paid for first."
    },
    {
      "id": "scores_items_by_urgency_actionability_novelty_confidence_importance_and_interruptibility",
      "status": "blocked",
      "evidence": "No scoring exists. What exists is the RULE the scoring would serve, and it is stronger than a score: 'say only what changed', with silence as the default and the normal outcome. Three of the six factors are already enforced structurally -- novelty by the changed-only rule, confidence by refusing to print a number that was not given and is not stamped today, interruptibility by quiet hours and a cooldown. The three genuinely absent are urgency, actionability and importance, and adding a six-factor score without them would be arithmetic over three constants.",
      "reason": "Three of the six factors have no input to compute from. Deliberately not faked."
    },
    {
      "id": "does_not_interrupt_for_low_value_observations",
      "status": "passed",
      "evidence": "The whole design of orion-standing. Silence is the default, every line has to answer what changed, why it matters and what to do about it, and an unavailable source is reported as a blind spot rather than flattened into 'nothing scheduled'."
    },
    {
      "id": "places_low_priority_suggestions_in_today",
      "status": "blocked",
      "evidence": "There is a Today surface in the Swift app and standing orders do not write to it; low-priority items are dropped rather than filed. Closing this is a write path from orion-standing into the day model, not a scoring problem.",
      "reason": "No write path from the proactive system into the Today surface."
    }
  ],
  "nextPhaseAllowed": false
}

## Interface and decisions
Produce `docs/planning/offline-roadmap-results/phase-59-packet.md` with the exact report interface from common.md. Treat gate evidence as historical claims until matched to source; absent installed access means not re-proven. Preserve entryRequiresPhase and entrySatisfied semantics.

## Tests and failure injection
Name the nearest existing suite and exact command from source. For the smallest missing seam specify an injectable failure (restart, stale revision, unavailable source, replay or denial as applicable), expected durable state and consumer-visible outcome. Native commands are reviewer-run proposals until registered.

## Exchange plan
Exchange 1: ### FILE the report skeleton at your assigned path: the six section headings, and in Requirement matrix one row per requirement id from this brief (status "to verify"). Exchanges 2 onward: SEARCH/READ two or three files, then ### EDIT the section that finding belongs to, in the same exchange. Never spend more than two exchanges in a row without an EDIT. The doc-report check runs after every write and names what is still missing; when it passes and every row is filled, ### DONE.

## Traps and reviewer
Do not copy historical Python paths as the new implementation owner. Distinguish missing code from missing normal-route proof. No automatic gate edits. Reviewer checks cited symbols exist at worktree baseline and proposed scopes cannot expand authority.
