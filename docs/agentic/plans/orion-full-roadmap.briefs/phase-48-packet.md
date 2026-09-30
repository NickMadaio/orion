# Phase 48: Mac Privilege Separation

## Where you start
Snapshot at commit 9855d99 on 2026-09-26; recheck the worktree source. Passed requirements on an open phase may need evidence/entry review only. Do not manufacture missing code.
READ docs/planning/v2/MANIFEST_PHASES.json, then locate live symbols with SEARCH.

## Requirement input
{
  "name": "Mac Privilege Separation",
  "status": "in_progress",
  "entryRequiresPhase": "47",
  "entrySatisfied": true,
  "openedOn": "2026-09-02",
  "openedAgainst": "Entered with entrySatisfied false. The phase before it is open on requirements that are not code -- mobile cancellation needs a phone surface, and Phase 46's two other gaps change the capability surface and execution semantics respectively. Recorded as a deviation per AGENTS.md rather than asserted true.",
  "evidence": "Surveyed 2026-09-02. No worker/broker split exists. Recorded so the position is honest rather than left blank.",
  "requirements": [
    {
      "id": "splits_execution_into_user_worker_and_privileged_broker",
      "status": "blocked",
      "reason": "Not started. This is an architectural split, not a feature, and it should be designed before it is typed.",
      "evidence": "Not built as code, on purpose (2026-09-26). A broker running as the same macOS user adds no boundary: anything that can reach the worker can reach the broker. A real split needs OS isolation, either a second macOS user for the gateway or a sandbox-exec profile around it. Both are admin changes Nick must make. Options put to Nick."
    },
    {
      "id": "privileged_broker_exposes_only_a_tiny_explicit_interface",
      "status": "blocked",
      "reason": "Depends on the split above.",
      "evidence": "Depends on the broker split above; no broker exists yet (2026-09-26)."
    },
    {
      "id": "does_not_expose_run_arbitrary_root_command",
      "status": "passed",
      "evidence": "True today and worth recording as the one thing this phase already has. tools.elevated.enabled is false in openclaw.json, exec runs security=allowlist with askFallback=deny, and no allowlist entry is a shell or an interpreter -- 35 read-only utilities and a set of named wrapper scripts. There is no path to a root command because there is no path to an arbitrary command."
    },
    {
      "id": "keeps_privileged_code_minimal",
      "status": "blocked",
      "reason": "Depends on the split.",
      "evidence": "Depends on the broker split above (2026-09-26)."
    },
    {
      "id": "signs_and_hardens_executables",
      "status": "blocked",
      "reason": "Not started, and partly gated on the Apple Developer Program Nick has chosen to leave until last.",
      "evidence": "Deferred by Nick (2026-09-26: 'Build all but signing'). Needs the Apple Developer Program ($99/yr) for Developer ID signing and a hardened runtime."
    },
    {
      "id": "prevents_unauthorized_replacement_or_tampering",
      "status": "blocked",
      "reason": "Independent review (2026-09-26) showed the plugin half is not a prevention: the check runs inside the code it checks, so a replaced index.js or integrity.js skips it. Closing that needs the gateway to verify before loading, or code signing (deferred).",
      "evidence": "Built and deployed 2026-09-26. scripts/lib/orion-integrity.mjs records a SHA-256 manifest of every installed file in ~/.openclaw/orion-gate/integrity/ (a directory no ORION action can write), written only by the sanctioned installers (orion-deploy, orion-repair, the bridge installer). The Discord bridge is started by launchd through a verifier that refuses to run a changed copy and logs which file changed; the plugin checks itself at load and refuses orion_task_run, orion_tool_run and orion_permission_change if it has been altered. Live: 73 plugin files recorded, integrityProblem() null; bridge status 'unchanged'. Tests: integrity.test.ts, scripts/orion_v2_integrity_check.sh. Honest limit: a user-level attacker who can write the gate directory can rewrite the manifest; closing that needs code signing (signs_and_hardens_executables, deferred). Repaired 2026-09-26 after review: the manifest now covers the whole extension (package.json, openclaw.plugin.json, node_modules: 1,464 files), the installed copy fails closed with no manifest, deploy empties dist before copying, and deploy/repair never re-record a backup that did not verify. And ORION himself can no longer change any of it: every file action refuses paths under ~/Desktop/ORION, ~/.openclaw and ~/Library/LaunchAgents (protected-paths.ts), and terminal_run runs under a sandbox-exec profile denying writes there. The bridge half (launchd runs the verifier) stands."
    },
    {
      "id": "binds_destructive_authorization_to_the_requesting_turn",
      "status": "passed",
      "reason": "Not fixed. Found by an independent review of the failed conversation.",
      "evidence": "Built and deployed 2026-09-26. For actions whose target is a person's words (recipient, title, key, script, pluginFile), an irreversible or critical action must have its target named in the requesting turn or the confirmation just before it; briefings and app state are stripped first so a machine turn can never be 'the request' (fixed 2026-09-26 after review). Every other destructive action (file_delete, terminal_run, calendar_event_remove, screen control) needs a one-shot approval that now names the exact target -- the full command, the file path -- and one yes is spent atomically on one run of one step. Tests: validator requesting-turn tests; review-repairs.test.ts (C2, H4)."
    }
  ],
  "limitations": [
    "Nothing in this phase is built beyond the negative requirement, which was already true. Recorded rather than skipped."
  ],
  "nextPhaseAllowed": false
}

## Interface and decisions
Produce `docs/planning/offline-roadmap-results/phase-48-packet.md` with the exact report interface from common.md. Treat gate evidence as historical claims until matched to source; absent installed access means not re-proven. Preserve entryRequiresPhase and entrySatisfied semantics.

## Tests and failure injection
Name the nearest existing suite and exact command from source. For the smallest missing seam specify an injectable failure (restart, stale revision, unavailable source, replay or denial as applicable), expected durable state and consumer-visible outcome. Native commands are reviewer-run proposals until registered.

## Exchange plan
Exchange 1: ### FILE the report skeleton at your assigned path: the six section headings, and in Requirement matrix one row per requirement id from this brief (status "to verify"). Exchanges 2 onward: SEARCH/READ two or three files, then ### EDIT the section that finding belongs to, in the same exchange. Never spend more than two exchanges in a row without an EDIT. The doc-report check runs after every write and names what is still missing; when it passes and every row is filled, ### DONE.

## Traps and reviewer
Do not copy historical Python paths as the new implementation owner. Distinguish missing code from missing normal-route proof. No automatic gate edits. Reviewer checks cited symbols exist at worktree baseline and proposed scopes cannot expand authority.
