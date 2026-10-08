// V3 statistics against known values (ORION V3 handoff §10, §13.5).
import { test } from "node:test";
import assert from "node:assert/strict";
import { wilson, ruleOfThree, passHatK, passAllK, mcnemarExact, bootstrapDiff, bootstrapMedianDiff, rng } from "../scripts/lib/eval/v3/stats.mjs";

const near = (a, b, eps = 1e-3) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);

test("Wilson 95% interval for 38/40 is 0.835–0.986", () => {
  const w = wilson(38, 40);
  near(w.p, 0.95); near(w.low, 0.8350); near(w.high, 0.9862);
});

test("Wilson handles 0 and n successes without leaving [0, 1]", () => {
  assert.equal(wilson(0, 20).low, 0);
  assert.ok(wilson(0, 20).high > 0.1 && wilson(0, 20).high < 0.2);
  assert.equal(wilson(20, 20).high, 1);
  assert.deepEqual(wilson(0, 0), { p: null, low: null, high: null, n: 0 });
});

test("rule of three: 0 failures in n trials bounds the rate below 3/n", () => {
  assert.equal(ruleOfThree(300), 0.01);
  assert.equal(ruleOfThree(60), 0.05);
});

test("pass^k: C(c,k)/C(n,k), and the share of cases passing every repeat", () => {
  near(passHatK(3, 4, 3), 0.25);
  assert.equal(passHatK(2, 4, 3), 0);
  assert.equal(passHatK(4, 4, 3), 1);
  assert.equal(passAllK([[true, true, true], [true, false, true], [true, true, true], [false, false, false]]), 0.5);
});

test("exact McNemar: 1 vs 6 discordant gives p = 0.125; no discordance gives 1", () => {
  near(mcnemarExact(1, 6), 0.125);
  assert.equal(mcnemarExact(0, 0), 1);
  near(mcnemarExact(0, 10), 2 / 1024);
});

test("paired bootstrap of the pass-rate difference is deterministic and brackets the truth", () => {
  const a = Array.from({ length: 40 }, (_, i) => i % 10 !== 0);
  const b = Array.from({ length: 40 }, (_, i) => i % 4 !== 0);
  const d = bootstrapDiff(a, b, { resamples: 2000, seed: 7 });
  near(d.diff, 0.9 - 0.75);
  assert.ok(d.low < d.diff && d.diff < d.high);
  assert.deepEqual(bootstrapDiff(a, b, { resamples: 2000, seed: 7 }), d);
});

test("bootstrap of a median difference and the seeded generator", () => {
  const d = bootstrapMedianDiff([1, 1.1, 0.9, 1.2, 1], [3, 3.2, 2.9, 3.1, 3], { resamples: 1000, seed: 1 });
  assert.ok(d.diff < -1.5 && d.high < 0);
  const r = rng(42); const x = r(); assert.ok(x >= 0 && x < 1); assert.equal(rng(42)(), x);
});
