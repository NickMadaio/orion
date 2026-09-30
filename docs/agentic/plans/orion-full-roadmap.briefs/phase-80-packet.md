# Phase 80: Future Call Capability

## Where you start
Snapshot at commit 9855d99 on 2026-09-26; recheck the worktree source. Passed requirements on an open phase may need evidence/entry review only. Do not manufacture missing code.
READ docs/planning/v2/MANIFEST_PHASES.json, then locate live symbols with SEARCH.

## Requirement input
{
  "name": "Future Call Capability",
  "status": "in_progress",
  "entryRequiresPhase": "79",
  "entrySatisfied": false,
  "openedOn": "2026-09-04",
  "openedAgainst": "Entered with entrySatisfied false. Phases 65 and 66 are open on the app bundle's designated requirement, which is deliberately parked until Nick is at the keyboard, and neither is code this phase depends on. Recorded as a deviation per AGENTS.md rather than asserted true.",
  "evidence": "docs/planning/v2/CALL_POLICY.md (227 lines), plus the telephony patterns in scripts/orion_v2_deferred_check.py.",
  "requirements": [
    {
      "id": "defines_the_seven_items_before_implementation",
      "status": "passed",
      "evidence": "This phase is unusual: its deliverable IS the definition, and the manifest says so. All seven are answered with a rule and the reasoning behind it. DISCLOSURE is fixed text in source, not a config value or a prompt, because a model that composes its own disclosure will eventually compose a shorter one \u2014 and if it fails to play, the call ends rather than proceeding undisclosed. CONSENT reuses the Phase 49 approval gate and states that `sovereign` must not relax it. RECORDING is a flat no, because recording law depends on where each party is physically standing and a system that cannot determine the applicable law cannot lawfully record. IMPERSONATION is three separate prohibitions because they fail separately. ESCALATION ends the call on any confusion and keeps a do-not-call record. IDENTITY VERIFICATION refuses in BOTH directions \u2014 it will not prove it is Nick, which is the interaction a SIM-swap runs on, and it will not accept a claim from the other end, because a call is untrusted external content. SENSITIVE INFORMATION is an allowlist rather than a denylist, because a call is a conversation and a denylist is the wrong shape for one."
    },
    {
      "id": "does_not_bolt_calls_onto_gmail_permissions",
      "status": "passed",
      "evidence": "The document's structural conclusion, with the reasoning: a call is synchronous, has no draft state, makes the other party a participant rather than a recipient, and is the one channel where impersonation is the default failure. So a `calling` tier would be its own, at external_connected or above, listed explicitly rather than folded into anything \u2014 the same rule messages_send and self_modification already follow. Six preconditions are listed in order, and the sixth is an independent review, since this document was written by the same model that would build the feature."
    },
    {
      "id": "nothing_telephony_has_been_built",
      "status": "passed",
      "evidence": "Enforced rather than asserted: the Phase 76 deferral check fails if anything matching twilio, voip, answer_call, phone_call or sip_ appears in the action catalog, the wrapper scripts or the exec allowlist."
    }
  ],
  "nextPhaseAllowed": true
}

## Interface and decisions
Produce `docs/planning/offline-roadmap-results/phase-80-packet.md` with the exact report interface from common.md. Treat gate evidence as historical claims until matched to source; absent installed access means not re-proven. Preserve entryRequiresPhase and entrySatisfied semantics.

## Tests and failure injection
Name the nearest existing suite and exact command from source. For the smallest missing seam specify an injectable failure (restart, stale revision, unavailable source, replay or denial as applicable), expected durable state and consumer-visible outcome. Native commands are reviewer-run proposals until registered.

## Exchange plan
Exchange 1: ### FILE the report skeleton at your assigned path: the six section headings, and in Requirement matrix one row per requirement id from this brief (status "to verify"). Exchanges 2 onward: SEARCH/READ two or three files, then ### EDIT the section that finding belongs to, in the same exchange. Never spend more than two exchanges in a row without an EDIT. The doc-report check runs after every write and names what is still missing; when it passes and every row is filled, ### DONE.

## Traps and reviewer
Do not copy historical Python paths as the new implementation owner. Distinguish missing code from missing normal-route proof. No automatic gate edits. Reviewer checks cited symbols exist at worktree baseline and proposed scopes cannot expand authority.
