# life-patterns

## Interface
`export function learnPatterns(history) -> { byKind: { [kind]: { planned, happened, rate, medianDelay } }, wake: { median, samples }, sleep: { median, samples } }`
history: array of { kind, plannedStart, actualStart|null } and { kind: "wake"|"sleep", minute } records.

## Decisions
- rate = happened / planned (2 decimals); medianDelay = median of (actualStart - plannedStart) for happened ones, or null.
- Sleep minutes after midnight (< 720) are treated as minute + 1440 when computing the median, then reported mod 1440.
- Fewer than 3 samples → median null (not enough to learn from).

## Tests (tests/life-patterns.test.mjs)
1. "rates and delays per kind" 2. "skipped blocks lower the rate" 3. "median wake time" 4. "sleep after midnight averages correctly" — 23:30, 00:30, 01:30 → 00:30 (30). 5. "too few samples is null".

## Exchange plan
FILE both in exchange 1; DONE when green.

## For the reviewer
Check every Decisions rule has a test.
