// The V3 decision rule (handoff §10). Rate gates with Wilson intervals
// (pass / borderline / fail), paired comparisons on the same cases (exact
// McNemar plus a bootstrap interval on the difference), Nick's speed classes
// (≥5 s significant, ≤2 s negligible), and the per-job choice: never a model
// that fails a gate; a ≥5 s faster model unless the other is shown more
// reliable; within 2 s, the more reliable (then pass^3, then energy).
// (Written by Claude on 2026-10-08 for the V3 local-first evaluation.)
import { wilson, mcnemarExact, bootstrapDiff } from "./stats.mjs";

export function rateGate(pass, n, gate) {
  const w = wilson(pass, n);
  const status = w.p >= gate ? "pass" : w.high < gate ? "fail" : "borderline";
  return { ...w, gate, status };
}

/** a, b: per-trial booleans on the same (case, repeat) pairs. */
export function compare(a, b, { band = 0.05, resamples = 10000 } = {}) {
  const disc = a.reduce((acc, x, i) => ({ b: acc.b + (x && !b[i] ? 1 : 0), c: acc.c + (!x && b[i] ? 1 : 0) }), { b: 0, c: 0 });
  const d = bootstrapDiff(a, b, { resamples, seed: 7 });
  const verdict = d.low > 0 ? "A more reliable" : d.high < 0 ? "B more reliable" : d.low >= -band && d.high <= band ? "equivalent" : "inconclusive";
  return { diff: d.diff, low: d.low, high: d.high, discordant: disc, mcnemarP: mcnemarExact(disc.b, disc.c), verdict };
}

export const speedClass = (deltaS) => (Math.abs(deltaS) >= 5 ? "significant" : Math.abs(deltaS) <= 2 ? "negligible" : "grey");

const passRate = (xs) => xs.filter(Boolean).length / xs.length;

/**
 * candidates: [{ model, gates: bool, speedS (median TTFT or task time), perTrial: [bool], pass3?, energyJ? }]
 * → { model, why } — the handoff §10.3 rule applied pairwise from the fastest.
 */
export function choose(candidates) {
  const eligible = candidates.filter((c) => c.gates);
  if (!eligible.length) return { model: null, why: "no configuration passes every gate" };
  const sorted = [...eligible].sort((x, y) => x.speedS - y.speedS);
  let pick = sorted[0];
  let why = `${pick.model} is the fastest that passes every gate`;
  for (const other of sorted.slice(1)) {
    const delta = other.speedS - pick.speedS;
    const cmp = compare(other.perTrial, pick.perTrial);
    const otherMoreReliable = cmp.verdict === "A more reliable";
    if (speedClass(delta) === "negligible") {
      // §10.3 rule 2: paired comparison, then higher pass^3, then lower energy.
      const tied = cmp.verdict === "equivalent" || cmp.verdict === "inconclusive";
      const p3 = (x) => x.pass3 ?? passRate(x.perTrial);
      const better = otherMoreReliable || (tied && p3(other) > p3(pick))
        || (tied && p3(other) === p3(pick) && (other.energyJ ?? Infinity) < (pick.energyJ ?? Infinity));
      if (better) { why = `${other.model} is within 2 s and ${otherMoreReliable ? "shown more reliable" : p3(other) > p3(pick) ? "has higher pass^3" : "uses less energy"} (${cmp.verdict})`; pick = other; }
    } else if (otherMoreReliable) {
      why = `${other.model} is ${delta.toFixed(1)} s slower but shown more reliable (${cmp.verdict})`; pick = other;
    } else if (speedClass(delta) === "grey" && cmp.verdict === "equivalent" && other.energyJ != null && pick.energyJ != null && other.energyJ <= pick.energyJ * 0.8) {
      why = `${other.model} is in the 2–5 s grey zone, equally reliable and uses ≥20% less energy`; pick = other;
    }
  }
  return { model: pick.model, why };
}
