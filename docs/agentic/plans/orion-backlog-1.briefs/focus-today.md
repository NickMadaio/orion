# Task focus-today — total focus time today, not just the last segment

## Files
- `scripts/lib/focus/day-total.mjs` (new).
- `scripts/orion-session` (edit — ONLY add the `today` command and its usage line; task focus-cli also edits this file, so keep the change small and self-contained).
- `tests/focus-day-total.test.mjs` (new).

## Interface
```
export function focusToday(records, { dayKey, live } = {}) -> { dayKey, sessions, focusSeconds, restSeconds, latestSessionSeconds, longestSessionSeconds }
export function formatFocusToday(total) -> string
```
## Decisions
1. `records` are parsed history objects (see common.md). Count only `dayKey` matches. Sum `servedFocusSeconds` (ignore non-finite), `servedRestSeconds`. `sessions` counts records with servedFocusSeconds ≥ 60. `latestSessionSeconds` = servedFocusSeconds of the record with the latest `endedAt`.
2. `live` (optional) = `{ servedFocusSeconds }` for a session still running: added to focusSeconds and counted as a session (it is the latest).
3. Every reason counts (early and abandoned time was still focus).
4. `formatFocusToday`: `Focused today: 1h 52m across 4 sessions (latest 16m).`; zero → `No focus time yet today.`; 1 session → `across 1 session`.
5. CLI `orion-session today [--day YYYY-MM-DD]`: reads the history file (`ORION_FOCUS_HISTORY` override), skips unparsable lines, uses today's local date (`toLocaleDateString('en-CA')`) unless `--day`, prints `formatFocusToday`. It does NOT contact the app (works when the app is down).

## Tests (titles exactly)
- "sums every session of the day, not just the latest"
- "other days are ignored"
- "a live session is added and counts as latest"
- "short blips under a minute add time but not sessions"
- "formats hours, minutes and the empty day"
- "the today command reads the history file"  (child process, temp history file, `--day`)
