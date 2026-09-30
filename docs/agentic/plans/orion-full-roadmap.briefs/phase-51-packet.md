# Phase 51: Structured Terminal Operations

## Where you start
Snapshot at commit 9855d99 on 2026-09-26; recheck the worktree source. Passed requirements on an open phase may need evidence/entry review only. Do not manufacture missing code.
READ docs/planning/v2/MANIFEST_PHASES.json, then locate live symbols with SEARCH.

## Requirement input
{
  "name": "Structured Terminal Operations",
  "status": "in_progress",
  "entryRequiresPhase": "50",
  "entrySatisfied": true,
  "openedOn": "2026-09-03",
  "openedAgainst": "Entered with entrySatisfied false. Phase 50 is open on its `resources` field and Phase 49 on the iPhone half, neither of which is code this phase depends on. Recorded as a deviation per AGENTS.md rather than asserted true.",
  "evidence": "plugin/orion-control/src/devops.ts plus seven ACTION_CATALOG entries, covered by src/gate.test.ts and exercised against the real repository. Enabled live in openclaw.json.",
  "requirements": [
    {
      "id": "does_not_begin_with_raw_shell",
      "status": "passed",
      "evidence": "There are zero raw-shell execution kinds in ACTION_CATALOG -- verified by enumerating them, not by reading the list. The phase's opening instruction was already being violated by the exec layer rather than by the catalog: `git` is a bare name on the allowlist, which orion-authority has always reported honestly as an escape hatch, because one entry covers `git status` and `git push --force` alike."
    },
    {
      "id": "creates_structured_development_capabilities",
      "status": "passed",
      "evidence": "Seven: git_status, git_log, git_diff, git_pull, tests_run, build_run, package_install. The manifest's `package.install` is `npm ci` and nothing else -- installing exactly the committed lockfile, never a package named at call time. Its `script.run_allowlisted` is deliberately NOT built as a generic runner: a closed table of repositories crossed with a closed table of operations is the same idea without an argument anybody can widen."
    },
    {
      "id": "restricts_repository_working_directory_arguments_environment_time_and_output",
      "status": "passed",
      "evidence": "All six, by construction rather than by checking. REPOSITORY: named by key against a closed Map, so there is no path to traverse. WORKING DIRECTORY: the repo root, not an argument. ARGUMENTS: fixed argv; the only two inputs in the phase are a bounded integer and a boolean, appended to a constant prefix. ENVIRONMENT: built from an allowlist of five variables, so a token added to Nick's shell profile tomorrow is absent here today, and PATH is pinned rather than inherited. TIME: per operation, SIGKILL, because a runner that traps SIGTERM ignores a timeout. OUTPUT: capped and cut in the MIDDLE, because a failing suite prints its answer last."
    },
    {
      "id": "the_bare_git_allowlist_entry_is_retired",
      "status": "passed",
      "evidence": "Done live 2026-09-26 with Nick's approval. Removed main's {\"pattern\":\"git\"} from ~/.openclaw/exec-approvals.json (backup .pre-phase51-20260925-211108; the crestodian agent's list untouched). Git now goes only through the structured development capabilities. scripts/orion_v2_strictness_check.sh asserts the entry is absent (34/34).",
      "reason": "Removing an exec allowlist entry is Nick's call; recommended, not taken."
    }
  ],
  "decisions": [
    "The tier is `dev_operations`, listed by name at consequential_local rather than folded into EDIT_TIERS -- the same rule self_modification follows, because running a repository's build executes code out of that repository and must not arrive as a side effect of widening filesystem access.",
    "tests_run, build_run and package_install genuinely do execute repository code, and git_pull can bring in a hook. Recorded rather than argued away. It is not a new class of power -- orion-repair already built and tested before installing -- but it now carries a tier, a risk, a timeout and a ledger entry instead of arriving through an allowlist entry that cannot see its own arguments."
  ],
  "nextPhaseAllowed": true,
  "limitations": [
    "2026-09-26: every requirement passes; stays in_progress until 49 and 50 close in sequence."
  ]
}

## Interface and decisions
Produce `docs/planning/offline-roadmap-results/phase-51-packet.md` with the exact report interface from common.md. Treat gate evidence as historical claims until matched to source; absent installed access means not re-proven. Preserve entryRequiresPhase and entrySatisfied semantics.

## Tests and failure injection
Name the nearest existing suite and exact command from source. For the smallest missing seam specify an injectable failure (restart, stale revision, unavailable source, replay or denial as applicable), expected durable state and consumer-visible outcome. Native commands are reviewer-run proposals until registered.

## Exchange plan
Exchange 1: ### FILE the report skeleton at your assigned path: the six section headings, and in Requirement matrix one row per requirement id from this brief (status "to verify"). Exchanges 2 onward: SEARCH/READ two or three files, then ### EDIT the section that finding belongs to, in the same exchange. Never spend more than two exchanges in a row without an EDIT. The doc-report check runs after every write and names what is still missing; when it passes and every row is filled, ### DONE.

## Traps and reviewer
Do not copy historical Python paths as the new implementation owner. Distinguish missing code from missing normal-route proof. No automatic gate edits. Reviewer checks cited symbols exist at worktree baseline and proposed scopes cannot expand authority.
