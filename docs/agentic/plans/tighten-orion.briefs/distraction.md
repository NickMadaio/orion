# distraction — when phone use gets a nudge, and when it gets a lock

## Where you start
The phone can report screen time per category (social, video, games, other) in a recent window, and ORION already has a Focus lock it can engage. What is missing is the rule for WHEN. Mission: "stop doomscrolling", respect real breaks, be firmer late at night. You write `scripts/lib/life/distraction.mjs` and `tests/tighten-distraction.test.mjs`.

## Interface
```
export function decide(input)
  // input = {
  //   now: { minute },                                  // minute of day
  //   usage: { social: int, video: int, games: int, other: int },   // minutes in the last `windowMinutes`
  //   windowMinutes: int,                               // 30..120
  //   current: { kind, title, end } | null,             // the block on now, if any
  //   bedtime: int | null,                              // minute of day, 0..1439
  //   recentNudges: int,                                // nudges already sent in the last 60 min
  //   lockAllowed: boolean
  // }
  // -> { action: "none" | "nudge" | "lock", reason: string, minutes: int }   minutes = lock length (0 unless lock)
```
Throws TypeError for missing `now`, `usage` or `windowMinutes` outside 30..120.

## Decisions (first that applies)
1. `distracting` = social + video + games.
2. **Protected time** — current.kind is rest, meal or social: action none, reason "break" (breaks are protected, not leftovers).
3. **Late night** — bedtime set and now is at or after bedtime (handle bedtime before midnight and now after midnight: treat minutes < 300 as next day) and distracting ≥ 10: if recentNudges ≥ 2 and lockAllowed → lock 30, reason "past bedtime"; else nudge, reason "past bedtime".
4. **During work** — current.kind is class, study, deadline or side_project and distracting ≥ 15: recentNudges ≥ 2 and lockAllowed → lock 45 (or until current.end if sooner, minimum 15), reason "during <title>"; recentNudges < 2 → nudge "during <title>".
5. **Free time drift** — no current block and distracting ≥ 0.75 × windowMinutes: nudge, reason "long scroll" (never lock in free time).
6. Otherwise none, reason "ok".
- `recentNudges` ≥ 4 and rule 3 or 4 applies but lockAllowed is false → action nudge, reason ends " (lock not allowed)".

## Tests (titles exact)
1. `breaks are protected` — current rest, usage social 60 → none, "break".
2. `scrolling in a study block nudges first` — current study "Macro study", social 20, recentNudges 0 → nudge "during Macro study".
3. `third strike locks until the block ends` — same with recentNudges 2, lockAllowed, now 900, current.end 930 → lock, minutes 30.
4. `lock never shorter than 15` — current.end = now + 5 → lock minutes 15.
5. `past bedtime after midnight` — bedtime 1410, now 30, video 15, recentNudges 2, lockAllowed → lock 30 "past bedtime".
6. `no lock without permission` — case 5 with lockAllowed false → nudge.
7. `long free-time scroll nudges but never locks` — current null, social 50 of window 60, recentNudges 5, lockAllowed → nudge "long scroll".
8. `light use is fine` — study block, social 5 → none "ok".
9. `bad input throws` — windowMinutes 10 → TypeError.

## Exchange plan
FILE module + tests; EDIT rules in order; DONE.

## Traps
- Midnight: bedtime 1410 (11:30 PM) and now 30 (12:30 AM) is past bedtime.
- Lock length when the block ends soon: max(15, current.end − now), capped at 45.

## For the reviewer
Rule order is the behaviour; check each test against it.
