# Task early — the "finished early" plan (pure)

## Why
Nick wants one button: "I finished early". Pressed during a block, that block ends now and the rest of the day moves EARLIER. Pressed right after a class, it asks two questions as symbols: "out of class early" (the trip home starts now) or "already home" (no trip left). Today `replan` only ever keeps or delays blocks; nothing pulls a day forward.

## Interface — `scripts/lib/life/early.mjs`
```
export function earlyContext(blocks, { now, commuteMinutes })
  → { kind: "after-class", classId, classTitle, classEnd }
  | { kind: "block", id, title }
  | { kind: "none" }

export function finishEarly(blocks, { now, mode, commuteMinutes = 30, buffer = 10, dayEnd = 1440 })
  → { mode, freeFrom, shortened, clipped, moves, unchanged }
```
- `mode` is "block", "out-of-class" or "home". Anything else → TypeError. `now` an integer 0..1439, `blocks` an array → else TypeError.
- `shortened`: `{ id, title, from: oldEnd, to: now }` for the block that just finished (mode "block" only), else null.
- `clipped`: `{ id, title, end: now }` when a REAL class is still scheduled past now in out-of-class/home mode (it is never written to his calendar; callers use it only to judge the day), else null.
- `moves`: `[{ id, title, from, to }]` — `from`/`to` are start minutes; only blocks whose start changed; every `to < from`.
- `freeFrom`: the minute from which the day is laid out again.
- `unchanged`: ids of movable future blocks that kept their start.

## Decisions (in this order)
1. A real class is `kind === "class" && fixed && source !== "orion"`.
2. `earlyContext`: let `c` = the real class with the latest `end` such that `c.start <= now` and `now <= c.end + commuteMinutes + 30`. If it exists → after-class. Otherwise the block with `start <= now < end`, `fixed === false` → block. Otherwise none.
3. Mode "block": the movable block with `start <= now < end` is the one finished; if none, throw `Error("nothing is under way to finish")`. `freeFrom = now`. `shortened = { id, title, from: end, to: now }`.
4. Mode "out-of-class": needs a context of after-class (else throw `Error("no class just ended")`); `freeFrom = now + commuteMinutes`. Mode "home": same class requirement; `freeFrom = now`. If that class's `end > now`, set `clipped`.
5. Walls (things that never move, judged with the clip applied): every fixed block; every block whose title matches /\b(nap|wind down|sleep|bed)\b/i; and `commuteWalls` of the day EXCEPT the "commute home" wall after the class being answered (in out-of-class/home mode that trip is replaced by `[now, freeFrom]`).
6. Candidates: movable blocks (`fixed === false`, not a wall) with `start >= now` (in block mode also excluding the shortened one), in start order.
7. Pull forward greedily: `cursor = freeFrom` (block mode: `now + buffer`). For each candidate, find the earliest start `s >= cursor` such that `[s - buffer, s + length + buffer)` overlaps no wall and no already-placed candidate, and `s + length <= dayEnd`. If `s < block.start` it moves to `s`; otherwise it keeps its start. Either way `cursor = placedEnd + buffer`. Order is never changed and nothing moves later.
8. Never mutate `blocks`.

## Tests — `tests/surfaces-early.test.mjs` (titles exactly)
- "finishing a block early pulls the next ones forward in order"
- "nap, wind down and classes never move"
- "a gap that is too small for the next block is skipped, not overfilled"
- "nothing ever moves later"
- "after a class the context asks which kind of early"
- "out of class early: the trip home starts now"
- "already home: the day starts now and the class is clipped"
- "pressing with nothing under way throws"
- "invalid mode or now throws TypeError"
- "the input blocks are not mutated"
Every test that moves blocks also asserts: no two resulting blocks (walls + moved + unchanged) overlap, and every moved block keeps its length.
