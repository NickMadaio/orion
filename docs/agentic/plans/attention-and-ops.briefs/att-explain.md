# att-explain

## Interface
`export function explainAttention(item, scored, gated) -> string[]`
scored = `{ score, known, unknown }` from score.mjs; gated = `{ route, reason }` from gate.mjs.

## Decisions
First sentence by reason:
| reason | sentence |
|---|---|
| expired | "Dropped: it expired." |
| unranked | "Filed for later: too little is known to rank it." |
| quiet_hours | "Held for later: it is quiet hours and this is not urgent enough to break them." |
| focus_active | "Held for later: you are focusing and this can wait." |
| focus_unknown | "Held for later: it is not known whether you are focusing, so it waits." |
| score | "Shown now: it scored high enough to interrupt." |
| low_score | "Filed for later: worth knowing, not worth interrupting for." |
| anything else | `Routed to ${route}: ${reason}.` |
Second sentence: score null -> `Only ${known.length} of 6 signals are known.`; else `Scored ${score} from ${known.length} of 6 signals.`
Third (only if unknown non-empty): `Unknown: ${unknown.join(", ")}.`

## Tests (tests/attention-explain.test.mjs)
1. "each reason has its sentence" — every table row.
2. "a ranked item states its score and signals".
3. "an unranked item says how little is known and names the unknowns".

## Exchange plan
FILE both in exchange 1; DONE when green.
