# life-sync-merge

## Interface
`export function mergeLogs(...logs) -> event[]` and `export function since(log, cursor) -> event[]` (cursor: { [device]: highestClockSeen }).

## Decisions
- Deduplicate by id (identical id with different content: keep the one whose JSON sorts first, and that is deterministic).
- Order by at, then device, then clock.
- since returns events whose clock > cursor[device] (missing device = 0), in merge order.
- Invalid events are dropped, not thrown.

## Tests (tests/life-sync-merge.test.mjs)
1. "merge is the same in either order" 2. "duplicates collapse" 3. "order is time then device then clock" 4. "since returns only unseen events" 5. "invalid events are dropped".

## Exchange plan
FILE both in exchange 1; DONE when green.

## For the reviewer
Check every Decisions rule has a test.
