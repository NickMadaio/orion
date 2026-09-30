# Phase 67: Cost Controls

## Where you start
Snapshot at commit 9855d99 on 2026-09-26; recheck the worktree source. Passed requirements on an open phase may need evidence/entry review only. Do not manufacture missing code.
READ docs/planning/v2/MANIFEST_PHASES.json, then locate live symbols with SEARCH.

## Requirement input
{
  "name": "Cost Controls",
  "status": "in_progress",
  "entryRequiresPhase": "66",
  "entrySatisfied": false,
  "openedOn": "2026-09-03",
  "openedAgainst": "Entered with entrySatisfied false. The phases behind this one are open on surfaces that do not exist -- an iOS app and a computer-use layer -- neither of which is code this phase depends on. Recorded as a deviation per AGENTS.md rather than asserted true.",
  "evidence": "scripts/orion-budget, reading the usage records OpenClaw already writes into ~/.openclaw/agents/main/sessions/*.jsonl. Verified against real history.",
  "requirements": [
    {
      "id": "tracks_tokens_model_calls_tool_calls_duration_and_estimated_cost",
      "status": "passed",
      "evidence": "CLOSED 2026-09-03, and the earlier record was wrong. I wrote that tool calls and duration were 'absent from the usage records', which was reading one file and concluding about two: both are in the task ledger. `orion-budget --tasks` reads it -- tool calls are a count of step ATTEMPTS (a step that retried twice is three calls) and duration is a subtraction. Tokens and model calls come from the gateway's usage records as before. Estimated cost stays deliberately blank and labelled: the gateway records 0 on every call because these are billed through a subscription, so the rate table ships at zero rather than with prices invented here."
    },
    {
      "id": "establishes_per_task_automation_daily_and_remote_session_budgets",
      "status": "passed",
      "evidence": "CLOSED 2026-09-03. All four now exist. Daily, automation and remote-session ceilings were already there; PER-TASK is now real in the two dimensions the ledger can measure exactly -- tool calls and seconds -- and both feed `--check`, so cron catches a single runaway run and not only a runaway day. A loop that burns its budget inside one task never shows up in a daily total until the day is over. Per-task TOKENS remain an estimate by time window and are labelled one wherever they appear: the usage log carries no task id, so a call during a run was not necessarily for it and two overlapping runs both claim the same calls. A pointer, not an invoice."
    },
    {
      "id": "stops_runaway_agent_loops",
      "status": "passed",
      "evidence": "Already handled, and in a better place than a budget: the plugin refuses a third identical tool call inside one run and resets at run end, which is tested. The budget is the backstop for the case that gets past it -- many DIFFERENT calls, which look like progress until you count them."
    },
    {
      "id": "alerts_on_abnormal_spending",
      "status": "passed",
      "evidence": "`orion-budget --check` prints nothing and exits 0 when everything is under the ceilings, and prints one line per breach and exits 1 when not. Silence as the normal outcome is what lets it go into cron without becoming the car alarm orion-cron-deliver exists to prevent."
    },
    {
      "id": "uses_smaller_cheaper_models_for_appropriate_work",
      "status": "passed",
      "evidence": "Already true and now measurable rather than assumed. Across the sessions on disk: 725 calls to Haiku 4.5, 109 to a local llama3.2:3b, 23 to a local qwen3.6:27b. The local models do the work that does not need a frontier model -- orion-focus's unlock argument and orion-standing's --polish -- and orion-budget reports the split so a drift toward the expensive path is visible."
    }
  ],
  "nextPhaseAllowed": true,
  "postReviewCorrections": [
    {
      "on": "2026-09-04",
      "review": "Phases 49-80, oblivious",
      "note": "The model counts were pinned and are stale \u2014 orion-budget today reports more Haiku and llama calls than the evidence names, and an unmentioned 18 gpt-oss:20b. The mechanism works; the numbers were a snapshot written as a fact. Counts in evidence should be dated or derived, not pinned."
    }
  ]
}

## Interface and decisions
Produce `docs/planning/offline-roadmap-results/phase-67-packet.md` with the exact report interface from common.md. Treat gate evidence as historical claims until matched to source; absent installed access means not re-proven. Preserve entryRequiresPhase and entrySatisfied semantics.

## Tests and failure injection
Name the nearest existing suite and exact command from source. For the smallest missing seam specify an injectable failure (restart, stale revision, unavailable source, replay or denial as applicable), expected durable state and consumer-visible outcome. Native commands are reviewer-run proposals until registered.

## Exchange plan
Exchange 1: ### FILE the report skeleton at your assigned path: the six section headings, and in Requirement matrix one row per requirement id from this brief (status "to verify"). Exchanges 2 onward: SEARCH/READ two or three files, then ### EDIT the section that finding belongs to, in the same exchange. Never spend more than two exchanges in a row without an EDIT. The doc-report check runs after every write and names what is still missing; when it passes and every row is filled, ### DONE.

## Traps and reviewer
Do not copy historical Python paths as the new implementation owner. Distinguish missing code from missing normal-route proof. No automatic gate edits. Reviewer checks cited symbols exist at worktree baseline and proposed scopes cannot expand authority.
