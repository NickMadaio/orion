# att-score

## Interface
```
export const DEFAULT_WEIGHTS = { urgency: 0.3, importance: 0.2, actionability: 0.15, confidence: 0.15, novelty: 0.1, interruptibility: 0.1 };
export function scoreAttentionItem(item, weights = DEFAULT_WEIGHTS) -> { score: number | null, known: string[], unknown: string[] }
```

## Decisions
- known = signal names (in DEFAULT_WEIGHTS key order) whose value is a finite number; unknown = the rest.
- If known.length < 3 -> score null.
- Else score = sum(w_i * s_i) / sum(w_i) over known, rounded with `Math.round(x * 10000) / 10000`.
- item.signals missing or not an object -> all six unknown, score null.

## Tests (tests/attention-score.test.mjs)
1. "all six known is the weighted mean" — all signals 0.5 -> 0.5; urgency 1 and others 0 -> 0.3.
2. "unknown signals are left out, not counted as zero" — urgency 1, importance 1, confidence 1, others null -> 1 (not 0.65).
3. "too few known signals cannot be ranked" — two known -> score null, known length 2.
4. "known and unknown are reported in weight order" — urgency and novelty null -> unknown ["urgency", "novelty"].
5. "custom weights are honoured" — weights {urgency: 1, importance: 0, actionability: 0, confidence: 0, novelty: 0, interruptibility: 0} with urgency 0.7 and two others known -> 0.7.

## Exchange plan
FILE both in exchange 1; DONE when green.

## Traps
Test 2 is the whole point: a naive mean over six treats null as zero.
