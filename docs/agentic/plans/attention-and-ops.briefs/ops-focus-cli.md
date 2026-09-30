# ops-focus-cli

## Interface
`orion-focus-report [--file PATH] [--days N] [--now ISO] [--json]`
Default file `join(homedir(), ".openclaw/orion-controlled/focus-history.jsonl")`.

## Decisions
- Window from = now - days*86_400_000, to = now + 1. Lines parsed one by one; bad lines count as skipped.
- Text: `Focus, last ${days} day(s): ${sessions} session(s), ${focusMinutes} min` then one line per day ascending `  ${day}  ${sessions} session(s)  ${focusMinutes} min  ${earlyEnds} ended early`, then `Longest: ${minutes} min (${task}) on ${day}` when any.
- --json prints the report. Bad --days -> exit 2.

## Tests (tests/ops-focus-cli.test.mjs)
1. "a history prints per day".
2. "--json prints the report".
3. "missing history is not an error".
4. "bad --days is refused".

## Exchange plan
FILE both in exchange 1; DONE when green.
