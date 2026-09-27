import { strict as assert } from "node:assert";

/**
 * Parse a JSONL string into an array of row objects.
 * Blank lines are ignored. Lines that fail JSON.parse are counted in skipped.
 * @param {string} text
 * @returns {{ rows: object[], skipped: number }}
 */
export function parseJsonl(text) {
  const rows = [];
  let skipped = 0;

  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    try {
      rows.push(JSON.parse(trimmed));
    } catch {
      skipped++;
    }
  }

  return { rows, skipped };
}

/**
 * Summarize inference ledger rows within a time window.
 * @param {object[]} rows - parsed ledger rows
 * @param {{ from: number, to: number }} opts - window in ms timestamps
 * @returns {{ totals: stats, byModel: Record<string, stats>, byDay: Record<string, { calls: number, costUsd: number }>, skipped: number }}
 */
export function summarizeInference(rows, { from, to }) {
  /** @typedef {Object} stats
   * @property {number} calls
   * @property {number} failures
   * @property {number} inputTokens
   * @property {number} outputTokens
   * @property {number} cacheReadTokens
   * @property {number} cacheWriteTokens
   * @property {number} costUsd
   * @property {number|null} p50LatencyMs
   * @property {number|null} p95LatencyMs
   */

  /** @type {{ calls: number, failures: number, inputTokens: number, outputTokens: number, cacheReadTokens: number, cacheWriteTokens: number, costUsd: number, latencies: number[] }} */
  const totals = {
    calls: 0,
    failures: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costUsd: 0,
    latencies: [],
  };

  /** @type {Record<string, typeof totals>} */
  const byModel = {};
  /** @type {Record<string, { calls: number, costUsd: number }>} */
  const byDay = {};
  let skipped = 0;

  for (const row of rows) {
    // Validate ts and model
    const tsMs = Date.parse(row.ts);
    if (Number.isNaN(tsMs)) {
      skipped++;
      continue;
    }
    if (typeof row.model !== "string") {
      skipped++;
      continue;
    }

    // Window filter: [from, to)
    if (tsMs < from || tsMs >= to) {
      continue;
    }

    const model = row.model;
    const isFailure = row.outcome !== "succeeded";
    const tokens = row.tokens ?? {};
    const inputTokens = typeof tokens.input === "number" ? tokens.input : 0;
    const outputTokens = typeof tokens.output === "number" ? tokens.output : 0;
    const cacheReadTokens = typeof tokens.cache_read === "number" ? tokens.cache_read : 0;
    const cacheWriteTokens = typeof tokens.cache_write === "number" ? tokens.cache_write : 0;
    const costUsd = typeof row.estimated_cost_usd === "number" ? row.estimated_cost_usd : 0;
    const latencyMs = typeof row.latency_ms === "number" && Number.isFinite(row.latency_ms) ? row.latency_ms : null;

    // Update totals
    totals.calls++;
    if (isFailure) totals.failures++;
    totals.inputTokens += inputTokens;
    totals.outputTokens += outputTokens;
    totals.cacheReadTokens += cacheReadTokens;
    totals.cacheWriteTokens += cacheWriteTokens;
    totals.costUsd += costUsd;
    if (latencyMs !== null) totals.latencies.push(latencyMs);

    // Update byModel
    if (!byModel[model]) {
      byModel[model] = {
        calls: 0,
        failures: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        costUsd: 0,
        latencies: [],
      };
    }
    const m = byModel[model];
    m.calls++;
    if (isFailure) m.failures++;
    m.inputTokens += inputTokens;
    m.outputTokens += outputTokens;
    m.cacheReadTokens += cacheReadTokens;
    m.cacheWriteTokens += cacheWriteTokens;
    m.costUsd += costUsd;
    if (latencyMs !== null) m.latencies.push(latencyMs);

    // Update byDay
    const utcDate = new Date(tsMs).toISOString().slice(0, 10);
    if (!byDay[utcDate]) {
      byDay[utcDate] = { calls: 0, costUsd: 0 };
    }
    byDay[utcDate].calls++;
    byDay[utcDate].costUsd += costUsd;
  }

  // Round costs to 6 decimals and compute percentiles
  const roundCost = (v) => Math.round(v * 1e6) / 1e6;

  const finalizeStats = (acc) => {
    const sorted = [...acc.latencies].sort((a, b) => a - b);
    return {
      calls: acc.calls,
      failures: acc.failures,
      inputTokens: acc.inputTokens,
      outputTokens: acc.outputTokens,
      cacheReadTokens: acc.cacheReadTokens,
      cacheWriteTokens: acc.cacheWriteTokens,
      costUsd: roundCost(acc.costUsd),
      p50LatencyMs: nearestRank(sorted, 50),
      p95LatencyMs: nearestRank(sorted, 95),
    };
  };

  const resultTotals = finalizeStats(totals);
  const resultByModel = {};
  for (const [model, acc] of Object.entries(byModel)) {
    resultByModel[model] = finalizeStats(acc);
  }

  // Round byDay costs
  const resultByDay = {};
  for (const [day, d] of Object.entries(byDay)) {
    resultByDay[day] = { calls: d.calls, costUsd: roundCost(d.costUsd) };
  }

  return { totals: resultTotals, byModel: resultByModel, byDay: resultByDay, skipped };
}

/**
 * Nearest-rank percentile. sorted must be ascending.
 * Index = Math.ceil(p/100 * n) - 1. Returns null if array is empty.
 */
function nearestRank(sorted, p) {
  const n = sorted.length;
  if (n === 0) return null;
  const idx = Math.ceil((p / 100) * n) - 1;
  return sorted[idx];
}
