# Phase 70: CI/CD Security

## Where you start
Snapshot at commit 9855d99 on 2026-09-26; recheck the worktree source. Passed requirements on an open phase may need evidence/entry review only. Do not manufacture missing code.
READ docs/planning/v2/MANIFEST_PHASES.json, then locate live symbols with SEARCH.

## Requirement input
{
  "name": "CI/CD Security",
  "status": "in_progress",
  "entryRequiresPhase": "69",
  "entrySatisfied": true,
  "openedOn": "2026-09-03",
  "openedAgainst": "Entered with entrySatisfied false. The phases behind this one are open on surfaces that do not exist -- an iOS app and a computer-use layer -- neither of which is code this phase depends on. Recorded as a deviation per AGENTS.md rather than asserted true.",
  "evidence": ".github/workflows/ci.yml and scripts/orion_v2_ci_check.sh, which run the same set so a green CI and a green local run mean the same thing.",
  "requirements": [
    {
      "id": "requires_ci_checks_for_the_nine_named_categories",
      "status": "passed",
      "evidence": "Eight of nine run, and the ninth does not apply. Unit and integration tests (vitest), security invariants (the adversarial suites, run FIRST so a failure ends the job before anything reports green), schema validation (manifest.test.ts, which holds openclaw.plugin.json against the runtime ConfigSchema -- they have drifted before), static analysis (tsc --noEmit), dependency scanning (npm audit, reported not fatal), secret scanning, and format/lint folded into the type checker since the repo configures no separate linter. MIGRATION VALIDATION has nothing to validate: there is no database and no schema migration anywhere in this system."
    },
    {
      "id": "secret_scanning_does_not_reimplement_what_exists",
      "status": "passed",
      "evidence": "The first version of this grew its own regex list and its own exclusions, and then failed on fourteen deliberately-fake credentials inside tests that assert credentials are REFUSED. Both fixes on the table were wrong -- widening an exclusion is fragile, and a second scanner is a second thing to keep in step. scripts/orion_v2_secret_scan.py was already here and is better: it allowlists by path + rule + FINGERPRINT, so a real key replacing a fake one in the same file still fires, and it prints only a fingerprint, so a finding cannot leak the thing it found into a CI log. It now runs over the worktree AND over full history, because a leak committed and reverted is still a leak that has to be rotated."
    },
    {
      "id": "failed_security_invariants_are_not_casually_overridden",
      "status": "passed",
      "evidence": "By ordering rather than by policy. The adversarial suite is the first step in both the workflow and the local script, and a failure exits immediately -- there is no run in which a security failure appears below a column of green ticks. `continue-on-error` is used exactly once, on the dependency audit, and the reason is written at the call site: a transitive advisory in a dev dependency should be visible without blocking an unrelated fix."
    },
    {
      "id": "makes_the_uncovered_surface_visible_rather_than_implied",
      "status": "passed",
      "evidence": "The five machine-bound suites cannot run on a runner -- they assert against the real exec allowlist, the installed plugin and the live permission state, which is what makes them worth having. So the workflow writes them into the job summary with what each holds and the line 'a green CI is not a green machine'. A CI pass that reads as total coverage is exactly how the suites that hold the real boundary stop being run."
    },
    {
      "id": "uses_protected_deployment_and_easy_rollback",
      "status": "passed",
      "evidence": "CLOSED 2026-09-03. `orion-deploy` replaces the `cp dist/*.js ...` I had typed by hand several times the same day. Seven steps, and the ORDER is the protection: refuse a dirty tree; build; run every suite including the five machine-bound ones a CI runner cannot, and stop there on any failure; snapshot what is installed NOW rather than what was built last; install; prove it still loads; roll back automatically if it does not. `--rollback` restores the last of five kept versions. Both halves were tested: a truncated catalog is caught by the leaf-import check, and a deleted dist is restored to the exact fingerprint. The load check itself was wrong first time -- importing index.js standalone fails on `openclaw`, which resolves from the gateway's module graph, so a healthy deploy was rolled back. A verification that fails on a healthy system is worse than none: it trains you to pass the flag that skips it. It now imports the leaf modules and then asks the GATEWAY, which is the only thing that answers the real question."
    }
  ],
  "nextPhaseAllowed": true
}

## Interface and decisions
Produce `docs/planning/offline-roadmap-results/phase-70-packet.md` with the exact report interface from common.md. Treat gate evidence as historical claims until matched to source; absent installed access means not re-proven. Preserve entryRequiresPhase and entrySatisfied semantics.

## Tests and failure injection
Name the nearest existing suite and exact command from source. For the smallest missing seam specify an injectable failure (restart, stale revision, unavailable source, replay or denial as applicable), expected durable state and consumer-visible outcome. Native commands are reviewer-run proposals until registered.

## Exchange plan
Exchange 1: ### FILE the report skeleton at your assigned path: the six section headings, and in Requirement matrix one row per requirement id from this brief (status "to verify"). Exchanges 2 onward: SEARCH/READ two or three files, then ### EDIT the section that finding belongs to, in the same exchange. Never spend more than two exchanges in a row without an EDIT. The doc-report check runs after every write and names what is still missing; when it passes and every row is filled, ### DONE.

## Traps and reviewer
Do not copy historical Python paths as the new implementation owner. Distinguish missing code from missing normal-route proof. No automatic gate edits. Reviewer checks cited symbols exist at worktree baseline and proposed scopes cannot expand authority.
