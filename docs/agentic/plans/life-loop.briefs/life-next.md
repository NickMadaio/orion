# life-next

## Interface
`export function nextAction({ blocks, now, done = [], state = "day" }) -> { action, blockId, reason, startsIn }`
action: "sleep" | "do" | "prepare" | "free".

## Decisions (first that applies)
1. state "awake_late" or "winding_down" → action "sleep", reason "It is past your bedtime."
2. A block containing now that is not in done → "do" that block (if several, highest priority by comparePriority), startsIn 0.
3. A block starting within 15 minutes → "prepare", startsIn minutes.
4. The earliest overdue movable study/deadline/side_project block not in done (ended before now) → "do", reason "You planned this for <HH:MM> and it hasn't happened yet."
5. Otherwise "free" with the next block's title and startsIn, or reason "Nothing else is planned today."

## Tests (tests/life-next-action.test.mjs)
1. "late at night means sleep" 2. "the current block wins" 3. "a class in ten minutes means prepare" 4. "missed study comes back" 5. "done blocks are not suggested" 6. "an empty evening is free".

## Exchange plan
FILE both in exchange 1; DONE when green.

## For the reviewer
Check every Decisions rule has a test.
