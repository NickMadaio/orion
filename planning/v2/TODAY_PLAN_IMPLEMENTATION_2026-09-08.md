# ORION Today/Plan implementation — 8 September 2026

Built a first usable Mac planning slice from the product vision. Today now has a source path from the existing calendar and Orion Reminders readers to an explicit timeline, a reviewable proposal, an accepted local plan, completion, replanning and undo. This is a reviewed source checkpoint, not an installed release or completion of the full vision.

## What changed and why

The old planner allocated a number of minutes without choosing real calendar slots. The new MobileCore scheduler uses actual gaps between commitments, protects transition buffers and the chosen off-hours, reserves free time before selecting tasks, and leaves work deferred when its full estimate or deadline cannot fit. Equal-priority tasks use deadline order. Overlapping calendar commitments remain intact and are called out. All-day entries are visible context; unavailable hours must be represented as timed calendar blocks. Estimates are editable starting assumptions, not claimed learned preferences.

Home's Today surface shows the current block, next calendar commitment and remaining free time. Quick Open and the composer remain available; the existing morning brief can still appear first. Expanded blocks expose Finish block and 15 more minutes. Running late recomputes from now using the remaining unfinished task estimates. Each operation first creates a preview. The change summary includes moved, removed/deferred and newly scheduled work. Accept applies the local revision; Undo restores the preceding snapshot, including its completion state.

The source adapter fetches today's actual interval, independently of whichever week the Calendar tab is displaying. Recurring occurrences remain distinct. Date-only reminder deadlines mean the end of their civil day. A failed Reminders fetch retains the previous reading and marks it unavailable. Calendar/task evidence expires after ten minutes; a preview expires after one minute. Changed sources invalidate previews and suppress current advice from stale accepted plans. Elapsed free time is removed from the displayed remainder.

The accepted snapshot, previous snapshot and operation receipts live in one versioned file owned by SessionService. Writes compare the expected revision, use a process lock, and atomically replace an owner-only file. Duplicate operations recover their receipt; reuse with different content is refused. A competing writer cannot silently replace newer work, and the app reloads the winning revision so the user can review again. Unreadable/corrupt state is preserved rather than treated as a new empty plan.

## Decisions and boundaries

- Reused the existing Swift/MobileCore planner and Apple readers. No second planner service or new provider was introduced.
- Finish block records completion in this local plan. The source reminder is unchanged; its existing Tasks controls manage that record. Combining external reminder writes with local undo would need a separate reconciliation design.
- Calendar commitments are never moved by this path. Preview and undo do not claim to undo external calendar edits.
- One saved revision includes its undo, avoiding a crash window between two separate files. A kernel lock releases on process exit and cannot be stolen merely because a live operation ran slowly.
- Preferences and accepted plans persist locally. This slice does not synchronize to the phone or backend.

## Independent review and repairs

A separate reviewer inspected source requirements and the implementation, then independently reran the repaired tests. The review found four concrete issues: stale accepted advice after source changes, free-time totals including elapsed blocks, equal-priority deadline ordering that unnecessarily deferred feasible work, and omitted newly scheduled tasks in revision summaries. All four were repaired. NEXT was also clarified to mean the next calendar commitment. The final review reported no unresolved actionable findings within this scope.

## Proof obtained

| Check | Result and scope |
| --- | --- |
| Full native app build and test wrapper | 437 XCTest cases pass, including 26 new planner/store tests and nine actual app-model/adapter/view tests. |
| Existing connection checks | 26 health checks, nine real loopback transport cases and five menu-update checks pass. |
| Independent verification | Reviewer separately ran all 35 TodayPlan cases and repeated the original deadline reproduction; both tasks now fit on time. |
| Shared code portability | MobileCore: 693 checks pass; compilation for iOS Simulator passes. This is no claim of an iPhone application. |
| Mutation checks | Baseline passes; six deliberate defects are caught: stale overwrite, duplicate accept, mismatched replay, lost undo, lost free-time reserve and deadline ordering. Copies of source are changed; the app tree is untouched. |
| Actual app model | Preview does not write; accept saves; completion revises; a fresh model reloads the saved state; undo restores it. Stale sources/previews, changed preferences and competing revisions are exercised using temporary storage. |
| Visual check | The production TodayPlanView rendered successfully and was visually inspected. It uses clearly identified synthetic seminar/task inputs in the test harness; it is not a screenshot of Nick's live day. |
| Secrets and working tree | Source/history scan clean with the existing allowlist. The pre-existing planning/learning-proposals.md edit is excluded. |

Reproduction: run `native/Orion/Tests/run-domain-test.sh`, `scripts/orion_v2_mobile_check.sh`, and `python3 native/Orion/Tests/TodayPlanHarness/mutations.py`. To render the actual view, set `ORION_TODAY_RENDER_DIR` to an existing output directory when running the native wrapper. Runtime data is not used by these new tests.

## Not yet proven and next gate

Installed build 217 remains in /Applications. The changed app has not been installed or exercised against Nick's real EventKit data through a normal user session. The offscreen view and actual-model tests do not establish live permissions, calendar freshness under real sync delays, or a complete installed restart flow. No gateway restart, permission change, external task/calendar mutation, credential access, billing setup or push occurred.

Task pinning is still absent, so delivery-plan step 2 remains partial. Also outstanding are calibrated estimates tied to actual work, richer task duration handling, overnight/custom shift schedules, and health-informed planning. The greedy selector preserves explicit priority and constraints; it does not claim a globally optimal schedule. A saved plan covers one civil day; Undo is one level. All-day events do not automatically reserve the entire day.

Next implement explicit pinned task slots with conflict/refusal behavior, then prepare and verify an identity-preserving candidate release. The installed acceptance pass must use the real Calendar and Orion Reminders routes: preview, accept, restart, early finish, running late/missed gym, more time, undo, source changes and permission loss. Preserve bedtime and pinned slots; surface conflicts instead of silently moving them. Only after that evidence should the Mac portion of the recovery work be called delivered. REC-USABLE-CLIENT still additionally requires the phone/client and durable bridge work; no numbered phase or recovery gate is closed here.

## Checkpoint and rollback

All implementation files, tests and this report are checkpointed locally after independent review. Logs and a scoped patch are retained at `.builds/today-plan-2026-09-08/`. The existing `planning/learning-proposals.md` change remains outside the checkpoint. Remote backup has not been claimed.

Nothing installed needs rolling back. To withdraw this source slice, apply a reviewed inverse of its scoped commit on the current branch; do not reset the mixed tree. Test files use temporary storage and never create the production `~/.openclaw/orion-controlled/today-plan.json`. A future installed version must preserve that file when rolling back code.
