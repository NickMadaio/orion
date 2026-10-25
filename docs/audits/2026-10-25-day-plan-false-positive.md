# 2026-10-25 "only doing two things today" false positive

At 13:05 GMT (the UK clocks went back from BST to GMT at 02:00 that morning), Nick typed: "only doing two things today. Study for CS Midterm from
now until 6pm. then i go back home. once im home i work on marketing presentation until 12 am." ORION replied "Done: Study for CS Midterm is
now 300 minutes, 2:00 PM–7:00 PM; Go over Orion learning plan now 7:05 PM; DS Lab 05 now 8:10 PM; Gym now 9:00 PM. Not done: I couldn't make
that change." Almost none of that matched what he asked. Branch `fix/day-plan-false-positive`, worktree `ORION-worktrees/day-plan`, based on
origin/main 2eced76. The evidence files were only read, and every test uses fixtures with stubbed calendar writes.

## Evidence

- **Before** (`reschedule-undo.json`, entry 2026-10-25T13:05:37Z): Study for CS Midterm 14:00–15:00, Go over Orion learning plan 15:05–16:05,
  DS Lab 05 16:10–16:55 and Gym 17:00–18:30. Earlier that day there were also practice leetcode 10:30–11:30, finish resume 11:35–13:05 and
  AE1 Marketing Presentation 13:10–13:55. ORION created all of these blocks.
- **Routing row** (`shadow.jsonl`, last): the desk escalated to the deep tier. The flow ran `resize "Study for CS Midterm" 300` and
  `move "AE1 Marketing Presentation" --to 24:00`. The findings were `[["last change incomplete"]]`, with passes 0.
- **Transcript** (`13b97188-…`): the 9B was told "You already made this change. Reply … exactly", and it repeated the flow's line.
- **After**: Study 14:00–19:00 (pinned), the Orion plan at 19:05, DS Lab at 20:10, Gym 21:00–22:30, and Marketing still at 13:10–13:55.
  Nick's calendar was later fixed by hand (Study 13:10–18:00, Marketing 18:45–23:59, the other three blocks dropped). He confirmed that
  saying "only two things today" overrides the gym must for that day.

## Root causes

1. **Nothing read a whole-day plan.** `readIntent` returned `unparsed`, so the sentence went to the 9B form. The intent layer had no shape
   for "only X and Y today, X from now until T, then home, then Y until T2". The direct-add shape needs `put/add`, and the replan shape needs
   `reschedule … first`. Separately, the strict gate refuses "gonna" and "going to", which rules out his casual phrasing.
2. **The backstop only checked starts.** `time-backstop.ts` read only starts (`at/from/to`), and only for `add/move/day/now`. "until 6pm" is
   an end, and `resize` was never checked, so a write ending at 19:00 ran. DST was not involved. `clock` and `show --json` both use local
   time, the scheduler builds times from local wall-clock fields, and the form saw "Now: Sun 13:05". The worker used the block's old start
   because a `resize` keeps the start. The new tests run with TZ=Europe/London on 2026-10-25 and on a normal Sunday.
3. **No code path could express a midnight end.** `parseClock("midnight")` returned null, and `resolveEnd("12 am")` read it as after
   midnight. The scheduler's `minute()` rejected `24:00`, so even `move … --until 24:00` was refused. The worker wrote `--to 24:00` (a
   start), which got a `usage:` failure.
4. **A partial write reported "Done", and nothing replaced it.** `execute()` treated "resize wrote, then move failed" as `done` because a
   journal mark existed. `spokenReply` then built "Done: …; Not done: I couldn't make that change". In `local-routing.ts`, once a flow
   returns `done` (`flowActed`), its reply is final, and every finding-based replacement is skipped. That applies to typed and spoken turns
   alike: the spoken-only line from 69b4827 is also behind `!flowActed`. So the "last change incomplete" finding was logged and ignored.
   The cascade moves came from `resize` itself: the scheduler slides later blocks, and the flow read its lines back as part of "Done".
5. **"Only two things" was never honoured.** No code path removed ORION's other blocks, so a resize cascaded them into the evening, gym
   included.

## Fix (commits on the branch)

