# day-review — what was planned against what happened

## Where you start
ORION plans Nick's day (calendar blocks) and chases it (check-ins: started, done, snoozed, given up; to-dos ticked off). Nothing compares the two, so ORION cannot say in the evening "you did 3 of 5, study slipped twice, you started things 20 minutes late on average". You write `scripts/lib/life/day-review.mjs` and `tests/truthful-day-review.test.mjs`. Claude sends it as the evening message.

## Interface
```
export function reviewDay({ date, blocks, checkins, todosDone, now })
  // blocks: [{ title, kind, start, end, fixed, source }]  (minutes; source "orion" = planned by ORION)
  // checkins: [{ what, dueMinute, startedMinute|null, doneMinute|null, phase }]  phase: done|cancelled|given_up|snoozed|waiting
  // todosDone: [string]   now: { date, minute }
  // -> { planned, done, slipped: [title], lateMinutes: int|null, text: string }
```
## Decisions
1. Planned = ORION's own blocks (`source === "orion"`) that ended by `now`, excluding kinds `rest` and titles "Wind down"/"Break".
2. A block is done when a check-in whose `what` shares a 4+ letter word with its title (case-insensitive) is `done`, or a to-do in `todosDone` does.
3. Slipped = planned and not done.
4. lateMinutes = median of (startedMinute − dueMinute) over check-ins that started, rounded; null if none.
5. text (12-hour clock, no emoji, ≤ 280 chars): `Today: <done> of <planned> planned blocks done.` + (slipped ? ` Slipped: <up to 3 titles, comma-separated><, and N more>.` : "") + (lateMinutes >= 10 ? ` You started things about <lateMinutes> min late.` : "") + ` Tomorrow starts with <first fixed block title> at <clock>.` only when a `tomorrowFirst` option `{ title, minute }` is given.
6. No planned blocks → text `Nothing was planned today.` and planned 0.

## Tests (titles exact)
1. `counts done against planned` · 2. `a to-do ticked off counts as done` · 3. `slipped lists up to three` · 4. `lateness is the median start delay` · 5. `rest and wind down are not work` · 6. `nothing planned` · 7. `tomorrow line when given` · 8. `invalid input throws`
