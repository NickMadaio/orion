# att-src-focus

## Where you start
`scripts/lib/orion-automation-host.mjs` legacyFocus reads ~/.openclaw/orion-controlled/focus.json: `{ session: null }` -> not focusing; `session.until` (ms) -> focusing while now <= until; otherwise unknown. focus-history.jsonl rows look like `{"startedAt":"2026-08-12T01:58:50Z","servedFocusSeconds":17.6,"reason":"early",...}`.

## Interface
```
export function focusActiveFrom(focusJson, now) -> true | false | null
export function fromFocusHistory(rows, { now }) -> item[]
```

## Decisions
focusActiveFrom:
| input | result |
|---|---|
| null (file missing) | false |
| object with session === null | false |
| object with session.until a safe integer > 0 | now <= until |
| anything else (undefined, string, session without until) | null |
fromFocusHistory:
- rows not an array -> []. A row counts when it is an object with a parseable startedAt whose UTC date equals today's UTC date and a finite servedFocusSeconds.
- total = sum of servedFocusSeconds of counted rows. If total === 0 and new Date(now).getUTCHours() >= 15 -> one item: id = dedupKey = `focus:none:${today}`, source "focus", kind "no_focus_today", title "No focus session yet today", detail "", observedAt now, dueAt null, expiresAt Date.parse(`${today}T23:59:59Z`), signals: urgency 0.2, actionability 0.5, confidence 0.7, novelty null, importance null, interruptibility null. Otherwise [].

## Tests (tests/attention-src-focus.test.mjs)
1. "focus state follows the host's reading" — each row of the table.
2. "no focus by mid-afternoon files a gentle item" — now 16:00Z, rows only from yesterday -> one item.
3. "some focus today, or too early, files nothing" — a today row with 600 s -> []; now 10:00Z with no rows -> [].
4. "malformed rows are skipped" — [null, {startedAt: "x"}] at 16:00Z -> one item.

## Exchange plan
FILE both in exchange 1; DONE when green.
