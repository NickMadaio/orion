# Task focus-sequence — arbitrary focus sequences, starting anywhere, recovery

## Files
- `scripts/lib/focus/sequence.mjs` (new).
- `tests/focus-sequence.test.mjs` (new).

## Interface
```
export function parseSequence(text) -> Array<{ kind: 'focus'|'rest', minutes: number }>
export function remainingFrom(phases, { phaseIndex, elapsedMinutes }) -> phases
export function recoverFromHistory(record, { blockMinutes, restMinutes } = {}) -> phases | null
export function describeSequence(phases) -> string
export function toRequestPhases(phases) -> Array<{ kind, seconds }>
```

## Decisions
1. `parseSequence` accepts free text. Split on `,` `;` `→` `->` `+` and the words `then`, `and then`, `followed by`, `after that`. For each piece find ONE number (digits, decimals, or number words one…twenty, thirty, forty, forty-five/forty five, fifty, sixty, ninety; also `half an hour`=30, `an hour`=60, `hour and a half`=90; `h`/`hr`/`hour(s)` multiply by 60) and ONE kind: focus words `work focus block study session sprint pomodoro` (also a bare `w`) → focus; `break rest pause` (also a bare `b`/`r`) → rest. Compact forms `20w 5b 40w` and `20/5/40` (alternating, starting with focus) work. A piece with a number but no kind takes the kind that alternates from the previous piece (first piece defaults to focus). Ignore filler such as `minutes left`, `another`, `more`, `remaining`, `I had`.
   Validation: each focus 1..180 minutes, each rest 1..60, at most 12 phases, total ≤ 600; empty input or a piece with no number → `TypeError` with a readable message naming the piece. Two adjacent phases of the same kind stay separate (Nick may want that).
2. `remainingFrom`: validates phaseIndex in range and elapsedMinutes ≥ 0; returns the phases from `phaseIndex` onward with the first one reduced by `elapsedMinutes` (rounded to 0.5 min); a first phase reduced to ≤ 0.5 is dropped.
3. `recoverFromHistory(record)`: returns null when `record.reason === 'completed'`. Otherwise with `blockSeconds = plannedFocusSeconds / max(1,totalFocusBlocks)`, `restMinutes` default = `plannedRestSeconds / max(1,totalFocusBlocks-1) / 60` or 10 if that is 0 and there is more than one block, `servedInCurrent = servedFocusSeconds - completedFocusBlocks*blockSeconds`: sequence is [focus remainder of the current block (dropped if < 1 min)] then, for each later block, [rest, focus block]. If the remainder was dropped and the first item would be a rest, drop that rest too. Minutes rounded to whole minutes, min 1. Empty → null.
4. `describeSequence`: `20m focus → 5m break → 40m focus`; minutes ≥ 60 as `1h 10m`.
5. `toRequestPhases`: minutes → integer seconds.

## Tests (titles exactly)
- "parses comma lists of work and break"
- "parses then-chains with number words, including Nick's recovery sentence"  — `I had 20 minutes left, then a five-minute break, then another forty-minute block` → focus 20, rest 5, focus 40
- "parses compact forms 20w 5b 40w and 20/5/40"
- "a sequence may start with a break"
- "rejects empty text, missing numbers and oversized phases"
- "remainingFrom starts mid-phase and drops a used-up first phase"
- "recovers the unfinished part of an early-ended session"  — planned 2×40 focus, 10 rest, served 20 min, 0 completed → focus 20, rest 10, focus 40
- "a completed session has nothing to recover"
- "describes sequences with hours"
