# att-gate

## Interface
```
export function attentionGate(item, context) -> { deliver: boolean, route: "interrupt" | "today" | "drop", reason: string }
// context = { now: ms, hourOfDay: 0..23, quietHours: [start, end] | null, focusActive: true | false | null, score: number | null }
```

## Decisions (first match wins)
1. `item.expiresAt !== null && item.expiresAt <= now` -> drop, "expired"
2. `score === null` -> today, "unranked" (an item that cannot be ranked never interrupts)
3. hourOfDay inside quietHours AND urgency < 0.9 -> today, "quiet_hours"
4. focusActive !== false AND urgency < 0.9 -> today, reason "focus_active" if true, "focus_unknown" if null
5. score >= 0.6 -> interrupt, "score"
6. otherwise -> today, "low_score"
urgency = item.signals.urgency, with null treated as 0 for these comparisons.
Quiet window [s, e]: s < e -> quiet when s <= h < e; s > e -> quiet when h >= s or h < e; s === e -> never quiet (same as admission.mjs).

## Tests (tests/attention-gate.test.mjs)
1. "an expired item is dropped" — expiresAt = now.
2. "an unranked item is filed, never interrupts" — score null, urgency 1.
3. "quiet hours wrap midnight" — quiet [22, 7]: hour 23 and hour 3 -> today quiet_hours; hour 12 -> not quiet (score 0.9, focus false -> interrupt).
4. "very urgent items pass quiet hours and focus" — urgency 0.95, score 0.8, hour 23 quiet [22,7], focus true -> interrupt.
5. "unknown focus counts as focus" — focus null, urgency 0.5, score 0.9 -> today focus_unknown.
6. "score decides the rest" — no quiet, focus false: score 0.6 -> interrupt; 0.59 -> today low_score.
7. "deliver matches route" — every case above: deliver === (route === "interrupt").

## Exchange plan
FILE both in exchange 1 (a decision function is short); DONE when green.
