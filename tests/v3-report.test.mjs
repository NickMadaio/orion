// The V3 decision logic (handoff §10): gate status with intervals, paired
// comparison, speed classes and the per-job choice.
import { test } from "node:test";
import assert from "node:assert/strict";
import { rateGate, compare, speedClass, choose } from "../scripts/lib/eval/v3/report.mjs";

test("rate gates: point ≥ gate passes; upper bound below fails; otherwise borderline", () => {
  assert.equal(rateGate(115, 120, 0.95).status, "pass");
  assert.equal(rateGate(100, 120, 0.95).status, "fail");
  assert.equal(rateGate(111, 120, 0.95).status, "borderline");
});

test("paired comparison: equivalent within ±5 points, better when the interval excludes 0", () => {
  const same = Array.from({ length: 60 }, (_, i) => i % 10 !== 0);
  assert.equal(compare(same, same).verdict, "equivalent");
  const worse = same.map((x, i) => x && i % 3 !== 0);
  const c = compare(same, worse);
  assert.equal(c.verdict, "A more reliable");
  assert.ok(c.mcnemarP < 0.05);
});

test("speed classes: ≥5 s significant, ≤2 s negligible, grey between", () => {
  assert.equal(speedClass(6), "significant");
  assert.equal(speedClass(1.5), "negligible");
  assert.equal(speedClass(3), "grey");
});

test("choose: faster by ≥5 s wins unless the other is more reliable; ≤2 s goes to reliability; gate failures never win", () => {
  const a = { model: "small", gates: true, speedS: 1.0, perTrial: Array(60).fill(true) };
  const b = { model: "big", gates: true, speedS: 7.0, perTrial: Array(60).fill(true) };
  assert.equal(choose([a, b]).model, "small");
  const failing = { ...a, gates: false };
  assert.equal(choose([failing, b]).model, "big");
  const close = { model: "big", gates: true, speedS: 2.0, perTrial: Array(60).fill(true) };
  const lessReliable = { model: "small", gates: true, speedS: 1.0, perTrial: Array(60).fill(true).map((_, i) => i % 4 !== 0) };
  assert.equal(choose([lessReliable, close]).model, "big");
  assert.equal(choose([failing]).model, null);
});

test("grey zone: equivalent reliability, then ≥20% less energy breaks the tie", () => {
  const fast = { model: "fast", gates: true, speedS: 1.0, perTrial: Array(60).fill(true), energyJ: 100 };
  const frugal = { model: "frugal", gates: true, speedS: 4.0, perTrial: Array(60).fill(true), energyJ: 70 };
  assert.equal(choose([fast, frugal]).model, "frugal");
  assert.equal(choose([fast, { ...frugal, energyJ: 90 }]).model, "fast");
});
