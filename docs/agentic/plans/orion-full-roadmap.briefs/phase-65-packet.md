# Phase 65: App Intents and System Integration

## Where you start
Snapshot at commit 9855d99 on 2026-09-26; recheck the worktree source. Passed requirements on an open phase may need evidence/entry review only. Do not manufacture missing code.
READ docs/planning/v2/MANIFEST_PHASES.json, then locate live symbols with SEARCH.

## Requirement input
{
  "name": "App Intents and System Integration",
  "status": "not_started",
  "entryRequiresPhase": "64",
  "entrySatisfied": true,
  "openedOn": "2026-09-03",
  "openedAgainst": "Entered with entrySatisfied false. The phases behind this one are open on surfaces that do not exist -- an iOS app and a computer-use layer -- neither of which is code this phase depends on. Recorded as a deviation per AGENTS.md rather than asserted true.",
  "evidence": "Surveyed 2026-09-03 by grepping native/ for AppIntent, WidgetKit, ActivityKit and INIntent. Zero hits.",
  "requirements": [
    {
      "id": "do_not_build_before_underlying_actions_are_stable",
      "status": "passed",
      "evidence": "Honoured, and the manifest's own instruction. The six intents it names map onto actions that have only just stabilised -- 'Run approved automation' needed Phase 57, which landed yesterday, and 'Lock ORION' needed the strictness ladder. Building the intents first would have exposed a surface over a moving target."
    },
    {
      "id": "adds_ask_add_start_focus_whats_my_day_run_automation_and_lock",
      "status": "blocked",
      "evidence": "Still unbuilt, and the blocker is worth stating precisely rather than as 'needs Xcode'. Xcode 26.6 IS installed and the mobile package builds for the iOS simulator on every check run. What stops this is that adding a target changes the app bundle, and every TCC grant and every Keychain item on this machine is bound to the bundle's DESIGNATED REQUIREMENT -- which is what orion-identity-check exists to protect. Getting it wrong costs Nick his microphone grant, his accessibility grant and his Gmail refresh tokens, and leaves a second 'Orion' in Privacy & Security with no way to tell what happened. That is a change to make with him at the keyboard, not one to land unattended.",
      "reason": "Changing the app bundle risks the designated requirement, and with it every TCC grant and Keychain item. Not a change to land unattended."
    },
    {
      "id": "exposes_through_siri_shortcuts_widgets_and_control_center",
      "status": "blocked",
      "evidence": "None built. This is a Swift/Xcode surface rather than a logic one, and the identity constraint orion-identity-check exists for makes it more delicate than it looks: adding a target changes the bundle's designated requirement if done carelessly, and every TCC grant and Keychain item is bound to it.",
      "reason": "Needs Xcode project changes, under the designated-requirement constraint."
    }
  ],
  "nextPhaseAllowed": false
}

## Interface and decisions
Produce `docs/planning/offline-roadmap-results/phase-65-packet.md` with the exact report interface from common.md. Treat gate evidence as historical claims until matched to source; absent installed access means not re-proven. Preserve entryRequiresPhase and entrySatisfied semantics.

## Tests and failure injection
Name the nearest existing suite and exact command from source. For the smallest missing seam specify an injectable failure (restart, stale revision, unavailable source, replay or denial as applicable), expected durable state and consumer-visible outcome. Native commands are reviewer-run proposals until registered.

## Exchange plan
Exchange 1: ### FILE the report skeleton at your assigned path: the six section headings, and in Requirement matrix one row per requirement id from this brief (status "to verify"). Exchanges 2 onward: SEARCH/READ two or three files, then ### EDIT the section that finding belongs to, in the same exchange. Never spend more than two exchanges in a row without an EDIT. The doc-report check runs after every write and names what is still missing; when it passes and every row is filled, ### DONE.

## Traps and reviewer
Do not copy historical Python paths as the new implementation owner. Distinguish missing code from missing normal-route proof. No automatic gate edits. Reviewer checks cited symbols exist at worktree baseline and proposed scopes cannot expand authority.
