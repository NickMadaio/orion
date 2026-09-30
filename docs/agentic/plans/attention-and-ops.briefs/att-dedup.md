# att-dedup

## Interface
`export function dedupAttentionItems(items, { windowMs = 6 * 3_600_000 } = {}) -> { kept: item[], dropped: { id: string, keptId: string }[] }`

## Decisions
- Group by dedupKey. In each group find the newest (largest observedAt; tie -> larger id string wins).
- An older item of that group is dropped when `newest.observedAt - item.observedAt <= windowMs`, recorded as `{ id: item.id, keptId: newest.id }`; otherwise it is kept.
- kept sorted by observedAt desc, then id asc. dropped in the order encountered after sorting items by observedAt desc.
- items not an array -> TypeError("items must be an array").

## Tests (tests/attention-dedup.test.mjs)
1. "the newest of a key wins" — three items key k at t, t+1000, t+2000 -> kept one (t+2000), dropped two with keptId of the newest.
2. "different keys are independent" — keys a and b -> both kept.
3. "an old occurrence outside the window survives" — same key 7h apart with default window -> both kept.
4. "ties break by id" — same key, same observedAt, ids "x1" and "x2" -> keeps "x2".
5. "input is not mutated" — freeze items; no throw.

## Exchange plan
FILE both in exchange 1; DONE when green.
