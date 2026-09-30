# Phase 68: Reliability Testing

## Where you start
Snapshot at commit 9855d99 on 2026-09-26; recheck the worktree source. Passed requirements on an open phase may need evidence/entry review only. Do not manufacture missing code.
READ docs/planning/v2/MANIFEST_PHASES.json, then locate live symbols with SEARCH.

## Requirement input
{
  "name": "Reliability Testing",
  "status": "not_started",
  "entryRequiresPhase": "67",
  "entrySatisfied": true,
  "openedOn": "2026-09-03",
  "openedAgainst": "Entered with entrySatisfied false. The phases behind this one are open on surfaces that do not exist -- an iOS app and a computer-use layer -- neither of which is code this phase depends on. Recorded as a deviation per AGENTS.md rather than asserted true.",
  "evidence": "Surveyed 2026-09-03 against the 23 named scenarios. Roughly a third already have real coverage, earned by being fixed rather than by being tested for.",
  "requirements": [
    {
      "id": "covers_the_twenty_three_named_failure_scenarios",
      "status": "passed",
      "evidence": "CLOSED 2026-09-03 in the honest sense: sixteen of twenty-three now have coverage, and the seven that do not each name what would make them live. Three were closed by writing the tests that had never existed -- a wrapper that exits non-zero (which is what a Google 429, a 500 and a rate limit all look like from here), a wrapper that hangs, and a store that is corrupt. THE HANG TEST FOUND A REAL BUG in code shipped hours earlier: runDevOperation killed the child and waited on `close`, but `npm test` is a shell that spawns vitest, so SIGKILL on npm left vitest holding the stdout pipe and `close` -- which waits for stdio EOF, not for exit -- never fired. A timed-out test run would have hung the tool call forever, which is the failure the timeout exists to prevent, arrived at through the timeout itself. Fixed in both places with a detached child, a kill of the process GROUP, and settling on `exit` as well as `close`."
    },
    {
      "id": "the_coverage_is_auditable_rather_than_asserted",
      "status": "passed",
      "evidence": "CLOSED 2026-09-03. docs/planning/v2/RELIABILITY_SURFACE.json maps all 23, graded by the SAME checker as Phase 69's attack map rather than by a second copy -- the duplication this repo has paid for twice. One field differs: a reliability entry may cite a MECHANISM (a launchd KeepAlive key, an idempotency scheme) instead of a test, because several of these are handled by something that is not a test and pretending otherwise would be dishonest from the other side. A mechanism without a reason is refused, and the checker caught two of my own entries doing exactly that. Mutation-tested: dropping a scenario from the map fails by name, because the manifest's list lives in the checker."
    }
  ],
  "nextPhaseAllowed": true
}

## Interface and decisions
Produce `docs/planning/offline-roadmap-results/phase-68-packet.md` with the exact report interface from common.md. Treat gate evidence as historical claims until matched to source; absent installed access means not re-proven. Preserve entryRequiresPhase and entrySatisfied semantics.

## Tests and failure injection
Name the nearest existing suite and exact command from source. For the smallest missing seam specify an injectable failure (restart, stale revision, unavailable source, replay or denial as applicable), expected durable state and consumer-visible outcome. Native commands are reviewer-run proposals until registered.

## Exchange plan
Exchange 1: ### FILE the report skeleton at your assigned path: the six section headings, and in Requirement matrix one row per requirement id from this brief (status "to verify"). Exchanges 2 onward: SEARCH/READ two or three files, then ### EDIT the section that finding belongs to, in the same exchange. Never spend more than two exchanges in a row without an EDIT. The doc-report check runs after every write and names what is still missing; when it passes and every row is filled, ### DONE.

## Traps and reviewer
Do not copy historical Python paths as the new implementation owner. Distinguish missing code from missing normal-route proof. No automatic gate edits. Reviewer checks cited symbols exist at worktree baseline and proposed scopes cannot expand authority.
