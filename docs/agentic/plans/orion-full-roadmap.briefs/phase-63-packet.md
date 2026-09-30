# Phase 63: Explainability

## Where you start
Snapshot at commit 9855d99 on 2026-09-26; recheck the worktree source. Passed requirements on an open phase may need evidence/entry review only. Do not manufacture missing code.
READ docs/planning/v2/MANIFEST_PHASES.json, then locate live symbols with SEARCH.

## Requirement input
{
  "name": "Explainability",
  "status": "in_progress",
  "entryRequiresPhase": "62",
  "entrySatisfied": true,
  "openedOn": "2026-09-03",
  "openedAgainst": "Entered with entrySatisfied false. The phases behind this one are open on surfaces that do not exist -- an iOS app and a computer-use layer -- neither of which is code this phase depends on. Recorded as a deviation per AGENTS.md rather than asserted true.",
  "evidence": "plugin/orion-control/src/explain.ts and scripts/orion-why, covered by src/gate.test.ts and verified against the real task ledger.",
  "requirements": [
    {
      "id": "every_consequential_recommendation_supports_why",
      "status": "passed",
      "evidence": "`orion-why` answers it: the last run, a named run, or `orion-why can <capability>` which delegates to orion-authority rather than growing a second explanation of authority -- this repo has already been burned once by exactly that between orion-authority and orion-selfdoc."
    },
    {
      "id": "exposes_inputs_evidence_policy_provenance_and_constraints",
      "status": "passed",
      "evidence": "All five, each from a durable record. INPUTS and EVIDENCE from the task ledger, quoted verbatim -- a paraphrased piece of evidence is a claim about evidence. POLICY read out of ACTION_CATALOG, so it cannot disagree with the gate that actually ran. PROVENANCE from the trust anchor, and a run with none says so rather than staying quiet. CONSTRAINTS are the validator's own issue messages, in order."
    },
    {
      "id": "does_not_expose_private_hidden_chain_of_thought",
      "status": "passed",
      "evidence": "Taken in its strongest form: the model does not answer this question at all. `orion-why` is a program that assembles recorded facts and has no reasoning to leak because it does none. The weaker reading -- a filter over what the model says -- would have reproduced the defect SOUL.md already fights, where Orion answers about himself from memory and is confidently wrong; an explanation NARRATED by the model is a plausible story about what happened, indistinguishable from a report of it."
    }
  ],
  "nextPhaseAllowed": true
}

## Interface and decisions
Produce `docs/planning/offline-roadmap-results/phase-63-packet.md` with the exact report interface from common.md. Treat gate evidence as historical claims until matched to source; absent installed access means not re-proven. Preserve entryRequiresPhase and entrySatisfied semantics.

## Tests and failure injection
Name the nearest existing suite and exact command from source. For the smallest missing seam specify an injectable failure (restart, stale revision, unavailable source, replay or denial as applicable), expected durable state and consumer-visible outcome. Native commands are reviewer-run proposals until registered.

## Exchange plan
Exchange 1: ### FILE the report skeleton at your assigned path: the six section headings, and in Requirement matrix one row per requirement id from this brief (status "to verify"). Exchanges 2 onward: SEARCH/READ two or three files, then ### EDIT the section that finding belongs to, in the same exchange. Never spend more than two exchanges in a row without an EDIT. The doc-report check runs after every write and names what is still missing; when it passes and every row is filled, ### DONE.

## Traps and reviewer
Do not copy historical Python paths as the new implementation owner. Distinguish missing code from missing normal-route proof. No automatic gate edits. Reviewer checks cited symbols exist at worktree baseline and proposed scopes cannot expand authority.
