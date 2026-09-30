# life-template-daily

## Interface
`export function dailyNeeds(blocks, config) -> { met: string[], missing: { need: string, minutes: number }[] }`

config (defaults when a field is absent):
```
{ "sideProjectMinutes": 60, "gymDays": [1,3,5], "gymMinutes": 60, "restMinutes": 30,
  "weekday": 1 }
```
Needs, in this order: "side_project" (sum of side_project minutes >= sideProjectMinutes), "gym" (only when weekday is in gymDays: sum of gym minutes >= gymMinutes), "rest" (sum of rest minutes >= restMinutes), "meals" (at least 2 meal blocks).
missing[].minutes = how many minutes short (for meals: 30 per missing meal).

## Tests (tests/life-daily-needs.test.mjs)
1. "a full day meets everything" 2. "no side project is 60 minutes short" 3. "gym only counts on gym days" — weekday 2 with no gym → gym not missing. 4. "partial side project reports the shortfall" — 40 min → 20 short. 5. "one meal is one meal short" 6. "defaults apply when config is empty".

## Exchange plan
FILE both in exchange 1; DONE when green.

## For the reviewer
Check every Decisions rule has a test.
