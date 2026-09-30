# Phase 50: Delegated Policies

## Where you start
Snapshot at commit 9855d99 on 2026-09-26; recheck the worktree source. Passed requirements on an open phase may need evidence/entry review only. Do not manufacture missing code.
READ docs/planning/v2/MANIFEST_PHASES.json, then locate live symbols with SEARCH.

## Requirement input
{
  "name": "Delegated Policies",
  "status": "in_progress",
  "entryRequiresPhase": "49",
  "entrySatisfied": false,
  "openedOn": "2026-09-02",
  "openedAgainst": "Entered with entrySatisfied false. The phase before it is open on requirements that are not code -- mobile cancellation needs a phone surface, and Phase 46's two other gaps change the capability surface and execution semantics respectively. Recorded as a deviation per AGENTS.md rather than asserted true.",
  "evidence": "plugin/orion-control/src/{approvals,strictness}.ts and the gate in validator.ts, covered by src/gate.test.ts and src/index.test.ts (170 tests) and by scripts/orion_v2_strictness_check.sh (27 checks) against the live machine.",
  "requirements": [
    {
      "id": "allows_preauthorizing_narrowly_defined_capabilities",
      "status": "passed",
      "evidence": "CLOSED 2026-09-02. A delegation is a STRICTNESS MODE plus its exceptions, stored at ~/.openclaw/orion-gate/strictness.json and set by `orion-mode`. Four modes -- contained, guarded (default), open, sovereign -- and they are a real ladder rather than four names: 62/114/123/124 capabilities run unannounced and 82/15/15/6 still stop and ask. `guarded` is the identity, asserted against docs/planning/v2/GUARDED_BASELINE.json, a fixture pinned from commit 2cf0445 so that no closed phase's evidence is invalidated."
    },
    {
      "id": "every_delegation_defines_capabilities_resources_exceptions_limits_expiration_ceiling_and_devices",
      "status": "passed",
      "reason": "`resources` (per-path scoping) is unimplemented. The other six fields are stored and enforced.",
      "evidence": "Built and deployed 2026-09-26. Strictness modes (strictness.ts) now carry `resources`: the roots a relaxation covers. orion-mode --within <path> sets them; the validator's outsideScope rule raises any target outside those roots back to approval (targetOutsideResources). Together with the existing capabilities, exceptions, limits, expiry, the fixed floor as ceiling, and the device the mode was set from, every delegation defines all seven. Relaxing still needs owner re-authentication (Phase 43). Test: strictness-resources.test.ts; orion_v2_reauth_check.sh --within. Limit found by review 2026-09-26: resources are enforced for path-carrying file actions; fixed-root actions fail closed (count as outside); approval-gated self-modification asks regardless. orion-mode now treats dropping or widening --within, or --clear-never, as a relaxation needing the owner, and a same-mode scope change is written rather than answered 'Already' (orion_v2_reauth_check.sh, 12 checks)."
    },
    {
      "id": "requires_explicit_user_approval_to_create_or_expand_a_delegation",
      "status": "passed",
      "evidence": "CLOSED 2026-09-02, by the same argument that makes `orion-approve` work and no other: `orion-mode` is absent from the exec allowlist (so the call is denied, not prompted), is in FORBIDDEN_SCRIPTS (so the repair engine will not edit it), writes a path no mutable root covers, and its config key is in FORBIDDEN_CONFIG (so it cannot be redirected). Running it IS the authorization. Expanding additionally needs `--yes`, and an open-ended relaxation needs `--until-changed` said out loud -- friction placed on the choice that deserves it. Tightening never needs either, because that is the one direction Orion may take alone. 2026-09-26: review found two ways round it, both repaired: orion-mode could widen scope without the owner (M3), and ORION could rewrite the scripts that grant approval via an unapproved Desktop write (C1, now refused by protected-paths.ts)."
    }
  ],
  "limitations": [
    "Phase 42 deliberately built the Delegation vocabulary early, and its gate recorded at the time that nothing produced one. That is still true and is this phase's whole scope.",
    "This phase is where the manifest itself would narrow the full remote authority Nick chose on 2026-09-02 -- preauthorised narrow capabilities are the alternative to all-or-nothing. Worth reading together with scopeNotInManifest's remote_conversation_with_the_brain entry.",
    "2026-09-26: every requirement passes, but the phase stays in_progress, not closed: Phase 49 (its predecessor) is not complete, so 50's own entry is unsatisfied. Close it after 49."
  ],
  "nextPhaseAllowed": true,
  "postReviewCorrections": [
    {
      "on": "2026-09-04",
      "review": "Phases 49-80, oblivious",
      "note": "The ladder was a DESCRIPTION, not a gate. strictness.ts reached only a status readout and orion-authority's documentation; validator.ts had never seen a mode. The numbers in the mode summaries were computed for display and were also stale. FIXED: baseLevelFor moved into the plugin (removing orion-authority's duplicate ladder rather than adding one), ValidationOptions gained a strictness field, and the mode is threaded through runAuthorizedGraph and the controller into the authoritative validation. `contained` now refuses a non-read action without a grant, verified against the installed plugin. The summaries are corrected too: a mode raises to APPROVAL and never lowers from it, because a validator can refuse and cannot make a model narrate \u2014 what `open` and `sovereign` free is announcement, not gates."
    }
  ]
}

## Interface and decisions
Produce `docs/planning/offline-roadmap-results/phase-50-packet.md` with the exact report interface from common.md. Treat gate evidence as historical claims until matched to source; absent installed access means not re-proven. Preserve entryRequiresPhase and entrySatisfied semantics.

## Tests and failure injection
Name the nearest existing suite and exact command from source. For the smallest missing seam specify an injectable failure (restart, stale revision, unavailable source, replay or denial as applicable), expected durable state and consumer-visible outcome. Native commands are reviewer-run proposals until registered.

## Exchange plan
Exchange 1: ### FILE the report skeleton at your assigned path: the six section headings, and in Requirement matrix one row per requirement id from this brief (status "to verify"). Exchanges 2 onward: SEARCH/READ two or three files, then ### EDIT the section that finding belongs to, in the same exchange. Never spend more than two exchanges in a row without an EDIT. The doc-report check runs after every write and names what is still missing; when it passes and every row is filled, ### DONE.

## Traps and reviewer
Do not copy historical Python paths as the new implementation owner. Distinguish missing code from missing normal-route proof. No automatic gate edits. Reviewer checks cited symbols exist at worktree baseline and proposed scopes cannot expand authority.
