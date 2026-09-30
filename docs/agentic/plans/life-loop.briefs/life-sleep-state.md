# life-sleep-state

## Interface
`export function sleepState({ now, bedtime, wake, lastActiveMinutesAgo, charging }) -> { state, minutesPastBedtime, reason }`
All times are minutes on a 24h clock; bedtime may be after midnight (e.g. 30 = 00:30) and wake e.g. 480. `now` too. Treat the night as the span from bedtime to wake crossing midnight when needed.

## Decisions
- If now is outside the night span → state "day".
- Inside the span: lastActiveMinutesAgo <= 5 → "awake_late"; lastActiveMinutesAgo >= 20 and (charging === true or charging === undefined) → "probably_asleep"; otherwise "winding_down".
- lastActiveMinutesAgo null/undefined → "unknown" (never assume asleep).
- minutesPastBedtime: minutes since bedtime within the span, else 0.
- reason: a short English sentence naming the signal used.

## Tests (tests/life-sleep-state.test.mjs)
bedtime 0 (midnight), wake 480.
1. "midday is day" 2. "using the phone at 3am is awake late" — now 180, active 1 → awake_late, minutesPastBedtime 180. 3. "quiet and charging is probably asleep" 4. "no activity signal is unknown" 5. "a bedtime before midnight spans midnight" — bedtime 1380, now 60 → inside, 120 past. 6. "just after wake is day".

## Exchange plan
FILE both in exchange 1; DONE when green.

## For the reviewer
Check every Decisions rule has a test.
