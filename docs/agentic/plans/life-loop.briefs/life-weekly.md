# life-weekly

## Interface
`export function blocksForDate(template, date) -> block[]`

template shape:
```
{ "from": "2026-09-28", "until": "2026-12-11", "skip": ["2026-11-02"],
  "entries": [ { "id": "cs2100-lecture", "title": "CS2100 Lecture", "kind": "class",
                 "weekday": 1, "start": 540, "end": 630 } ] }
```
weekday: 1 = Monday … 7 = Sunday (ISO). Compute weekday with Date.UTC(y, m-1, d) and getUTCDay() (0 = Sunday → 7).

## Decisions
- Outside [from, until] (inclusive) or in skip → [].
- Each produced block: id = `${entry.id}-${date}`, fixed: true, source: "template", kind/title/start/end from the entry. Output sorted by start.
- Invalid template (missing fields, bad weekday, start >= end) → throw TypeError("invalid template").

## Tests (tests/life-weekly.test.mjs)
Use this fixture: Monday 2026-09-28 has entries at 540–630 and 660–750; Tuesday has 810–900.
1. "monday gets monday's classes in order" 2. "a later monday repeats" — 2026-10-05. 3. "tuesday gets only tuesday" 4. "outside the term is empty" — 2026-12-14. 5. "a skipped date is empty" 6. "ids carry the date" 7. "a bad weekday throws".

## Exchange plan
FILE both in exchange 1; DONE when green.

## For the reviewer
Check every Decisions rule has a test.
