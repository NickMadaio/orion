# life-gaps

## Interface
`export function freeGaps(blocks, window, options = {}) -> { start, end }[]`
- window: { start, end } minutes. options.buffer (default 0): minutes kept free before and after every FIXED block. options.minimum (default 15): gaps shorter than this are dropped.
- Overlapping blocks are merged first. Output sorted, non-overlapping, clipped to the window.

## Tests (tests/life-gaps.test.mjs)
1. "an empty day is one gap" 2. "gaps sit between blocks" 3. "overlapping blocks merge" 4. "buffers apply only around fixed blocks" 5. "short gaps are dropped" 6. "blocks outside the window are ignored".

## Exchange plan
FILE both in exchange 1; DONE when green.

## For the reviewer
Check every Decisions rule has a test.
