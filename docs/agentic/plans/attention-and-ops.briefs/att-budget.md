# att-budget

## Interface
```
export function canInterrupt(ledger, now, { maxPerHour = 2, maxPerDay = 8 } = {}) -> { allowed: boolean, reason: "ok" | "hour_limit" | "day_limit", nextAt: number | null }
export function recordInterruption(ledger, now) -> number[]
```
ledger = array of ms timestamps of past interruptions.

## Decisions
- Ignore non-safe-integer entries. hour = entries in (now - 3_600_000, now]; day = entries in (now - 86_400_000, now].
- hour.length >= maxPerHour -> { allowed: false, reason: "hour_limit", nextAt: min(hour) + 3_600_000 }.
- else day.length >= maxPerDay -> { allowed: false, reason: "day_limit", nextAt: min(day) + 86_400_000 }.
- else { allowed: true, reason: "ok", nextAt: null }.
- recordInterruption -> [...entries within (now - 86_400_000, now], now] sorted ascending.

## Tests (tests/attention-budget.test.mjs)
1. "an empty ledger allows".
2. "the hour limit blocks and says when it clears".
3. "the day limit blocks after the hour window has passed".
4. "recording keeps only the last day and never mutates" — frozen input.

## Exchange plan
FILE both in exchange 1; DONE when green.
