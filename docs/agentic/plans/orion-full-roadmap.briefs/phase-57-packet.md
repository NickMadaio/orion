# Phase 57: Automation Framework

## Where you start
Snapshot at commit 9855d99 on 2026-09-26; recheck the worktree source. Existing implementation projects own this phase. Inspect source and identify integration/proof gates; do not propose a duplicate implementation.
READ docs/planning/v2/MANIFEST_PHASES.json, then locate live symbols with SEARCH.

## Requirement input
{
  "name": "Automation Framework",
  "status": "in_progress",
  "entryRequiresPhase": "56",
  "entrySatisfied": false,
  "openedOn": "2026-09-03",
  "openedAgainst": "Entered with entrySatisfied false. Phase 50 is open on its `resources` field and Phase 49 on the iPhone half, neither of which is code this phase depends on. Recorded as a deviation per AGENTS.md rather than asserted true.",
  "evidence": "plugin/orion-control/src/automation.ts, four ACTION_CATALOG entries under the `automation` tier, and scripts/orion-automation for the half Orion may not run. Covered by src/gate.test.ts and by scripts/orion_v2_strictness_check.sh.",
  "requirements": [
    {
      "id": "defines_automation_as_structured_rules",
      "status": "passed",
      "evidence": "An AutomationProposal carries all seven fields the manifest names -- trigger, conditions, action, permissions, expiration, riskLimits, failureBehavior -- and validateProposal returns EVERY problem at once rather than the first, because a model that fixes one field per round trip starts inventing fields by the seventh. The trigger is a closed set of shapes and never a raw cron string; the expression is derived at install time, since a minute-field typo is a factor of sixty."
    },
    {
      "id": "model_may_propose_automation",
      "status": "passed",
      "evidence": "`automation_propose` writes into automations/proposed, which nothing schedules from, and returns the simulation alongside the confirmation so the proposal arrives with its own cost attached. This is the half that did not exist: Orion could describe an automation in English and had nowhere to put it -- the same gap orion-skill was built to close."
    },
    {
      "id": "model_may_not_silently_install_permanent_automation",
      "status": "passed",
      "evidence": "Structural rather than incidental. It was ALREADY true by absence -- no action could write a LaunchAgent or crontab and `openclaw` is not allowlisted -- and absence holds only until somebody adds a wrapper for an unrelated reason. Now the automation tier has propose/list/simulate/withdraw and no install operation at all; installing is scripts/orion-automation, which is off the exec allowlist and in FORBIDDEN_SCRIPTS. Two live checks assert both halves: that the four operations are exactly those four, and that no action anywhere in the catalog mentions a scheduler."
    },
    {
      "id": "actions_are_drawn_from_a_closed_table",
      "status": "passed",
      "evidence": "Five entries, every one a command that already runs unattended on this machine and already knows how to stay quiet. An automation that could run an arbitrary command would be arbitrary execution on a timer, which is worse than arbitrary execution because nobody is watching."
    },
    {
      "id": "an_automation_ends_on_its_own",
      "status": "blocked",
      "evidence": "Source audit of scripts/orion-automation: scheduler receives a derived schedule and action command, without runtime expiry. Required proposal metadata is not proof of automatic stopping.",
      "reason": "expiresOn is validated but not enforced by the scheduled command. A bounded runtime runner and expiry execution proof are still required."
    }
  ],
  "nextPhaseAllowed": false,
  "postReviewCorrections": [
    {
      "on": "2026-09-04",
      "review": "Phases 49-80, oblivious",
      "note": "validateProposal used `in`, which walks the prototype chain, so constructor, toString, valueOf and __proto__ passed a check whose whole job is to say the table is closed. Not exploitable into execution \u2014 the installer throws on argv[0] \u2014 but a validator accepting what it advertises as impossible turns a clear refusal into a crash elsewhere. FIXED with Object.hasOwn; mutation-tested."
    },
    {
      "on": "2026-09-18",
      "review": "Independent automation audit and removal repair",
      "note": "Fixed swallowed scheduler errors and substring matching during removal. Require complete JSON listing, exact unique name, exact-ID removal and observed absence before changing local records. Eight failure/ambiguity tests run in CI. No real schedule modified. Expiration remains validation-only: installer does not enforce runtime expiry, conditions, risk limits or failure behavior. Phase remains open; PHASE_57_REMOVAL_2026-09-18.md."
    }
  ]
}

## Interface and decisions
Produce `docs/planning/offline-roadmap-results/phase-57-packet.md` with the exact report interface from common.md. Treat gate evidence as historical claims until matched to source; absent installed access means not re-proven. Preserve entryRequiresPhase and entrySatisfied semantics.

## Tests and failure injection
Name the nearest existing suite and exact command from source. For the smallest missing seam specify an injectable failure (restart, stale revision, unavailable source, replay or denial as applicable), expected durable state and consumer-visible outcome. Native commands are reviewer-run proposals until registered.

## Exchange plan
Exchange 1: ### FILE the report skeleton at your assigned path: the six section headings, and in Requirement matrix one row per requirement id from this brief (status "to verify"). Exchanges 2 onward: SEARCH/READ two or three files, then ### EDIT the section that finding belongs to, in the same exchange. Never spend more than two exchanges in a row without an EDIT. The doc-report check runs after every write and names what is still missing; when it passes and every row is filled, ### DONE.

## Traps and reviewer
Do not copy historical Python paths as the new implementation owner. Distinguish missing code from missing normal-route proof. No automatic gate edits. Reviewer checks cited symbols exist at worktree baseline and proposed scopes cannot expand authority.
