// The statistics the V3 gates and comparisons use (ORION V3 handoff §10):
// Wilson intervals for rate gates, the rule of three for zero-failure gates,
// pass^k for consistency (τ-bench), exact McNemar and paired bootstraps for
// comparing two configurations on the same cases. Pure and seeded, so a report
// can be regenerated exactly.
// (Written by Claude on 2026-10-08 for the V3 local-first evaluation.)

const Z95 = 1.959964;

/** 95% Wilson score interval for k successes in n. */
export function wilson(k, n, z = Z95) {
  if (!n) return { p: null, low: null, high: null, n: 0 };
  const p = k / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const margin = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { p, low: k === 0 ? 0 : Math.max(0, center - margin), high: k === n ? 1 : Math.min(1, center + margin), n };
}

/** 0 failures in n trials: the true rate is below ~3/n with 95% confidence. */
export const ruleOfThree = (n) => (n > 0 ? Math.round((3 / n) * 1e6) / 1e6 : null);

const choose = (n, k) => {
  if (k < 0 || k > n) return 0;
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return r;
};

/** Unbiased pass^k estimate from c successes in n trials of one task. */
export const passHatK = (c, n, k) => (n >= k ? choose(c, k) / choose(n, k) : null);

/** Share of cases that passed every one of their repeats. rows: [[bool…] per case]. */
export const passAllK = (rows) => (rows.length ? rows.filter((r) => r.length && r.every(Boolean)).length / rows.length : null);

/** Two-sided exact McNemar p-value from the discordant counts b and c. */
export function mcnemarExact(b, c) {
  const n = b + c;
  if (n === 0) return 1;
  const tail = Array.from({ length: Math.min(b, c) + 1 }, (_, i) => choose(n, i)).reduce((s, x) => s + x, 0) / 2 ** n;
  return Math.min(1, 2 * tail);
}

/** mulberry32: a small seeded generator in [0, 1). */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const percentile = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(q * sorted.length)))];
const mean = (xs) => xs.reduce((s, x) => s + Number(x), 0) / xs.length;
const median = (xs) => {
  const s = [...xs].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * Paired bootstrap of pass-rate(a) − pass-rate(b) over cases (a[i], b[i] are the
 * same case; booleans or per-case pass fractions). 95% percentile interval.
 */
export function bootstrapDiff(a, b, { resamples = 10000, seed = 1 } = {}) {
  if (a.length !== b.length || !a.length) throw new Error("bootstrapDiff needs two equal, non-empty per-case lists");
  const next = rng(seed);
  const n = a.length;
  const diffs = Array.from({ length: resamples }, () => {
    let sa = 0; let sb = 0;
    for (let i = 0; i < n; i++) { const j = Math.floor(next() * n); sa += Number(a[j]); sb += Number(b[j]); }
    return (sa - sb) / n;
  }).sort((x, y) => x - y);
  return { diff: mean(a) - mean(b), low: percentile(diffs, 0.025), high: percentile(diffs, 0.975) };
}

/** Unpaired bootstrap of median(a) − median(b) (e.g. time to first token). */
export function bootstrapMedianDiff(a, b, { resamples = 10000, seed = 1 } = {}) {
  const next = rng(seed);
  const draw = (xs) => Array.from({ length: xs.length }, () => xs[Math.floor(next() * xs.length)]);
  const diffs = Array.from({ length: resamples }, () => median(draw(a)) - median(draw(b))).sort((x, y) => x - y);
  return { diff: median(a) - median(b), low: percentile(diffs, 0.025), high: percentile(diffs, 0.975) };
}

export { median };
