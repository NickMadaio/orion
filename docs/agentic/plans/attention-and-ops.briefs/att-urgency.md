# att-urgency

## Interface
`export function urgencyFromDue(dueAt, now) -> number | null`

## Decisions
- dueAt null -> null. dueAt not null and not a safe integer, or now not a safe integer -> `throw new TypeError("invalid time")`.
- hours = (dueAt - now) / 3_600_000
| condition | urgency |
|---|---|
| hours <= 0 (due or overdue) | 1 |
| hours <= 1 | 0.95 |
| hours <= 6 | 0.8 |
| hours <= 24 | 0.6 |
| hours <= 72 | 0.4 |
| hours <= 168 | 0.25 |
| otherwise | 0.1 |
Boundaries are inclusive exactly as written.

## Tests (tests/attention-urgency.test.mjs)
1. "no due time is unknown, not zero" — null -> null.
2. "overdue and due now are fully urgent" — dueAt = now - 1 and dueAt = now -> 1.
3. "each step of the table" — one case strictly inside each band plus each boundary (exactly 1h, 6h, 24h, 72h, 168h) -> table value.
4. "bad input throws" — now 1.5, dueAt "soon" -> TypeError.

## Exchange plan
FILE both files in exchange 1; DONE when green.

## For the reviewer
Check each boundary against the table.
