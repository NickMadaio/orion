# Phase 64: Confidence Handling

## Where you start
Snapshot at commit 9855d99 on 2026-09-26; recheck the worktree source. Passed requirements on an open phase may need evidence/entry review only. Do not manufacture missing code.
READ docs/planning/v2/MANIFEST_PHASES.json, then locate live symbols with SEARCH.

## Requirement input
{
  "name": "Confidence Handling",
  "status": "in_progress",
  "entryRequiresPhase": "63",
  "entrySatisfied": true,
  "openedOn": "2026-09-03",
  "openedAgainst": "Entered with entrySatisfied false. The phases behind this one are open on surfaces that do not exist -- an iOS app and a computer-use layer -- neither of which is code this phase depends on. Recorded as a deviation per AGENTS.md rather than asserted true.",
  "evidence": "plugin/orion-control/src/explain.ts and scripts/orion-why, covered by src/gate.test.ts and verified against the real task ledger.",
  "requirements": [
    {
      "id": "distinguishes_known_observed_inferred_uncertain_and_unable_to_verify",
      "status": "passed",
      "evidence": "All five, and every one DERIVED from what the record contains rather than read from a field -- a model that could write `confidence: \"known\"` would. `verified` with evidence is observed; `succeeded` is inferred, however cleanly it exited, because 'the tool did not throw' and 'the thing is true' are different claims this program has confused before. The fifth level is the one that matters most: 'I looked and cannot tell' and 'I could not look' are different sentences, and collapsing them is how orion-standing once reported a clear day when Reminders had never been granted."
    },
    {
      "id": "does_not_present_uncertain_inference_as_fact",
      "status": "passed",
      "evidence": "A run's confidence is the WEAKEST of its steps, not an average, so one verified read cannot vouch for a write nobody checked. `isActionable` is true only for known and observed. The existing enforcement stays: orion-standing refuses to print a number it was not given, and --polish rejects a rewrite that introduces a digit."
    },
    {
      "id": "applies_to_health_email_inferred_tasks_intent_automation_and_memory",
      "status": "passed",
      "evidence": "CLOSED 2026-09-03. Confidence is now on EVERY run result rather than on two surfaces -- `confidence` and `confidenceMeans` sit beside `executed`, derived by explainRun from the record and never from anything the model wrote. That covers computer automation, inferred tasks and intent in one place, because all three arrive as task runs. Memory keeps orion-note's --epistemic, mapped rather than replaced so no existing note is orphaned; health keeps orion-standing's refusal to attribute a stale figure to today; mail arrives through prep cards, whose sections are ok/empty/unavailable, which is the same distinction under another name. The tool description now tells the model what to do with it: `inferred` means nothing checked, so never say you saw it. That cost a real constraint -- the description has a 4000-character budget and the first version blew it, so the approval guidance was tightened to fit, since it is paid for on every request while SOUL.md is loaded once."
    }
  ],
  "nextPhaseAllowed": true
}

## Interface and decisions
Produce `docs/planning/offline-roadmap-results/phase-64-packet.md` with the exact report interface from common.md. Treat gate evidence as historical claims until matched to source; absent installed access means not re-proven. Preserve entryRequiresPhase and entrySatisfied semantics.

## Tests and failure injection
Name the nearest existing suite and exact command from source. For the smallest missing seam specify an injectable failure (restart, stale revision, unavailable source, replay or denial as applicable), expected durable state and consumer-visible outcome. Native commands are reviewer-run proposals until registered.

## Exchange plan
Exchange 1: ### FILE the report skeleton at your assigned path: the six section headings, and in Requirement matrix one row per requirement id from this brief (status "to verify"). Exchanges 2 onward: SEARCH/READ two or three files, then ### EDIT the section that finding belongs to, in the same exchange. Never spend more than two exchanges in a row without an EDIT. The doc-report check runs after every write and names what is still missing; when it passes and every row is filled, ### DONE.

## Traps and reviewer
Do not copy historical Python paths as the new implementation owner. Distinguish missing code from missing normal-route proof. No automatic gate edits. Reviewer checks cited symbols exist at worktree baseline and proposed scopes cannot expand authority.
