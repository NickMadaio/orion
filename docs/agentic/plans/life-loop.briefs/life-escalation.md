# life-escalation

## Interface
- `export function startLoop(block, now) -> loop` — loop: { blockId, phase: "waiting", level: 0, nextCheckAt, deferrals: 0, history: [] }. nextCheckAt = block start (absolute minutes: use a plain number; the caller defines the epoch).
- `export function step(loop, event, now) -> loop` — events: { type: "tick" } | { type: "started" } | { type: "done" } | { type: "defer", minutes, legitimate } | { type: "ignored" } | { type: "cancelled", reason }.

## Decisions
- tick when now >= nextCheckAt and phase "waiting" → phase "reminded", level 1, nextCheckAt now + 10.
- tick in "reminded"/"intervening" at/after nextCheckAt → level + 1 (max 4), phase "intervening", nextCheckAt now + [10,10,5,5][level-1].
- ignored → same as a tick that is due.
- started → phase "active", level 0, nextCheckAt now + 25 (check it's still going). done → phase "done", nextCheckAt null.
- defer legitimate (e.g. eating): phase "deferred", level unchanged, nextCheckAt now + clamp(minutes, 5, 45), deferrals + 1. Not legitimate: counts as ignored. A third deferral of any kind is treated as not legitimate.
- cancelled → phase "cancelled" (reality changed the plan; no scolding), nextCheckAt null.
- tick in "deferred" at/after nextCheckAt → phase "reminded", level max(1, level).
- Every transition appends { at: now, event: type, phase } to history. Never mutate.

## Tests (tests/life-follow-through.test.mjs)
1. "reminds at the block's start" 2. "ignoring escalates to level 4 and stops there" 3. "starting resets the level" 4. "eating first defers and comes back" — defer 25 legit → next check +25, then tick → reminded. 5. "the third deferral is not legitimate" 6. "cancel ends without escalation" 7. "done ends the loop" 8. "never mutates the loop".

## Exchange plan
FILE both in exchange 1; DONE when green.

## For the reviewer
Check every Decisions rule has a test.
