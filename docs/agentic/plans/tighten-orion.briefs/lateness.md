# lateness — how late Nick starts things, learned from check-ins

## Where you start
Every finished check-in appends one JSON line to a history file:
`{"at":"2026-09-29T19:26:29.314Z","what":"the problem set","kind":"study","plannedStart":1246,"actualStart":1226,"weekday":2}`
`plannedStart`/`actualStart` are minutes after midnight; `actualStart` is null when he never started; `weekday` is 0 (Sunday)…6. Today ORION can only say "not enough data". You write `scripts/lib/life/lateness.mjs` and `tests/tighten-lateness.test.mjs`. Do not read any file: callers pass the parsed records.

## Interface
```
export function lateness(records, { minSamples = 3 } = {})
  // -> {
  //   overall: Stat,
  //   byKind: { [kind]: Stat },
  //   byWeekday: { [0..6]: Stat },
  //   byBand: { morning: Stat, afternoon: Stat, evening: Stat, night: Stat },
  //   trend: "better" | "worse" | "steady" | null,
  //   sentence: string
  // }
// Stat = { samples, started, skipped, medianDelay: number|null, onTimeRate: number|null, confident: boolean }
export function delayOf(record)   // actualStart - plannedStart, wrapped into -720..720; null if not started
```
`records` must be an array (else TypeError); records missing `plannedStart` or `kind` are ignored.

## Decisions
- Delay wraps around midnight: planned 1430, actual 10 → +20; planned 10, actual 1430 → -20.
- `onTimeRate`: share of STARTED records with delay ≤ 5, rounded to 2 decimals. `medianDelay`: median of started delays, rounded to whole minutes; null when none started.
- `confident`: samples ≥ minSamples.
- Bands by plannedStart: morning 300–719, afternoon 720–1019, evening 1020–1319, night otherwise.
- `trend`: compare median delay of the most recent `minSamples` started records (by `at`) with the `minSamples` before them; null if fewer than 2×minSamples started. worse if newer − older ≥ 10, better if ≤ −10, else steady.
- `sentence` (for Nick, ≤ 160 chars):
  - not confident overall → "Only N check-in(s) so far — I'll know your pattern after 3." (singular when 1)
  - otherwise lead with the overall: "You usually start about X min late" (X = medianDelay rounded to 5; "on time" when |median| ≤ 5; "about X min early" when ≤ −10), then add the worst confident kind if its median is ≥ 15 min later than overall: ", worst with study (about 35 min)", then " — getting better." / " — slipping lately." when trend is better/worse. End with ".".

## Tests (titles exact)
1. `delay wraps around midnight` — the two wrap cases above.
2. `too few records says so` — one record → sentence "Only 1 check-in so far — I'll know your pattern after 3."
3. `overall median and on-time rate` — delays [0, 10, 30, 45] started + one skipped → medianDelay 20 (median of 4 = mean of middle two, rounded), onTimeRate 0.25, skipped 1.
4. `worst kind is named when clearly worse` — study delays [40,35,30], gym [0,5,0] → sentence mentions study.
5. `bands and weekdays` — records at 540 (morning) and 1200 (evening) land in the right bands; weekday 2 counted under key 2.
6. `trend detects slipping` — six started records ordered by `at`, older delays [0,0,5], newer [20,25,30] → trend "worse", sentence ends "— slipping lately."
7. `early starters are described as early` — delays [-15,-20,-12] → "about 15 min early".
8. `invalid input throws` — lateness("x") throws TypeError.

## Exchange plan
FILE module + tests; EDIT stats; EDIT sentence; DONE.

## Traps
- Median of an even count is the mean of the middle two, then rounded.
- Sort by `at` (ISO string compare is fine) before computing trend; do not mutate the input array.

## For the reviewer
The sentence wording is user-facing; check it character for character against the Decisions.
