# life-priority

## Interface
- `export function priorityOf(block) -> integer` — 0 is highest. Uses KINDS order from block.mjs (class 0 … rest 8).
- `export function comparePriority(a, b) -> number` — sort comparator: fixed before movable; then priorityOf ascending; then start ascending; then id ascending.
- `export function movable(block) -> boolean` — false when fixed or kind is class or sleep.

## Tests (tests/life-priority.test.mjs)
1. "classes outrank everything" 2. "rest is last" 3. "fixed beats movable of higher kind" — a fixed `other` sorts before a movable `gym`. 4. "ties break by start then id" 5. "class and sleep are never movable even when fixed is false" 6. "sorting does not mutate the input array" (use [...arr].sort in the test and compare).

## Exchange plan
FILE both files in exchange 1; DONE when green.

## For the reviewer
Check every Decisions rule has a test.
