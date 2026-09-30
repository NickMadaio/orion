# ops-inference-summary

## Where you start
Real rows of ~/.openclaw/orion-controlled/inference-ledger.jsonl look like:
`{"schema_version":1,"ts":"2026-08-09T06:09:30.221000Z","role":"reasoning","provider":"anthropic","model":"claude-haiku-4-5-20251001","latency_ms":1234,"tokens":{"input":3,"output":20,"cache_read":14857,"cache_write":1114},"outcome":"succeeded","estimated_cost_usd":0.0029812,...}`
Do not read the real file in tests.

## Interface
```
export function parseJsonl(text) -> { rows: object[], skipped: number }
export function summarizeInference(rows, { from, to }) -> { totals: stats, byModel: { [model]: stats }, byDay: { [YYYY-MM-DD]: { calls, costUsd } }, skipped: number }
stats = { calls, failures, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, costUsd, p50LatencyMs, p95LatencyMs }
```

## Decisions
- parseJsonl: split on "\n", ignore blank lines, JSON.parse each; failures counted in skipped.
- A row counts when Date.parse(ts) is in [from, to) and model is a string; rows with bad ts or model are counted in `skipped` of the summary.
- failures: outcome !== "succeeded". Missing token fields count as 0. latency percentiles over finite latency_ms: nearest rank = sorted[Math.ceil(p/100 * n) - 1]; none -> null.
- byDay key = UTC date of ts.

## Tests (tests/ops-inference-summary.test.mjs)
1. "calls, tokens and cost add up per model".
2. "failures are counted".
3. "percentiles use nearest rank" — latencies 1..100 -> p50 50, p95 95.
4. "the window and bad rows are respected".
5. "parseJsonl skips bad lines".

## Exchange plan
FILE both in exchange 1; DONE when green.
