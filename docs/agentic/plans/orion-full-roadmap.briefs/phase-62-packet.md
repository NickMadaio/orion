# Phase 62: Waiting-On Tracking

## Where you start
Snapshot at commit 9855d99 on 2026-09-26; recheck the worktree source. Passed requirements on an open phase may need evidence/entry review only. Do not manufacture missing code.
READ docs/planning/v2/MANIFEST_PHASES.json, then locate live symbols with SEARCH.

## Requirement input
{
  "name": "Waiting-On Tracking",
  "status": "not_started",
  "entryRequiresPhase": "61",
  "entrySatisfied": true,
  "openedOn": "2026-09-03",
  "openedAgainst": "Entered with entrySatisfied false. The phases behind this one are open on surfaces that do not exist -- an iOS app and a computer-use layer -- neither of which is code this phase depends on. Recorded as a deviation per AGENTS.md rather than asserted true.",
  "evidence": "Surveyed 2026-09-03. Nothing tracks an outstanding request.",
  "requirements": [
    {
      "id": "tracks_user_initiated_requests_awaiting_responses",
      "status": "passed",
      "evidence": "CLOSED 2026-09-03. Six actions under the `waiting_on` tier over one JSON file Orion owns. Every item must name `expect` -- the observable event that ends it -- because 'waiting on the professor' is a feeling and 'waiting for a reply to my email of the 20th' is a thing that either happened or did not. That field is also what makes overdue mean something other than old: a thing asked for last week and expected next month is not overdue."
    },
    {
      "id": "surfaces_overdue_items",
      "status": "passed",
      "evidence": "CLOSED 2026-09-03. orion-standing reads the store on the MORNING pass only and reports what is past its own due date, unsnoozed, and under the surfacing cap. Morning only for the reason the location source already follows: `check` runs hourly, and an hourly 'you are still waiting on the professor' is exactly the nagging that gets a proactive assistant switched off. A corrupt store is a blind spot, never an empty list. Verified live end to end."
    },
    {
      "id": "allows_dismiss_remind_later_and_draft_follow_up",
      "status": "passed",
      "evidence": "CLOSED 2026-09-03, with the gate decision made explicitly rather than left implicit. `dismiss` and `snooze` are trivial. `draft` writes text ONTO THE RECORD and cannot deliver it: drafting is one step from sending, and messages_send sits at the third-party approval floor no strictness mode can lower, so turning a draft into a message goes through that gate exactly as if Orion had composed it fresh. A test asserts no action in the tier reaches a person. Surfacing is also capped at five: a daily reminder forever is one people learn to ignore along with the ones that matter, so it stays in the list and stops speaking, which is different from being deleted."
    }
  ],
  "nextPhaseAllowed": true,
  "postReviewCorrections": [
    {
      "on": "2026-09-04",
      "review": "Phases 49-80, oblivious",
      "note": "The claim that no waiting action reaches a person held, but it rested on the same unwired ladder as Phase 50. It now rests on the catalog instead: the test pins the six action names and greps their execution for send/message/mail, which was always the real enforcement."
    }
  ]
}

## Interface and decisions
Produce `docs/planning/offline-roadmap-results/phase-62-packet.md` with the exact report interface from common.md. Treat gate evidence as historical claims until matched to source; absent installed access means not re-proven. Preserve entryRequiresPhase and entrySatisfied semantics.

## Tests and failure injection
Name the nearest existing suite and exact command from source. For the smallest missing seam specify an injectable failure (restart, stale revision, unavailable source, replay or denial as applicable), expected durable state and consumer-visible outcome. Native commands are reviewer-run proposals until registered.

## Exchange plan
Exchange 1: ### FILE the report skeleton at your assigned path: the six section headings, and in Requirement matrix one row per requirement id from this brief (status "to verify"). Exchanges 2 onward: SEARCH/READ two or three files, then ### EDIT the section that finding belongs to, in the same exchange. Never spend more than two exchanges in a row without an EDIT. The doc-report check runs after every write and names what is still missing; when it passes and every row is filled, ### DONE.

## Traps and reviewer
Do not copy historical Python paths as the new implementation owner. Distinguish missing code from missing normal-route proof. No automatic gate edits. Reviewer checks cited symbols exist at worktree baseline and proposed scopes cannot expand authority.
