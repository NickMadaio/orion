# ops-inference-cli

## Interface
`orion-costs [--file PATH] [--days N] [--now ISO] [--json]`
Default file `join(homedir(), ".openclaw/orion-controlled/inference-ledger.jsonl")`, days 7, now = Date.now().

## Decisions
- window: from = now - days*86_400_000, to = now + 1.
- Text output: header `Inference, last ${days} day(s)`, then per model sorted by costUsd desc: `  ${model}  ${calls} calls  ${failures} failed  $${costUsd.toFixed(4)}  p50 ${p50}ms  p95 ${p95}ms`, then a `Total` line the same way, then `(${skipped} unreadable line(s) skipped)` when skipped > 0.
- --json prints the summary object.
- Bad --days (not a positive integer) -> exit 2.

## Tests (tests/ops-inference-cli.test.mjs)
1. "a ledger is summarized per model".
2. "--json prints the summary".
3. "a missing ledger is not an error".
4. "bad --days is refused".

## Exchange plan
FILE both in exchange 1; DONE when green.
