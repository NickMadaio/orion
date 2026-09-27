import { test } from "node:test";
import { strict as assert } from "node:assert";
import { parseJsonl, summarizeInference } from "../scripts/lib/orion-inference-summary.mjs";

test("calls, tokens and cost add up per model", () => {
  const rows = [
    makeRow("2026-08-09T06:00:00.000Z", "model-a", 100, { input: 10, output: 5, cache_read: 0, cache_write: 0 }, 0.01),
    makeRow("2026-08-09T07:00:00.000Z", "model-a", 200, { input: 20, output: 10, cache_read: 50, cache_write: 10 }, 0.02),
    makeRow("2026-08-09T08:00:00.000Z", "model-b", 300, { input: 30, output: 15, cache_read: 0, cache_write: 0 }, 0.03),
  ];

  const from = Date.parse("2026-08-09T00:00:00.000Z");
  const to = Date.parse("2026-08-10T00:00:00.000Z");

  const result = summarizeInference(rows, { from, to });

  assert.strictEqual(result.totals.calls, 3);
  assert.strictEqual(result.totals.inputTokens, 60);
  assert.strictEqual(result.totals.outputTokens, 30);
  assert.strictEqual(result.totals.cacheReadTokens, 50);
  assert.strictEqual(result.totals.cacheWriteTokens, 10);
  assert.strictEqual(result.totals.costUsd, 0.06);

  assert.strictEqual(result.byModel["model-a"].calls, 2);
  assert.strictEqual(result.byModel["model-a"].inputTokens, 30);
  assert.strictEqual(result.byModel["model-a"].costUsd, 0.03);

  assert.strictEqual(result.byModel["model-b"].calls, 1);
  assert.strictEqual(result.byModel["model-b"].inputTokens, 30);
  assert.strictEqual(result.byModel["model-b"].costUsd, 0.03);

  assert.strictEqual(result.skipped, 0);
});

test("failures are counted", () => {
  const rows = [
    makeRow("2026-08-09T06:00:00.000Z", "model-a", 100, {}, 0.01, "succeeded"),
    makeRow("2026-08-09T07:00:00.000Z", "model-a", 200, {}, 0.02, "failed"),
    makeRow("2026-08-09T08:00:00.000Z", "model-a", 300, {}, 0.03, "timeout"),
  ];

  const from = Date.parse("2026-08-09T00:00:00.000Z");
  const to = Date.parse("2026-08-10T00:00:00.000Z");

  const result = summarizeInference(rows, { from, to });

  assert.strictEqual(result.totals.calls, 3);
  assert.strictEqual(result.totals.failures, 2);
  assert.strictEqual(result.byModel["model-a"].failures, 2);
});

test("percentiles use nearest rank", () => {
  // Latencies 1..100: n=100. p50 index = ceil(0.5*100)-1 = 49 -> value 50. p95 index = ceil(0.95*100)-1 = 94 -> value 95.
  const rows = [];
  for (let i = 1; i <= 100; i++) {
    rows.push(makeRow("2026-08-09T06:00:00.000Z", "model-x", i, {}, 0));
  }

  const from = Date.parse("2026-08-09T00:00:00.000Z");
  const to = Date.parse("2026-08-10T00:00:00.000Z");

  const result = summarizeInference(rows, { from, to });

  assert.strictEqual(result.totals.p50LatencyMs, 50);
  assert.strictEqual(result.totals.p95LatencyMs, 95);
});

test("the window and bad rows are respected", () => {
  const inside = makeRow("2026-08-09T12:00:00.000Z", "model-a", 100, {}, 0.01);
  const before = makeRow("2026-08-08T23:59:59.999Z", "model-a", 100, {}, 0.01);
  const after = makeRow("2026-08-10T00:00:00.000Z", "model-a", 100, {}, 0.01);

  // Bad ts
  const badTs = { ...inside, ts: "not-a-date" };
  // Missing model
  const noModel = { ...inside, model: null };

  const rows = [inside, before, after, badTs, noModel];

  const from = Date.parse("2026-08-09T00:00:00.000Z");
  const to = Date.parse("2026-08-10T00:00:00.000Z");

  const result = summarizeInference(rows, { from, to });

  assert.strictEqual(result.totals.calls, 1);
  // badTs and noModel are skipped; before and after are outside window (not skipped)
  assert.strictEqual(result.skipped, 2);
});

test("parseJsonl skips bad lines", () => {
  const text = `{"a":1}
not-json
{"b":2}

{"c":3}`;

  const result = parseJsonl(text);

  assert.strictEqual(result.rows.length, 3);
  assert.deepStrictEqual(result.rows[0], { a: 1 });
  assert.deepStrictEqual(result.rows[1], { b: 2 });
  assert.deepStrictEqual(result.rows[2], { c: 3 });
  assert.strictEqual(result.skipped, 1);
});

/**
 * Helper to create a ledger row.
 */
function makeRow(ts, model, latencyMs, tokens, costUsd, outcome = "succeeded") {
  return {
    schema_version: 1,
    ts,
    role: "reasoning",
    provider: "anthropic",
    model,
    latency_ms: latencyMs,
    tokens: { input: 0, output: 0, cache_read: 0, cache_write: 0, ...tokens },
    outcome,
    estimated_cost_usd: costUsd,
  };
}
