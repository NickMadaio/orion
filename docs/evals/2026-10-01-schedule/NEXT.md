# Schedule evaluation — what to fix next (2026-10-01)

Run: `docs/evals/2026-10-01-schedule/run.sh` (results + SUMMARY.txt here). Thinking-off
baseline: Haiku 6/16, Sonnet 5 8/16. Both failed the same scenarios, so the work is
mostly in the tools and the grader:

1. **Pins.** A time he sets (`move --to`, `extend`, `swap`, `--then`, `now`) must stay put
   when a later command cascades. Two changes in one message: dinner set to 20:00, then
   the nap resize pushed it to 20:18. Store pinned calendar ids per date in
   `orion-controlled/[eval-]pins.json`; feed pinned blocks to `replan` as fixed.
2. **rename onto an existing block** ("replace apply somewhere with the YouTube project"):
   move the existing YouTube block into that slot instead of creating a duplicate.
3. **Minimum saved → apply today.** After `setMinimum`, resize today's future blocks
   below it (new `orion-reschedule minimums`; orion-remote runs it after saving).
4. **`move "X" --by 30` / `--by -15`** for "push X back half an hour".
5. **"Still in the lab, 30 more minutes" → `extend`**, not `orion-checkin` (Haiku did this).
6. **One run exited 1 instantly with no reply** (first scenario, Haiku): reproduce with
   `--only extend-lab-nap-after-swap-youtube`.
7. **Grader**: a block that no longer fits is fine if the reply names it and asks; give
   the base day some slack. Nick's added criteria: breaks well placed (not stacked, not
   right after waking), a nap placed sensibly when he slept badly, sequential things in
   order, and dinner-type blocks kept in their natural time (never pulled into the afternoon).
8. Then choose the default brain from SUMMARY.txt (pass rate and median seconds), local
   first when it passes; API when he is on his phone with the Mac off or needs it fast.
