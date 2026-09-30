# Phase 69: Security Attack Testing

## Where you start
Snapshot at commit 9855d99 on 2026-09-26; recheck the worktree source. Passed requirements on an open phase may need evidence/entry review only. Do not manufacture missing code.
READ docs/planning/v2/MANIFEST_PHASES.json, then locate live symbols with SEARCH.

## Requirement input
{
  "name": "Security Attack Testing",
  "status": "in_progress",
  "entryRequiresPhase": "68",
  "entrySatisfied": true,
  "openedOn": "2026-09-03",
  "openedAgainst": "Entered with entrySatisfied false. The phases behind this one are open on surfaces that do not exist -- an iOS app and a computer-use layer -- neither of which is code this phase depends on. Recorded as a deviation per AGENTS.md rather than asserted true.",
  "evidence": "docs/planning/v2/ATTACK_SURFACE.json and scripts/orion_v2_attack_check.py, wired into scripts/orion_v2_ci_check.sh and .github/workflows/ci.yml.",
  "requirements": [
    {
      "id": "continuously_tests_the_named_attack_classes",
      "status": "passed",
      "evidence": "All nineteen classes the manifest names are mapped: eleven to specific tests by their literal titles, eight argued not-applicable with a REASON and a RESIDUAL. The check fails when a class is missing, when a claimed test has been renamed or deleted, or when an uncovered class gives a reason without saying what would make it live. 'Not applicable' is an acceptable answer; 'not applicable' with nothing said about what would change that is not. Mutation-tested: renaming one security test fails the check by name."
    },
    {
      "id": "the_map_cannot_go_stale",
      "status": "passed",
      "evidence": "The manifest's list is held in the CHECKER, not in the map, so the map cannot satisfy the check by shortening itself. Titles are matched literally rather than fuzzily, because a near-match is how a renamed test keeps passing. And the checker deliberately does not RUN the tests -- orion_v2_ci_check.sh does that -- so there are two things to compare rather than one to mistrust."
    },
    {
      "id": "every_class_is_either_covered_or_has_a_stated_residual_risk",
      "status": "passed",
      "evidence": "The eight uncovered classes are uncovered for structural reasons -- one user, no inbound HTTP endpoint, no fetch primitive, no attachment handling, no SQL this system writes -- and each names what would make it live. The largest residual is written down rather than argued away: `npm ci` still runs install scripts, and tests_run/build_run execute repository code, so dependency_compromise is 'covered' only in the narrow sense that the argv cannot be widened."
    }
  ],
  "nextPhaseAllowed": true
}

## Interface and decisions
Produce `docs/planning/offline-roadmap-results/phase-69-packet.md` with the exact report interface from common.md. Treat gate evidence as historical claims until matched to source; absent installed access means not re-proven. Preserve entryRequiresPhase and entrySatisfied semantics.

## Tests and failure injection
Name the nearest existing suite and exact command from source. For the smallest missing seam specify an injectable failure (restart, stale revision, unavailable source, replay or denial as applicable), expected durable state and consumer-visible outcome. Native commands are reviewer-run proposals until registered.

## Exchange plan
Exchange 1: ### FILE the report skeleton at your assigned path: the six section headings, and in Requirement matrix one row per requirement id from this brief (status "to verify"). Exchanges 2 onward: SEARCH/READ two or three files, then ### EDIT the section that finding belongs to, in the same exchange. Never spend more than two exchanges in a row without an EDIT. The doc-report check runs after every write and names what is still missing; when it passes and every row is filled, ### DONE.

## Traps and reviewer
Do not copy historical Python paths as the new implementation owner. Distinguish missing code from missing normal-route proof. No automatic gate edits. Reviewer checks cited symbols exist at worktree baseline and proposed scopes cannot expand authority.
