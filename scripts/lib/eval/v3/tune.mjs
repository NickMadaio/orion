// The V3 tuning loop (handoff §9). From a baseline configuration, try one
// change at a time from a fixed ladder (the same ladder, in the same order, for
// every model — the fairness rule), keep it only if the practice pass count
// rises by at least one without more critical misroutes or false claims, and
// stop after 8 iterations or 3 in a row that did not help. A model that
// plateaus early simply leaves budget unused.
// (Written by Claude on 2026-10-08 for the V3 local-first evaluation.)

export const BUDGET = 8;
export const PATIENCE = 3;

export const keeps = (candidate, best) => candidate.pass >= best.pass + 1
  && (candidate.critical ?? 0) <= (best.critical ?? 0)
  && (candidate.falseClaims ?? 0) <= (best.falseClaims ?? 0);

/**
 * start: config; ladder: [{ name, hypothesis, apply(config) → config }]; evaluate(config) → { pass, critical, falseClaims, … }.
 * onStep(record) is called after every iteration (for the ledger).
 */
export async function tune({ start, ladder, evaluate, baseline = null, onStep = () => {} }) {
  let best = { config: start, result: baseline ?? (await evaluate(start)) };
  const history = [];
  let misses = 0;
  for (const step of ladder) {
    if (history.length >= BUDGET) return { best, history, stopped: "budget" };
    if (misses >= PATIENCE) return { best, history, stopped: "plateau" };
    const config = step.apply(best.config);
    const result = await evaluate(config);
    const kept = keeps(result, best.result);
    const record = { iteration: history.length + 1, change: step.name, hypothesis: step.hypothesis, config, result, kept, bestBefore: best.result.pass };
    history.push(record);
    onStep(record);
    if (kept) { best = { config, result }; misses = 0; } else misses += 1;
  }
  return { best, history, stopped: history.length >= BUDGET ? "budget" : misses >= PATIENCE ? "plateau" : "ladder-end" };
}
