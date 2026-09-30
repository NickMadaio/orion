# ops-focus-report

## Where you start
Real rows of ~/.openclaw/orion-controlled/focus-history.jsonl (do not read it in tests):
`{"approximate":false,"completedFocusBlocks":0,"dayKey":"2026-08-11","endedAt":"2026-08-12T01:59:08Z","plannedFocusSeconds":9000,"reason":"early","servedFocusSeconds":17.62,"startedAt":"2026-08-12T01:58:50Z","task":"Focus","totalFocusBlocks":3}`

## Interface
`export function focusReport(rows, { from, to }) -> { totals: dayStats, byDay: { [YYYY-MM-DD]: dayStats }, longest: { startedAt, minutes, task } | null, skipped }`
dayStats = `{ sessions, focusMinutes, completedBlocks, earlyEnds }`

## Decisions
- A row counts when Date.parse(startedAt) is in [from, to) and servedFocusSeconds is finite; else skipped (outside the window is NOT skipped, just excluded).
- Day key = UTC date of startedAt. focusMinutes = Math.round(seconds / 60 * 10) / 10 (sum seconds first, round once). earlyEnds: reason === "early". completedBlocks: sum of completedFocusBlocks (missing -> 0).
- longest: the counted row with the most servedFocusSeconds.

## Tests (tests/ops-focus-report.test.mjs)
1. "sessions and minutes add up per day".
2. "early ends and blocks are counted".
3. "the longest session is named".
4. "the window and bad rows are respected".

## Exchange plan
FILE both in exchange 1; DONE when green.
