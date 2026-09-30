# Phase 60: Focus Sessions

## Where you start
Snapshot at commit 9855d99 on 2026-09-26; recheck the worktree source. Passed requirements on an open phase may need evidence/entry review only. Do not manufacture missing code.
READ docs/planning/v2/MANIFEST_PHASES.json, then locate live symbols with SEARCH.

## Requirement input
{
  "name": "Focus Sessions",
  "status": "in_progress",
  "entryRequiresPhase": "59",
  "entrySatisfied": false,
  "openedOn": "2026-09-03",
  "openedAgainst": "Entered with entrySatisfied false. Phase 50 is open on its `resources` field and Phase 49 on the iPhone half, neither of which is code this phase depends on. Recorded as a deviation per AGENTS.md rather than asserted true.",
  "evidence": "Surveyed 2026-09-03 against scripts/orion-focus (315 lines) and native/Orion/Sources/Orion/FocusSessionHome.swift (1192 lines), both live. Preparation added 2026-09-03; verified live against the real repository and calendar.",
  "requirements": [
    {
      "id": "creates_focus_sessions_connecting_task_and_mac_workspace",
      "status": "passed",
      "evidence": "`orion-focus start \"<task>\" <minutes> <app>...` binds a task to a set of allowed apps and enforces it every minute through a cron job that has been running for weeks. Two design choices in it are worth keeping on the record: it REFOCUSES rather than quitting the distracting app, which needs no Automation permission and risks no unsaved work; and the unlock is an argument with a sceptical local model rather than a button, because a timer you can cancel is a timer you will cancel."
    },
    {
      "id": "connects_a_calendar_block_and_notification_preferences",
      "status": "passed",
      "evidence": "CLOSED 2026-09-03. `orion-focus next` binds a session to the next calendar BLOCK -- its title becomes the task and its END becomes the deadline, not now-plus-sixty, because a session whose end time is a guess drifts away from the meeting it was meant to protect. That needed a machine-readable calendar, so `orion-agenda upcoming --json` was added: the wrapper already unpacked `events_json` internally and the human format carries only a start time. Still read-only, which is the contract that whole file is bound by. NOTIFICATIONS go through a named Shortcut ('Orion Focus On'/'Orion Focus Off') rather than a plist: macOS Focus modes have no public command-line API, and the private route is a key Apple has moved twice -- a Do Not Disturb that works until an OS update and then fails SILENTLY is the worst shape this feature can have. If the shortcut is absent the session starts anyway and says so, and `end` restores it, because a focus mode that switches on and never off is a worse bug than one that never switches on."
    },
    {
      "id": "orion_prepares_required_applications_files_and_project_context",
      "status": "passed",
      "evidence": "CLOSED 2026-09-03. `orion-focus start` now prepares before it speaks, and `orion-focus prepare` re-runs it on demand. Three things and only three, because 'prepare' is exactly where a focus tool turns into a workflow engine nobody asked for: APPLICATIONS via `open -a` (idempotent -- an app already running is raised, not relaunched -- and needing no permission the enforcement half did not already have); PROJECT via `git status` and `git log` against a repository named by KEY through Phase 51's closed table, which is why this was blocked until Phase 51 landed; CONTEXT via today's agenda, so a session that runs into a meeting says so before it starts. It reads and it opens -- no file is written, no setting changed, and the two git operations are the ones in the Phase 51 table that open no network connection. A calendar that cannot be read is reported as a blind spot rather than as an empty day, which is orion-standing's rule applied here."
    },
    {
      "id": "does_not_begin_work_on_the_mac_without_proper_permissions",
      "status": "passed",
      "evidence": "orion-focus needs no permission Nick has not already given, and its header says so and says why: `lsappinfo` reads the frontmost app with no TCC prompt, `open -a` raises a window, `say` speaks. The alternative design -- quitting apps -- would have needed Automation permission per target app, and was rejected partly for that reason."
    }
  ],
  "nextPhaseAllowed": true
}

## Interface and decisions
Produce `docs/planning/offline-roadmap-results/phase-60-packet.md` with the exact report interface from common.md. Treat gate evidence as historical claims until matched to source; absent installed access means not re-proven. Preserve entryRequiresPhase and entrySatisfied semantics.

## Tests and failure injection
Name the nearest existing suite and exact command from source. For the smallest missing seam specify an injectable failure (restart, stale revision, unavailable source, replay or denial as applicable), expected durable state and consumer-visible outcome. Native commands are reviewer-run proposals until registered.

## Exchange plan
Exchange 1: ### FILE the report skeleton at your assigned path: the six section headings, and in Requirement matrix one row per requirement id from this brief (status "to verify"). Exchanges 2 onward: SEARCH/READ two or three files, then ### EDIT the section that finding belongs to, in the same exchange. Never spend more than two exchanges in a row without an EDIT. The doc-report check runs after every write and names what is still missing; when it passes and every row is filled, ### DONE.

## Traps and reviewer
Do not copy historical Python paths as the new implementation owner. Distinguish missing code from missing normal-route proof. No automatic gate edits. Reviewer checks cited symbols exist at worktree baseline and proposed scopes cannot expand authority.
