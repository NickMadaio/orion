# Phase 52: Raw Terminal Access

## Where you start
Snapshot at commit 9855d99 on 2026-09-26; recheck the worktree source. Passed requirements on an open phase may need evidence/entry review only. Do not manufacture missing code.
READ docs/planning/v2/MANIFEST_PHASES.json, then locate live symbols with SEARCH.

## Requirement input
{
  "name": "Raw Terminal Access",
  "status": "in_progress",
  "entryRequiresPhase": "51",
  "entrySatisfied": true,
  "openedOn": "2026-09-03",
  "openedAgainst": "Entered with entrySatisfied false. Phase 50 is open on its `resources` field and Phase 49 on the iPhone half, neither of which is code this phase depends on. Recorded as a deviation per AGENTS.md rather than asserted true.",
  "evidence": "Surveyed 2026-09-03 by enumerating ACTION_CATALOG execution kinds and the exec policy, not by reading a list.",
  "requirements": [
    {
      "id": "keep_it_disabled_by_default",
      "status": "passed",
      "evidence": "Zero raw-shell actions exist, and the exec layer runs `security: allowlist`, `ask: off`, `askFallback: deny` -- an unlisted command is refused outright rather than prompted. Disabled by absence, which is the strongest form of disabled there is, and Phase 51 landing first is what makes keeping it that way practical rather than merely principled."
    },
    {
      "id": "only_after_structured_operations_are_proven_safe",
      "status": "passed",
      "evidence": "Phase 51 shipped first and is the whole basis for not needing this. 'Proven safe' is not yet claimable -- the structured operations are hours old -- so this stays open as a sequencing fact rather than a verdict."
    },
    {
      "id": "treat_raw_terminal_as_r5_with_session_visibility_faceid_duration_audit_and_cancellation",
      "status": "blocked",
      "evidence": "Built and deployed 2026-09-26, flag OFF. terminal_run is catalogued as tier raw_terminal, critical, irreversible, approval required, and R5 in orion/security/risk.py (never demoted). It runs through zsh -lc with a 2-minute limit and a 20KB output cap; it is audited in the task ledger; while running it appears in the Mac app's approvals panel with Stop, which kills its process group. Pending gate amendment: Nick decided (2026-09-25) that confirmation is in-app 'Allow once / Allow for this chat / Deny' (like ChatGPT and Claude) instead of Face ID. A chat grant is 8h and covers terminal_run only. The requirement's Face ID clause stays open until Nick either accepts the amendment or Phase 49's Face ID lands. enableRawTerminalActions defaults OFF. Repaired 2026-09-26 after independent review: the approval card and panel show the whole command and folder (they showed only 'terminal_run'); the command runs under sandbox-exec denying writes to the gate, the plugin, the repo and LaunchAgents, with a minimal environment and redacted output; a command copied from read content is refused; Stop kills it and it is never retried; chat approvals are capped at 8h from when they were given, must trace to a real grant, are withdrawn by 'orion-approve revoke-chat' and by orion-lock. Note: 'this chat' is ORION's one conversation, shared by the app, voice and Discord. Tests: review-repairs.test.ts (9), terminal.test.ts (5).",
      "reason": "Deliberately unbuilt. The phase's own instruction is to keep it disabled by default."
    }
  ],
  "nextPhaseAllowed": false,
  "pendingGateAmendment": {
    "raisedOn": "2026-09-26",
    "requirement": "treat_raw_terminal_as_r5_with_session_visibility_faceid_duration_audit_and_cancellation",
    "proposal": "Replace Face ID with in-app confirmation (Allow once / Allow for this chat / Deny) in the Mac approvals panel, recorded as <user>@app by scripts/orion-approve.",
    "decidedBy": "Nick, 2026-09-25: build it, but not as gated; UI or in-app confirmation like ChatGPT and Claude use.",
    "status": "awaiting Nick accepting it as the gate wording"
  }
}

## Interface and decisions
Produce `docs/planning/offline-roadmap-results/phase-52-packet.md` with the exact report interface from common.md. Treat gate evidence as historical claims until matched to source; absent installed access means not re-proven. Preserve entryRequiresPhase and entrySatisfied semantics.

## Tests and failure injection
Name the nearest existing suite and exact command from source. For the smallest missing seam specify an injectable failure (restart, stale revision, unavailable source, replay or denial as applicable), expected durable state and consumer-visible outcome. Native commands are reviewer-run proposals until registered.

## Exchange plan
Exchange 1: ### FILE the report skeleton at your assigned path: the six section headings, and in Requirement matrix one row per requirement id from this brief (status "to verify"). Exchanges 2 onward: SEARCH/READ two or three files, then ### EDIT the section that finding belongs to, in the same exchange. Never spend more than two exchanges in a row without an EDIT. The doc-report check runs after every write and names what is still missing; when it passes and every row is filled, ### DONE.

## Traps and reviewer
Do not copy historical Python paths as the new implementation owner. Distinguish missing code from missing normal-route proof. No automatic gate edits. Reviewer checks cited symbols exist at worktree baseline and proposed scopes cannot expand authority.
