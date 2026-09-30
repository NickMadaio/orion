# att-rank

## Where you start
score.mjs exports `scoreAttentionItem(item) -> { score, known, unknown }`; gate.mjs exports `attentionGate(item, { now, hourOfDay, quietHours, focusActive, score }) -> { deliver, route, reason }`.

## Interface
`export function rankAttention(entries, { now, hourOfDay, quietHours = null, focusActive = null }) -> { now: row[], later: row[], dropped: { id, reason }[] }`
row = `{ id, title, source, score, reason, dueAt }`.

## Decisions
- route "interrupt" -> now; "today" -> later; "drop" -> dropped.
- Ordering as in the acceptance. dropped keeps input order.

## Tests (tests/attention-rank.test.mjs)
1. "a high-scoring item interrupts and a low one waits".
2. "expired entries are dropped with their reason".
3. "unknown focus files everything that is not very urgent".
4. "ordering is by score, then due time, then id".

## Exchange plan
FILE rank.mjs and tests in exchange 1 (import the two modules); DONE when green.
