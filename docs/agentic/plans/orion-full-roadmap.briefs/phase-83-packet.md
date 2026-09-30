# Phase 83: Multi-User Hardening

## Where you start
Snapshot at commit 9855d99 on 2026-09-26; recheck the worktree source. Passed requirements on an open phase may need evidence/entry review only. Do not manufacture missing code.
READ docs/planning/v2/MANIFEST_PHASES.json, then locate live symbols with SEARCH.

## Requirement input
{
  "name": "Multi-User Hardening",
  "status": "not_started",
  "entryRequiresPhase": "82",
  "entrySatisfied": false,
  "openedOn": "2026-09-04",
  "openedAgainst": "Entered with entrySatisfied false. Phase 80's neighbours are open on an iOS app and on an independent review, neither of which is code this phase depends on. Recorded as a deviation per AGENTS.md rather than asserted true.",
  "evidence": "Surveyed 2026-09-04. Single tenant; most of this is unbuildable and one part is verifiable now.",
  "requirements": [
    {
      "id": "does_not_rely_on_uuid_secrecy",
      "status": "passed",
      "evidence": "Verifiable today and verified. Nothing in this system authorizes on an identifier being unguessable. An approval ticket id is FOUR characters and deliberately so \u2014 it is meant to be read aloud \u2014 and it grants nothing on its own: a grant additionally requires a 128-bit nonce that appears only in the ticket file, a matching canonical hash, a matching device id, an unexpired window, and a grantedBy that is not the local process. Guessing the id gets an attacker nothing, which is the property this rule is asking for."
    },
    {
      "id": "enforces_tenant_isolation_and_object_level_authorization",
      "status": "blocked",
      "evidence": "There is one tenant and no object-level ownership model to enforce. Building isolation before a second identity exists produces isolation that has never separated anything.",
      "reason": "Single tenant. No second identity exists to isolate from."
    },
    {
      "id": "adds_rate_limits_quotas_and_abuse_controls",
      "status": "blocked",
      "evidence": "Partly present for a different reason and worth recording: orion-remote has a per-window RATE_CAP, the plugin refuses a third identical tool call in one run, and Phase 67's budgets cap tokens, model calls, tool calls and duration per day and per task. Those are runaway controls, not abuse controls \u2014 they bound one trusted user's accidents, not an adversary's deliberate load.",
      "reason": "Runaway controls exist; abuse controls presuppose an untrusted user, and there is not one."
    },
    {
      "id": "isolates_jobs_connectors_memories_and_encryption_context",
      "status": "blocked",
      "evidence": "Nothing is isolated because nothing is shared with anyone. The one piece that would survive into a multi-user world is the capability tier system: tiers are a closed enum and profiles are intersections, so per-user profiles are the natural shape when there is a second user.",
      "reason": "Single user. Isolation has nothing to isolate."
    }
  ],
  "nextPhaseAllowed": false
}

## Interface and decisions
Produce `docs/planning/offline-roadmap-results/phase-83-packet.md` with the exact report interface from common.md. Treat gate evidence as historical claims until matched to source; absent installed access means not re-proven. Preserve entryRequiresPhase and entrySatisfied semantics.

## Tests and failure injection
Name the nearest existing suite and exact command from source. For the smallest missing seam specify an injectable failure (restart, stale revision, unavailable source, replay or denial as applicable), expected durable state and consumer-visible outcome. Native commands are reviewer-run proposals until registered.

## Exchange plan
Exchange 1: ### FILE the report skeleton at your assigned path: the six section headings, and in Requirement matrix one row per requirement id from this brief (status "to verify"). Exchanges 2 onward: SEARCH/READ two or three files, then ### EDIT the section that finding belongs to, in the same exchange. Never spend more than two exchanges in a row without an EDIT. The doc-report check runs after every write and names what is still missing; when it passes and every row is filled, ### DONE.

## Traps and reviewer
Do not copy historical Python paths as the new implementation owner. Distinguish missing code from missing normal-route proof. No automatic gate edits. Reviewer checks cited symbols exist at worktree baseline and proposed scopes cannot expand authority.
