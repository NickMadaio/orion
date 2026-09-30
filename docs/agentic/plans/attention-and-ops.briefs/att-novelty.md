# att-novelty

## Interface
`export function noveltyOf(dedupKey, history, now) -> number`
`history` is an array of `{ dedupKey: string, surfacedAt: number (ms) }`.

## Decisions
count = entries with the same dedupKey AND `now - 7*86_400_000 <= surfacedAt <= now`.
| count | novelty |
|---|---|
| 0 | 1 |
| 1 | 0.6 |
| 2 | 0.35 |
| 3 or more | 0.1 |
Entries that are not objects, or lack a string dedupKey or a safe-integer surfacedAt, are skipped. history not an array -> treat as [] .

## Tests (tests/attention-novelty.test.mjs)
1. "never surfaced is fully novel" — [] -> 1.
2. "each repeat lowers novelty" — 1, 2, 3 and 5 matching entries -> 0.6, 0.35, 0.1, 0.1.
3. "other keys and old surfacings do not count" — entries with another key, one 8 days old, one in the future -> 1.
4. "malformed entries are skipped" — [null, {dedupKey: 3}, {dedupKey: "k"}] plus one valid -> 0.6.

## Exchange plan
FILE both in exchange 1; DONE when green.
