# Task learn-dedupe — don't learn the same thing twice (pure)

## Interface — `scripts/lib/brain/learned.mjs`
```
export function normalize(text)                      → string
export function alreadyKnown(fact, noteText)         → boolean
export function planLearning(facts, notesByTitle)    → { add: [fact], skip: [{ fact, why }] }
```
- `facts`: accepted facts from learn-extract. `notesByTitle`: `{ [title]: markdownText }`
  (missing title = note does not exist yet).

## Decisions
1. `normalize`: lowercase, strip a trailing ` (YYYY-MM-DD)`, remove punctuation, collapse spaces.
2. `alreadyKnown`: true when any `- [..] …` line of the note, normalized, equals the
   normalized fact, or contains it, or ≥ 80% of the fact's words (4+ letters) appear in it.
3. `planLearning`: skip facts already known (why "already known"), and duplicates within
   the same batch (why "duplicate in batch"); keep the order of the input otherwise.

## Tests — `tests/brain-learn-dedupe.test.mjs` (titles exactly)
- "an identical observation is already known"
- "a dated line still matches the same fact"
- "a mostly overlapping fact is already known"
- "a new fact is added"
- "two identical facts in one batch keep only the first"
- "a note that does not exist yet never blocks a fact"
