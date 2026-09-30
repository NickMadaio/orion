# life-fit-study

## Interface
`export function fitStudy(blocks, sessions, window, now) -> { blocks, placed: block[], moved: {id, from, to}[], unplaced: number[] }`
- sessions: minutes per session, e.g. [90, 60]. window: waking {start,end}. now: minute of day; nothing is placed or moved before now.
- Placed blocks: kind "study", source "orion", fixed false, ids `study-<date>-<n>`, date taken from the other blocks (or throw TypeError("no date") if blocks is empty and window has no date — accept an optional 5th argument date).

## Decisions (in order)
1. For each session, largest first: use the earliest free gap (from gaps.mjs, buffer 10, after now) that fits it.
2. If none fits: consider movable blocks of LOWER priority than study (side_project, meal, other, rest) — never class, sleep, gym, deadline. Move the lowest-priority one that frees enough room to the latest free gap that fits it; if it fits nowhere else, it is NOT dropped — leave it and try the next candidate.
3. side_project may be moved but its total for the day must stay >= 60 minutes (never shortened or removed).
4. Sessions that still don't fit go to `unplaced` (their minutes).
5. Never mutate inputs; result blocks sorted by start.

## Tests (tests/life-fit-study.test.mjs)
1. "fits into an empty afternoon" 2. "never moves a class" 3. "moves rest before side project" 4. "side project keeps its hour" 5. "nothing goes before now" 6. "reports what could not fit" 7. "inputs are not mutated".

## Exchange plan
FILE both in exchange 1 with a simple gap-only version; add moving in exchange 2+; DONE when green.

## For the reviewer
Check every Decisions rule has a test.