| Commit | What |
|---|---|
| 73272dd | `orion-reschedule`: an end of `24:00` is accepted for `move`/`extend --until` and for the planning window; a start of `24:00` still fails. `day --plan … --only` puts in exactly the plans he named and removes every other not-yet-started block whose source is `orion`, in the same undo step. |
| 378a85f | `intent-time`: an end of "12 am", "00:00" or "midnight" is 24:00 today. A bare "till 12" after noon also means midnight. |
| 649a864 | Backstop: `statedEnds` / `writtenEnds` / `endMismatch`. Each end he states belongs to the thing named in its own clause. Any write of that thing whose end can be computed (add, move, resize, extend, timed day --plan) must end at that time. This runs on every path that calls `timeMismatch`, which includes the worker's own exec, one command at a time. |
| 05b229a | `day-plan.ts` and the new `dayplan` intent, which runs before the desk. They parse the plan as: items in order; each ends at the time he said; the first starts now (or at the time he stated); the next starts after the previous one plus the 5-minute buffer, or plus `commuteMinutes` when he goes home. The gate is lenient: a statement of plan passes, while questions, hedges, take-backs, hearsay, past reports and other days are refused. Ownership: a class or a plan with people is never moved or removed, and he is told when one is in the way. The reply is written by code from the calendar read back after the change. It says "Done" only if every item is exactly as asked; otherwise it lists what he asked for, what is on the calendar, and "undo". In `execute()`, any failed call after an earlier write returns an honest partial summary (what changed, from the day diff; what did not; "undo"), never "Done". |
| c71ed4e | Fixes from the review: a bare "just" counts as a whole-day signal only when the message includes a trip home. Plans with people that ORION booked are never cleared. The backstop skips the end of something he says he is busy with ("I have lab until 4"). "till 12:45" at 12:10 means 12:45 PM. A block ending at "00:00" ends at midnight. |
| 0de93f3, script tests | Regressions: his exact sentence and three variants, on the DST day and on a normal day; 18 negatives; the backstop on the incident writes; the routing path with the outreach prefix; ownership; midnight. |

An independent review then blocked the branch. Its findings were fixed in 93b48e6, 48e2728, e518a6d, befc1eb and 5fea66f:

- **CRITICAL (whole-day signal):** a bare "only" or "just" no longer counts. Neither does someone else's day ("my friend / he / she is
  only doing…"), a negation ("not study"), or "I'd only be". Only his own explicit whole-day phrasing counts: "only doing N things
  (today)", "just these two today", "that's it for today". A title never starts with a pronoun, "not" or "only". The earlier variant
  "just gonna study till 6 then head home…" now goes to the normal path, and the backstop guards it there.
- **HIGH (worker exec path):** the worker's own exec is now checked against the day, read first through `readDayJson`. If he stated an
  end and the written end cannot be worked out, the write is refused. The incident's exact `resize "Study for CS Midterm" 300` is now
  blocked on that path.
- **HIGH (`--only`):** it is all or nothing. Any plan that cannot be booked exactly as stated gives `NOTHING WAS CHANGED` and nothing is
  cleared. An end he stated ("until 12 am") is booked even past the computed bedtime.
- **MEDIUM:**
  - An anchor that `--only` cleared is skipped for that day (`anchor-skips.json`); `fill --anchors` and `--fill` respect the skip.
  - `--only` is refused on any day but today.
  - A call that only partly fits opens with "Partly done", not-done part first.
  - The end check matches the block exactly (Study vs Study Lab).
- **LOW:**
  - A named block already under way keeps its start, and only its end is set.
  - The END_CLAUSE off-by-one ("hen") is fixed.
  - Any block over 12 hours is asked about, not booked.
  - "Done" is said only when every cleared block is gone, every plan is exact and no other block moved.

On his sentence, the change is now one call: `day --plan "Study for CS Midterm, 295, 13:05" --plan "AE1 Marketing Presentation, 315, 18:45" --only`.
The reply reads: "Done: Study for CS Midterm 1:05–6:00 PM, then home, then AE1 Marketing Presentation 6:45 PM–12:00 AM. I took Go over Orion
learning plan, DS Lab 05 off the rest of today. Gym is skipped today, since you said only these two things." Gym follows the decision he
confirmed: "only X and Y" skips it for that day, and he is told in one line rather than asked.

## Left as is

- `undo` of an `--only` change brings the cleared blocks back, but the day's anchor skip stays. After an undo, the gym is not auto-filled
  that day; he can still add it by name.
- `local-routing` still treats a flow's reply as final when `flowActed`. The fix makes that reply honest at its source rather than adding a
  second override in routing.
