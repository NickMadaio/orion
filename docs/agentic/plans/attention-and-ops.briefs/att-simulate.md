# att-simulate

## Interface
`export function simulateAttentionDay(entries, { day, quietHours = null, focusByHour = () => false, budget = {} }) -> { interrupts, filed, blockedByBudget, perHour: { hour, interrupts }[] }`
day = "YYYY-MM-DD" (UTC). focusByHour(hour) -> true | false | null.

## Decisions
- For hour 0..23: now = Date.parse(`${day}T${hh}:00:00Z`). Rank the entries not yet decided with `rankAttention(entries, { now, hourOfDay: hour, quietHours, focusActive: focusByHour(hour) })`.
- For each row in `now`: if `canInterrupt(ledger, now, budget).allowed` -> interrupts += 1, ledger = recordInterruption(ledger, now), mark decided; else blockedByBudget += 1, filed += 1, mark decided.
- After hour 23, every entry never decided and not dropped counts as filed once.
- perHour lists all 24 hours.

## Tests (tests/attention-simulate.test.mjs)
1. "urgent items interrupt once each".
2. "the budget turns excess interruptions into filed items" — 5 urgent entries, budget {maxPerHour: 2} at one hour.
3. "quiet hours file what is not urgent".
4. "perHour covers the whole day".

## Exchange plan
FILE both in exchange 1; DONE when green.
